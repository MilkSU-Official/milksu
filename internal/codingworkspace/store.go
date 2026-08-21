package codingworkspace

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

const (
	memoryFileName = "coding-project-memory.json"
	maxRecents     = 12
)

var generatedScratchWorkspace = regexp.MustCompile(
	`(?i)/(?:MilkSU/Coding/(?:新编码任务|临时任务)-[a-f0-9]{8}|agent-workspaces/Coding/无项目任务-[a-f0-9]{8})$`,
)

type RecentProject struct {
	Path   string `json:"path"`
	Name   string `json:"name"`
	UsedAt int64  `json:"usedAt"`
}

type storedMemory struct {
	LastWorkspacePath string          `json:"lastWorkspacePath,omitempty"`
	Recents           []RecentProject `json:"recents,omitempty"`
}

type Snapshot struct {
	LastWorkspacePath  string          `json:"lastWorkspacePath,omitempty"`
	EffectiveWorkspace string          `json:"effectiveWorkspace"`
	HomeDirectory      string          `json:"homeDirectory"`
	Recents            []RecentProject `json:"recents"`
}

type Store struct {
	mu   sync.Mutex
	path string
}

func NewStore() (*Store, error) {
	base, err := appdata.Directory()
	if err != nil {
		return nil, err
	}
	if err := os.MkdirAll(base, 0o700); err != nil {
		return nil, fmt.Errorf("create coding project memory directory: %w", err)
	}
	return &Store{path: filepath.Join(base, memoryFileName)}, nil
}

func (s *Store) Get() (Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.snapshotLocked()
}

func (s *Store) Remember(path string) (Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	resolved, err := resolveProjectDirectory(path)
	if err != nil {
		return Snapshot{}, err
	}
	if isGeneratedScratchWorkspace(resolved) {
		return s.snapshotLocked()
	}
	memory, err := s.readLocked()
	if err != nil {
		return Snapshot{}, err
	}
	now := time.Now().UnixMilli()
	memory.LastWorkspacePath = resolved
	memory.Recents = rememberRecent(memory.Recents, RecentProject{
		Path:   resolved,
		Name:   filepath.Base(resolved),
		UsedAt: now,
	})
	if err := s.writeLocked(memory); err != nil {
		return Snapshot{}, err
	}
	return s.snapshotFromLocked(memory)
}

func (s *Store) Forget(path string) (Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	normalized := normalizeStoredPath(path)
	memory, err := s.readLocked()
	if err != nil {
		return Snapshot{}, err
	}
	next := memory.Recents[:0]
	for _, recent := range memory.Recents {
		if normalizeStoredPath(recent.Path) == normalized {
			continue
		}
		next = append(next, recent)
	}
	memory.Recents = next
	if normalizeStoredPath(memory.LastWorkspacePath) == normalized {
		memory.LastWorkspacePath = ""
		if len(memory.Recents) > 0 {
			memory.LastWorkspacePath = memory.Recents[0].Path
		}
	}
	if err := s.writeLocked(memory); err != nil {
		return Snapshot{}, err
	}
	return s.snapshotFromLocked(memory)
}

func (s *Store) snapshotLocked() (Snapshot, error) {
	memory, err := s.readLocked()
	if err != nil {
		return Snapshot{}, err
	}
	return s.snapshotFromLocked(memory)
}

func (s *Store) snapshotFromLocked(memory storedMemory) (Snapshot, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return Snapshot{}, fmt.Errorf("locate user directory: %w", err)
	}
	home = filepath.Clean(home)
	effective := home
	if resolved, resolveErr := resolveProjectDirectory(memory.LastWorkspacePath); resolveErr == nil &&
		!isGeneratedScratchWorkspace(resolved) {
		effective = resolved
	}
	recents := make([]RecentProject, 0, len(memory.Recents))
	for _, recent := range memory.Recents {
		if _, err := os.Stat(recent.Path); err != nil {
			continue
		}
		recents = append(recents, recent)
	}
	return Snapshot{
		LastWorkspacePath:  strings.TrimSpace(memory.LastWorkspacePath),
		EffectiveWorkspace: effective,
		HomeDirectory:      home,
		Recents:            recents,
	}, nil
}

func (s *Store) readLocked() (storedMemory, error) {
	data, err := os.ReadFile(s.path)
	if err != nil {
		if os.IsNotExist(err) {
			return storedMemory{}, nil
		}
		return storedMemory{}, fmt.Errorf("read coding project memory: %w", err)
	}
	var memory storedMemory
	if err := json.Unmarshal(data, &memory); err != nil {
		return storedMemory{}, nil
	}
	return memory, nil
}

func (s *Store) writeLocked(memory storedMemory) error {
	data, err := json.MarshalIndent(memory, "", "  ")
	if err != nil {
		return fmt.Errorf("encode coding project memory: %w", err)
	}
	if err := os.WriteFile(s.path, data, 0o600); err != nil {
		return fmt.Errorf("write coding project memory: %w", err)
	}
	if err := os.Chmod(s.path, 0o600); err != nil {
		return fmt.Errorf("tighten coding project memory permissions: %w", err)
	}
	return nil
}

func rememberRecent(recents []RecentProject, next RecentProject) []RecentProject {
	out := make([]RecentProject, 0, len(recents)+1)
	out = append(out, next)
	for _, recent := range recents {
		if normalizeStoredPath(recent.Path) == normalizeStoredPath(next.Path) {
			continue
		}
		out = append(out, recent)
		if len(out) >= maxRecents {
			break
		}
	}
	return out
}

func resolveProjectDirectory(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return "", fmt.Errorf("project directory is required")
	}
	if value == "~" || strings.HasPrefix(value, "~/") {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("locate user directory: %w", err)
		}
		value = filepath.Join(home, strings.TrimPrefix(value, "~/"))
	}
	absolute, err := filepath.Abs(value)
	if err != nil {
		return "", fmt.Errorf("resolve project directory: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", fmt.Errorf("resolve project directory: %w", err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("open project directory: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("project path must be a directory")
	}
	return filepath.Clean(resolved), nil
}

func normalizeStoredPath(value string) string {
	return strings.TrimRight(filepath.Clean(strings.TrimSpace(value)), `/\`)
}

func isGeneratedScratchWorkspace(path string) bool {
	normalized := filepath.ToSlash(path)
	return generatedScratchWorkspace.MatchString(normalized)
}
