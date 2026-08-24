package main

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	pluginruntime "github.com/MilkSU-Official/milksu/internal/plugin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

func TestPluginMCPConfigPinsCurrentAppDataDirectory(t *testing.T) {
	dataDirectory := t.TempDir()
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)
	config := (&App{}).GetPluginMCPConfig()
	if !config.Available {
		t.Fatal("plugin MCP config is unavailable")
	}
	servers, ok := config.Configuration["mcpServers"].(map[string]any)
	if !ok {
		t.Fatalf("mcpServers = %#v", config.Configuration["mcpServers"])
	}
	server, ok := servers["milksu-plugins"].(map[string]any)
	if !ok {
		t.Fatalf("milksu-plugins = %#v", servers["milksu-plugins"])
	}
	environment, ok := server["env"].(map[string]string)
	if !ok {
		t.Fatalf("plugin MCP env = %#v", server["env"])
	}
	want, err := filepath.Abs(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	if environment[appdata.DirectoryOverrideEnv] != want {
		t.Fatalf("plugin MCP appdata = %q, want %q", environment[appdata.DirectoryOverrideEnv], want)
	}
}

func TestPluginMCPServerListsAndCallsOnlyOfficialExternalReadTools(t *testing.T) {
	officialRoot := t.TempDir()
	developmentRoot := t.TempDir()
	schema := json.RawMessage(`{
  "type":"object",
  "properties":{"query":{"type":"string","maxLength":32}},
  "required":["query"],
  "additionalProperties":false
}`)
	official := pluginMCPTestManifest("official.tools", schema)
	development := pluginMCPTestManifest("development.tools", schema)
	development.Contributes.Tools = development.Contributes.Tools[:2]
	writePluginMCPTestPackage(t, officialRoot, official)
	writePluginMCPTestPackage(t, developmentRoot, development)
	writePluginMCPTestLock(t, officialRoot, official)
	registry, err := pluginruntime.New(pluginruntime.Options{
		OfficialDirectory: officialRoot, DevelopmentDirectory: developmentRoot,
		DataDirectory: t.TempDir(), DevelopmentMode: true,
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := registry.SetEnabled(development.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := registry.SetEnabled(official.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := registry.SetExternalEnabled(official.ID, true); err != nil {
		t.Fatal(err)
	}

	server, err := newPluginMCPServer(registry)
	if err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	clientTransport, serverTransport := mcp.NewInMemoryTransports()
	serverSession, err := server.Connect(ctx, serverTransport, nil)
	if err != nil {
		t.Fatal(err)
	}
	client := mcp.NewClient(&mcp.Implementation{Name: "plugin-test", Version: "1.0.0"}, nil)
	clientSession, err := client.Connect(ctx, clientTransport, nil)
	if err != nil {
		_ = serverSession.Close()
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = clientSession.Close()
		_ = serverSession.Close()
	})

	listed, err := clientSession.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	tools := make(map[string]*mcp.Tool, len(listed.Tools))
	for _, tool := range listed.Tools {
		tools[tool.Name] = tool
	}
	publicName := "official_tools__public_read"
	if len(tools) != 2 || tools["milksu_plugins_list"] == nil || tools[publicName] == nil {
		t.Fatalf("MCP tools/list names = %#v", sortedPluginMCPToolNames(tools))
	}
	for _, hidden := range []string{
		"official_tools__internal_read",
		"official_tools__internal_write",
		"development_tools__public_read",
	} {
		if tools[hidden] != nil {
			t.Errorf("MCP tools/list exposed %q", hidden)
		}
	}
	public := tools[publicName]
	if public.OutputSchema == nil {
		t.Fatal("public MCP tool did not publish its reviewed output schema")
	}
	if public.Annotations == nil || !public.Annotations.ReadOnlyHint || !public.Annotations.IdempotentHint ||
		public.Annotations.DestructiveHint == nil || *public.Annotations.DestructiveHint ||
		public.Annotations.OpenWorldHint == nil || *public.Annotations.OpenWorldHint {
		t.Fatalf("public tool annotations = %#v", public.Annotations)
	}

	called, err := clientSession.CallTool(ctx, &mcp.CallToolParams{
		Name: publicName, Arguments: map[string]any{"query": "hello"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if called.IsError {
		t.Fatalf("public external read tool returned error: %#v", called.Content)
	}
	text, ok := called.Content[0].(*mcp.TextContent)
	if !ok || text.Text != `{"query":"hello"}` {
		t.Fatalf("public external read tool content = %#v", called.Content)
	}
	if err := registry.SetEnabled(official.ID, false); err != nil {
		t.Fatal(err)
	}
	disabled, err := clientSession.CallTool(ctx, &mcp.CallToolParams{
		Name: publicName, Arguments: map[string]any{"query": "hello"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if !disabled.IsError {
		t.Fatalf("disabled official tool call = %#v", disabled)
	}
	if err := registry.SetEnabled(official.ID, true); err != nil {
		t.Fatal(err)
	}
	if err := registry.SetExternalEnabled(official.ID, true); err != nil {
		t.Fatal(err)
	}

	invalid, err := clientSession.CallTool(ctx, &mcp.CallToolParams{Name: publicName, Arguments: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	if !invalid.IsError {
		t.Fatalf("invalid tool input result = %#v", invalid)
	}

	pluginsResult, err := clientSession.CallTool(ctx, &mcp.CallToolParams{Name: "milksu_plugins_list", Arguments: map[string]any{}})
	if err != nil {
		t.Fatal(err)
	}
	listText, ok := pluginsResult.Content[0].(*mcp.TextContent)
	if !ok {
		t.Fatalf("plugin list content = %#v", pluginsResult.Content)
	}
	var publicPlugins []struct {
		ID    string   `json:"id"`
		Tools []string `json:"external_read_tools"`
	}
	if err := json.Unmarshal([]byte(listText.Text), &publicPlugins); err != nil {
		t.Fatal(err)
	}
	if len(publicPlugins) != 1 || publicPlugins[0].ID != official.ID || len(publicPlugins[0].Tools) != 1 || publicPlugins[0].Tools[0] != publicName {
		t.Fatalf("public plugin list = %#v", publicPlugins)
	}

	if err := registry.SetEnabled(official.ID, false); err != nil {
		t.Fatal(err)
	}
	registrations, err := reconcilePluginMCPTools(server, registry, map[string]pluginMCPToolRegistration{
		publicName: {fingerprint: "stale"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(registrations) != 0 {
		t.Fatalf("disabled external registrations = %#v", registrations)
	}
	listed, err = clientSession.ListTools(ctx, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(listed.Tools) != 1 || listed.Tools[0].Name != "milksu_plugins_list" {
		t.Fatalf("MCP tools after reconciliation = %#v", listed.Tools)
	}
}

func TestExternalMCPToolNameIsStableAndBounded(t *testing.T) {
	if got := externalMCPToolName("vendor.plugin", "read_status"); got != "vendor_plugin__read_status" {
		t.Fatalf("short external tool name = %q", got)
	}
	if dotted, dashed := externalMCPToolName("a.b", "read"), externalMCPToolName("a-b", "read"); dotted == dashed {
		t.Fatalf("distinct valid plugin ids mapped to %q", dotted)
	}
	pluginID := strings.Repeat("long.segment.", 12) + "tail"
	first := externalMCPToolName(pluginID, "read_status")
	second := externalMCPToolName(pluginID, "read_status")
	if first != second || len(first) > 120 || !strings.HasSuffix(first, "__read_status") {
		t.Fatalf("bounded external tool name = %q (len %d), second = %q", first, len(first), second)
	}
	maximumTool := strings.Repeat("a", 64)
	if got := externalMCPToolName(pluginID, maximumTool); len(got) > 120 || !strings.HasSuffix(got, "__"+maximumTool) {
		t.Fatalf("maximum-length external tool name = %q (len %d)", got, len(got))
	}
}

func pluginMCPTestManifest(id string, schema json.RawMessage) pluginruntime.Manifest {
	return pluginruntime.Manifest{
		ID: id, Name: id, Version: "1.0.0", APIVersion: pluginruntime.APIVersion,
		Publisher: pluginruntime.PublisherSpec{Name: "Test Publisher"},
		Host:      pluginruntime.HostSpec{MinVersion: "0.0.0"}, StorageVersion: 1,
		Runtime: pluginruntime.RuntimeSpec{Kind: pluginruntime.RuntimeLua, Entry: "main.lua"},
		Permissions: []pluginruntime.Permission{
			pluginruntime.PermissionAgentTools,
			pluginruntime.PermissionMCPExternalRead,
		},
		Contributes: pluginruntime.Contributions{Tools: []pluginruntime.ToolContribution{
			{Name: "public_read", Description: "Read public data", InputSchema: schema, OutputSchema: schema, Effect: pluginruntime.ToolEffectRead, External: pluginruntime.ExternalRead},
			{Name: "internal_read", Description: "Read internal data", InputSchema: schema, OutputSchema: schema, Effect: pluginruntime.ToolEffectRead, External: pluginruntime.ExternalNone},
			{Name: "internal_write", Description: "Write internal data", InputSchema: schema, OutputSchema: schema, Effect: pluginruntime.ToolEffectWrite, External: pluginruntime.ExternalNone},
		}},
	}
}

func writePluginMCPTestPackage(t *testing.T, root string, manifest pluginruntime.Manifest) string {
	t.Helper()
	directory := filepath.Join(root, manifest.ID)
	if err := os.MkdirAll(directory, 0o700); err != nil {
		t.Fatal(err)
	}
	writePluginMCPTestFile(t, filepath.Join(directory, "main.lua"), `
plugin = {}
function plugin.call_tool(name, input_json)
  if name == "public_read" then return input_json end
  return "null"
end
`)
	payload, err := json.Marshal(manifest)
	if err != nil {
		t.Fatal(err)
	}
	writePluginMCPTestFile(t, filepath.Join(directory, "plugin.json"), string(payload))
	return directory
}

func writePluginMCPTestLock(t *testing.T, root string, manifest pluginruntime.Manifest) {
	t.Helper()
	digest, err := pluginMCPTestPackageDigest(filepath.Join(root, manifest.ID))
	if err != nil {
		t.Fatal(err)
	}
	lock := pluginruntime.LockFile{
		APIVersion: pluginruntime.LockAPIVersion,
		Plugins:    []pluginruntime.LockEntry{{ID: manifest.ID, Version: manifest.Version, SHA256: digest}},
	}
	payload, err := json.Marshal(lock)
	if err != nil {
		t.Fatal(err)
	}
	writePluginMCPTestFile(t, filepath.Join(root, "plugins.lock.json"), string(payload))
}

func writePluginMCPTestFile(t *testing.T, path, contents string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(contents), 0o600); err != nil {
		t.Fatal(err)
	}
}

func pluginMCPTestPackageDigest(directory string) (string, error) {
	root, err := filepath.Abs(directory)
	if err != nil {
		return "", err
	}
	var paths []string
	if err := filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if path == root || entry.IsDir() {
			return nil
		}
		relative, err := filepath.Rel(root, path)
		if err != nil {
			return err
		}
		paths = append(paths, filepath.ToSlash(relative))
		return nil
	}); err != nil {
		return "", err
	}
	sort.Strings(paths)
	hash := sha256.New()
	var length [8]byte
	for _, relative := range paths {
		binary.BigEndian.PutUint64(length[:], uint64(len(relative)))
		_, _ = hash.Write(length[:])
		_, _ = io.WriteString(hash, relative)
		path := filepath.Join(root, filepath.FromSlash(relative))
		info, err := os.Stat(path)
		if err != nil {
			return "", err
		}
		binary.BigEndian.PutUint64(length[:], uint64(info.Size()))
		_, _ = hash.Write(length[:])
		file, err := os.Open(path)
		if err != nil {
			return "", err
		}
		_, copyErr := io.Copy(hash, file)
		closeErr := file.Close()
		if copyErr != nil {
			return "", copyErr
		}
		if closeErr != nil {
			return "", closeErr
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func sortedPluginMCPToolNames(tools map[string]*mcp.Tool) []string {
	names := make([]string, 0, len(tools))
	for name := range tools {
		names = append(names, name)
	}
	sort.Strings(names)
	return names
}
