package plugin

import (
	"bytes"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

const (
	manifestFileName = "plugin.json"
	maxManifestBytes = 64 << 10
	maxEntryBytes    = 2 << 20
)

var (
	pluginIDPattern   = regexp.MustCompile(`^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$`)
	toolNamePattern   = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)
	capabilityPattern = regexp.MustCompile(`^[a-z][a-z0-9.-]{2,95}$`)
	hexDigestPattern  = regexp.MustCompile(`^[a-f0-9]{64}$`)
	allowedSlots      = map[string]struct{}{"settings.plugin-panel": {}, "app.background": {}}
	allowedPermission = map[Permission]struct{}{
		PermissionStorage: {}, PermissionUIBackground: {}, PermissionUITheme: {},
		PermissionAgentTools: {}, PermissionMCPExternalRead: {},
	}
)

func readManifest(directory string) (Manifest, error) {
	path, err := securePackageFile(directory, manifestFileName, maxManifestBytes)
	if err != nil {
		return Manifest{}, err
	}
	file, err := os.Open(path)
	if err != nil {
		return Manifest{}, err
	}
	defer file.Close()
	var value Manifest
	decoder := json.NewDecoder(io.LimitReader(file, maxManifestBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&value); err != nil {
		return Manifest{}, fmt.Errorf("decode %s: %w", manifestFileName, err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return Manifest{}, fmt.Errorf("%s contains trailing JSON data", manifestFileName)
	}
	if err := validateManifest(directory, value); err != nil {
		return Manifest{}, err
	}
	return value, nil
}

func validateManifest(directory string, value Manifest) error {
	if value.APIVersion != APIVersion && value.APIVersion != LegacyAPIVersion {
		return fmt.Errorf("unsupported plugin apiVersion %q", value.APIVersion)
	}
	if len(value.ID) > 64 || !pluginIDPattern.MatchString(value.ID) {
		return fmt.Errorf("invalid plugin id %q", value.ID)
	}
	if strings.TrimSpace(value.Name) == "" || len(value.Name) > 96 {
		return errors.New("plugin name must contain 1-96 characters")
	}
	if _, err := parseSemanticVersion(value.Version); err != nil {
		return fmt.Errorf("plugin version: %w", err)
	}
	if value.APIVersion == APIVersion {
		if strings.TrimSpace(value.Publisher.Name) == "" || len(value.Publisher.Name) > 96 {
			return errors.New("stable plugins require a publisher name of at most 96 characters")
		}
		if value.Publisher.KeyID != "" && !hexDigestPattern.MatchString(value.Publisher.KeyID) {
			return errors.New("publisher keyId must be a lowercase SHA-256 fingerprint")
		}
		if _, err := parseSemanticVersion(value.Host.MinVersion); err != nil {
			return fmt.Errorf("host minVersion: %w", err)
		}
		if value.StorageVersion == 0 {
			return errors.New("stable plugins require storageVersion >= 1")
		}
		seenMigrations := map[[2]uint]struct{}{}
		for _, migration := range value.StorageMigrations {
			key := [2]uint{migration.From, migration.To}
			if migration.From == 0 || migration.To <= migration.From || migration.To > value.StorageVersion {
				return fmt.Errorf("invalid storage migration %d -> %d", migration.From, migration.To)
			}
			if _, duplicate := seenMigrations[key]; duplicate {
				return fmt.Errorf("duplicate storage migration %d -> %d", migration.From, migration.To)
			}
			seenMigrations[key] = struct{}{}
		}
		seenCapabilities := map[string]struct{}{}
		for _, capability := range value.Host.RequiredCapabilities {
			if !capabilityPattern.MatchString(capability) {
				return fmt.Errorf("invalid required host capability %q", capability)
			}
			if _, duplicate := seenCapabilities[capability]; duplicate {
				return fmt.Errorf("duplicate required host capability %q", capability)
			}
			seenCapabilities[capability] = struct{}{}
		}
	}
	switch value.Runtime.Kind {
	case RuntimeLua:
		if !strings.EqualFold(filepath.Ext(value.Runtime.Entry), ".lua") {
			return errors.New("lua runtime entry must end in .lua")
		}
	case RuntimeTypeScript:
		if extension := strings.ToLower(filepath.Ext(value.Runtime.Entry)); extension != ".mjs" && extension != ".js" {
			return errors.New("typescript runtime entry must be a compiled .mjs or .js bundle")
		}
	default:
		return fmt.Errorf("unsupported plugin runtime %q", value.Runtime.Kind)
	}
	if _, err := securePackageFile(directory, value.Runtime.Entry, maxEntryBytes); err != nil {
		return fmt.Errorf("runtime entry: %w", err)
	}
	permissionSet := make(map[Permission]struct{}, len(value.Permissions))
	for _, permission := range value.Permissions {
		if _, ok := allowedPermission[permission]; !ok {
			return fmt.Errorf("unsupported permission %q", permission)
		}
		if _, duplicate := permissionSet[permission]; duplicate {
			return fmt.Errorf("duplicate permission %q", permission)
		}
		permissionSet[permission] = struct{}{}
	}
	if len(value.StorageMigrations) > 0 {
		if _, ok := permissionSet[PermissionStorage]; !ok {
			return errors.New("storage migrations require plugin.storage permission")
		}
	}
	if value.UI != nil && value.UI.SettingsEntry != "" {
		if _, err := securePackageFile(directory, value.UI.SettingsEntry, maxEntryBytes); err != nil {
			return fmt.Errorf("settings entry: %w", err)
		}
		extension := strings.ToLower(filepath.Ext(value.UI.SettingsEntry))
		if extension != ".js" && extension != ".mjs" {
			return errors.New("settings entry must be a compiled .js or .mjs bundle")
		}
	}
	if value.Theme != nil {
		if _, ok := permissionSet[PermissionUITheme]; !ok {
			return errors.New("theme contribution requires ui.theme permission")
		}
		if _, err := securePackageFile(directory, value.Theme.Source, maxEntryBytes); err != nil {
			return fmt.Errorf("theme token map: %w", err)
		}
		if !strings.EqualFold(filepath.Ext(value.Theme.Source), ".json") {
			return errors.New("theme source must be a compiled JSON token map")
		}
	}
	seenSlots := map[string]struct{}{}
	for _, slot := range value.Contributes.Slots {
		if _, ok := allowedSlots[slot]; !ok {
			return fmt.Errorf("unsupported contribution slot %q", slot)
		}
		if _, duplicate := seenSlots[slot]; duplicate {
			return fmt.Errorf("duplicate contribution slot %q", slot)
		}
		seenSlots[slot] = struct{}{}
	}
	if value.UI != nil && value.UI.SettingsEntry != "" {
		if _, ok := seenSlots["settings.plugin-panel"]; !ok {
			return errors.New("settings entry requires settings.plugin-panel contribution")
		}
	}
	if _, ok := seenSlots["app.background"]; ok {
		if _, permitted := permissionSet[PermissionUIBackground]; !permitted {
			return errors.New("app.background contribution requires ui.background permission")
		}
		if value.Theme == nil {
			return errors.New("app.background contribution requires a compiled theme")
		}
	}
	if value.Theme != nil {
		if _, ok := seenSlots["app.background"]; !ok {
			return errors.New("theme contribution requires the exclusive app.background slot")
		}
	}
	seenTools := map[string]struct{}{}
	for index, tool := range value.Contributes.Tools {
		if !toolNamePattern.MatchString(tool.Name) {
			return fmt.Errorf("tool %d has invalid name %q", index, tool.Name)
		}
		if _, duplicate := seenTools[tool.Name]; duplicate {
			return fmt.Errorf("duplicate tool name %q", tool.Name)
		}
		seenTools[tool.Name] = struct{}{}
		if strings.TrimSpace(tool.Description) == "" || len(tool.Description) > 512 {
			return fmt.Errorf("tool %q requires a description of at most 512 characters", tool.Name)
		}
		if tool.Effect != ToolEffectRead && tool.Effect != ToolEffectWrite {
			return fmt.Errorf("tool %q has unsupported effect %q", tool.Name, tool.Effect)
		}
		if tool.External != ExternalNone && tool.External != ExternalRead {
			return fmt.Errorf("tool %q has unsupported external exposure %q", tool.Name, tool.External)
		}
		if tool.External == ExternalRead && tool.Effect != ToolEffectRead {
			return fmt.Errorf("write tool %q cannot be exposed through read-only external MCP", tool.Name)
		}
		if tool.External == ExternalRead {
			if _, ok := permissionSet[PermissionMCPExternalRead]; !ok {
				return fmt.Errorf("tool %q requires mcp.external.read permission", tool.Name)
			}
		}
		if _, ok := permissionSet[PermissionAgentTools]; !ok {
			return fmt.Errorf("tool %q requires agent.tools permission", tool.Name)
		}
		if err := validateInputSchema(tool.InputSchema); err != nil {
			return fmt.Errorf("tool %q inputSchema: %w", tool.Name, err)
		}
		if value.APIVersion == APIVersion {
			if err := validateInputSchema(tool.OutputSchema); err != nil {
				return fmt.Errorf("tool %q outputSchema: %w", tool.Name, err)
			}
		}
	}
	return nil
}

func validateInputSchema(raw json.RawMessage) error {
	if len(raw) == 0 || len(raw) > maxManifestBytes {
		return errors.New("must be a bounded JSON object")
	}
	decoder := json.NewDecoder(bytes.NewReader(raw))
	decoder.UseNumber()
	var value map[string]any
	if err := decoder.Decode(&value); err != nil {
		return err
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return errors.New("contains trailing JSON data")
	}
	if schemaType, _ := value["type"].(string); schemaType != "object" {
		return errors.New("top-level type must be object")
	}
	return validateSchemaDefinition(value, true)
}

func securePackageFile(directory, relativePath string, maxBytes int64) (string, error) {
	relativePath = strings.TrimSpace(relativePath)
	if !fs.ValidPath(relativePath) || strings.Contains(relativePath, `\`) {
		return "", errors.New("entry path must be a canonical relative slash path")
	}
	clean := filepath.Clean(filepath.FromSlash(relativePath))
	if clean == "." || clean == ".." || strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", errors.New("entry path escapes the plugin package")
	}
	root, err := filepath.Abs(directory)
	if err != nil {
		return "", err
	}
	path := filepath.Join(root, clean)
	relative, err := filepath.Rel(root, path)
	if err != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", errors.New("entry path escapes the plugin package")
	}
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return "", fmt.Errorf("%s must be a regular, non-symlink file", relativePath)
	}
	if info.Size() > maxBytes {
		return "", fmt.Errorf("%s is larger than %d bytes", relativePath, maxBytes)
	}
	return path, nil
}
