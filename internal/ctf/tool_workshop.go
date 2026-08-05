package ctf

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
)

const ToolWorkshopSchemaVersion = "ctf-tool-workshop.milksu.dev/v1alpha1"

const (
	ToolRequestStatusPending = "pending"
	ToolRequestStatusReady   = "ready"
	ToolRequestStatusBlocked = "blocked"
	ToolRequestStatusUnknown = "unknown"
)

var (
	toolRequestStatusPattern = regexp.MustCompile(
		`(?im)^\s*(?:[-*]\s*)?(?:status|状态)\s*[:：]\s*` +
			"`?" + `(pending|ready|blocked|待实现|已交付|阻塞)` + "`?" + `\s*$`,
	)
	toolRequestHeadingPattern = regexp.MustCompile(`(?m)^\s*#\s+(.+?)\s*$`)
)

type ToolRequestSummary struct {
	Name         string    `json:"name"`
	RelativePath string    `json:"relativePath"`
	Status       string    `json:"status"`
	Title        string    `json:"title"`
	UpdatedAt    time.Time `json:"updatedAt"`
}

type ToolWorkshopState struct {
	SchemaVersion string               `json:"schemaVersion"`
	Requests      []ToolRequestSummary `json:"requests"`
	PendingCount  int                  `json:"pendingCount"`
	ReadyCount    int                  `json:"readyCount"`
	BlockedCount  int                  `json:"blockedCount"`
	UnknownCount  int                  `json:"unknownCount"`
	ToolCount     int                  `json:"toolCount"`
	LatestRequest *ToolRequestSummary  `json:"latestRequest,omitempty"`
}

// ReadToolWorkshopState projects the filesystem handoff into a small UI-safe
// status model. It never executes a tool or follows links.
func ReadToolWorkshopState(workspacePath string) (ToolWorkshopState, error) {
	if strings.TrimSpace(workspacePath) == "" {
		return ToolWorkshopState{}, fmt.Errorf("CTF tool workspace path is required")
	}
	state := ToolWorkshopState{
		SchemaVersion: ToolWorkshopSchemaVersion,
		Requests:      []ToolRequestSummary{},
	}
	requestDirectory := filepath.Join(workspacePath, "work", "tool-requests")
	entries, err := os.ReadDir(requestDirectory)
	if err != nil {
		if os.IsNotExist(err) {
			return state, nil
		}
		return ToolWorkshopState{}, fmt.Errorf("read CTF tool requests: %w", err)
	}
	for _, entry := range entries {
		if len(state.Requests) >= 64 {
			break
		}
		info, infoErr := entry.Info()
		if infoErr != nil || !info.Mode().IsRegular() || info.Size() > 256*1024 {
			continue
		}
		name := entry.Name()
		if strings.EqualFold(name, "README.md") || !strings.EqualFold(filepath.Ext(name), ".md") {
			continue
		}
		data, readErr := os.ReadFile(filepath.Join(requestDirectory, name))
		if readErr != nil {
			continue
		}
		request := ToolRequestSummary{
			Name:         name,
			RelativePath: filepath.ToSlash(filepath.Join("work", "tool-requests", name)),
			Status:       toolRequestStatus(string(data)),
			Title:        toolRequestTitle(name, string(data)),
			UpdatedAt:    info.ModTime().UTC(),
		}
		state.Requests = append(state.Requests, request)
		switch request.Status {
		case ToolRequestStatusPending:
			state.PendingCount++
		case ToolRequestStatusReady:
			state.ReadyCount++
		case ToolRequestStatusBlocked:
			state.BlockedCount++
		default:
			state.UnknownCount++
		}
	}
	sort.Slice(state.Requests, func(left, right int) bool {
		if state.Requests[left].UpdatedAt.Equal(state.Requests[right].UpdatedAt) {
			return state.Requests[left].Name < state.Requests[right].Name
		}
		return state.Requests[left].UpdatedAt.After(state.Requests[right].UpdatedAt)
	})
	if len(state.Requests) > 0 {
		latest := state.Requests[0]
		state.LatestRequest = &latest
	}
	state.ToolCount = countWorkshopTools(filepath.Join(workspacePath, "work", "tools"), 64)
	return state, nil
}

func toolRequestStatus(content string) string {
	match := toolRequestStatusPattern.FindStringSubmatch(content)
	if len(match) < 2 {
		return ToolRequestStatusUnknown
	}
	switch strings.ToLower(strings.TrimSpace(match[1])) {
	case ToolRequestStatusPending, "待实现":
		return ToolRequestStatusPending
	case ToolRequestStatusReady, "已交付":
		return ToolRequestStatusReady
	case ToolRequestStatusBlocked, "阻塞":
		return ToolRequestStatusBlocked
	default:
		return ToolRequestStatusUnknown
	}
}

func toolRequestTitle(name, content string) string {
	if match := toolRequestHeadingPattern.FindStringSubmatch(content); len(match) >= 2 {
		if title := truncateRunes(strings.TrimSpace(match[1]), 120); title != "" {
			return title
		}
	}
	return strings.TrimSuffix(name, filepath.Ext(name))
}

func countWorkshopTools(directory string, limit int) int {
	count := 0
	_ = filepath.WalkDir(directory, func(path string, entry os.DirEntry, err error) error {
		if err != nil || entry == nil {
			return nil
		}
		if path == directory {
			return nil
		}
		if entry.Type()&os.ModeSymlink != 0 {
			if entry.IsDir() {
				return filepath.SkipDir
			}
			return nil
		}
		if entry.IsDir() {
			if entry.Name() == ".git" || entry.Name() == "node_modules" {
				return filepath.SkipDir
			}
			return nil
		}
		if count >= limit {
			return filepath.SkipAll
		}
		info, infoErr := entry.Info()
		if infoErr == nil &&
			info.Mode().IsRegular() &&
			!strings.EqualFold(entry.Name(), "README.md") {
			count++
		}
		return nil
	})
	return count
}
