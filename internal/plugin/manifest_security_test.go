package plugin

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestReadManifestRejectsUnreviewedShapeAndEntryPaths(t *testing.T) {
	t.Run("unknown field", func(t *testing.T) {
		directory := t.TempDir()
		writeTestFile(t, filepath.Join(directory, "main.lua"), "plugin = {}")
		writeTestFile(t, filepath.Join(directory, manifestFileName), `{
  "id":"example.plugin",
  "name":"Example",
  "version":"1.0.0",
  "apiVersion":"milksu.plugin/v1alpha1",
  "runtime":{"kind":"lua","entry":"main.lua"},
  "permissions":[],
  "unreviewed":true
}`)
		if _, err := readManifest(directory); err == nil || !strings.Contains(err.Error(), "unknown field") {
			t.Fatalf("readManifest unknown-field error = %v", err)
		}
	})

	t.Run("escaping runtime entry", func(t *testing.T) {
		parent := t.TempDir()
		directory := filepath.Join(parent, "plugin")
		if err := os.Mkdir(directory, 0o700); err != nil {
			t.Fatal(err)
		}
		writeTestFile(t, filepath.Join(parent, "outside.lua"), "plugin = {}")
		manifest := testManifest("example.plugin")
		manifest.Runtime.Entry = filepath.Join("..", "outside.lua")
		writeTestManifest(t, directory, manifest)
		if _, err := readManifest(directory); err == nil || (!strings.Contains(err.Error(), "escapes") && !strings.Contains(err.Error(), "canonical relative")) {
			t.Fatalf("readManifest escaping-entry error = %v", err)
		}
	})

	t.Run("symlink runtime entry", func(t *testing.T) {
		directory := t.TempDir()
		target := filepath.Join(directory, "target.lua")
		writeTestFile(t, target, "plugin = {}")
		if err := os.Symlink(target, filepath.Join(directory, "main.lua")); err != nil {
			t.Skipf("symlink unavailable: %v", err)
		}
		writeTestManifest(t, directory, testManifest("example.plugin"))
		if _, err := readManifest(directory); err == nil || !strings.Contains(err.Error(), "non-symlink") {
			t.Fatalf("readManifest symlink-entry error = %v", err)
		}
	})
}

func TestReadManifestRejectsWriteToolExposedAsReadOnlyMCP(t *testing.T) {
	directory := t.TempDir()
	writeTestFile(t, filepath.Join(directory, "main.lua"), "plugin = {}")
	manifest := testManifest("example.plugin")
	manifest.Permissions = []Permission{PermissionAgentTools, PermissionMCPExternalRead}
	manifest.Contributes.Tools = []ToolContribution{{
		Name:        "mutate",
		Description: "Mutate data",
		InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
		Effect:      ToolEffectWrite,
		External:    ExternalRead,
	}}
	writeTestManifest(t, directory, manifest)
	if _, err := readManifest(directory); err == nil || !strings.Contains(err.Error(), "write tool") {
		t.Fatalf("readManifest write-tool exposure error = %v", err)
	}
}

func TestReadManifestRequiresExclusiveBackgroundSlotForTheme(t *testing.T) {
	directory := t.TempDir()
	writeTestFile(t, filepath.Join(directory, "main.lua"), "plugin = {}")
	writeTestFile(t, filepath.Join(directory, "theme.json"), `{"default":{},"light":{},"dark":{}}`)
	manifest := testManifest("example.theme")
	manifest.Permissions = []Permission{PermissionUITheme}
	manifest.Theme = &ThemeSpec{Source: "theme.json"}
	writeTestManifest(t, directory, manifest)
	if _, err := readManifest(directory); err == nil || !strings.Contains(err.Error(), "app.background") {
		t.Fatalf("readManifest theme without exclusive slot error = %v", err)
	}
}

func TestPackageDigestBindsPathsAndBytesDeterministically(t *testing.T) {
	first := t.TempDir()
	second := t.TempDir()
	writeTestFile(t, filepath.Join(first, "nested", "b.txt"), "bravo")
	writeTestFile(t, filepath.Join(first, "a.txt"), "alpha")
	writeTestFile(t, filepath.Join(second, "a.txt"), "alpha")
	writeTestFile(t, filepath.Join(second, "nested", "b.txt"), "bravo")

	firstDigest, err := packageDigest(first)
	if err != nil {
		t.Fatal(err)
	}
	secondDigest, err := packageDigest(second)
	if err != nil {
		t.Fatal(err)
	}
	if firstDigest != secondDigest {
		t.Fatalf("same package bytes produced %q and %q", firstDigest, secondDigest)
	}

	writeTestFile(t, filepath.Join(second, "nested", "b.txt"), "changed")
	changedDigest, err := packageDigest(second)
	if err != nil {
		t.Fatal(err)
	}
	if changedDigest == firstDigest {
		t.Fatal("changing a file did not change the package digest")
	}

	if err := os.Rename(filepath.Join(second, "nested", "b.txt"), filepath.Join(second, "nested", "c.txt")); err != nil {
		t.Fatal(err)
	}
	renamedDigest, err := packageDigest(second)
	if err != nil {
		t.Fatal(err)
	}
	if renamedDigest == changedDigest {
		t.Fatal("changing a file path did not change the package digest")
	}
}

func testManifest(id string) Manifest {
	return Manifest{
		ID: id, Name: "Test plugin", Version: "1.0.0", APIVersion: APIVersion,
		Publisher: PublisherSpec{Name: "Test Publisher"},
		Host:      HostSpec{MinVersion: "0.0.0"}, StorageVersion: 1,
		Runtime: RuntimeSpec{Kind: RuntimeLua, Entry: "main.lua"}, Permissions: []Permission{},
	}
}

func writeTestManifest(t *testing.T, directory string, manifest Manifest) {
	t.Helper()
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(directory, manifestFileName), string(payload))
}

func writeTestFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
}
