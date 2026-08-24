package plugin

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

const (
	lockFileName     = "plugins.lock.json"
	maxLockFileBytes = 256 << 10
	devModeEnv       = "MILKSU_PLUGIN_DEV"
)

type Options struct {
	OfficialDirectory    string
	InstalledDirectory   string
	DevelopmentDirectory string
	DataDirectory        string
	DevelopmentMode      bool
	HostVersion          string
	NodeExecutable       string
	TypeScriptWorker     string
}

type packageRecord struct {
	manifest    Manifest
	directory   string
	digest      string
	source      Source
	theme       compiledTheme
	errorText   string
	canRollback bool
}

type Registry struct {
	mu        sync.RWMutex
	packageMu sync.Mutex
	options   Options
	state     persistedState
	items     map[string]*packageRecord
	issues    []Descriptor
	executor  runtimeExecutor
	staged    map[string]*stagedPackage
}

func New(options Options) (*Registry, error) {
	if strings.TrimSpace(options.DataDirectory) == "" {
		return nil, errors.New("plugin data directory is required")
	}
	statePath := filepath.Join(options.DataDirectory, "plugins", pluginStateFile)
	state, err := readState(statePath)
	if err != nil {
		return nil, err
	}
	registry := &Registry{
		options: options,
		state:   state,
		items:   map[string]*packageRecord{},
		staged:  map[string]*stagedPackage{},
	}
	registry.executor = newRuntimeExecutor(options)
	registry.reloadLocked()
	return registry, nil
}

func (r *Registry) Reload() {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.reloadLocked()
}

func (r *Registry) reloadLocked() {
	r.items = map[string]*packageRecord{}
	r.issues = nil
	r.loadOfficialLocked()
	r.loadInstalledLocked()
	if r.options.DevelopmentMode {
		r.loadDevelopmentLocked()
	}
}

func (r *Registry) loadOfficialLocked() {
	root := filepath.Clean(strings.TrimSpace(r.options.OfficialDirectory))
	if root == "." || root == "" {
		r.addIssueLocked("official", SourceOfficial, "official plugin directory is unavailable")
		return
	}
	lock, err := readLockFile(filepath.Join(root, lockFileName))
	if err != nil {
		r.addIssueLocked("official", SourceOfficial, err.Error())
		return
	}
	locked := make(map[string]LockEntry, len(lock.Plugins))
	for _, entry := range lock.Plugins {
		if _, versionErr := parseSemanticVersion(entry.Version); !pluginIDPattern.MatchString(entry.ID) || versionErr != nil || !validDigest(entry.SHA256) {
			r.addIssueLocked(entry.ID, SourceOfficial, "official lock entry is invalid")
			continue
		}
		if _, duplicate := locked[entry.ID]; duplicate {
			r.addIssueLocked(entry.ID, SourceOfficial, "official lock contains duplicate plugin id")
			continue
		}
		locked[entry.ID] = entry
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		r.addIssueLocked("official", SourceOfficial, fmt.Sprintf("read official plugin directory: %v", err))
		return
	}
	seen := map[string]struct{}{}
	for _, entry := range entries {
		if entry.Name() == lockFileName {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil || info.Mode()&os.ModeSymlink != 0 || !entry.IsDir() {
			r.addIssueLocked(entry.Name(), SourceOfficial, "official plugin entry must be a non-symlink directory")
			continue
		}
		directory := filepath.Join(root, entry.Name())
		manifest, manifestErr := readManifest(directory)
		if manifestErr != nil {
			r.addIssueLocked(entry.Name(), SourceOfficial, manifestErr.Error())
			continue
		}
		seen[manifest.ID] = struct{}{}
		if entry.Name() != manifest.ID {
			r.addIssueLocked(manifest.ID, SourceOfficial, "official plugin directory must equal its manifest id")
			continue
		}
		lockEntry, ok := locked[manifest.ID]
		if !ok {
			r.addIssueLocked(manifest.ID, SourceOfficial, "official plugin is not present in the production lock")
			continue
		}
		digest, digestErr := packageDigest(directory)
		if digestErr != nil {
			r.addIssueLocked(manifest.ID, SourceOfficial, digestErr.Error())
			continue
		}
		if lockEntry.Version != manifest.Version || !strings.EqualFold(lockEntry.SHA256, digest) {
			r.addIssueLocked(manifest.ID, SourceOfficial, "official plugin version or SHA-256 does not match the production lock")
			continue
		}
		r.addPackageLocked(directory, manifest, digest, SourceOfficial)
	}
	for id := range locked {
		if _, ok := seen[id]; !ok {
			r.addIssueLocked(id, SourceOfficial, "official lock references a missing plugin package")
		}
	}
}

func (r *Registry) loadDevelopmentLocked() {
	root := filepath.Clean(strings.TrimSpace(r.options.DevelopmentDirectory))
	if root == "." || root == "" {
		return
	}
	entries, err := os.ReadDir(root)
	if errors.Is(err, os.ErrNotExist) {
		return
	}
	if err != nil {
		r.addIssueLocked("development", SourceDevelopment, fmt.Sprintf("read development plugin directory: %v", err))
		return
	}
	for _, entry := range entries {
		if entry.Name() == ".gitkeep" {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil || info.Mode()&os.ModeSymlink != 0 || !entry.IsDir() {
			r.addIssueLocked(entry.Name(), SourceDevelopment, "development plugin entry must be a non-symlink directory")
			continue
		}
		directory := filepath.Join(root, entry.Name())
		manifest, manifestErr := readManifest(directory)
		if manifestErr != nil {
			r.addIssueLocked(entry.Name(), SourceDevelopment, manifestErr.Error())
			continue
		}
		if entry.Name() != manifest.ID {
			r.addIssueLocked(manifest.ID, SourceDevelopment, "development plugin directory must equal its manifest id")
			continue
		}
		if manifest.APIVersion != APIVersion {
			r.addIssueLocked(manifest.ID, SourceDevelopment, "development plugins must use milksu.plugin/v1")
			continue
		}
		if err := validateThirdPartyTools(manifest); err != nil {
			r.addIssueLocked(manifest.ID, SourceDevelopment, err.Error())
			continue
		}
		if existing := r.items[manifest.ID]; existing != nil && existing.source == SourceOfficial {
			r.addIssueLocked(manifest.ID, SourceDevelopment, "development plugin cannot shadow an official plugin")
			continue
		}
		digest, digestErr := packageDigest(directory)
		if digestErr != nil {
			r.addIssueLocked(manifest.ID, SourceDevelopment, digestErr.Error())
			continue
		}
		r.addPackageLocked(directory, manifest, digest, SourceDevelopment)
	}
}

func (r *Registry) addPackageLocked(directory string, manifest Manifest, digest string, source Source) {
	record := &packageRecord{manifest: manifest, directory: directory, digest: digest, source: source}
	if err := r.validateHostCompatibility(manifest); err != nil {
		record.errorText = err.Error()
	}
	if manifest.Theme != nil {
		themePath, _ := securePackageFile(directory, manifest.Theme.Source, maxEntryBytes)
		theme, err := readThemeTokens(themePath)
		if err != nil {
			record.errorText = err.Error()
		} else {
			record.theme = theme
		}
	}
	r.items[manifest.ID] = record
}

func (r *Registry) addIssueLocked(id string, source Source, message string) {
	id = strings.TrimSpace(id)
	if id == "" {
		id = "unknown"
	}
	r.issues = append(r.issues, Descriptor{
		ID: id, Name: id, Source: source, Status: StatusError, Error: message,
	})
}

func (r *Registry) List() []Descriptor {
	r.mu.Lock()
	defer r.mu.Unlock()
	stateErr := r.refreshStateLocked()
	if stateErr != nil {
		// Listing is also a capability decision in the MCP adapter. Never keep
		// reporting a cached enabled bit when the durable state is unreadable.
		r.state = defaultState()
	}
	result := make([]Descriptor, 0, len(r.items)+len(r.issues)+1)
	for _, record := range r.items {
		result = append(result, r.descriptorLocked(record))
	}
	result = append(result, r.issues...)
	if stateErr != nil {
		result = append(result, Descriptor{
			ID: "state", Name: "plugin state", Source: SourceOfficial,
			Status: StatusError, Error: fmt.Sprintf("refresh plugin state: %v", stateErr),
		})
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Source != result[j].Source {
			return result[i].Source < result[j].Source
		}
		return result[i].ID < result[j].ID
	})
	return result
}

func (r *Registry) descriptorLocked(record *packageRecord) Descriptor {
	enabled := r.state.Enabled[record.manifest.ID]
	status := StatusDisabled
	if enabled {
		status = StatusReady
	}
	if record.errorText != "" {
		status = StatusError
		enabled = false
	}
	return Descriptor{
		ID: record.manifest.ID, Name: record.manifest.Name, Version: record.manifest.Version,
		APIVersion: record.manifest.APIVersion, Runtime: record.manifest.Runtime.Kind,
		Source: record.source, Publisher: record.manifest.Publisher, Digest: record.digest, Permissions: append([]Permission(nil), record.manifest.Permissions...),
		Contributions: record.manifest.Contributes, Enabled: enabled, Status: status,
		Error: record.errorText, HasSettings: record.manifest.UI != nil && record.manifest.UI.SettingsEntry != "",
		CanRollback:     record.canRollback,
		ExternalEnabled: r.state.External[record.manifest.ID],
		ThemeTokens:     record.theme.Default, LightTokens: record.theme.Light, DarkTokens: record.theme.Dark,
	}
}

func (r *Registry) validateHostCompatibility(manifest Manifest) error {
	if manifest.APIVersion == LegacyAPIVersion {
		return nil
	}
	hostVersion := strings.TrimSpace(r.options.HostVersion)
	if hostVersion == "" {
		hostVersion = "0.0.0"
	}
	comparison, err := compareSemanticVersions(hostVersion, manifest.Host.MinVersion)
	if err != nil {
		return fmt.Errorf("compare host version: %w", err)
	}
	if comparison < 0 {
		return fmt.Errorf("plugin requires MilkSU %s or newer (current %s)", manifest.Host.MinVersion, hostVersion)
	}
	available := make(map[string]struct{}, len(HostCapabilities))
	for _, capability := range HostCapabilities {
		available[capability] = struct{}{}
	}
	for _, capability := range manifest.Host.RequiredCapabilities {
		if _, ok := available[capability]; !ok {
			return fmt.Errorf("plugin requires unavailable host capability %q", capability)
		}
	}
	return nil
}

func (r *Registry) SetEnabled(id string, enabled bool) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.refreshStateLocked(); err != nil {
		return fmt.Errorf("refresh plugin state: %w", err)
	}
	record := r.items[strings.TrimSpace(id)]
	if record == nil {
		return fmt.Errorf("plugin %q is not installed", id)
	}
	if record.errorText != "" {
		return fmt.Errorf("plugin %q is unavailable: %s", id, record.errorText)
	}
	next, err := clonePersistedState(r.state)
	if err != nil {
		return err
	}
	if enabled && contributesSlot(record.manifest, "app.background") {
		for candidateID, candidate := range r.items {
			if candidateID != record.manifest.ID && contributesSlot(candidate.manifest, "app.background") {
				next.Enabled[candidateID] = false
			}
		}
	}
	next.Enabled[record.manifest.ID] = enabled
	if !enabled {
		next.External[record.manifest.ID] = false
	}
	return r.commitStateLocked(next)
}

func (r *Registry) enabledRecord(id string) (*packageRecord, error) {
	r.mu.Lock()
	if err := r.refreshStateLocked(); err != nil {
		r.mu.Unlock()
		return nil, fmt.Errorf("refresh plugin state: %w", err)
	}
	record := r.items[strings.TrimSpace(id)]
	if record == nil {
		r.mu.Unlock()
		return nil, fmt.Errorf("plugin %q is not installed", id)
	}
	if record.errorText != "" {
		r.mu.Unlock()
		return nil, fmt.Errorf("plugin %q is unavailable", id)
	}
	if !r.state.Enabled[record.manifest.ID] {
		r.mu.Unlock()
		return nil, fmt.Errorf("plugin %q is disabled", id)
	}
	copyRecord := *record
	r.mu.Unlock()
	if copyRecord.source == SourceOfficial {
		digest, err := packageDigest(copyRecord.directory)
		if err != nil || !strings.EqualFold(digest, copyRecord.digest) {
			return nil, fmt.Errorf("official plugin %q changed after verification", id)
		}
	} else if copyRecord.source == SourceInstalled {
		trust, err := readTrustStore(r.trustStorePath())
		if err != nil {
			return nil, fmt.Errorf("verify installed plugin publisher: %w", err)
		}
		manifest, digest, _, err := verifyInstalledDirectory(copyRecord.directory, trust)
		if err != nil || manifest.ID != copyRecord.manifest.ID || manifest.Version != copyRecord.manifest.Version || !strings.EqualFold(digest, copyRecord.digest) {
			return nil, fmt.Errorf("installed plugin %q failed signature or integrity verification", id)
		}
	}
	return &copyRecord, nil
}

func (r *Registry) statePath() string {
	return filepath.Join(r.options.DataDirectory, "plugins", pluginStateFile)
}

func (r *Registry) refreshStateLocked() error {
	state, err := readState(r.statePath())
	if err != nil {
		return err
	}
	r.state = state
	return nil
}

func (r *Registry) SettingsScript(id string) (string, error) {
	record, err := r.enabledRecord(id)
	if err != nil {
		return "", err
	}
	if record.manifest.UI == nil || record.manifest.UI.SettingsEntry == "" {
		return "", errors.New("plugin does not contribute a settings panel")
	}
	path, err := securePackageFile(record.directory, record.manifest.UI.SettingsEntry, maxEntryBytes)
	if err != nil {
		return "", err
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	return string(payload), nil
}

func (r *Registry) EnabledTools(externalOnly bool) []ToolCallDescriptor {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.refreshStateLocked(); err != nil {
		return nil
	}
	var result []ToolCallDescriptor
	for _, record := range r.items {
		if record.errorText != "" || !r.state.Enabled[record.manifest.ID] {
			continue
		}
		if externalOnly && (!r.state.External[record.manifest.ID] || !hasPermission(record.manifest, PermissionMCPExternalRead)) {
			continue
		}
		for _, tool := range record.manifest.Contributes.Tools {
			if externalOnly && (tool.External != ExternalRead || tool.Effect != ToolEffectRead) {
				continue
			}
			result = append(result, ToolCallDescriptor{
				PluginID: record.manifest.ID, PluginVersion: record.manifest.Version,
				PluginDigest: record.digest, Tool: tool,
			})
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].PluginID != result[j].PluginID {
			return result[i].PluginID < result[j].PluginID
		}
		return result[i].Tool.Name < result[j].Tool.Name
	})
	return result
}

type ToolCallDescriptor struct {
	PluginID      string           `json:"plugin_id"`
	PluginVersion string           `json:"plugin_version"`
	PluginDigest  string           `json:"plugin_digest"`
	Tool          ToolContribution `json:"tool"`
}

// ExternalToolCatalog is the stable schema surface for MCP clients. The MCP
// adapter reconciles this catalog and notifies clients that negotiated dynamic
// tool-list changes. CallTool still refreshes durable state and rejects
// disabled, untrusted or tampered plugins on every invocation.
func (r *Registry) ExternalToolCatalog() []ToolCallDescriptor {
	r.mu.Lock()
	defer r.mu.Unlock()
	if err := r.refreshStateLocked(); err != nil {
		return nil
	}
	var result []ToolCallDescriptor
	for _, record := range r.items {
		if record.errorText != "" || !r.state.Enabled[record.manifest.ID] || !r.state.External[record.manifest.ID] || !hasPermission(record.manifest, PermissionMCPExternalRead) {
			continue
		}
		for _, tool := range record.manifest.Contributes.Tools {
			if tool.Effect == ToolEffectRead && tool.External == ExternalRead {
				result = append(result, ToolCallDescriptor{
					PluginID: record.manifest.ID, PluginVersion: record.manifest.Version,
					PluginDigest: record.digest, Tool: tool,
				})
			}
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].PluginID != result[j].PluginID {
			return result[i].PluginID < result[j].PluginID
		}
		return result[i].Tool.Name < result[j].Tool.Name
	})
	return result
}

func readLockFile(path string) (LockFile, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return LockFile{}, fmt.Errorf("read production plugin lock: %w", err)
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() || info.Size() > maxLockFileBytes {
		return LockFile{}, errors.New("production plugin lock must be a bounded regular, non-symlink file")
	}
	file, err := os.Open(path)
	if err != nil {
		return LockFile{}, err
	}
	defer file.Close()
	var lock LockFile
	decoder := json.NewDecoder(io.LimitReader(file, maxLockFileBytes+1))
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(&lock); err != nil {
		return LockFile{}, fmt.Errorf("decode production plugin lock: %w", err)
	}
	if err := decoder.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return LockFile{}, errors.New("production plugin lock contains trailing JSON data")
	}
	if lock.APIVersion != LockAPIVersion {
		return LockFile{}, fmt.Errorf("unsupported production plugin lock apiVersion %q", lock.APIVersion)
	}
	return lock, nil
}

func DevelopmentModeFromEnvironment() bool {
	return strings.TrimSpace(os.Getenv(devModeEnv)) == "1"
}
