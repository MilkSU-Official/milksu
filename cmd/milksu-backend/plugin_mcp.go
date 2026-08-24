package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	pluginruntime "github.com/MilkSU-Official/milksu/internal/plugin"
	"github.com/modelcontextprotocol/go-sdk/mcp"
)

const pluginMCPVersion = "0.1.0"

const maxPluginMCPMetadataBytes = 8 << 20

var nonMCPToolNameCharacter = regexp.MustCompile(`[^A-Za-z0-9_-]+`)

type PluginMCPConfig struct {
	Available     bool           `json:"available"`
	Command       string         `json:"command,omitempty"`
	Args          []string       `json:"args"`
	Configuration map[string]any `json:"configuration"`
}

func (a *App) GetPluginMCPConfig() PluginMCPConfig {
	executable, err := os.Executable()
	if err != nil {
		return PluginMCPConfig{Args: []string{}, Configuration: map[string]any{}}
	}
	executable, err = filepath.Abs(executable)
	if err != nil || !regularPluginRuntimeFile(executable) {
		return PluginMCPConfig{Args: []string{}, Configuration: map[string]any{}}
	}
	dataDirectory, err := appdata.Directory()
	if err != nil {
		return PluginMCPConfig{Args: []string{}, Configuration: map[string]any{}}
	}
	dataDirectory, err = filepath.Abs(dataDirectory)
	if err != nil {
		return PluginMCPConfig{Args: []string{}, Configuration: map[string]any{}}
	}
	args := []string{"plugin-mcp"}
	return PluginMCPConfig{
		Available: true,
		Command:   executable,
		Args:      args,
		Configuration: map[string]any{
			"mcpServers": map[string]any{
				"milksu-plugins": map[string]any{
					"command": executable,
					"args":    args,
					"env": map[string]string{
						appdata.DirectoryOverrideEnv: dataDirectory,
						"MILKSU_APP_VERSION":         pluginHostVersion(),
					},
				},
			},
		},
	}
}

func runPluginMCP(ctx context.Context) error {
	dataDirectory, err := appdata.Ensure()
	if err != nil {
		return fmt.Errorf("prepare plugin data directory: %w", err)
	}
	registry, err := newPluginRegistry(dataDirectory)
	if err != nil {
		return fmt.Errorf("load plugin registry: %w", err)
	}
	server, registrations, err := buildPluginMCPServer(registry)
	if err != nil {
		return err
	}
	go watchPluginMCPRegistry(ctx, dataDirectory, server, registry, registrations)
	return server.Run(ctx, &mcp.StdioTransport{})
}

func newPluginMCPServer(registry *pluginruntime.Registry) (*mcp.Server, error) {
	server, _, err := buildPluginMCPServer(registry)
	return server, err
}

type pluginMCPToolRegistration struct {
	fingerprint string
	descriptor  pluginruntime.ToolCallDescriptor
}

func buildPluginMCPServer(registry *pluginruntime.Registry) (*mcp.Server, map[string]pluginMCPToolRegistration, error) {
	if registry == nil {
		return nil, nil, errors.New("plugin registry is unavailable")
	}
	server := mcp.NewServer(
		&mcp.Implementation{Name: "milksu-plugins", Version: pluginMCPVersion},
		&mcp.ServerOptions{Capabilities: &mcp.ServerCapabilities{
			Tools: &mcp.ToolCapabilities{ListChanged: true},
		}},
	)
	registerPluginListTool(server, registry)
	registrations, err := reconcilePluginMCPTools(server, registry, nil)
	if err != nil {
		return nil, nil, err
	}
	return server, registrations, nil
}

func pluginMCPToolCatalog(registry *pluginruntime.Registry) (map[string]pluginMCPToolRegistration, error) {
	result := make(map[string]pluginMCPToolRegistration)
	for _, descriptor := range registry.ExternalToolCatalog() {
		name := externalMCPToolName(descriptor.PluginID, descriptor.Tool.Name)
		if name == "milksu_plugins_list" {
			return nil, fmt.Errorf("external plugin tool name collides with the host catalog %q", name)
		}
		payload, err := json.Marshal(descriptor)
		if err != nil {
			return nil, err
		}
		if _, exists := result[name]; exists {
			return nil, fmt.Errorf("external plugin tool name collision %q", name)
		}
		digest := sha256.Sum256(payload)
		result[name] = pluginMCPToolRegistration{
			fingerprint: hex.EncodeToString(digest[:]), descriptor: descriptor,
		}
	}
	return result, nil
}

func addPluginMCPTool(server *mcp.Server, name string, descriptor pluginruntime.ToolCallDescriptor, registry *pluginruntime.Registry) {
	pluginID := descriptor.PluginID
	tool := descriptor.Tool
	var outputSchema any
	if len(tool.OutputSchema) > 0 {
		outputSchema = json.RawMessage(tool.OutputSchema)
	}
	server.AddTool(&mcp.Tool{
		Name:         name,
		Title:        tool.Name,
		Description:  fmt.Sprintf("MilkSU plugin %s: %s", pluginID, tool.Description),
		InputSchema:  json.RawMessage(tool.InputSchema),
		OutputSchema: outputSchema,
		Annotations: &mcp.ToolAnnotations{
			ReadOnlyHint:    true,
			IdempotentHint:  true,
			DestructiveHint: mcpBoolPointer(false),
			OpenWorldHint:   mcpBoolPointer(false),
		},
	}, func(callContext context.Context, request *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		if request == nil || request.Params == nil {
			return pluginMCPError(errors.New("tool arguments are missing")), nil
		}
		input := request.Params.Arguments
		if len(input) == 0 {
			input = json.RawMessage(`{}`)
		}
		result, callErr := registry.CallTool(callContext, pluginruntime.ToolCall{
			PluginID: pluginID,
			ToolName: tool.Name,
			Input:    input,
		}, true)
		if callErr != nil {
			return pluginMCPError(callErr), nil
		}
		return pluginMCPSuccess(result.Content)
	})
}

func reconcilePluginMCPTools(server *mcp.Server, registry *pluginruntime.Registry, current map[string]pluginMCPToolRegistration) (map[string]pluginMCPToolRegistration, error) {
	next, err := pluginMCPToolCatalog(registry)
	if err != nil {
		return current, err
	}
	for name, existing := range current {
		candidate, stillPresent := next[name]
		if !stillPresent || candidate.fingerprint != existing.fingerprint {
			server.RemoveTools(name)
		}
	}
	for name, candidate := range next {
		existing, alreadyPresent := current[name]
		if !alreadyPresent || candidate.fingerprint != existing.fingerprint {
			addPluginMCPTool(server, name, candidate.descriptor, registry)
		}
	}
	return next, nil
}

func watchPluginMCPRegistry(ctx context.Context, dataDirectory string, server *mcp.Server, registry *pluginruntime.Registry, current map[string]pluginMCPToolRegistration) {
	revision := pluginMCPMetadataRevision(dataDirectory)
	ticker := time.NewTicker(time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			nextRevision := pluginMCPMetadataRevision(dataDirectory)
			if nextRevision == revision {
				continue
			}
			revision = nextRevision
			registry.Reload()
			next, err := reconcilePluginMCPTools(server, registry, current)
			if err != nil {
				for name := range current {
					server.RemoveTools(name)
				}
				current = map[string]pluginMCPToolRegistration{}
				continue
			}
			current = next
		}
	}
}

func pluginMCPMetadataRevision(dataDirectory string) string {
	hash := sha256.New()
	root := filepath.Join(dataDirectory, "plugins")
	for _, name := range []string{"state.json", "installed.json", "publishers.json"} {
		_, _ = io.WriteString(hash, name+"\x00")
		path := filepath.Join(root, name)
		info, err := os.Lstat(path)
		if errors.Is(err, os.ErrNotExist) {
			_, _ = io.WriteString(hash, "missing\x00")
			continue
		}
		if err != nil || info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() > maxPluginMCPMetadataBytes {
			_, _ = io.WriteString(hash, "unsafe\x00")
			continue
		}
		file, err := os.Open(path)
		if err != nil {
			_, _ = io.WriteString(hash, "unreadable\x00")
			continue
		}
		_, copyErr := io.CopyN(hash, file, info.Size())
		closeErr := file.Close()
		if copyErr != nil || closeErr != nil {
			_, _ = io.WriteString(hash, "read-error\x00")
		}
		_, _ = io.WriteString(hash, "\x00")
	}
	return hex.EncodeToString(hash.Sum(nil))
}

func registerPluginListTool(server *mcp.Server, registry *pluginruntime.Registry) {
	server.AddTool(&mcp.Tool{
		Name:         "milksu_plugins_list",
		Title:        "List MilkSU plugins",
		Description:  "List enabled MilkSU plugins whose reviewed read-only tools are currently exposed to external MCP clients.",
		InputSchema:  json.RawMessage(`{"type":"object","properties":{},"additionalProperties":false}`),
		OutputSchema: json.RawMessage(`{"type":"array","items":{"type":"object","required":["id","name","version","digest","enabled","status","external_read_tools"],"properties":{"id":{"type":"string"},"name":{"type":"string"},"version":{"type":"string"},"digest":{"type":"string"},"enabled":{"type":"boolean"},"status":{"type":"string"},"external_read_tools":{"type":"array","items":{"type":"string"}}},"additionalProperties":false}}`),
		Annotations: &mcp.ToolAnnotations{
			ReadOnlyHint:    true,
			IdempotentHint:  true,
			DestructiveHint: mcpBoolPointer(false),
			OpenWorldHint:   mcpBoolPointer(false),
		},
	}, func(_ context.Context, _ *mcp.CallToolRequest) (*mcp.CallToolResult, error) {
		type publicPlugin struct {
			ID      string   `json:"id"`
			Name    string   `json:"name"`
			Version string   `json:"version"`
			Digest  string   `json:"digest"`
			Enabled bool     `json:"enabled"`
			Status  string   `json:"status"`
			Tools   []string `json:"external_read_tools"`
		}
		exposed := make(map[string][]string)
		for _, descriptor := range registry.ExternalToolCatalog() {
			exposed[descriptor.PluginID] = append(exposed[descriptor.PluginID], externalMCPToolName(descriptor.PluginID, descriptor.Tool.Name))
		}
		plugins := make([]publicPlugin, 0, len(exposed))
		for _, descriptor := range registry.List() {
			if tools := exposed[descriptor.ID]; len(tools) > 0 {
				plugins = append(plugins, publicPlugin{
					ID: descriptor.ID, Name: descriptor.Name, Version: descriptor.Version,
					Digest: descriptor.Digest, Enabled: descriptor.Enabled,
					Status: string(descriptor.Status), Tools: tools,
				})
			}
		}
		return pluginMCPSuccess(plugins)
	})
}

func externalMCPToolName(pluginID, toolName string) string {
	prefix := strings.Trim(nonMCPToolNameCharacter.ReplaceAllString(pluginID, "_"), "_")
	if prefix == "" {
		prefix = "plugin"
	}
	name := prefix + "__" + toolName
	if len(name) <= 120 {
		return name
	}
	digest := sha256.Sum256([]byte(pluginID))
	suffix := "_" + hex.EncodeToString(digest[:6])
	prefixBudget := 120 - len("__") - len(toolName)
	keep := prefixBudget - len(suffix)
	if keep < 1 {
		keep = 1
	}
	if keep > len(prefix) {
		keep = len(prefix)
	}
	return prefix[:keep] + suffix + "__" + toolName
}

func pluginMCPSuccess(value any) (*mcp.CallToolResult, error) {
	encoded, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	return &mcp.CallToolResult{
		Content:           []mcp.Content{&mcp.TextContent{Text: string(encoded)}},
		StructuredContent: value,
	}, nil
}

func pluginMCPError(err error) *mcp.CallToolResult {
	message := strings.TrimSpace(err.Error())
	if len(message) > 2048 {
		message = message[:2048]
	}
	return &mcp.CallToolResult{
		Content: []mcp.Content{&mcp.TextContent{Text: message}},
		IsError: true,
	}
}

func mcpBoolPointer(value bool) *bool { return &value }
