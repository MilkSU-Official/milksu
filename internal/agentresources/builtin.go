package agentresources

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

var builtinMCPNames = []string{
	"ida-pro",
	"capa",
	"codeql",
	"burp-suite",
	"shannon",
}

var builtinSkillNames = []string{
	"frontend-visual-qa",
	"product-design",
	"integrate-api",
	"review-security",
	"create-technical-deliverables",
	"release-milksu",
	"archify",
}

type builtinMCPRecord struct {
	Enabled    *bool    `json:"enabled,omitempty"`
	Customized bool     `json:"customized,omitempty"`
	Command    string   `json:"command,omitempty"`
	Args       []string `json:"args,omitempty"`
}

type BuiltinMCPSnapshot struct {
	Name       string   `json:"name"`
	Enabled    bool     `json:"enabled"`
	Customized bool     `json:"customized"`
	Command    string   `json:"command,omitempty"`
	Args       []string `json:"args,omitempty"`
}

type BuiltinSkillSnapshot struct {
	Name       string `json:"name"`
	Customized bool   `json:"customized"`
}

type BuiltinSkillDocument struct {
	Name       string `json:"name"`
	Document   string `json:"document"`
	Customized bool   `json:"customized"`
}

type BuiltinMCPInput struct {
	Name    string   `json:"name"`
	Enabled *bool    `json:"enabled"`
	Command string   `json:"command"`
	Args    []string `json:"args"`
}

type ConfigHandoff struct {
	Kind           string `json:"kind"`
	Name           string `json:"name"`
	Title          string `json:"title"`
	Prompt         string `json:"prompt"`
	VisibleText    string `json:"visibleText"`
	WorkspacePath  string `json:"workspacePath"`
	ExecutionMode  string `json:"executionMode"`
	ApprovalPolicy string `json:"approvalPolicy"`
}

type workspaceMCPFile struct {
	ID      string   `json:"id"`
	Enabled *bool    `json:"enabled,omitempty"`
	Command string   `json:"command,omitempty"`
	Args    []string `json:"args,omitempty"`
}

func knownBuiltinMCP(name string) bool {
	for _, item := range builtinMCPNames {
		if item == name {
			return true
		}
	}
	return false
}

func knownBuiltinSkill(name string) bool {
	for _, item := range builtinSkillNames {
		if item == name {
			return true
		}
	}
	return false
}

func (s *Store) overlaySkillDir(name string) string {
	return filepath.Join(s.root, "overlays", "skills", name)
}

func (s *Store) workspaceDir() string {
	return filepath.Join(s.root, "workspace")
}

func (s *Store) UpsertBuiltinMCP(input BuiltinMCPInput) (CatalogSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadAndSyncLocked()
	if err != nil {
		return CatalogSnapshot{}, err
	}
	name := strings.TrimSpace(input.Name)
	if !knownBuiltinMCP(name) {
		return CatalogSnapshot{}, fmt.Errorf("unknown built-in MCP %q", name)
	}
	if document.BuiltinMCP == nil {
		document.BuiltinMCP = map[string]builtinMCPRecord{}
	}
	record := document.BuiltinMCP[name]
	if input.Enabled != nil {
		record.Enabled = input.Enabled
	}
	command := strings.TrimSpace(input.Command)
	args := normalizeOverlayArgs(input.Args)
	if command != "" || len(args) > 0 {
		if command != "" {
			if len([]rune(command)) > maxCommandRunes {
				return CatalogSnapshot{}, fmt.Errorf("MCP command is too long")
			}
			record.Command = command
		}
		record.Args = args
		record.Customized = true
	}
	document.BuiltinMCP[name] = record
	if err := s.saveLocked(document); err != nil {
		return CatalogSnapshot{}, err
	}
	if err := s.writeWorkspaceLocked(document); err != nil {
		return CatalogSnapshot{}, err
	}
	return s.snapshotLocked(document), nil
}

func (s *Store) SetBuiltinMCPEnabled(name string, enabled bool) (CatalogSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadAndSyncLocked()
	if err != nil {
		return CatalogSnapshot{}, err
	}
	name = strings.TrimSpace(name)
	if !knownBuiltinMCP(name) {
		return CatalogSnapshot{}, fmt.Errorf("unknown built-in MCP %q", name)
	}
	if document.BuiltinMCP == nil {
		document.BuiltinMCP = map[string]builtinMCPRecord{}
	}
	record := document.BuiltinMCP[name]
	record.Enabled = &enabled
	document.BuiltinMCP[name] = record
	if err := s.saveLocked(document); err != nil {
		return CatalogSnapshot{}, err
	}
	if err := s.writeWorkspaceLocked(document); err != nil {
		return CatalogSnapshot{}, err
	}
	return s.snapshotLocked(document), nil
}

func (s *Store) RestoreBuiltinMCP(name string) (CatalogSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadAndSyncLocked()
	if err != nil {
		return CatalogSnapshot{}, err
	}
	name = strings.TrimSpace(name)
	if !knownBuiltinMCP(name) {
		return CatalogSnapshot{}, fmt.Errorf("unknown built-in MCP %q", name)
	}
	if document.BuiltinMCP != nil {
		delete(document.BuiltinMCP, name)
	}
	if err := s.saveLocked(document); err != nil {
		return CatalogSnapshot{}, err
	}
	if err := s.writeWorkspaceLocked(document); err != nil {
		return CatalogSnapshot{}, err
	}
	return s.snapshotLocked(document), nil
}

func (s *Store) GetBuiltinSkillDocument(name string) (BuiltinSkillDocument, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if _, err := s.loadAndSyncLocked(); err != nil {
		return BuiltinSkillDocument{}, err
	}
	name = strings.TrimSpace(name)
	if !knownBuiltinSkill(name) {
		return BuiltinSkillDocument{}, fmt.Errorf("unknown built-in skill %q", name)
	}
	document, customized, err := s.readEffectiveSkillLocked(name)
	if err != nil {
		return BuiltinSkillDocument{}, err
	}
	return BuiltinSkillDocument{Name: name, Document: document, Customized: customized}, nil
}

func (s *Store) SetBuiltinSkillDocument(name, body string) (CatalogSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	catalog, err := s.loadAndSyncLocked()
	if err != nil {
		return CatalogSnapshot{}, err
	}
	name = strings.TrimSpace(name)
	if !knownBuiltinSkill(name) {
		return CatalogSnapshot{}, fmt.Errorf("unknown built-in skill %q", name)
	}
	if strings.TrimSpace(body) == "" {
		return CatalogSnapshot{}, fmt.Errorf("skill document is empty")
	}
	if !utf8StringWithin(body, maxSkillFileBytes) {
		return CatalogSnapshot{}, fmt.Errorf("SKILL.md exceeds 1 MiB")
	}
	if parsedName, _, _ := parseSkillFrontmatter(body); parsedName != "" && !validResourceName(parsedName) {
		return CatalogSnapshot{}, fmt.Errorf("skill name is invalid")
	}
	destination := s.overlaySkillDir(name)
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return CatalogSnapshot{}, fmt.Errorf("create skill overlay: %w", err)
	}
	if err := os.WriteFile(filepath.Join(destination, "SKILL.md"), []byte(body), 0o600); err != nil {
		return CatalogSnapshot{}, fmt.Errorf("write skill overlay: %w", err)
	}
	if err := s.writeWorkspaceLocked(catalog); err != nil {
		return CatalogSnapshot{}, err
	}
	return s.snapshotLocked(catalog), nil
}

func (s *Store) RestoreBuiltinSkill(name string) (CatalogSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	catalog, err := s.loadAndSyncLocked()
	if err != nil {
		return CatalogSnapshot{}, err
	}
	name = strings.TrimSpace(name)
	if !knownBuiltinSkill(name) {
		return CatalogSnapshot{}, fmt.Errorf("unknown built-in skill %q", name)
	}
	if err := os.RemoveAll(s.overlaySkillDir(name)); err != nil {
		return CatalogSnapshot{}, fmt.Errorf("remove skill overlay: %w", err)
	}
	if err := s.writeWorkspaceLocked(catalog); err != nil {
		return CatalogSnapshot{}, err
	}
	return s.snapshotLocked(catalog), nil
}

func (s *Store) EnsureConfigWorkspace() (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadAndSyncLocked()
	if err != nil {
		return "", err
	}
	if err := s.writeWorkspaceLocked(document); err != nil {
		return "", err
	}
	return s.workspaceDir(), nil
}

func (s *Store) LookupBuiltinMCP(name string) (command string, args []string, enabled bool, customized bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	enabled = true
	document, err := s.loadAndSyncLocked()
	if err != nil {
		return "", nil, enabled, false
	}
	record, ok := document.BuiltinMCP[name]
	if !ok {
		return "", nil, enabled, false
	}
	if record.Enabled != nil {
		enabled = *record.Enabled
	}
	return record.Command, append([]string(nil), record.Args...), enabled, record.Customized
}

func (s *Store) BuiltinMCPEnabled(name string, fallback bool) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadLocked()
	if err != nil {
		return fallback
	}
	record, ok := document.BuiltinMCP[name]
	if !ok || record.Enabled == nil {
		return fallback
	}
	return *record.Enabled
}

func (s *Store) loadAndSyncLocked() (catalogDocument, error) {
	document, err := s.loadLocked()
	if err != nil {
		return catalogDocument{}, err
	}
	if err := s.syncWorkspaceLocked(&document); err != nil {
		return catalogDocument{}, err
	}
	return document, nil
}

func (s *Store) syncWorkspaceLocked(document *catalogDocument) error {
	root := s.workspaceDir()
	info, err := os.Lstat(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return fmt.Errorf("stat config workspace: %w", err)
	}
	if !info.IsDir() {
		return nil
	}
	if document.BuiltinMCP == nil {
		document.BuiltinMCP = map[string]builtinMCPRecord{}
	}
	changed := false
	for _, name := range builtinMCPNames {
		path := filepath.Join(root, "mcp", name+".json")
		data, readErr := os.ReadFile(path)
		if readErr != nil {
			continue
		}
		var file workspaceMCPFile
		if json.Unmarshal(data, &file) != nil {
			continue
		}
		id := strings.TrimSpace(file.ID)
		if id == "" {
			id = name
		}
		if id != name || !knownBuiltinMCP(id) {
			continue
		}
		record := document.BuiltinMCP[name]
		command := strings.TrimSpace(file.Command)
		args := normalizeOverlayArgs(file.Args)
		if file.Enabled != nil {
			record.Enabled = file.Enabled
			changed = true
		}
		if command == "" && len(args) == 0 {
			if record.Customized || record.Command != "" || len(record.Args) > 0 {
				record.Customized = false
				record.Command = ""
				record.Args = nil
				changed = true
			}
		} else if record.Command != command || !stringSlicesEqual(record.Args, args) {
			record.Command = command
			record.Args = args
			record.Customized = true
			changed = true
		}
		document.BuiltinMCP[name] = record
	}
	for _, name := range builtinSkillNames {
		body, readErr := os.ReadFile(filepath.Join(root, "skills", name, "SKILL.md"))
		if readErr != nil {
			continue
		}
		factory, factoryErr := s.readFactorySkillLocked(name)
		overlayPath := filepath.Join(s.overlaySkillDir(name), "SKILL.md")
		if factoryErr == nil && string(body) == factory {
			if _, err := os.Stat(overlayPath); err == nil {
				_ = os.RemoveAll(s.overlaySkillDir(name))
			}
			continue
		}
		if err := os.MkdirAll(s.overlaySkillDir(name), 0o700); err != nil {
			return fmt.Errorf("create skill overlay: %w", err)
		}
		if err := os.WriteFile(overlayPath, body, 0o600); err != nil {
			return fmt.Errorf("write skill overlay: %w", err)
		}
	}
	if changed {
		return s.saveLocked(*document)
	}
	return nil
}

func (s *Store) writeWorkspaceLocked(document catalogDocument) error {
	root := s.workspaceDir()
	if err := os.MkdirAll(filepath.Join(root, "mcp"), 0o700); err != nil {
		return fmt.Errorf("create config workspace: %w", err)
	}
	if err := os.MkdirAll(filepath.Join(root, "skills"), 0o700); err != nil {
		return fmt.Errorf("create config workspace: %w", err)
	}
	if err := os.WriteFile(filepath.Join(root, "AGENTS.md"), []byte(configWorkspaceGuidance()), 0o600); err != nil {
		return fmt.Errorf("write config workspace guidance: %w", err)
	}
	for _, name := range builtinMCPNames {
		record := document.BuiltinMCP[name]
		enabled := true
		if record.Enabled != nil {
			enabled = *record.Enabled
		}
		payload, err := json.MarshalIndent(workspaceMCPFile{
			ID:      name,
			Enabled: &enabled,
			Command: record.Command,
			Args:    append([]string(nil), record.Args...),
		}, "", "  ")
		if err != nil {
			return err
		}
		if err := os.WriteFile(filepath.Join(root, "mcp", name+".json"), append(payload, '\n'), 0o600); err != nil {
			return fmt.Errorf("write built-in MCP workspace file: %w", err)
		}
	}
	for _, name := range builtinSkillNames {
		body, _, err := s.readEffectiveSkillLocked(name)
		if err != nil {
			continue
		}
		dir := filepath.Join(root, "skills", name)
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("create workspace skill: %w", err)
		}
		if err := os.WriteFile(filepath.Join(dir, "SKILL.md"), []byte(body), 0o600); err != nil {
			return fmt.Errorf("write workspace skill: %w", err)
		}
	}
	return nil
}

func (s *Store) readEffectiveSkillLocked(name string) (string, bool, error) {
	overlay := filepath.Join(s.overlaySkillDir(name), "SKILL.md")
	if data, err := os.ReadFile(overlay); err == nil {
		return string(data), true, nil
	}
	body, err := s.readFactorySkillLocked(name)
	if err != nil {
		return "", false, err
	}
	return body, false, nil
}

func (s *Store) readFactorySkillLocked(name string) (string, error) {
	dir := s.factorySkillDir(name)
	if dir == "" {
		return "", fmt.Errorf("factory skills directory is not configured")
	}
	data, err := os.ReadFile(filepath.Join(dir, "SKILL.md"))
	if err != nil {
		return "", fmt.Errorf("read factory skill %s: %w", name, err)
	}
	return string(data), nil
}

func (s *Store) overlaySkillPathsLocked() (paths []string, hideFactory []string) {
	for _, name := range builtinSkillNames {
		path := s.overlaySkillDir(name)
		if _, err := os.Stat(filepath.Join(path, "SKILL.md")); err != nil {
			continue
		}
		paths = append(paths, path)
		hideFactory = append(hideFactory, name)
	}
	return paths, hideFactory
}

func (s *Store) builtinMCPSnapshotsLocked(document catalogDocument) []BuiltinMCPSnapshot {
	result := make([]BuiltinMCPSnapshot, 0, len(builtinMCPNames))
	for _, name := range builtinMCPNames {
		record := document.BuiltinMCP[name]
		enabled := true
		if record.Enabled != nil {
			enabled = *record.Enabled
		}
		result = append(result, BuiltinMCPSnapshot{
			Name:       name,
			Enabled:    enabled,
			Customized: record.Customized,
			Command:    record.Command,
			Args:       append([]string(nil), record.Args...),
		})
	}
	return result
}

func (s *Store) builtinSkillSnapshotsLocked() []BuiltinSkillSnapshot {
	result := make([]BuiltinSkillSnapshot, 0, len(builtinSkillNames))
	for _, name := range builtinSkillNames {
		_, err := os.Stat(filepath.Join(s.overlaySkillDir(name), "SKILL.md"))
		result = append(result, BuiltinSkillSnapshot{
			Name:       name,
			Customized: err == nil,
		})
	}
	return result
}

func normalizeOverlayArgs(values []string) []string {
	result := make([]string, 0, len(values))
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		if len([]rune(trimmed)) > maxArgRunes || len(result) >= maxArgs {
			continue
		}
		result = append(result, trimmed)
	}
	return result
}

func stringSlicesEqual(left, right []string) bool {
	if len(left) != len(right) {
		return false
	}
	for index := range left {
		if left[index] != right[index] {
			return false
		}
	}
	return true
}

func utf8StringWithin(value string, maxBytes int) bool {
	return len(value) <= maxBytes
}

func configWorkspaceGuidance() string {
	return strings.TrimSpace(`
# MilkSU agent resource workspace

Edit the files in this directory to change this machine's built-in MCP and Skill overlays.
MilkSU reloads these files when Settings opens the catalog or a Coding turn starts.

- mcp/<id>.json: built-in MCP overlay. IDs: ida-pro, capa, codeql, burp-suite, shannon.
  Set command/args to override this version's detected adapter. Clear command and args to use detection again.
  Do not put API keys or tokens in these files.
- skills/<name>/SKILL.md: overlay of a shipped first-party Skill. Keep Pi catalog rules:
  name + when-to-use description in frontmatter; body stays in this file for read /skill:name.
  disable-model-invocation: true keeps a skill slash-only.

To restore this app version's factory files, use Settings restore, or delete the overlay and leave an empty command.

Do not scan the user's chat with keywords. Follow natural-language requests and edit these files.
`) + "\n"
}
