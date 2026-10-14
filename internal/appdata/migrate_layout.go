package appdata

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"
)

// dataLayoutMigrationJournalName is the crash-resume journal for the in-place
// data-layout migration of an existing state root. Each completed move is
// appended and synced before the next one starts, so an interrupted migration
// resumes instead of restarting. It is removed once every entry has moved and
// before the version-2 marker is written.
const dataLayoutMigrationJournalName = "data-layout-migration.json"

const dataLayoutMigrationJournalSchema = "milksu-data-layout-migration/v1"

// preV2MigrationSuffix marks an entry that already occupied a version-2 target
// when the version-1 source was moved in. The pre-existing copy is renamed,
// never deleted, so nothing a partial version-2 run created is ever lost.
const preV2MigrationSuffix = ".pre-v2-migration"

// dataLayoutV2MigrationMap moves every top-level entry of a version-1 state
// root into its version-2 location, relative to the root. Each target is the
// path the version-2 readers actually resolve; keep the cited reader in sync
// when a path moves again. Entries absent from this table are preserved under
// data/legacy-unmapped/ for manual recovery.
var dataLayoutV2MigrationMap = map[string]string{
	// Stores.
	"conversations":              "data/stores/conversations",              // internal/conversation/store.go NewStore
	"session-index":              "data/stores/session-index",              // cmd/milksu-backend/app.go sessionindex.NewStore
	"usage":                      "data/stores/usage",                      // cmd/milksu-backend/app.go modelusage.NewStore
	"lab-jobs":                   "data/stores/lab-jobs",                   // internal/lab/store.go NewStore
	"coding-project-memory.json": "data/stores/coding-project-memory.json", // internal/codingworkspace/store.go NewStore

	// Configuration.
	"settings.json":  "config/settings.json",  // internal/config/settings.go NewStore
	"credentials.db": "config/credentials.db", // internal/config/settings.go newSQLiteSecretStore

	// Agent state.
	"agent-home":      "data/agent/home",      // internal/engine/sidecar.go sidecarRuntimeHome
	"agent-resources": "data/agent/resources", // internal/agentresources/store.go NewStore
	"companion":       "data/companion",       // cmd/milksu-backend/app.go companion.RuntimeOptions

	// Runtime.
	"runtime":       "data/runtime",               // cmd/milksu-backend/app.go securityruntime.NewService
	"lifespan.json": "data/runtime/lifespan.json", // internal/appdata/lifespan.go lifespanPath

	// Services.
	"model-catalog":  "data/services/model-catalog",  // internal/modelcatalog/service.go New
	"plugins":        "data/services/plugins",        // cmd/milksu-backend/app_plugins.go newPluginRegistry
	"envbroker":      "data/services/envbroker",      // internal/envbroker/store.go NewStore
	"coding-tools":   "data/services/coding-tools",   // internal/codingtools/tools.go NewService
	"security-tools": "data/services/security-tools", // internal/securitytools/service.go NewService
	"computer-use":   "data/services/computer-use",   // internal/computercap/prepare.go preparedDriverPath

	// Domain roles. ctf / nssctf / ctfshow / evalsuite stay so existing
	// version-1 roots still move once; the product no longer opens them.
	"ctf":       "data/domain/ctf",
	"nssctf":    "data/domain/nssctf",
	"ctfshow":   "data/domain/ctfshow",
	"vuln":      "data/domain/vuln", // internal/vuln/feed.go, internal/vuln/practice.go
	"evalsuite": "data/domain/evalsuite",

	// Workspaces and backups.
	"agent-workspace":  "workspaces/agent-workspace",  // internal/engine/sidecar.go sidecarWorkspace
	"agent-workspaces": "workspaces/agent-workspaces", // cmd/milksu-backend/app.go workspaceRoot
	"ctf-workspaces":   "workspaces/ctf-workspaces",
	"browser":          "workspaces/browser", // cmd/milksu-backend/app.go browsercap.New
	"restore":          "backups/restore",    // internal/appdata/restore.go restoreDirectoryName
}

// dataLayoutV2RootKeepNames lists root entries the version-2 migration never
// touches: the layout marker, both migration journals, and the version-2
// structural directories that are already at their final location. A partial
// version-2 run may have created any of them before the rollback; moving them
// (or filing them under legacy-unmapped) would hide live data such as a
// hand-made incident backup inside backups/.
var dataLayoutV2RootKeepNames = map[string]struct{}{
	DataLayoutFile:                 {},
	homeMigrationJournalName:       {},
	dataLayoutMigrationJournalName: {},
	"data":                         {},
	"config":                       {},
	"workspaces":                   {},
	"backups":                      {},
}

type dataLayoutMigrationJournal struct {
	Schema      string   `json:"schema"`
	FromVersion int      `json:"fromVersion"`
	ToVersion   int      `json:"toVersion"`
	StartedAt   string   `json:"startedAt"`
	Completed   []string `json:"completed"`
}

// migrateDataLayoutV1ToV2 moves the top-level entries of a version-1 state
// root into their version-2 locations. A version-1 root keeps every managed
// path directly at the root; version-2 readers resolve the unified
// data/config/workspaces/backups subpaths, so without this move the marker
// would say version 2 while the readers see empty directories.
func migrateDataLayoutV1ToV2(root string) error {
	root, err := secureRoot(root)
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return fmt.Errorf("inspect version-1 state root: %w", err)
	}
	journal, err := openDataLayoutMigrationJournal(root)
	if err != nil {
		return err
	}
	completed := make(map[string]struct{}, len(journal.Completed))
	for _, name := range journal.Completed {
		completed[name] = struct{}{}
	}
	names := make([]string, 0, len(entries))
	for _, entry := range entries {
		names = append(names, entry.Name())
	}
	sort.Strings(names)
	for _, name := range names {
		if _, keep := dataLayoutV2RootKeepNames[name]; keep {
			continue
		}
		if _, done := completed[name]; done {
			continue
		}
		target := dataLayoutV2MigrationMap[name]
		if target == "" {
			target = unmappedHomeMigrationPrefix + "/" + name
		}
		if err := moveDataLayoutMigrationEntry(root, name, target); err != nil {
			return err
		}
		journal.Completed = append(journal.Completed, name)
		if err := writeDataLayoutMigrationJournal(root, journal); err != nil {
			return err
		}
	}
	if err := os.Remove(filepath.Join(root, dataLayoutMigrationJournalName)); err != nil &&
		!errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("clear data layout migration journal: %w", err)
	}
	return nil
}

func openDataLayoutMigrationJournal(root string) (dataLayoutMigrationJournal, error) {
	path := filepath.Join(root, dataLayoutMigrationJournalName)
	journal := dataLayoutMigrationJournal{
		Schema:      dataLayoutMigrationJournalSchema,
		FromVersion: 1,
		ToVersion:   2,
		StartedAt:   time.Now().UTC().Format(time.RFC3339),
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		if err := writeDataLayoutMigrationJournal(root, journal); err != nil {
			return dataLayoutMigrationJournal{}, err
		}
		return journal, nil
	}
	if err != nil {
		return dataLayoutMigrationJournal{}, fmt.Errorf("read data layout migration journal: %w", err)
	}
	if err := json.Unmarshal(data, &journal); err != nil {
		return dataLayoutMigrationJournal{}, fmt.Errorf("decode data layout migration journal: %w", err)
	}
	if journal.Schema != dataLayoutMigrationJournalSchema ||
		journal.FromVersion != 1 || journal.ToVersion != 2 {
		return dataLayoutMigrationJournal{}, fmt.Errorf(
			"data layout migration journal does not match this migration")
	}
	return journal, nil
}

func writeDataLayoutMigrationJournal(root string, journal dataLayoutMigrationJournal) error {
	return writeJSONAtomically(filepath.Join(root, dataLayoutMigrationJournalName), journal)
}

// moveDataLayoutMigrationEntry moves one root entry into its version-2
// location. A source that already disappeared is treated as a completed
// earlier move, so a resumed migration never repeats work. A target that
// already exists (for example a default file a partial version-2 run wrote)
// is renamed aside with the .pre-v2-migration suffix before the source moves
// in; directory targets are merged sub-item by sub-item under the same rule.
func moveDataLayoutMigrationEntry(root, name, target string) error {
	source := filepath.Join(root, name)
	destination := filepath.Join(root, filepath.FromSlash(target))
	sourceInfo, err := os.Lstat(source)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect layout migration source %q: %w", name, err)
	}
	destinationInfo, err := os.Lstat(destination)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
			return fmt.Errorf("prepare layout migration target %q: %w", target, err)
		}
		if err := moveFileOrDirectory(source, destination); err != nil {
			return fmt.Errorf("migrate %q to %q: %w", name, target, err)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect layout migration target %q: %w", target, err)
	}
	if sourceInfo.IsDir() && destinationInfo.IsDir() {
		if err := mergeDataLayoutDirectory(source, destination); err != nil {
			return fmt.Errorf("merge %q into %q: %w", name, target, err)
		}
		return nil
	}
	if err := renameDataLayoutConflict(destination); err != nil {
		return fmt.Errorf("preserve existing layout migration target %q: %w", target, err)
	}
	if err := moveFileOrDirectory(source, destination); err != nil {
		return fmt.Errorf("migrate %q to %q: %w", name, target, err)
	}
	return nil
}

// mergeDataLayoutDirectory folds a source directory into an existing target
// directory, sub-item by sub-item. Every child either moves to a free name or
// renames the occupying entry aside, so the source ends up empty and is
// removed; nothing is overwritten and nothing is deleted.
func mergeDataLayoutDirectory(source, destination string) error {
	entries, err := os.ReadDir(source)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		sourceChild := filepath.Join(source, entry.Name())
		destinationChild := filepath.Join(destination, entry.Name())
		sourceInfo, err := os.Lstat(sourceChild)
		if err != nil {
			return err
		}
		destinationInfo, err := os.Lstat(destinationChild)
		if errors.Is(err, os.ErrNotExist) {
			if err := moveFileOrDirectory(sourceChild, destinationChild); err != nil {
				return err
			}
			continue
		}
		if err != nil {
			return err
		}
		if sourceInfo.IsDir() && destinationInfo.IsDir() {
			if err := mergeDataLayoutDirectory(sourceChild, destinationChild); err != nil {
				return err
			}
			continue
		}
		if err := renameDataLayoutConflict(destinationChild); err != nil {
			return err
		}
		if err := moveFileOrDirectory(sourceChild, destinationChild); err != nil {
			return err
		}
	}
	return os.Remove(source)
}

// renameDataLayoutConflict preserves an entry that already occupies a
// version-2 target path by renaming it with the .pre-v2-migration suffix. A
// second conflicting copy gets a UTC timestamp appended so repeated partial
// runs never overwrite an earlier preserved copy either.
func renameDataLayoutConflict(path string) error {
	aside := path + preV2MigrationSuffix
	if _, err := os.Lstat(aside); err == nil {
		aside = fmt.Sprintf(
			"%s%s.%s",
			path,
			preV2MigrationSuffix,
			time.Now().UTC().Format("20060102T150405Z"),
		)
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect preserved target %q: %w", path, err)
	}
	if err := os.Rename(path, aside); err != nil {
		return fmt.Errorf("rename %q: %w", path, err)
	}
	return nil
}
