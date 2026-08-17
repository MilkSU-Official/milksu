package appdata

import (
	"context"
	"database/sql"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"slices"
	"strings"

	_ "modernc.org/sqlite"
)

const (
	databaseStateCompatible = "compatible"
	databaseStateMissing    = "missing"
	databaseStateNewer      = "newer"
	databaseStateCorrupt    = "corrupt"
	databaseStateRemaining  = "remaining"
)

// DatabaseDescriptor identifies one SQLite database under the data root that
// the read-only compatibility inspection reports on. RelativePath is a
// slash-separated RELATIVE path under the data root. Supported is the
// migration version this build supports; 0 means the database is not yet
// migrated ("remaining").
type DatabaseDescriptor struct {
	LogicalName  string
	RelativePath string
	Supported    int
}

// DatabaseCompatibilityStatus is the read-only compatibility verdict for one
// database. State is exactly one of the fixed set: "compatible", "missing",
// "newer", "corrupt", "remaining". Current is set only when determined
// (compatible/newer); Supported is set from the descriptor when it is > 0.
type DatabaseCompatibilityStatus struct {
	LogicalName  string `json:"logicalName"`
	RelativePath string `json:"relativePath"`
	Current      *int   `json:"current,omitempty"`
	Supported    *int   `json:"supported,omitempty"`
	State        string `json:"state"`
	Error        string `json:"error,omitempty"`
}

// ReadOnlySQLiteURL renders an absolute filesystem path as a SQLite file URI
// with mode=ro. Windows drive-letter paths are normalized to the canonical
// rooted file:/C:/... shape: url.URL alone would treat the rootless "C:/"
// path as a URI authority and SQLite would reject it, while backslashes would
// be escaped into %5C.
func ReadOnlySQLiteURL(path string) string {
	slashed := filepath.ToSlash(path)
	if !strings.HasPrefix(slashed, "/") {
		slashed = "/" + slashed
	}
	return (&url.URL{Scheme: "file", Path: slashed}).String() + "?mode=ro"
}

// InspectDatabaseCompatibility performs a strictly read-only inspection of the
// databases described by descriptors under root. It never writes, never
// creates files or directories, never reads business-table contents, never
// runs quick_check, never runs migrations, and never executes write PRAGMAs.
// Results preserve descriptor order; a descriptor whose basename is
// credentials.db (case-insensitive) is skipped entirely and never appears in
// the results.
func InspectDatabaseCompatibility(
	ctx context.Context,
	root string,
	descriptors []DatabaseDescriptor,
) []DatabaseCompatibilityStatus {
	validatedRoot, rootErr := secureRoot(root)
	rootError := ""
	if rootErr != nil {
		rootError = sanitizeDatabaseError(rootErr.Error(), root)
	}
	result := make([]DatabaseCompatibilityStatus, 0, len(descriptors))
	for _, descriptor := range descriptors {
		if strings.EqualFold(filepath.Base(descriptor.RelativePath), "credentials.db") {
			continue
		}
		if descriptor.Supported < 0 {
			result = append(result, DatabaseCompatibilityStatus{
				LogicalName:  descriptor.LogicalName,
				RelativePath: filepath.ToSlash(descriptor.RelativePath),
				State:        databaseStateCorrupt,
				Error:        sanitizeDatabaseError("invalid database descriptor: negative supported version", root),
			})
			continue
		}
		if !safeDescriptorPath(descriptor.RelativePath) {
			result = append(result, DatabaseCompatibilityStatus{
				LogicalName:  descriptor.LogicalName,
				RelativePath: filepath.ToSlash(descriptor.RelativePath),
				State:        databaseStateCorrupt,
				Error:        sanitizeDatabaseError("unsafe database path", root),
				Supported:    supportedDatabaseVersion(descriptor.Supported),
			})
			continue
		}
		if descriptor.Supported == 0 {
			result = append(result, DatabaseCompatibilityStatus{
				LogicalName:  descriptor.LogicalName,
				RelativePath: filepath.ToSlash(descriptor.RelativePath),
				State:        databaseStateRemaining,
			})
			continue
		}
		if rootErr != nil {
			result = append(result, DatabaseCompatibilityStatus{
				LogicalName:  descriptor.LogicalName,
				RelativePath: filepath.ToSlash(descriptor.RelativePath),
				State:        databaseStateCorrupt,
				Error:        rootError,
				Supported:    supportedDatabaseVersion(descriptor.Supported),
			})
			continue
		}
		result = append(
			result,
			inspectDatabaseCompatibility(ctx, validatedRoot, descriptor),
		)
	}
	return result
}

func inspectDatabaseCompatibility(
	ctx context.Context,
	root string,
	descriptor DatabaseDescriptor,
) DatabaseCompatibilityStatus {
	status := DatabaseCompatibilityStatus{
		LogicalName:  descriptor.LogicalName,
		RelativePath: filepath.ToSlash(descriptor.RelativePath),
		Supported:    supportedDatabaseVersion(descriptor.Supported),
	}
	accumulated, missing, err := resolveDatabaseFile(root, descriptor.RelativePath)
	if missing {
		status.State = databaseStateMissing
		return status
	}
	if err != nil {
		status.State = databaseStateCorrupt
		status.Error = sanitizeDatabaseError(err.Error(), root)
		return status
	}

	databaseURL := ReadOnlySQLiteURL(accumulated)
	database, err := sql.Open("sqlite", databaseURL)
	if err != nil {
		status.State = databaseStateCorrupt
		status.Error = sanitizeDatabaseError(err.Error(), root)
		return status
	}
	defer database.Close()
	database.SetMaxOpenConns(1)

	current, err := readMigrationHistory(ctx, database)
	if err != nil {
		status.State = databaseStateCorrupt
		status.Error = sanitizeDatabaseError(err.Error(), root)
		return status
	}
	if current > descriptor.Supported {
		status.State = databaseStateNewer
	} else {
		status.State = databaseStateCompatible
	}
	value := current
	status.Current = &value
	return status
}

// resolveDatabaseFile walks component by component from root down through a
// safe descriptor path. A symbolic link at any position is rejected without
// resolving through it. missing is true at the first absent component; the
// function never creates anything.
func resolveDatabaseFile(root, relativePath string) (path string, missing bool, err error) {
	components := strings.Split(relativePath, "/")
	walkPaths := make([]string, 0, len(components)+1)
	accumulated := root
	walkPaths = append(walkPaths, root)
	for _, component := range components {
		accumulated = filepath.Join(accumulated, component)
		walkPaths = append(walkPaths, accumulated)
	}
	for index, candidate := range walkPaths {
		info, statErr := os.Lstat(candidate)
		if os.IsNotExist(statErr) {
			return "", true, nil
		}
		if statErr != nil {
			return "", false, statErr
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return "", false, fmt.Errorf("database path contains a symbolic link")
		}
		if index == len(walkPaths)-1 {
			if !info.Mode().IsRegular() {
				return "", false, fmt.Errorf("database path is not a regular file")
			}
			break
		}
		if !info.IsDir() {
			return "", false, fmt.Errorf("database path contains a non-directory component")
		}
	}
	return accumulated, false, nil
}

type migrationHistoryState struct {
	Exists  bool
	Current int
}

// readMigrationHistory validates the schema_migrations bookkeeping table and
// returns the maximum recorded version. It accepts exactly the legacy
// two-column shape (version, applied_at) or the current three-column shape
// (version, name, applied_at), in order; any other layout, a missing table,
// or an abnormal history (version <= 0, gaps in 1..max, duplicates) is
// corrupt. It never reads any table other than schema_migrations. An empty
// history table yields version 0.
func readMigrationHistory(ctx context.Context, database *sql.DB) (int, error) {
	state, err := inspectMigrationHistory(ctx, database)
	if err != nil {
		return 0, err
	}
	if !state.Exists {
		return 0, fmt.Errorf("schema_migrations table is missing")
	}
	return state.Current, nil
}

// inspectMigrationHistory is the read-only primitive shared by compatibility
// reporting and the pre-migration backup planner. Exists=false is a legitimate
// pre-migrator state for the planner; readMigrationHistory deliberately keeps
// treating it as "corrupt" in user-facing compatibility reports until the
// owning database migrator validates and adopts the legacy business schema.
func inspectMigrationHistory(ctx context.Context, database *sql.DB) (migrationHistoryState, error) {
	rows, err := database.QueryContext(ctx, `PRAGMA table_info(schema_migrations)`)
	if err != nil {
		return migrationHistoryState{}, fmt.Errorf("inspect schema_migrations: %w", err)
	}
	var columns []string
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			rows.Close()
			return migrationHistoryState{}, fmt.Errorf("read schema_migrations columns: %w", err)
		}
		columns = append(columns, name)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return migrationHistoryState{}, fmt.Errorf("iterate schema_migrations columns: %w", err)
	}
	if len(columns) == 0 {
		return migrationHistoryState{Exists: false}, nil
	}
	if !slices.Equal(columns, []string{"version", "applied_at"}) &&
		!slices.Equal(columns, []string{"version", "name", "applied_at"}) {
		return migrationHistoryState{}, fmt.Errorf(
			"corrupt migration history: schema_migrations has an unknown column layout, want exactly [version applied_at] or [version name applied_at]",
		)
	}

	versionRows, err := database.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return migrationHistoryState{}, fmt.Errorf("read schema_migrations versions: %w", err)
	}
	var versions []int
	for versionRows.Next() {
		var version int
		if err := versionRows.Scan(&version); err != nil {
			versionRows.Close()
			return migrationHistoryState{}, fmt.Errorf("read schema_migrations version: %w", err)
		}
		versions = append(versions, version)
	}
	versionRows.Close()
	if err := versionRows.Err(); err != nil {
		return migrationHistoryState{}, fmt.Errorf("iterate schema_migrations versions: %w", err)
	}
	slices.Sort(versions)
	for index, version := range versions {
		if version <= 0 {
			return migrationHistoryState{}, fmt.Errorf("corrupt migration history: invalid version %d", version)
		}
		if index > 0 && version == versions[index-1] {
			return migrationHistoryState{}, fmt.Errorf("corrupt migration history: duplicate version %d", version)
		}
		if version != index+1 {
			return migrationHistoryState{}, fmt.Errorf("corrupt migration history: missing version %d", index+1)
		}
	}
	if len(versions) == 0 {
		return migrationHistoryState{Exists: true}, nil
	}
	return migrationHistoryState{Exists: true, Current: versions[len(versions)-1]}, nil
}

// safeDescriptorPath reports whether relativePath is a safe slash-separated
// relative path: non-empty, not absolute, with no ".." path elements, and not
// escaping the data root after cleaning.
func safeDescriptorPath(relativePath string) bool {
	if strings.TrimSpace(relativePath) == "" {
		return false
	}
	if strings.HasPrefix(relativePath, "/") {
		return false
	}
	native := filepath.FromSlash(relativePath)
	if filepath.IsAbs(native) {
		return false
	}
	clean := filepath.Clean(native)
	if clean == "." || clean == ".." ||
		strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return false
	}
	for _, element := range strings.Split(native, string(filepath.Separator)) {
		if element == ".." {
			return false
		}
	}
	return true
}

func supportedDatabaseVersion(supported int) *int {
	if supported > 0 {
		value := supported
		return &value
	}
	return nil
}

// sanitizeDatabaseError redacts secrets and replaces the absolute data root
// with "<data>" so no absolute path leaks into a status.
func sanitizeDatabaseError(value, root string) string {
	return sanitizeDiagnosticText(strings.ReplaceAll(value, root, "<data>"))
}
