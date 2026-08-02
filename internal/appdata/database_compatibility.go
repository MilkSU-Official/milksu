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
	resolved := filepath.Join(root, descriptor.RelativePath)
	info, err := os.Lstat(resolved)
	if os.IsNotExist(err) {
		status.State = databaseStateMissing
		return status
	}
	if err != nil {
		status.State = databaseStateCorrupt
		status.Error = sanitizeDatabaseError(err.Error(), root)
		return status
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		status.State = databaseStateCorrupt
		status.Error = sanitizeDatabaseError("database path is not a regular file", root)
		return status
	}
	databaseURL := (&url.URL{Scheme: "file", Path: resolved}).String() + "?mode=ro"
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

// readMigrationHistory validates the schema_migrations bookkeeping table and
// returns the maximum recorded version. It accepts exactly the legacy
// two-column shape (version, applied_at) or the current three-column shape
// (version, name, applied_at), in order; any other layout, a missing table,
// or an abnormal history (version <= 0, gaps in 1..max, duplicates) is
// corrupt. It never reads any table other than schema_migrations. An empty
// history table yields version 0.
func readMigrationHistory(ctx context.Context, database *sql.DB) (int, error) {
	rows, err := database.QueryContext(ctx, `PRAGMA table_info(schema_migrations)`)
	if err != nil {
		return 0, fmt.Errorf("inspect schema_migrations: %w", err)
	}
	var columns []string
	for rows.Next() {
		var cid, notNull, primaryKey int
		var name, columnType string
		var defaultValue any
		if err := rows.Scan(&cid, &name, &columnType, &notNull, &defaultValue, &primaryKey); err != nil {
			rows.Close()
			return 0, fmt.Errorf("read schema_migrations columns: %w", err)
		}
		columns = append(columns, name)
	}
	rows.Close()
	if err := rows.Err(); err != nil {
		return 0, fmt.Errorf("iterate schema_migrations columns: %w", err)
	}
	if len(columns) == 0 {
		return 0, fmt.Errorf("schema_migrations table is missing")
	}
	if !slices.Equal(columns, []string{"version", "applied_at"}) &&
		!slices.Equal(columns, []string{"version", "name", "applied_at"}) {
		return 0, fmt.Errorf(
			"corrupt migration history: schema_migrations has an unknown column layout, want exactly [version applied_at] or [version name applied_at]",
		)
	}

	versionRows, err := database.QueryContext(ctx, `SELECT version FROM schema_migrations`)
	if err != nil {
		return 0, fmt.Errorf("read schema_migrations versions: %w", err)
	}
	var versions []int
	for versionRows.Next() {
		var version int
		if err := versionRows.Scan(&version); err != nil {
			versionRows.Close()
			return 0, fmt.Errorf("read schema_migrations version: %w", err)
		}
		versions = append(versions, version)
	}
	versionRows.Close()
	if err := versionRows.Err(); err != nil {
		return 0, fmt.Errorf("iterate schema_migrations versions: %w", err)
	}
	slices.Sort(versions)
	for index, version := range versions {
		if version <= 0 {
			return 0, fmt.Errorf("corrupt migration history: invalid version %d", version)
		}
		if index > 0 && version == versions[index-1] {
			return 0, fmt.Errorf("corrupt migration history: duplicate version %d", version)
		}
		if version != index+1 {
			return 0, fmt.Errorf("corrupt migration history: missing version %d", index+1)
		}
	}
	if len(versions) == 0 {
		return 0, nil
	}
	return versions[len(versions)-1], nil
}

// safeDescriptorPath reports whether relativePath is a safe slash-separated
// relative path: non-empty, not absolute, with no ".." path elements, and not
// escaping the data root after cleaning.
func safeDescriptorPath(relativePath string) bool {
	if strings.TrimSpace(relativePath) == "" {
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
