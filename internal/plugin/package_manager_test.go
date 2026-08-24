package plugin

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSignedPackageInstallUpgradeMigrationRollbackAndKeyRotation(t *testing.T) {
	root := t.TempDir()
	official := filepath.Join(root, "official")
	data := filepath.Join(root, "data")
	if err := os.MkdirAll(official, 0o700); err != nil {
		t.Fatal(err)
	}
	writeTestLockPayload(t, official, LockFile{APIVersion: LockAPIVersion, Plugins: []LockEntry{}})
	oldKeyPath := filepath.Join(root, "old.publisher-key.json")
	oldKey, err := GeneratePublisherKey("Test Publisher", oldKeyPath)
	if err != nil {
		t.Fatal(err)
	}

	versionOne := packageManagerManifest("test.signed", "1.0.0", oldKey.KeyID, 1, nil)
	versionOneSource := filepath.Join(root, "source-v1")
	writePackageManagerSource(t, versionOneSource, versionOne, false)
	versionOneArchive := filepath.Join(root, "test-v1.milksu-plugin")
	if _, err := PackPlugin(versionOneSource, versionOneArchive, []string{oldKeyPath}); err != nil {
		t.Fatal(err)
	}

	registry, err := New(Options{
		OfficialDirectory: official, InstalledDirectory: filepath.Join(data, "plugins", "installed"),
		DataDirectory: data, HostVersion: "26.822.1",
	})
	if err != nil {
		t.Fatal(err)
	}
	review, err := registry.StagePackage(versionOneArchive)
	if err != nil {
		t.Fatal(err)
	}
	if review.Trusted || review.Upgrade || review.Fingerprint != oldKey.KeyID {
		t.Fatalf("first install review = %#v", review)
	}
	if _, err := registry.InstallStagedPackage(review.Token, false, false, false); err == nil || !strings.Contains(err.Error(), "trust confirmation") {
		t.Fatalf("missing trust confirmation error = %v", err)
	}
	plugins, err := registry.InstallStagedPackage(review.Token, true, false, false)
	if err != nil {
		t.Fatal(err)
	}
	assertInstalledVersion(t, plugins, versionOne.ID, "1.0.0")
	if err := registry.SetEnabled(versionOne.ID, true); err != nil {
		t.Fatal(err)
	}
	result, err := registry.CallTool(t.Context(), ToolCall{PluginID: versionOne.ID, ToolName: "inspect", Input: json.RawMessage(`{}`)}, false)
	if err != nil || result.Content.(map[string]any)["ok"] != true {
		t.Fatalf("installed tool result = %#v, error = %v", result, err)
	}

	registry.mu.Lock()
	registry.state.Storage[versionOne.ID] = map[string]any{"legacy": "kept"}
	registry.state.StorageVersions[versionOne.ID] = 1
	if err := writeState(registry.statePath(), registry.state); err != nil {
		registry.mu.Unlock()
		t.Fatal(err)
	}
	registry.mu.Unlock()

	versionTwo := packageManagerManifest("test.signed", "1.1.0", oldKey.KeyID, 2, []StorageMigrationSpec{{From: 1, To: 2}})
	versionTwoSource := filepath.Join(root, "source-v2")
	writePackageManagerSource(t, versionTwoSource, versionTwo, true)
	versionTwoArchive := filepath.Join(root, "test-v2.milksu-plugin")
	if _, err := PackPlugin(versionTwoSource, versionTwoArchive, []string{oldKeyPath}); err != nil {
		t.Fatal(err)
	}
	review, err = registry.StagePackage(versionTwoArchive)
	if err != nil {
		t.Fatal(err)
	}
	if !review.Trusted || !review.Upgrade || !review.StorageMigration || review.StorageResetRequired {
		t.Fatalf("upgrade review = %#v", review)
	}
	plugins, err = registry.InstallStagedPackage(review.Token, false, false, false)
	if err != nil {
		t.Fatal(err)
	}
	assertInstalledVersion(t, plugins, versionOne.ID, "1.1.0")
	for _, descriptor := range plugins {
		if descriptor.ID == versionOne.ID && !descriptor.CanRollback {
			t.Fatalf("upgraded descriptor does not advertise its retained rollback version: %#v", descriptor)
		}
	}
	state, err := readState(registry.statePath())
	if err != nil || state.StorageVersions[versionOne.ID] != 2 || state.Storage[versionOne.ID]["migrated"] != true {
		t.Fatalf("migrated state = %#v, error = %v", state.Storage[versionOne.ID], err)
	}

	plugins, err = registry.RollbackPlugin(versionOne.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertInstalledVersion(t, plugins, versionOne.ID, "1.0.0")
	state, err = readState(registry.statePath())
	if err != nil || state.StorageVersions[versionOne.ID] != 1 || state.Storage[versionOne.ID]["legacy"] != "kept" {
		t.Fatalf("rolled-back state = %#v, version=%d, error=%v", state.Storage[versionOne.ID], state.StorageVersions[versionOne.ID], err)
	}
	if _, exists := state.Storage[versionOne.ID]["migrated"]; exists {
		t.Fatal("rollback retained migrated storage")
	}

	newKeyPath := filepath.Join(root, "new.publisher-key.json")
	newKey, err := GeneratePublisherKey("Test Publisher", newKeyPath)
	if err != nil {
		t.Fatal(err)
	}
	rotated := packageManagerManifest("test.signed", "1.2.0", newKey.KeyID, 2, []StorageMigrationSpec{{From: 1, To: 2}})
	rotatedSource := filepath.Join(root, "source-rotated")
	writePackageManagerSource(t, rotatedSource, rotated, true)
	rotatedArchive := filepath.Join(root, "test-rotated.milksu-plugin")
	if _, err := PackPlugin(rotatedSource, rotatedArchive, []string{oldKeyPath, newKeyPath}); err != nil {
		t.Fatal(err)
	}
	review, err = registry.StagePackage(rotatedArchive)
	if err != nil {
		t.Fatal(err)
	}
	if !review.KeyRotation || !review.Trusted {
		t.Fatalf("key rotation review = %#v", review)
	}
	plugins, err = registry.InstallStagedPackage(review.Token, false, false, false)
	if err != nil {
		t.Fatal(err)
	}
	assertInstalledVersion(t, plugins, versionOne.ID, "1.2.0")

	index, err := readInstalledIndex(registry.installedIndexPath())
	if err != nil {
		t.Fatal(err)
	}
	activeDirectory, err := registry.resolveInstalledDirectory(index.Plugins[versionOne.ID].Active.Directory)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(activeDirectory, "main.lua"), "plugin = { tampered = true }")
	if _, err := registry.enabledRecord(versionOne.ID); err == nil || !strings.Contains(err.Error(), "integrity") {
		t.Fatalf("tampered installed package error = %v", err)
	}
}

func TestPluginArchiveRejectsPathEscape(t *testing.T) {
	archivePath := filepath.Join(t.TempDir(), "malicious.milksu-plugin")
	var payload bytes.Buffer
	writer := zip.NewWriter(&payload)
	entry, err := writer.Create("../escape.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("escape")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(archivePath, payload.Bytes(), 0o600); err != nil {
		t.Fatal(err)
	}
	destination := filepath.Join(t.TempDir(), "extract")
	if err := os.Mkdir(destination, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := extractPluginArchive(archivePath, destination); err == nil || !strings.Contains(err.Error(), "invalid") {
		t.Fatalf("path escape archive error = %v", err)
	}
}

func TestDiscardStagedPackageIsIdempotentAndRemovesTemporaryTree(t *testing.T) {
	root := t.TempDir()
	official := filepath.Join(root, "official")
	if err := os.MkdirAll(official, 0o700); err != nil {
		t.Fatal(err)
	}
	writeTestLockPayload(t, official, LockFile{APIVersion: LockAPIVersion, Plugins: []LockEntry{}})
	keyPath := filepath.Join(root, "publisher-key.json")
	key, err := GeneratePublisherKey("Discard Publisher", keyPath)
	if err != nil {
		t.Fatal(err)
	}
	manifest := packageManagerManifest("test.discard", "1.0.0", key.KeyID, 1, nil)
	manifest.Publisher.Name = "Discard Publisher"
	source := filepath.Join(root, "source")
	writePackageManagerSource(t, source, manifest, false)
	archive := filepath.Join(root, "discard.milksu-plugin")
	if _, err := PackPlugin(source, archive, []string{keyPath}); err != nil {
		t.Fatal(err)
	}
	registry, err := New(Options{OfficialDirectory: official, InstalledDirectory: filepath.Join(root, "data", "plugins", "installed"), DataDirectory: filepath.Join(root, "data"), HostVersion: "26.822.1"})
	if err != nil {
		t.Fatal(err)
	}
	review, err := registry.StagePackage(archive)
	if err != nil {
		t.Fatal(err)
	}
	stagingDirectory := registry.staged[review.Token].directory
	registry.DiscardStagedPackage(review.Token)
	registry.DiscardStagedPackage(review.Token)
	if _, err := os.Stat(stagingDirectory); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("staging directory still exists: %v", err)
	}
	if _, err := registry.InstallStagedPackage(review.Token, true, false, false); err == nil || !strings.Contains(err.Error(), "expired") {
		t.Fatalf("discarded stage install error = %v", err)
	}
}

func packageManagerManifest(id, version, keyID string, storageVersion uint, migrations []StorageMigrationSpec) Manifest {
	schema := json.RawMessage(`{"type":"object","properties":{"ok":{"type":"boolean"}},"required":["ok"],"additionalProperties":false}`)
	return Manifest{
		ID: id, Name: "Signed test", Version: version, APIVersion: APIVersion,
		Publisher:      PublisherSpec{Name: "Test Publisher", KeyID: keyID},
		Host:           HostSpec{MinVersion: "26.822.1", RequiredCapabilities: []string{"runtime.lua.v1", "agent.read-tools.v1", "storage.v1"}},
		StorageVersion: storageVersion, StorageMigrations: migrations,
		Runtime:     RuntimeSpec{Kind: RuntimeLua, Entry: "main.lua"},
		Permissions: []Permission{PermissionAgentTools, PermissionStorage},
		Contributes: Contributions{Tools: []ToolContribution{{
			Name: "inspect", Description: "Inspect local state", InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
			OutputSchema: schema, Effect: ToolEffectRead, External: ExternalNone,
		}}},
	}
}

func writePackageManagerSource(t *testing.T, directory string, manifest Manifest, migration bool) {
	t.Helper()
	main := `
plugin = {}
function plugin.initialize(_context) return "null" end
function plugin.call_tool(_name, _input) return "{\"ok\":true}" end
function plugin.dispose() return "null" end
`
	if migration {
		main += `function plugin.migrate(_input) milksu.set("migrated", "true") return "null" end
`
	}
	writeTestFile(t, filepath.Join(directory, "main.lua"), main)
	writeTestManifest(t, directory, manifest)
}

func assertInstalledVersion(t *testing.T, descriptors []Descriptor, id, version string) {
	t.Helper()
	for _, descriptor := range descriptors {
		if descriptor.ID == id {
			if descriptor.Source != SourceInstalled || descriptor.Version != version || descriptor.Status == StatusError {
				t.Fatalf("installed descriptor = %#v", descriptor)
			}
			return
		}
	}
	t.Fatalf("installed plugin %q is missing from %#v", id, descriptors)
}
