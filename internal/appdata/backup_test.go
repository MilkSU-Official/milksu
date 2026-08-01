package appdata

import (
	"archive/zip"
	"context"
	"database/sql"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func TestExportBackupIncludesUserStateAndExcludesCredentials(t *testing.T) {
	root := t.TempDir()
	writeBackupFixture(
		t,
		filepath.Join(root, "settings.json"),
		`{"locale":"zh","providers":{"legacy":{"api_key":"legacy-provider-secret","has_api_key":true}}}`,
	)
	writeBackupFixture(t, filepath.Join(root, "conversations", "one.json"), `{"id":"one"}`)
	writeBackupFixture(t, filepath.Join(root, "ctf-workspaces", "job", "notes.md"), "evidence")
	writeBackupFixture(t, filepath.Join(root, "credentials.db"), "provider-secret")
	writeBackupFixture(t, filepath.Join(root, "browser", "bridge-pairing.json"), "bridge-secret")
	writeBackupFixture(t, filepath.Join(root, "agent-home", "pi", "auth.json"), "pi-secret")
	writeBackupFixture(t, filepath.Join(root, "agent-home", "pi", "sessions", "session.jsonl"), "resume")
	if err := os.Symlink(
		filepath.Join(root, "credentials.db"),
		filepath.Join(root, "conversations", "credential-link"),
	); err != nil {
		t.Fatal(err)
	}
	createBackupDatabase(t, filepath.Join(root, "ctf", "memory.sqlite3"))

	destination := filepath.Join(t.TempDir(), "MilkSU-backup.zip")
	exported, err := ExportBackup(context.Background(), root, destination)
	if err != nil {
		t.Fatal(err)
	}
	if exported.CredentialsIncluded || exported.FileCount != 5 || exported.Bytes <= 0 {
		t.Fatalf("unexpected export: %#v", exported)
	}
	validation, err := ValidateBackup(destination)
	if err != nil {
		t.Fatal(err)
	}
	if !validation.Valid || validation.CredentialsIncluded || validation.FileCount != exported.FileCount {
		t.Fatalf("unexpected validation: %#v", validation)
	}

	names, manifest := readBackupArchive(t, destination)
	for _, required := range []string{
		"data/settings.json",
		"data/conversations/one.json",
		"data/ctf-workspaces/job/notes.md",
		"data/ctf/memory.sqlite3",
		"data/agent-home/pi/sessions/session.jsonl",
		"manifest.json",
	} {
		if !slices.Contains(names, required) {
			t.Fatalf("backup is missing %q: %#v", required, names)
		}
	}
	for _, forbidden := range []string{"credentials.db", "bridge-pairing.json", "auth.json", "credential-link"} {
		if strings.Contains(strings.Join(names, "\n"), forbidden) {
			t.Fatalf("backup leaked %q: %#v", forbidden, names)
		}
	}
	if manifest.CredentialsIncluded || manifest.Schema != BackupSchema {
		t.Fatalf("unexpected manifest: %#v", manifest)
	}
	settings := readBackupEntry(t, destination, "data/settings.json")
	if strings.Contains(settings, "legacy-provider-secret") || strings.Contains(settings, `"api_key"`) {
		t.Fatalf("backup leaked a settings credential: %s", settings)
	}

	extracted := filepath.Join(t.TempDir(), "memory.sqlite3")
	extractBackupEntry(t, destination, "data/ctf/memory.sqlite3", extracted)
	database, err := sql.Open("sqlite", extracted)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	var value string
	if err := database.QueryRow(`SELECT value FROM proof WHERE id = 1`).Scan(&value); err != nil {
		t.Fatal(err)
	}
	if value != "verified" {
		t.Fatalf("snapshot value = %q", value)
	}
}

func TestExportBackupRejectsDestinationInsideDataDirectory(t *testing.T) {
	root := t.TempDir()
	writeBackupFixture(t, filepath.Join(root, "settings.json"), `{}`)
	if _, err := ExportBackup(
		context.Background(),
		root,
		filepath.Join(root, "backup.zip"),
	); err == nil || !strings.Contains(err.Error(), "outside") {
		t.Fatalf("expected destination rejection, got %v", err)
	}
}

func TestValidateBackupRejectsSensitiveAndTraversalPaths(t *testing.T) {
	for name, archivePath := range map[string]string{
		"sensitive": "data/credentials.db",
		"traversal": "../escape",
	} {
		t.Run(name, func(t *testing.T) {
			path := filepath.Join(t.TempDir(), "invalid.zip")
			file, err := os.Create(path)
			if err != nil {
				t.Fatal(err)
			}
			writer := zip.NewWriter(file)
			manifest := BackupManifest{
				Schema:              BackupSchema,
				CreatedAt:           "2026-08-02T00:00:00Z",
				CredentialsIncluded: false,
			}
			if archivePath == "data/credentials.db" {
				manifest.Files = []BackupFile{{
					Path:   "credentials.db",
					Bytes:  6,
					SHA256: "2bb80d537b1da3e38bd30361aa855686bde0ba19f01b8ce86c19e1a0e11de7ae",
				}}
			}
			manifestWriter, err := writer.Create("manifest.json")
			if err != nil {
				t.Fatal(err)
			}
			data, _ := json.Marshal(manifest)
			if _, err := manifestWriter.Write(data); err != nil {
				t.Fatal(err)
			}
			entry, err := writer.Create(archivePath)
			if err != nil {
				t.Fatal(err)
			}
			if _, err := entry.Write([]byte("secret")); err != nil {
				t.Fatal(err)
			}
			if err := writer.Close(); err != nil {
				t.Fatal(err)
			}
			if err := file.Close(); err != nil {
				t.Fatal(err)
			}
			if _, err := ValidateBackup(path); err == nil {
				t.Fatal("expected invalid backup to be rejected")
			}
		})
	}
}

func TestInspectCountsRegularFilesWithoutFollowingSymlinks(t *testing.T) {
	root := t.TempDir()
	writeBackupFixture(t, filepath.Join(root, "one"), "1234")
	writeBackupFixture(t, filepath.Join(root, "nested", "two"), "12")
	if err := os.Symlink(filepath.Join(root, "one"), filepath.Join(root, "nested", "link")); err != nil {
		t.Fatal(err)
	}
	status, err := Inspect(root)
	if err != nil {
		t.Fatal(err)
	}
	if status.Directory != root || status.FileCount != 2 || status.Bytes != 6 || status.LastModifiedAt == "" {
		t.Fatalf("unexpected status: %#v", status)
	}
}

func writeBackupFixture(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatal(err)
	}
}

func createBackupDatabase(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	database, err := sql.Open("sqlite", path)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if _, err := database.Exec(`
		CREATE TABLE proof (id INTEGER PRIMARY KEY, value TEXT NOT NULL);
		INSERT INTO proof(id, value) VALUES (1, 'verified');
	`); err != nil {
		t.Fatal(err)
	}
}

func readBackupArchive(t *testing.T, path string) ([]string, BackupManifest) {
	t.Helper()
	archive, err := zip.OpenReader(path)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	names := make([]string, 0, len(archive.File))
	var manifest BackupManifest
	for _, item := range archive.File {
		names = append(names, item.Name)
		if item.Name != "manifest.json" {
			continue
		}
		reader, err := item.Open()
		if err != nil {
			t.Fatal(err)
		}
		if err := json.NewDecoder(reader).Decode(&manifest); err != nil {
			reader.Close()
			t.Fatal(err)
		}
		if err := reader.Close(); err != nil {
			t.Fatal(err)
		}
	}
	slices.Sort(names)
	return names, manifest
}

func extractBackupEntry(t *testing.T, archivePath, name, destination string) {
	t.Helper()
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	for _, item := range archive.File {
		if item.Name != name {
			continue
		}
		reader, err := item.Open()
		if err != nil {
			t.Fatal(err)
		}
		file, err := os.Create(destination)
		if err != nil {
			reader.Close()
			t.Fatal(err)
		}
		if _, err := io.Copy(file, reader); err != nil {
			file.Close()
			reader.Close()
			t.Fatal(err)
		}
		if err := file.Close(); err != nil {
			reader.Close()
			t.Fatal(err)
		}
		if err := reader.Close(); err != nil {
			t.Fatal(err)
		}
		return
	}
	t.Fatalf("archive entry %q not found", name)
}

func readBackupEntry(t *testing.T, archivePath, name string) string {
	t.Helper()
	archive, err := zip.OpenReader(archivePath)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	for _, item := range archive.File {
		if item.Name != name {
			continue
		}
		reader, err := item.Open()
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(reader)
		closeErr := reader.Close()
		if err != nil {
			t.Fatal(err)
		}
		if closeErr != nil {
			t.Fatal(closeErr)
		}
		return string(data)
	}
	t.Fatalf("archive entry %q not found", name)
	return ""
}
