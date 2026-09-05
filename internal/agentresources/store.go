package agentresources

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"unicode"
	"unicode/utf8"
)

const (
	catalogSchema       = "milksu-agent-resources/v1"
	catalogFileName     = "catalog.json"
	maxCatalogBytes     = 1 << 20
	maxUserMCPServers   = 32
	maxUserSkills       = 64
	maxSkillFiles       = 200
	maxSkillBytes       = 8 << 20
	maxSkillFileBytes   = 1 << 20
	maxCommandRunes     = 256
	maxArgRunes         = 500
	maxArgs             = 32
	maxEnvNameRunes     = 64
	secretAccountPrefix = "mcp.user."
)

var reservedMCPNames = map[string]struct{}{
	"milksu-playwright":      {},
	"milksu-playwright-user": {},
	"milksu-computer-use":    {},
	"milksu-ida-pro":         {},
}

type secretKeeper interface {
	PutManagedSecret(account, secret string) error
	DeleteManagedSecret(account string) error
	LookupManagedSecret(account string) (string, error)
}

type catalogDocument struct {
	Schema     string                    `json:"schema"`
	MCPServers map[string]userMCPRecord  `json:"mcpServers"`
	Skills     map[string]userSkillRecord `json:"skills"`
}

type userMCPRecord struct {
	Enabled     bool     `json:"enabled"`
	Transport   string   `json:"transport"`
	Command     string   `json:"command,omitempty"`
	Args        []string `json:"args,omitempty"`
	URL         string   `json:"url,omitempty"`
	Socket      string   `json:"socket,omitempty"`
	EnvNames    []string `json:"envNames,omitempty"`
	HeaderNames []string `json:"headerNames,omitempty"`
	HasBearer   bool     `json:"hasBearer,omitempty"`
}

type userSkillRecord struct {
	Enabled     bool   `json:"enabled"`
	Description string `json:"description,omitempty"`
}

type CatalogSnapshot struct {
	MCPServers []MCPServerSnapshot `json:"mcpServers"`
	Skills     []SkillSnapshot     `json:"skills"`
}

type MCPServerSnapshot struct {
	Name            string   `json:"name"`
	Enabled         bool     `json:"enabled"`
	Transport       string   `json:"transport"`
	Command         string   `json:"command,omitempty"`
	Args            []string `json:"args,omitempty"`
	URL             string   `json:"url,omitempty"`
	Socket          string   `json:"socket,omitempty"`
	EnvNames        []string `json:"envNames,omitempty"`
	HeaderNames     []string `json:"headerNames,omitempty"`
	HasBearer       bool     `json:"hasBearer,omitempty"`
	FileAccess      string   `json:"fileAccess"`
	NetworkAccess   string   `json:"networkAccess"`
	Scope           string   `json:"scope"`
	ReviewReady     bool     `json:"reviewReady"`
}

type SkillSnapshot struct {
	Name        string `json:"name"`
	Label       string `json:"label"`
	Description string `json:"description"`
	Enabled     bool   `json:"enabled"`
	Origin      string `json:"origin"`
	SlashOnly   bool   `json:"slashOnly,omitempty"`
}

type MCPServerInput struct {
	Name          string            `json:"name"`
	Enabled       *bool             `json:"enabled"`
	Transport     string            `json:"transport"`
	Command       string            `json:"command"`
	Args          []string          `json:"args"`
	URL           string            `json:"url"`
	Socket        string            `json:"socket"`
	Env           map[string]string `json:"env"`
	Headers       map[string]string `json:"headers"`
	BearerToken   string            `json:"bearerToken"`
	RemoveEnv     []string          `json:"removeEnv"`
	RemoveHeaders []string          `json:"removeHeaders"`
	ClearBearer   bool              `json:"clearBearer"`
}

type RuntimeMCPServer struct {
	Name       string
	Definition map[string]any
}

type Runtime struct {
	MCPServers []RuntimeMCPServer
	SkillPaths []string
}

type Store struct {
	mu      sync.Mutex
	root    string
	secrets secretKeeper
}

func NewStore(dataDirectory string, secrets secretKeeper) (*Store, error) {
	if secrets == nil {
		return nil, fmt.Errorf("agent resource secret store is required")
	}
	root := filepath.Join(dataDirectory, "agent-resources")
	if err := os.MkdirAll(filepath.Join(root, "skills"), 0o700); err != nil {
		return nil, fmt.Errorf("create agent resource directory: %w", err)
	}
	if err := os.Chmod(root, 0o700); err != nil {
		return nil, fmt.Errorf("protect agent resource directory: %w", err)
	}
	store := &Store{root: root, secrets: secrets}
	if _, err := store.loadLocked(); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, err
	}
	return store, nil
}

func (s *Store) Snapshot() (CatalogSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadLocked()
	if err != nil {
		return CatalogSnapshot{}, err
	}
	return s.snapshotLocked(document), nil
}

func (s *Store) UpsertMCPServer(input MCPServerInput) (CatalogSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadLocked()
	if err != nil {
		return CatalogSnapshot{}, err
	}
	record, err := s.upsertMCPLocked(document, input)
	if err != nil {
		return CatalogSnapshot{}, err
	}
	document.MCPServers[record.name] = record.value
	if err := s.saveLocked(document); err != nil {
		return CatalogSnapshot{}, err
	}
	return s.snapshotLocked(document), nil
}

func (s *Store) SetMCPServerEnabled(name string, enabled bool) (CatalogSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadLocked()
	if err != nil {
		return CatalogSnapshot{}, err
	}
	if !validResourceName(name) {
		return CatalogSnapshot{}, fmt.Errorf("MCP server name is invalid")
	}
	record, exists := document.MCPServers[name]
	if !exists {
		return CatalogSnapshot{}, fmt.Errorf("MCP server %q is not configured", name)
	}
	record.Enabled = enabled
	document.MCPServers[name] = record
	if err := s.saveLocked(document); err != nil {
		return CatalogSnapshot{}, err
	}
	return s.snapshotLocked(document), nil
}

func (s *Store) DeleteMCPServer(name string) (CatalogSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadLocked()
	if err != nil {
		return CatalogSnapshot{}, err
	}
	if !validResourceName(name) {
		return CatalogSnapshot{}, fmt.Errorf("MCP server name is invalid")
	}
	record, exists := document.MCPServers[name]
	if !exists {
		return CatalogSnapshot{}, fmt.Errorf("MCP server %q is not configured", name)
	}
	if err := s.deleteMCPSecretsLocked(name, record); err != nil {
		return CatalogSnapshot{}, err
	}
	delete(document.MCPServers, name)
	if err := s.saveLocked(document); err != nil {
		return CatalogSnapshot{}, err
	}
	return s.snapshotLocked(document), nil
}

func (s *Store) ImportSkill(sourceDirectory string) (CatalogSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadLocked()
	if err != nil {
		return CatalogSnapshot{}, err
	}
	name, description, _, err := inspectSkillDirectory(sourceDirectory)
	if err != nil {
		return CatalogSnapshot{}, err
	}
	if _, exists := document.Skills[name]; exists {
		return CatalogSnapshot{}, fmt.Errorf("skill %q is already imported", name)
	}
	if len(document.Skills) >= maxUserSkills {
		return CatalogSnapshot{}, fmt.Errorf("at most %d user skills can be imported", maxUserSkills)
	}
	destination := filepath.Join(s.root, "skills", name)
	if err := copySkillDirectory(sourceDirectory, destination); err != nil {
		_ = os.RemoveAll(destination)
		return CatalogSnapshot{}, err
	}
	document.Skills[name] = userSkillRecord{Enabled: true, Description: description}
	if err := s.saveLocked(document); err != nil {
		_ = os.RemoveAll(destination)
		return CatalogSnapshot{}, err
	}
	return s.snapshotLocked(document), nil
}

func (s *Store) SetSkillEnabled(name string, enabled bool) (CatalogSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadLocked()
	if err != nil {
		return CatalogSnapshot{}, err
	}
	if !validResourceName(name) {
		return CatalogSnapshot{}, fmt.Errorf("skill name is invalid")
	}
	record, exists := document.Skills[name]
	if !exists {
		return CatalogSnapshot{}, fmt.Errorf("skill %q is not imported", name)
	}
	record.Enabled = enabled
	document.Skills[name] = record
	if err := s.saveLocked(document); err != nil {
		return CatalogSnapshot{}, err
	}
	return s.snapshotLocked(document), nil
}

func (s *Store) DeleteSkill(name string) (CatalogSnapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadLocked()
	if err != nil {
		return CatalogSnapshot{}, err
	}
	if !validResourceName(name) {
		return CatalogSnapshot{}, fmt.Errorf("skill name is invalid")
	}
	if _, exists := document.Skills[name]; !exists {
		return CatalogSnapshot{}, fmt.Errorf("skill %q is not imported", name)
	}
	if err := os.RemoveAll(filepath.Join(s.root, "skills", name)); err != nil {
		return CatalogSnapshot{}, fmt.Errorf("remove imported skill: %w", err)
	}
	delete(document.Skills, name)
	if err := s.saveLocked(document); err != nil {
		return CatalogSnapshot{}, err
	}
	return s.snapshotLocked(document), nil
}

func (s *Store) Runtime() Runtime {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadLocked()
	if err != nil {
		return Runtime{}
	}
	runtime := Runtime{
		MCPServers: []RuntimeMCPServer{},
		SkillPaths: []string{},
	}
	for _, name := range sortedKeys(document.MCPServers) {
		record := document.MCPServers[name]
		if !record.Enabled {
			continue
		}
		definition, ok := s.resolveMCPLocked(name, record)
		if !ok {
			continue
		}
		runtime.MCPServers = append(runtime.MCPServers, RuntimeMCPServer{
			Name:       name,
			Definition: definition,
		})
	}
	for _, name := range sortedKeys(document.Skills) {
		record := document.Skills[name]
		if !record.Enabled {
			continue
		}
		path := filepath.Join(s.root, "skills", name)
		if _, err := os.Stat(filepath.Join(path, "SKILL.md")); err != nil {
			continue
		}
		runtime.SkillPaths = append(runtime.SkillPaths, path)
	}
	return runtime
}

func (s *Store) UserMCPSummaries() []MCPServerSnapshot {
	s.mu.Lock()
	defer s.mu.Unlock()
	document, err := s.loadLocked()
	if err != nil {
		return []MCPServerSnapshot{}
	}
	return s.mcpSnapshotsLocked(document, true)
}

func (s *Store) loadLocked() (catalogDocument, error) {
	document := catalogDocument{
		Schema:     catalogSchema,
		MCPServers: map[string]userMCPRecord{},
		Skills:     map[string]userSkillRecord{},
	}
	path := filepath.Join(s.root, catalogFileName)
	info, err := os.Lstat(path)
	if errors.Is(err, os.ErrNotExist) {
		return document, nil
	}
	if err != nil {
		return catalogDocument{}, fmt.Errorf("stat agent resource catalog: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		return catalogDocument{}, fmt.Errorf("agent resource catalog must be a regular file")
	}
	if info.Size() > maxCatalogBytes {
		return catalogDocument{}, fmt.Errorf("agent resource catalog exceeds 1 MiB")
	}
	file, err := os.Open(path)
	if err != nil {
		return catalogDocument{}, fmt.Errorf("open agent resource catalog: %w", err)
	}
	defer file.Close()
	data, err := io.ReadAll(io.LimitReader(file, maxCatalogBytes+1))
	if err != nil {
		return catalogDocument{}, fmt.Errorf("read agent resource catalog: %w", err)
	}
	if len(data) > maxCatalogBytes {
		return catalogDocument{}, fmt.Errorf("agent resource catalog exceeds 1 MiB")
	}
	if err := json.Unmarshal(data, &document); err != nil {
		return catalogDocument{}, fmt.Errorf("parse agent resource catalog: %w", err)
	}
	if document.Schema != "" && document.Schema != catalogSchema {
		return catalogDocument{}, fmt.Errorf("unsupported agent resource catalog schema %q", document.Schema)
	}
	if document.MCPServers == nil {
		document.MCPServers = map[string]userMCPRecord{}
	}
	if document.Skills == nil {
		document.Skills = map[string]userSkillRecord{}
	}
	document.Schema = catalogSchema
	return document, nil
}

func (s *Store) saveLocked(document catalogDocument) error {
	document.Schema = catalogSchema
	if document.MCPServers == nil {
		document.MCPServers = map[string]userMCPRecord{}
	}
	if document.Skills == nil {
		document.Skills = map[string]userSkillRecord{}
	}
	data, err := json.MarshalIndent(document, "", "  ")
	if err != nil {
		return fmt.Errorf("encode agent resource catalog: %w", err)
	}
	path := filepath.Join(s.root, catalogFileName)
	temporary := path + ".tmp"
	if err := os.WriteFile(temporary, data, 0o600); err != nil {
		return fmt.Errorf("write agent resource catalog: %w", err)
	}
	if err := os.Rename(temporary, path); err != nil {
		_ = os.Remove(temporary)
		return fmt.Errorf("replace agent resource catalog: %w", err)
	}
	return nil
}

func (s *Store) snapshotLocked(document catalogDocument) CatalogSnapshot {
	return CatalogSnapshot{
		MCPServers: s.mcpSnapshotsLocked(document, false),
		Skills:     s.skillSnapshotsLocked(document),
	}
}

func (s *Store) mcpSnapshotsLocked(document catalogDocument, enabledOnly bool) []MCPServerSnapshot {
	result := make([]MCPServerSnapshot, 0, len(document.MCPServers))
	for _, name := range sortedKeys(document.MCPServers) {
		record := document.MCPServers[name]
		if enabledOnly && !record.Enabled {
			continue
		}
		fileAccess, networkAccess := accessLabels(record)
		result = append(result, MCPServerSnapshot{
			Name:          name,
			Enabled:       record.Enabled,
			Transport:     record.Transport,
			Command:       record.Command,
			Args:          append([]string(nil), record.Args...),
			URL:           displayURL(record.URL),
			Socket:        record.Socket,
			EnvNames:      append([]string(nil), record.EnvNames...),
			HeaderNames:   append([]string(nil), record.HeaderNames...),
			HasBearer:     record.HasBearer,
			FileAccess:    fileAccess,
			NetworkAccess: networkAccess,
			Scope:         "user",
			ReviewReady:   true,
		})
	}
	return result
}

func (s *Store) skillSnapshotsLocked(document catalogDocument) []SkillSnapshot {
	result := make([]SkillSnapshot, 0, len(document.Skills))
	for _, name := range sortedKeys(document.Skills) {
		record := document.Skills[name]
		description := strings.TrimSpace(record.Description)
		slashOnly := false
		if _, parsed, hidden, err := inspectSkillDirectory(filepath.Join(s.root, "skills", name)); err == nil {
			if description == "" {
				description = parsed
			}
			slashOnly = hidden
		}
		result = append(result, SkillSnapshot{
			Name:        name,
			Label:       name,
			Description: description,
			Enabled:     record.Enabled,
			Origin:      "user",
			SlashOnly:   slashOnly,
		})
	}
	return result
}

type namedMCPRecord struct {
	name  string
	value userMCPRecord
}

func (s *Store) upsertMCPLocked(document catalogDocument, input MCPServerInput) (namedMCPRecord, error) {
	name := strings.TrimSpace(input.Name)
	if !validResourceName(name) {
		return namedMCPRecord{}, fmt.Errorf("MCP server name is invalid")
	}
	if _, reserved := reservedMCPNames[name]; reserved || strings.HasPrefix(name, "milksu-") {
		return namedMCPRecord{}, fmt.Errorf("MCP server name %q is reserved", name)
	}
	existing, exists := document.MCPServers[name]
	if !exists && len(document.MCPServers) >= maxUserMCPServers {
		return namedMCPRecord{}, fmt.Errorf("at most %d user MCP servers can be saved", maxUserMCPServers)
	}
	record := existing
	if input.Enabled != nil {
		record.Enabled = *input.Enabled
	} else if !exists {
		record.Enabled = true
	}
	transport, command, args, remoteURL, socket, err := normalizeMCPTransport(input)
	if err != nil {
		return namedMCPRecord{}, err
	}
	record.Transport = transport
	record.Command = command
	record.Args = args
	record.URL = remoteURL
	record.Socket = socket
	envNames := uniqueNames(record.EnvNames)
	headerNames := uniqueNames(record.HeaderNames)
	for _, key := range input.RemoveEnv {
		if err := s.secrets.DeleteManagedSecret(secretAccount(name, "env", key)); err != nil {
			return namedMCPRecord{}, err
		}
		envNames = removeName(envNames, key)
	}
	for _, key := range input.RemoveHeaders {
		if err := s.secrets.DeleteManagedSecret(secretAccount(name, "header", key)); err != nil {
			return namedMCPRecord{}, err
		}
		headerNames = removeName(headerNames, key)
	}
	for key, value := range input.Env {
		if !validEnvName(key) {
			return namedMCPRecord{}, fmt.Errorf("environment name %q is invalid", key)
		}
		if strings.TrimSpace(value) == "" {
			continue
		}
		if err := s.secrets.PutManagedSecret(secretAccount(name, "env", key), value); err != nil {
			return namedMCPRecord{}, err
		}
		envNames = appendUnique(envNames, key)
	}
	for key, value := range input.Headers {
		if !validHeaderName(key) {
			return namedMCPRecord{}, fmt.Errorf("header name %q is invalid", key)
		}
		if strings.TrimSpace(value) == "" {
			continue
		}
		if err := s.secrets.PutManagedSecret(secretAccount(name, "header", key), value); err != nil {
			return namedMCPRecord{}, err
		}
		headerNames = appendUnique(headerNames, key)
	}
	if input.ClearBearer {
		if err := s.secrets.DeleteManagedSecret(secretAccount(name, "bearer", "_")); err != nil {
			return namedMCPRecord{}, err
		}
		record.HasBearer = false
	}
	if token := strings.TrimSpace(input.BearerToken); token != "" {
		if err := s.secrets.PutManagedSecret(secretAccount(name, "bearer", "_"), token); err != nil {
			return namedMCPRecord{}, err
		}
		record.HasBearer = true
	}
	record.EnvNames = uniqueNames(envNames)
	record.HeaderNames = uniqueNames(headerNames)
	return namedMCPRecord{name: name, value: record}, nil
}

func (s *Store) deleteMCPSecretsLocked(name string, record userMCPRecord) error {
	for _, key := range record.EnvNames {
		if err := s.secrets.DeleteManagedSecret(secretAccount(name, "env", key)); err != nil {
			return err
		}
	}
	for _, key := range record.HeaderNames {
		if err := s.secrets.DeleteManagedSecret(secretAccount(name, "header", key)); err != nil {
			return err
		}
	}
	if record.HasBearer {
		if err := s.secrets.DeleteManagedSecret(secretAccount(name, "bearer", "_")); err != nil {
			return err
		}
	}
	return nil
}

func (s *Store) resolveMCPLocked(name string, record userMCPRecord) (map[string]any, bool) {
	definition := map[string]any{}
	switch record.Transport {
	case "command":
		definition["command"] = record.Command
		if len(record.Args) > 0 {
			definition["args"] = append([]string(nil), record.Args...)
		}
	case "url":
		definition["url"] = record.URL
	case "socket":
		definition["socket"] = record.Socket
	default:
		return nil, false
	}
	if env := s.resolveNamedSecrets(name, "env", record.EnvNames); len(env) > 0 {
		definition["env"] = env
	}
	if headers := s.resolveNamedSecrets(name, "header", record.HeaderNames); len(headers) > 0 {
		definition["headers"] = headers
	}
	if record.HasBearer {
		if token, err := s.secrets.LookupManagedSecret(secretAccount(name, "bearer", "_")); err == nil && token != "" {
			definition["bearerToken"] = token
		}
	}
	return definition, true
}

func (s *Store) resolveNamedSecrets(server, kind string, names []string) map[string]string {
	if len(names) == 0 {
		return nil
	}
	result := map[string]string{}
	for _, name := range names {
		value, err := s.secrets.LookupManagedSecret(secretAccount(server, kind, name))
		if err != nil || value == "" {
			continue
		}
		result[name] = value
	}
	if len(result) == 0 {
		return nil
	}
	return result
}

func normalizeMCPTransport(input MCPServerInput) (transport, command string, args []string, remoteURL, socket string, err error) {
	transport = strings.TrimSpace(input.Transport)
	switch transport {
	case "command":
		command, err = boundedText(input.Command, maxCommandRunes)
		if err != nil {
			return "", "", nil, "", "", fmt.Errorf("MCP command is invalid")
		}
		args, err = normalizeArgs(input.Args)
		if err != nil {
			return "", "", nil, "", "", err
		}
		return transport, command, args, "", "", nil
	case "url":
		remoteURL, err = normalizeRemoteURL(input.URL)
		if err != nil {
			return "", "", nil, "", "", err
		}
		return transport, "", nil, remoteURL, "", nil
	case "socket":
		socket, err = boundedText(input.Socket, 240)
		if err != nil || strings.Contains(socket, "..") {
			return "", "", nil, "", "", fmt.Errorf("MCP socket is invalid")
		}
		return transport, "", nil, "", socket, nil
	default:
		return "", "", nil, "", "", fmt.Errorf("MCP transport must be command, url, or socket")
	}
}

func normalizeArgs(values []string) ([]string, error) {
	if len(values) > maxArgs {
		return nil, fmt.Errorf("MCP command accepts at most %d arguments", maxArgs)
	}
	result := make([]string, 0, len(values))
	for _, raw := range values {
		value := strings.TrimSpace(raw)
		if value == "" {
			continue
		}
		if _, err := boundedText(value, maxArgRunes); err != nil {
			return nil, fmt.Errorf("MCP argument is invalid")
		}
		result = append(result, value)
	}
	return result, nil
}

func normalizeRemoteURL(value string) (string, error) {
	trimmed, err := boundedText(value, 500)
	if err != nil {
		return "", fmt.Errorf("MCP URL is invalid")
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return "", fmt.Errorf("MCP URL must be http or https")
	}
	if parsed.User != nil {
		parsed.User = nil
	}
	return parsed.String(), nil
}

func inspectSkillDirectory(sourceDirectory string) (string, string, bool, error) {
	clean, err := filepath.Abs(filepath.Clean(sourceDirectory))
	if err != nil {
		return "", "", false, fmt.Errorf("resolve skill directory: %w", err)
	}
	info, err := os.Lstat(clean)
	if err != nil {
		return "", "", false, fmt.Errorf("open skill directory: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.IsDir() {
		return "", "", false, fmt.Errorf("skill import must be a regular directory")
	}
	skillPath := filepath.Join(clean, "SKILL.md")
	skillInfo, err := os.Lstat(skillPath)
	if err != nil {
		return "", "", false, fmt.Errorf("skill directory must contain SKILL.md")
	}
	if skillInfo.Mode()&os.ModeSymlink != 0 || !skillInfo.Mode().IsRegular() {
		return "", "", false, fmt.Errorf("SKILL.md must be a regular file")
	}
	data, err := os.ReadFile(skillPath)
	if err != nil {
		return "", "", false, fmt.Errorf("read SKILL.md: %w", err)
	}
	if !utf8.Valid(data) {
		return "", "", false, fmt.Errorf("SKILL.md must be UTF-8")
	}
	name, description, slashOnly := parseSkillFrontmatter(string(data))
	if !validResourceName(name) {
		name = filepath.Base(clean)
	}
	if !validResourceName(name) {
		return "", "", false, fmt.Errorf("skill name is invalid")
	}
	return name, description, slashOnly, nil
}

func copySkillDirectory(sourceDirectory, destination string) error {
	source, err := filepath.Abs(filepath.Clean(sourceDirectory))
	if err != nil {
		return fmt.Errorf("resolve skill directory: %w", err)
	}
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return fmt.Errorf("create imported skill directory: %w", err)
	}
	var files int
	var total int64
	return filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		relative, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		if relative == "." {
			return nil
		}
		if !allowedSkillRelative(relative) {
			if entry.IsDir() {
				return fs.SkipDir
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("skill import cannot include symbolic links")
		}
		target := filepath.Join(destination, relative)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		if !info.Mode().IsRegular() {
			return nil
		}
		if info.Size() > maxSkillFileBytes {
			return fmt.Errorf("skill file %s exceeds 1 MiB", relative)
		}
		files++
		total += info.Size()
		if files > maxSkillFiles || total > maxSkillBytes {
			return fmt.Errorf("imported skill exceeds the file or size limit")
		}
		data, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(target, data, 0o600)
	})
}

func allowedSkillRelative(relative string) bool {
	normalized := filepath.ToSlash(relative)
	if normalized == "SKILL.md" {
		return true
	}
	for _, name := range []string{"scripts", "references", "assets"} {
		if normalized == name || strings.HasPrefix(normalized, name+"/") {
			return !strings.Contains(normalized, "..")
		}
	}
	return false
}

func parseSkillFrontmatter(content string) (string, string, bool) {
	content = strings.ReplaceAll(content, "\r\n", "\n")
	if !strings.HasPrefix(content, "---\n") {
		return "", "", false
	}
	rest := content[4:]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "", "", false
	}
	var name, description string
	slashOnly := false
	for _, line := range strings.Split(rest[:end], "\n") {
		key, value, ok := strings.Cut(line, ":")
		if !ok {
			continue
		}
		key = strings.TrimSpace(key)
		value = strings.Trim(strings.TrimSpace(value), `"'`)
		switch key {
		case "name":
			name = value
		case "description":
			description = value
		case "disable-model-invocation":
			slashOnly = value == "true"
		}
	}
	if len([]rune(description)) > 1024 {
		description = string([]rune(description)[:1024])
	}
	return name, description, slashOnly
}

func validResourceName(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len(value) > 64 {
		return false
	}
	if value[0] == '-' || value[len(value)-1] == '-' {
		return false
	}
	for _, character := range value {
		if (character < 'a' || character > 'z') &&
			(character < '0' || character > '9') && character != '-' {
			return false
		}
	}
	return true
}

func validEnvName(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) > maxEnvNameRunes {
		return false
	}
	for index, character := range value {
		if character >= 'A' && character <= 'Z' || character >= '0' && character <= '9' || character == '_' {
			if index == 0 && character >= '0' && character <= '9' {
				return false
			}
			continue
		}
		return false
	}
	return true
}

func validHeaderName(value string) bool {
	value = strings.TrimSpace(value)
	if value == "" || len([]rune(value)) > maxEnvNameRunes {
		return false
	}
	for index, character := range value {
		if character >= 'A' && character <= 'Z' ||
			character >= 'a' && character <= 'z' ||
			character >= '0' && character <= '9' ||
			character == '-' {
			if index == 0 && (character < 'A' || character > 'Z') && (character < 'a' || character > 'z') {
				return false
			}
			continue
		}
		return false
	}
	return true
}

func boundedText(value string, limit int) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" || !utf8.ValidString(value) || len([]rune(value)) > limit {
		return "", fmt.Errorf("invalid text")
	}
	if strings.IndexFunc(value, unicode.IsControl) >= 0 {
		return "", fmt.Errorf("invalid text")
	}
	return value, nil
}

func accessLabels(record userMCPRecord) (string, string) {
	switch record.Transport {
	case "command":
		return "项目读写 + 私有运行目录", "任意出站网络"
	case "url":
		return "不直接授予本机文件", remoteOriginLabel(record.URL)
	case "socket":
		return "由本地 Socket 服务自身权限决定", "仅连接配置的本地 Socket"
	default:
		return "", ""
	}
}

func remoteOriginLabel(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" {
		return "远程地址无效"
	}
	return "仅连接 " + parsed.Scheme + "://" + parsed.Host
}

func displayURL(value string) string {
	parsed, err := url.Parse(strings.TrimSpace(value))
	if err != nil || parsed.Host == "" {
		return ""
	}
	parsed.User = nil
	return parsed.String()
}

func secretAccount(server, kind, key string) string {
	return secretAccountPrefix + server + "." + kind + "." + strings.TrimSpace(key)
}

func uniqueNames(values []string) []string {
	result := make([]string, 0, len(values))
	seen := map[string]struct{}{}
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
	}
	sort.Strings(result)
	return result
}

func appendUnique(values []string, value string) []string {
	value = strings.TrimSpace(value)
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}

func removeName(values []string, value string) []string {
	value = strings.TrimSpace(value)
	result := values[:0]
	for _, existing := range values {
		if existing != value {
			result = append(result, existing)
		}
	}
	return uniqueNames(result)
}

func sortedKeys[T any](values map[string]T) []string {
	keys := make([]string, 0, len(values))
	for key := range values {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	return keys
}
