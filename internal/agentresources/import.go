package agentresources

import (
	"encoding/json"
	"fmt"
	"strings"
)

func (s *Store) ImportMCPJSON(raw []byte) (CatalogSnapshot, error) {
	if len(raw) == 0 || len(raw) > maxCatalogBytes {
		return CatalogSnapshot{}, fmt.Errorf("MCP JSON is empty or too large")
	}
	inputs, err := parseImportedMCPServers(raw)
	if err != nil {
		return CatalogSnapshot{}, err
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadLocked()
	if err != nil {
		return CatalogSnapshot{}, err
	}
	added := 0
	for _, input := range inputs {
		if _, found := document.MCPServers[strings.TrimSpace(input.Name)]; !found {
			added++
		}
	}
	if len(document.MCPServers)+added > maxUserMCPServers {
		return CatalogSnapshot{}, fmt.Errorf("at most %d user MCP servers can be saved", maxUserMCPServers)
	}
	for _, input := range inputs {
		record, err := s.upsertMCPLocked(document, input)
		if err != nil {
			return CatalogSnapshot{}, err
		}
		document.MCPServers[record.name] = record.value
	}
	if err := s.saveLocked(document); err != nil {
		return CatalogSnapshot{}, err
	}
	return s.snapshotLocked(document), nil
}

func parseImportedMCPServers(raw []byte) ([]MCPServerInput, error) {
	var document map[string]json.RawMessage
	if err := json.Unmarshal(raw, &document); err != nil {
		return nil, fmt.Errorf("MCP JSON is invalid")
	}
	payload := document
	if nested, ok := document["mcpServers"]; ok {
		var servers map[string]json.RawMessage
		if err := json.Unmarshal(nested, &servers); err != nil {
			return nil, fmt.Errorf("mcpServers must be an object")
		}
		payload = servers
	} else if nested, ok := document["servers"]; ok {
		var servers map[string]json.RawMessage
		if err := json.Unmarshal(nested, &servers); err != nil {
			return nil, fmt.Errorf("servers must be an object")
		}
		payload = servers
	}
	if looksLikeSingleServer(payload) {
		return nil, fmt.Errorf("MCP JSON must map server names to definitions")
	}
	if len(payload) == 0 {
		return nil, fmt.Errorf("MCP JSON does not contain any servers")
	}
	seen := map[string]string{}
	result := make([]MCPServerInput, 0, len(payload))
	for rawName, encoded := range payload {
		name := normalizeImportedName(rawName)
		if !validResourceName(name) {
			return nil, fmt.Errorf("MCP server name %q is invalid", rawName)
		}
		if previous, exists := seen[name]; exists {
			return nil, fmt.Errorf("MCP server names %q and %q collide", previous, rawName)
		}
		seen[name] = rawName
		var definition map[string]any
		if err := json.Unmarshal(encoded, &definition); err != nil {
			return nil, fmt.Errorf("MCP server %q is invalid", rawName)
		}
		input, err := mcpInputFromImported(name, definition)
		if err != nil {
			return nil, err
		}
		result = append(result, input)
	}
	return result, nil
}

func looksLikeSingleServer(document map[string]json.RawMessage) bool {
	if len(document) == 0 {
		return false
	}
	_, hasCommand := document["command"]
	_, hasURL := document["url"]
	_, hasServerURL := document["serverUrl"]
	_, hasSocket := document["socket"]
	return hasCommand || hasURL || hasServerURL || hasSocket
}

func mcpInputFromImported(name string, definition map[string]any) (MCPServerInput, error) {
	enabled := true
	if raw, ok := definition["disabled"]; ok {
		if disabled, ok := raw.(bool); ok && disabled {
			enabled = false
		}
	}
	command := importedString(definition, "command")
	remoteURL := firstImportedString(definition, "url", "serverUrl")
	socket := importedString(definition, "socket")
	kind := strings.ToLower(importedString(definition, "type"))
	transport := "command"
	switch {
	case kind == "url" || kind == "http" || kind == "sse" || kind == "streamable-http" || remoteURL != "":
		transport = "url"
	case kind == "socket" || socket != "":
		transport = "socket"
	case kind == "command" || kind == "stdio" || command != "":
		transport = "command"
	default:
		return MCPServerInput{}, fmt.Errorf("MCP server %q is missing command, url, or socket", name)
	}
	input := MCPServerInput{
		Name:      name,
		Enabled:   &enabled,
		Transport: transport,
		Command:   command,
		Args:      importedStringList(definition["args"]),
		URL:       remoteURL,
		Socket:    socket,
		Env:       importedStringMap(definition["env"]),
		Headers:   importedStringMap(definition["headers"]),
	}
	if bearer := importedString(definition, "bearerToken", "bearer_token"); bearer != "" {
		input.BearerToken = bearer
	}
	return input, nil
}

func normalizeImportedName(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	var builder strings.Builder
	hyphen := false
	for _, character := range value {
		if character >= 'a' && character <= 'z' || character >= '0' && character <= '9' {
			builder.WriteRune(character)
			hyphen = false
			continue
		}
		if builder.Len() > 0 && !hyphen {
			builder.WriteByte('-')
			hyphen = true
		}
	}
	return strings.Trim(builder.String(), "-")
}

func firstImportedString(definition map[string]any, keys ...string) string {
	for _, key := range keys {
		if value := importedString(definition, key); value != "" {
			return value
		}
	}
	return ""
}

func importedString(definition map[string]any, keys ...string) string {
	for _, key := range keys {
		value, ok := definition[key]
		if !ok {
			continue
		}
		text, ok := value.(string)
		if !ok {
			continue
		}
		if trimmed := strings.TrimSpace(text); trimmed != "" {
			return trimmed
		}
	}
	return ""
}

func importedStringList(value any) []string {
	items, ok := value.([]any)
	if !ok {
		return nil
	}
	result := make([]string, 0, len(items))
	for _, item := range items {
		text, ok := item.(string)
		if !ok {
			continue
		}
		if trimmed := strings.TrimSpace(text); trimmed != "" {
			result = append(result, trimmed)
		}
	}
	return result
}

func importedStringMap(value any) map[string]string {
	items, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	result := map[string]string{}
	for key, raw := range items {
		text, ok := raw.(string)
		if !ok {
			continue
		}
		name := strings.TrimSpace(key)
		if name == "" {
			continue
		}
		result[name] = text
	}
	if len(result) == 0 {
		return nil
	}
	return result
}
