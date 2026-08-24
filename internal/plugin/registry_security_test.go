package plugin

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRegistryProductionModeIgnoresDevelopmentDirectory(t *testing.T) {
	officialRoot := t.TempDir()
	developmentRoot := t.TempDir()
	dataRoot := t.TempDir()
	official := testManifest("official.plugin")
	development := testManifest("development.plugin")
	writeRegistryTestPlugin(t, officialRoot, official)
	writeRegistryTestPlugin(t, developmentRoot, development)
	writeRegistryTestLock(t, officialRoot, official.ID)

	production, err := New(Options{
		OfficialDirectory: officialRoot, DevelopmentDirectory: developmentRoot,
		DataDirectory: dataRoot, DevelopmentMode: false,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertPluginSources(t, production.List(), map[string]Source{official.ID: SourceOfficial})

	developmentRegistry, err := New(Options{
		OfficialDirectory: officialRoot, DevelopmentDirectory: developmentRoot,
		DataDirectory: t.TempDir(), DevelopmentMode: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	assertPluginSources(t, developmentRegistry.List(), map[string]Source{
		official.ID: SourceOfficial, development.ID: SourceDevelopment,
	})
}

func TestDevelopmentPluginCanShadowInstalledButNeverOfficial(t *testing.T) {
	developmentRoot := t.TempDir()
	manifest := testManifest("development.override")
	directory := writeRegistryTestPlugin(t, developmentRoot, manifest)
	digest, err := packageDigest(directory)
	if err != nil {
		t.Fatal(err)
	}

	registry := &Registry{
		options: Options{DevelopmentDirectory: developmentRoot},
		items: map[string]*packageRecord{
			manifest.ID: {manifest: manifest, source: SourceInstalled},
		},
	}
	registry.loadDevelopmentLocked()
	if registry.items[manifest.ID].source != SourceDevelopment || registry.items[manifest.ID].digest != digest {
		t.Fatalf("development override = %#v", registry.items[manifest.ID])
	}

	registry.items[manifest.ID] = &packageRecord{manifest: manifest, source: SourceOfficial}
	registry.issues = nil
	registry.loadDevelopmentLocked()
	if registry.items[manifest.ID].source != SourceOfficial || len(registry.issues) != 1 || !strings.Contains(registry.issues[0].Error, "cannot shadow") {
		t.Fatalf("official shadow protection items=%#v issues=%#v", registry.items, registry.issues)
	}
}

func TestDevelopmentPluginRejectsWriteTools(t *testing.T) {
	developmentRoot := t.TempDir()
	manifest := testManifest("development.write-tool")
	schema := json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)
	manifest.Permissions = []Permission{PermissionAgentTools}
	manifest.Contributes.Tools = []ToolContribution{{
		Name: "mutate", Description: "Mutate data", InputSchema: schema,
		OutputSchema: schema, Effect: ToolEffectWrite, External: ExternalNone,
	}}
	writeRegistryTestPlugin(t, developmentRoot, manifest)
	registry := &Registry{options: Options{DevelopmentDirectory: developmentRoot}, items: map[string]*packageRecord{}}
	registry.loadDevelopmentLocked()
	if registry.items[manifest.ID] != nil || len(registry.issues) != 1 || !strings.Contains(registry.issues[0].Error, "read-only") {
		t.Fatalf("development write-tool result items=%#v issues=%#v", registry.items, registry.issues)
	}
}

func TestRegistryOfficialLockMismatchFailsClosed(t *testing.T) {
	officialRoot := t.TempDir()
	manifest := testManifest("official.plugin")
	writeRegistryTestPlugin(t, officialRoot, manifest)
	writeTestLockPayload(t, officialRoot, LockFile{
		APIVersion: LockAPIVersion,
		Plugins:    []LockEntry{{ID: manifest.ID, Version: manifest.Version, SHA256: strings.Repeat("0", 64)}},
	})
	registry, err := New(Options{OfficialDirectory: officialRoot, DataDirectory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	descriptors := registry.List()
	if len(descriptors) != 1 || descriptors[0].Status != StatusError {
		t.Fatalf("mismatched official package descriptors = %#v", descriptors)
	}
	if !strings.Contains(descriptors[0].Error, "does not match") {
		t.Fatalf("mismatched official package error = %q", descriptors[0].Error)
	}
}

func TestRegistryRechecksOfficialPackageBeforeUse(t *testing.T) {
	officialRoot := t.TempDir()
	manifest := testManifest("official.plugin")
	directory := writeRegistryTestPlugin(t, officialRoot, manifest)
	writeRegistryTestLock(t, officialRoot, manifest.ID)
	registry, err := New(Options{OfficialDirectory: officialRoot, DataDirectory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.SetEnabled(manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(directory, manifest.Runtime.Entry), "plugin = { changed = true }")
	if _, err := registry.enabledRecord(manifest.ID); err == nil || !strings.Contains(err.Error(), "changed after verification") {
		t.Fatalf("enabledRecord after tamper error = %v", err)
	}
}

func TestRegistryRefreshesEnabledStateBeforeEachCall(t *testing.T) {
	officialRoot := t.TempDir()
	dataRoot := t.TempDir()
	manifest := testManifest("official.shared-state")
	writeRegistryTestPlugin(t, officialRoot, manifest)
	writeRegistryTestLock(t, officialRoot, manifest.ID)

	appRegistry, err := New(Options{OfficialDirectory: officialRoot, DataDirectory: dataRoot})
	if err != nil {
		t.Fatal(err)
	}
	if err := appRegistry.SetEnabled(manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	mcpRegistry, err := New(Options{OfficialDirectory: officialRoot, DataDirectory: dataRoot})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := mcpRegistry.enabledRecord(manifest.ID); err != nil {
		t.Fatalf("enabledRecord before disable: %v", err)
	}
	if err := appRegistry.SetEnabled(manifest.ID, false); err != nil {
		t.Fatal(err)
	}
	if _, err := mcpRegistry.enabledRecord(manifest.ID); err == nil || !strings.Contains(err.Error(), "disabled") {
		t.Fatalf("enabledRecord after another process disabled plugin: %v", err)
	}
	descriptors := mcpRegistry.List()
	if len(descriptors) != 1 || descriptors[0].Enabled || descriptors[0].Status != StatusDisabled {
		t.Fatalf("list after another process disabled plugin = %#v", descriptors)
	}
}

func TestRegistryExternalToolsIncludeOnlyOfficialReadExposure(t *testing.T) {
	officialRoot := t.TempDir()
	developmentRoot := t.TempDir()
	schema := json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`)
	official := testManifest("official.tools")
	official.Permissions = []Permission{PermissionAgentTools, PermissionMCPExternalRead}
	official.Contributes.Tools = []ToolContribution{
		{Name: "public_read", Description: "Externally readable", InputSchema: schema, OutputSchema: schema, Effect: ToolEffectRead, External: ExternalRead},
		{Name: "internal_read", Description: "Internal read", InputSchema: schema, OutputSchema: schema, Effect: ToolEffectRead, External: ExternalNone},
		{Name: "internal_write", Description: "Internal write", InputSchema: schema, OutputSchema: schema, Effect: ToolEffectWrite, External: ExternalNone},
	}
	development := testManifest("development.tools")
	development.Permissions = []Permission{PermissionAgentTools, PermissionMCPExternalRead}
	development.Contributes.Tools = []ToolContribution{
		{Name: "public_read", Description: "Development read", InputSchema: schema, OutputSchema: schema, Effect: ToolEffectRead, External: ExternalRead},
	}
	writeRegistryTestPlugin(t, officialRoot, official)
	writeRegistryTestPlugin(t, developmentRoot, development)
	writeRegistryTestLock(t, officialRoot, official.ID)
	registry, err := New(Options{
		OfficialDirectory: officialRoot, DevelopmentDirectory: developmentRoot,
		DataDirectory: t.TempDir(), DevelopmentMode: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{official.ID, development.ID} {
		if err := registry.SetEnabled(id, true); err != nil {
			t.Fatal(err)
		}
	}
	if err := registry.SetExternalEnabled(official.ID, true); err != nil {
		t.Fatal(err)
	}
	external := registry.EnabledTools(true)
	if len(external) != 1 || external[0].PluginID != official.ID || external[0].Tool.Name != "public_read" {
		t.Fatalf("external tools = %#v", external)
	}
	all := registry.EnabledTools(false)
	if len(all) != 4 {
		t.Fatalf("all enabled tools count = %d, want 4 (%#v)", len(all), all)
	}
	registry.mu.Lock()
	registry.items[official.ID].manifest.Permissions = []Permission{PermissionAgentTools}
	registry.mu.Unlock()
	if external := registry.ExternalToolCatalog(); len(external) != 0 {
		t.Fatalf("external catalog retained a plugin after mcp.external.read was removed: %#v", external)
	}
}

func TestExternalReadToolCannotPersistPluginStorage(t *testing.T) {
	officialRoot := t.TempDir()
	manifest := testManifest("official.storage")
	manifest.Permissions = []Permission{PermissionAgentTools, PermissionMCPExternalRead, PermissionStorage}
	manifest.Contributes.Tools = []ToolContribution{{
		Name: "public_read", Description: "Read public data",
		InputSchema:  json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
		OutputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
		Effect:       ToolEffectRead, External: ExternalRead,
	}}
	directory := filepath.Join(officialRoot, manifest.ID)
	writeTestFile(t, filepath.Join(directory, "main.lua"), `
plugin = {}
function plugin.call_tool(_name, _input)
  milksu.set("last_read", "1")
  return "null"
end
`)
	writeTestManifest(t, directory, manifest)
	writeRegistryTestLock(t, officialRoot, manifest.ID)
	registry, err := New(Options{OfficialDirectory: officialRoot, DataDirectory: t.TempDir()})
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.SetEnabled(manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := registry.SetExternalEnabled(manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	_, err = registry.CallTool(context.Background(), ToolCall{
		PluginID: manifest.ID, ToolName: "public_read", Input: json.RawMessage(`{}`),
	}, true)
	if err == nil || !strings.Contains(err.Error(), "cannot persist storage writes") {
		t.Fatalf("external read storage-write error = %v", err)
	}
}

func TestOfficialLegacyManifestUsesOneReleaseLifecycleAdapter(t *testing.T) {
	root := t.TempDir()
	official := filepath.Join(root, "official")
	manifest := Manifest{
		ID: "milksu.legacy-adapter", Name: "Legacy adapter", Version: "1.0.0", APIVersion: LegacyAPIVersion,
		Runtime: RuntimeSpec{Kind: RuntimeLua, Entry: "main.lua"}, Permissions: []Permission{PermissionAgentTools},
		Contributes: Contributions{Tools: []ToolContribution{{
			Name: "inspect", Description: "Adapter probe",
			InputSchema: json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
			Effect:      ToolEffectRead, External: ExternalNone,
		}}},
	}
	directory := filepath.Join(official, manifest.ID)
	writeTestFile(t, filepath.Join(directory, "main.lua"), `
plugin = {}
function plugin.activate(context) if string.find(context, "milksu.plugin/v1alpha1", 1, true) == nil then error("missing legacy context") end return "null" end
function plugin.call_tool(_name, _input) return "{\"adapted\":true}" end
function plugin.deactivate() return "null" end
`)
	writeTestManifest(t, directory, manifest)
	writeRegistryTestLock(t, official, manifest.ID)
	registry, err := New(Options{OfficialDirectory: official, DataDirectory: filepath.Join(root, "data"), HostVersion: "26.822.1"})
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.SetEnabled(manifest.ID, true); err != nil {
		t.Fatal(err)
	}
	result, err := registry.CallTool(t.Context(), ToolCall{PluginID: manifest.ID, ToolName: "inspect", Input: json.RawMessage(`{}`)}, false)
	if err != nil {
		t.Fatal(err)
	}
	if result.Content.(map[string]any)["adapted"] != true {
		t.Fatalf("legacy adapter result = %#v", result.Content)
	}
}

func TestReadLockFileRejectsTrailingDataAndSymlink(t *testing.T) {
	t.Run("trailing data", func(t *testing.T) {
		path := filepath.Join(t.TempDir(), lockFileName)
		writeTestFile(t, path, `{"apiVersion":"milksu.plugin-lock/v1","plugins":[]} {}`)
		if _, err := readLockFile(path); err == nil || !strings.Contains(err.Error(), "trailing") {
			t.Fatalf("readLockFile trailing-data error = %v", err)
		}
	})

	t.Run("symlink", func(t *testing.T) {
		directory := t.TempDir()
		target := filepath.Join(directory, "target.json")
		writeTestFile(t, target, `{"apiVersion":"milksu.plugin-lock/v1","plugins":[]}`)
		path := filepath.Join(directory, lockFileName)
		if err := os.Symlink(target, path); err != nil {
			t.Skipf("symlink unavailable: %v", err)
		}
		if _, err := readLockFile(path); err == nil || !strings.Contains(err.Error(), "non-symlink") {
			t.Fatalf("readLockFile symlink error = %v", err)
		}
	})
}

func writeRegistryTestPlugin(t *testing.T, root string, manifest Manifest) string {
	t.Helper()
	directory := filepath.Join(root, manifest.ID)
	writeTestFile(t, filepath.Join(directory, manifest.Runtime.Entry), `
plugin = {}
function plugin.call_tool(_name, _input) return "null" end
function plugin.call_ui(_name, _input) return '{"capability":"value","value":null}' end
`)
	writeTestManifest(t, directory, manifest)
	return directory
}

func writeRegistryTestLock(t *testing.T, root string, ids ...string) {
	t.Helper()
	lock := LockFile{APIVersion: LockAPIVersion, Plugins: make([]LockEntry, 0, len(ids))}
	for _, id := range ids {
		directory := filepath.Join(root, id)
		manifest, err := readManifest(directory)
		if err != nil {
			t.Fatal(err)
		}
		digest, err := packageDigest(directory)
		if err != nil {
			t.Fatal(err)
		}
		lock.Plugins = append(lock.Plugins, LockEntry{ID: id, Version: manifest.Version, SHA256: digest})
	}
	writeTestLockPayload(t, root, lock)
}

func writeTestLockPayload(t *testing.T, root string, lock LockFile) {
	t.Helper()
	payload, err := json.Marshal(lock)
	if err != nil {
		t.Fatal(err)
	}
	writeTestFile(t, filepath.Join(root, lockFileName), string(payload))
}

func assertPluginSources(t *testing.T, descriptors []Descriptor, expected map[string]Source) {
	t.Helper()
	actual := make(map[string]Source, len(descriptors))
	for _, descriptor := range descriptors {
		if descriptor.Status == StatusError {
			t.Fatalf("unexpected registry issue: %#v", descriptor)
		}
		actual[descriptor.ID] = descriptor.Source
	}
	if len(actual) != len(expected) {
		t.Fatalf("plugin sources = %#v, want %#v", actual, expected)
	}
	for id, source := range expected {
		if actual[id] != source {
			t.Fatalf("plugin %s source = %q, want %q", id, actual[id], source)
		}
	}
}
