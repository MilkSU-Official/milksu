package appdata

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"time"
)

// homeMigrationJournalName is the crash-resume journal written at the state
// root while the legacy platform directory is being migrated into the unified
// ~/.milksu layout. Each completed move is appended and synced before the
// next one starts, so an interrupted migration resumes instead of restarting.
const homeMigrationJournalName = "migrating.json"

const homeMigrationJournalSchema = "milksu-home-migration/v1"

// legacyHomeRenameSuffix marks the original platform directory after a
// successful migration. It is kept in place as a manual-recovery copy; no
// MilkSU build reads it automatically.
const legacyHomeRenameSuffix = ".pre-milksu-home"

// homeMigrationMap moves every top-level entry of the legacy platform data
// directory (os.UserConfigDir()/com.milksu.app) to its unified-layout
// location, relative to the state root. Entries absent from this table are
// preserved under data/legacy-unmapped/ for manual recovery.
var homeMigrationMap = map[string]string{
	"settings.json":              "config/settings.json",
	"credentials.db":             "config/credentials.db",
	"conversations":              "data/stores/conversations",
	"session-index":              "data/stores/session-index",
	"usage":                      "data/stores/usage",
	"lab-jobs":                   "data/stores/lab-jobs",
	"coding-project-memory.json": "data/stores/coding-project-memory.json",
	"agent-home":                 "data/agent/home",
	"agent-resources":            "data/agent/resources",
	"ctf":                        "data/domain/ctf",
	"vuln":                       "data/domain/vuln",
	"evalsuite":                  "data/domain/evalsuite",
	"nssctf":                     "data/domain/nssctf",
	"ctfshow":                    "data/domain/ctfshow",
	"plugins":                    "data/services/plugins",
	"envbroker":                  "data/services/envbroker",
	"coding-tools":               "data/services/coding-tools",
	"security-tools":             "data/services/security-tools",
	"model-catalog":              "data/services/model-catalog",
	"computer-use":               "data/services/computer-use",
	"companion":                  "data/companion",
	"runtime":                    "data/runtime",
	"lifespan.json":              "data/runtime/lifespan.json",
	"agent-workspace":            "workspaces/agent-workspace",
	"agent-workspaces":           "workspaces/agent-workspaces",
	"ctf-workspaces":             "workspaces/ctf-workspaces",
	"browser":                    "workspaces/browser",
	"restore":                    "backups/restore",
}

// unmappedHomeMigrationPrefix preserves legacy entries this build does not
// know about. Nothing reads them automatically; they exist so a migration
// never silently deletes user data.
const unmappedHomeMigrationPrefix = "data/legacy-unmapped"

type homeMigrationJournal struct {
	Schema    string   `json:"schema"`
	Legacy    string   `json:"legacy"`
	StartedAt string   `json:"startedAt"`
	Completed []string `json:"completed"`
}

// migrateLegacyHome moves an existing legacy platform data directory into the
// unified state root. It runs only when the root carries no data-layout.json
// yet, so a fresh install or an already migrated root never enters it. The
// legacy directory itself is renamed with a .pre-milksu-home suffix instead of
// being deleted.
func migrateLegacyHome(root string) error {
	legacy, err := legacyHomeDirectory()
	if err != nil {
		// Without a platform config directory there is nothing to migrate.
		return nil
	}
	return migrateLegacyHomeFrom(root, legacy)
}

func migrateLegacyHomeFrom(root, legacy string) error {
	if _, err := os.Lstat(filepath.Join(root, DataLayoutFile)); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect data layout marker: %w", err)
	}
	entries, err := os.ReadDir(legacy)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect legacy MilkSU directory: %w", err)
	}
	migratable := false
	for _, entry := range entries {
		if entry.Name() != DataLayoutFile {
			migratable = true
			break
		}
	}
	if !migratable {
		return nil
	}

	journal, err := openHomeMigrationJournal(root, legacy)
	if err != nil {
		return err
	}
	completed := make(map[string]struct{}, len(journal.Completed))
	for _, name := range journal.Completed {
		completed[name] = struct{}{}
	}
	for _, entry := range entries {
		name := entry.Name()
		if name == DataLayoutFile {
			continue
		}
		if _, done := completed[name]; done {
			continue
		}
		target := homeMigrationMap[name]
		if target == "" {
			target = unmappedHomeMigrationPrefix + "/" + name
		}
		if err := moveHomeMigrationEntry(root, legacy, name, target); err != nil {
			return err
		}
		journal.Completed = append(journal.Completed, name)
		if err := writeHomeMigrationJournal(root, journal); err != nil {
			return err
		}
	}
	if err := migrateLegacyMigrationBackups(root, legacy); err != nil {
		return err
	}
	if err := renameLegacyHome(legacy); err != nil {
		return err
	}
	if err := os.Remove(filepath.Join(root, homeMigrationJournalName)); err != nil &&
		!errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("clear home migration journal: %w", err)
	}
	return nil
}

func legacyHomeDirectory() (string, error) {
	base, err := os.UserConfigDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(base, BundleIdentifier), nil
}

func openHomeMigrationJournal(root, legacy string) (homeMigrationJournal, error) {
	path := filepath.Join(root, homeMigrationJournalName)
	journal := homeMigrationJournal{
		Schema:    homeMigrationJournalSchema,
		Legacy:    legacy,
		StartedAt: time.Now().UTC().Format(time.RFC3339),
	}
	data, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		if err := writeHomeMigrationJournal(root, journal); err != nil {
			return homeMigrationJournal{}, err
		}
		return journal, nil
	}
	if err != nil {
		return homeMigrationJournal{}, fmt.Errorf("read home migration journal: %w", err)
	}
	if err := json.Unmarshal(data, &journal); err != nil {
		return homeMigrationJournal{}, fmt.Errorf("decode home migration journal: %w", err)
	}
	if journal.Schema != homeMigrationJournalSchema || journal.Legacy != legacy {
		return homeMigrationJournal{}, fmt.Errorf("home migration journal does not match this migration")
	}
	return journal, nil
}

func writeHomeMigrationJournal(root string, journal homeMigrationJournal) error {
	return writeJSONAtomically(filepath.Join(root, homeMigrationJournalName), journal)
}

// moveHomeMigrationEntry moves one legacy entry into the unified layout. A
// source that already disappeared is treated as a completed earlier move, so
// a resumed migration never repeats work. When both sides exist as
// directories (a file target may have created the directory first, e.g.
// data/runtime), the source children are merged in; anything that conflicts
// stays behind and is preserved by the legacy directory rename.
func moveHomeMigrationEntry(root, legacy, name, target string) error {
	source := filepath.Join(legacy, name)
	destination := filepath.Join(root, filepath.FromSlash(target))
	sourceInfo, err := os.Lstat(source)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect migration source %q: %w", name, err)
	}
	destinationInfo, err := os.Lstat(destination)
	if errors.Is(err, os.ErrNotExist) {
		if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
			return fmt.Errorf("prepare migration target %q: %w", target, err)
		}
		if err := moveFileOrDirectory(source, destination); err != nil {
			return fmt.Errorf("migrate %q to %q: %w", name, target, err)
		}
		return nil
	}
	if err != nil {
		return fmt.Errorf("inspect migration target %q: %w", target, err)
	}
	if sourceInfo.IsDir() && destinationInfo.IsDir() {
		if err := mergeMigrationDirectory(source, destination); err != nil {
			return fmt.Errorf("merge %q into %q: %w", name, target, err)
		}
		return nil
	}
	return fmt.Errorf("migration target %q already exists", target)
}

func mergeMigrationDirectory(source, destination string) error {
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
			if err := mergeMigrationDirectory(sourceChild, destinationChild); err != nil {
				return err
			}
			continue
		}
		// A conflicting entry stays in the legacy directory, which the
		// migration renames rather than deletes.
	}
	if err := os.Remove(source); err != nil {
		// Leftover conflicts keep the directory alive; the legacy rename
		// preserves them.
		if entries, readErr := os.ReadDir(source); readErr != nil || len(entries) > 0 {
			return nil
		}
		return err
	}
	return nil
}

func moveFileOrDirectory(source, destination string) error {
	if err := os.Rename(source, destination); err == nil {
		return nil
	}
	// Cross-device fall back: copy, then remove the source only after the
	// copy completed. The journal makes a repeated run safe.
	if err := copyPath(source, destination); err != nil {
		return err
	}
	return os.RemoveAll(source)
}

func copyPath(source, destination string) error {
	info, err := os.Lstat(source)
	if err != nil {
		return err
	}
	switch {
	case info.Mode()&os.ModeSymlink != 0:
		target, err := os.Readlink(source)
		if err != nil {
			return err
		}
		return os.Symlink(target, destination)
	case info.IsDir():
		if err := os.Mkdir(destination, info.Mode().Perm()); err != nil {
			return err
		}
		entries, err := os.ReadDir(source)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if err := copyPath(
				filepath.Join(source, entry.Name()),
				filepath.Join(destination, entry.Name()),
			); err != nil {
				return err
			}
		}
		return nil
	case info.Mode().IsRegular():
		return copyRegularFile(source, destination, info.Mode().Perm())
	default:
		return fmt.Errorf("unsupported file type %s", info.Mode().Type())
	}
}

func copyRegularFile(source, destination string, mode fs.FileMode) error {
	input, err := os.Open(source)
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(destination, os.O_CREATE|os.O_EXCL|os.O_WRONLY, mode)
	if err != nil {
		return err
	}
	if _, err := io.Copy(output, input); err != nil {
		output.Close()
		return err
	}
	if err := output.Sync(); err != nil {
		output.Close()
		return err
	}
	return output.Close()
}

// migrateLegacyMigrationBackups moves the pre-unification migration backup
// directory, which lived as a hidden sibling of the legacy data directory,
// into <root>/backups/migration-backups.
func migrateLegacyMigrationBackups(root, legacy string) error {
	source := filepath.Join(
		filepath.Dir(legacy),
		"."+filepath.Base(legacy)+migrationBackupDirectorySuffix,
	)
	if _, err := os.Lstat(source); errors.Is(err, os.ErrNotExist) {
		return nil
	} else if err != nil {
		return fmt.Errorf("inspect legacy migration backups: %w", err)
	}
	destination := filepath.Join(root, "backups", "migration-backups")
	if _, err := os.Lstat(destination); err == nil {
		return nil
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect migration backup target: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return fmt.Errorf("prepare migration backup target: %w", err)
	}
	if err := moveFileOrDirectory(source, destination); err != nil {
		return fmt.Errorf("migrate legacy migration backups: %w", err)
	}
	return nil
}

func renameLegacyHome(legacy string) error {
	renamed := legacy + legacyHomeRenameSuffix
	if _, err := os.Lstat(renamed); err == nil {
		renamed = fmt.Sprintf("%s.%s", renamed, time.Now().UTC().Format("20060102T150405Z"))
	} else if !errors.Is(err, os.ErrNotExist) {
		return fmt.Errorf("inspect legacy rename target: %w", err)
	}
	if err := os.Rename(legacy, renamed); err != nil {
		return fmt.Errorf("rename legacy MilkSU directory: %w", err)
	}
	return nil
}
