package main

import (
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"slices"
	"sort"
	"strings"
	"unicode"

	"github.com/MilkSU-Official/milksu/internal/engine"
)

const (
	workspaceAccessDiscover = "discover"
	workspaceAccessGrant    = "grant"
	workspaceAccessRevoke   = "revoke"
)

// handleWorkspaceAccessRequest is a Desktop capability boundary, not a
// natural-language router. Pi owns interpretation and clarification; this
// method only discovers directory names or applies one concrete path selected
// by the model.
func (a *App) handleWorkspaceAccessRequest(event engine.Event) {
	path, paths, restartRequired, err := a.resolveWorkspaceAccessRequest(event)
	responseError := ""
	if err != nil {
		responseError = err.Error()
	}
	if responseErr := a.engines.RespondWorkspaceAccess(
		event.SessionID,
		event.RequestID,
		path,
		paths,
		restartRequired,
		responseError,
	); responseErr != nil {
		a.diagnostics.Record(
			"coding-engine",
			"error",
			"workspace access response failed",
		)
	}
}

func (a *App) resolveWorkspaceAccessRequest(
	event engine.Event,
) (string, []string, bool, error) {
	if strings.HasPrefix(event.SessionID, "ctf_") {
		return "", nil, false, fmt.Errorf(
			"CTF Agent cannot expand its directory scope from Coding chat",
		)
	}
	stored, err := a.conversations.Get(event.SessionID)
	if err != nil {
		return "", nil, false, err
	}
	current, err := normalizeWorkspaceAccessPaths(
		stored.WorkspacePath,
		stored.WorkspaceAccessPaths,
	)
	if err != nil {
		return "", nil, false, err
	}

	switch strings.TrimSpace(event.Action) {
	case workspaceAccessDiscover:
		paths, discoverErr := discoverWorkspaceDirectories(
			event.Query,
			stored.WorkspacePath,
		)
		return "", paths, false, discoverErr
	case workspaceAccessGrant:
		resolved, resolveErr := normalizeAgentWorkspaceSelection(event.Path)
		if resolveErr != nil {
			return "", current, false, resolveErr
		}
		updated, normalizeErr := normalizeWorkspaceAccessPaths(
			stored.WorkspacePath,
			append(current, resolved),
		)
		if normalizeErr != nil {
			return "", current, false, normalizeErr
		}
		changed := !slices.Equal(current, updated)
		if changed {
			stored.WorkspaceAccessPaths = updated
			if saveErr := a.conversations.Save(stored); saveErr != nil {
				return "", current, false, saveErr
			}
		}
		return resolved, updated, changed, nil
	case workspaceAccessRevoke:
		resolved, resolveErr := normalizeAgentWorkspaceSelection(event.Path)
		if resolveErr != nil {
			return "", current, false, resolveErr
		}
		updated := make([]string, 0, len(current))
		found := false
		for _, candidate := range current {
			if filepath.Clean(candidate) == resolved {
				found = true
				continue
			}
			updated = append(updated, candidate)
		}
		if !found {
			return resolved, current, false, nil
		}
		stored.WorkspaceAccessPaths = updated
		if saveErr := a.conversations.Save(stored); saveErr != nil {
			return "", current, false, saveErr
		}
		return resolved, updated, true, nil
	default:
		return "", current, false, fmt.Errorf("unsupported workspace access action")
	}
}

type workspaceDirectoryCandidate struct {
	path  string
	score int
}

func discoverWorkspaceDirectories(query, currentWorkspace string) ([]string, error) {
	terms := workspaceSearchTerms(query)
	if len(terms) == 0 {
		return nil, fmt.Errorf("directory description is empty")
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return nil, fmt.Errorf("locate user directory: %w", err)
	}
	roots := workspaceDiscoveryRoots(home, currentWorkspace)
	seen := make(map[string]struct{})
	candidates := make([]workspaceDirectoryCandidate, 0, 12)
	visited := 0
	for _, root := range roots {
		root = filepath.Clean(root)
		if _, exists := seen[root]; exists {
			continue
		}
		seen[root] = struct{}{}
		rootDepth := strings.Count(root, string(filepath.Separator))
		_ = filepath.WalkDir(root, func(path string, entry os.DirEntry, walkErr error) error {
			if walkErr != nil || visited >= 6000 {
				if entry != nil && entry.IsDir() {
					return filepath.SkipDir
				}
				return nil
			}
			if !entry.IsDir() {
				return nil
			}
			visited++
			depth := strings.Count(filepath.Clean(path), string(filepath.Separator)) - rootDepth
			if depth > 4 {
				return filepath.SkipDir
			}
			if path != root && shouldSkipWorkspaceDiscoveryDirectory(entry.Name()) {
				return filepath.SkipDir
			}
			if score := scoreWorkspaceDirectory(path, terms); score > 0 {
				resolved, resolveErr := normalizeAgentWorkspaceSelection(path)
				if resolveErr == nil {
					candidates = append(candidates, workspaceDirectoryCandidate{
						path:  resolved,
						score: score,
					})
				}
			}
			return nil
		})
	}
	sort.SliceStable(candidates, func(left, right int) bool {
		if candidates[left].score == candidates[right].score {
			return len(candidates[left].path) < len(candidates[right].path)
		}
		return candidates[left].score > candidates[right].score
	})
	result := make([]string, 0, 8)
	resultSeen := make(map[string]struct{})
	for _, candidate := range candidates {
		if _, exists := resultSeen[candidate.path]; exists {
			continue
		}
		resultSeen[candidate.path] = struct{}{}
		result = append(result, candidate.path)
		if len(result) == 8 {
			break
		}
	}
	return result, nil
}

func workspaceDiscoveryRoots(home, currentWorkspace string) []string {
	roots := []string{
		filepath.Join(home, "code"),
		filepath.Join(home, "Code"),
		filepath.Join(home, "Documents"),
		filepath.Join(home, "Desktop"),
		filepath.Join(home, "Downloads"),
		filepath.Join(home, "Projects"),
		filepath.Join(home, "Workspace"),
		filepath.Join(home, "Workspaces"),
	}
	if strings.TrimSpace(currentWorkspace) != "" {
		roots = append([]string{filepath.Dir(currentWorkspace)}, roots...)
	}
	if runtime.GOOS == "darwin" {
		roots = append(roots, "/Volumes")
	}
	existing := roots[:0]
	for _, root := range roots {
		if info, err := os.Stat(root); err == nil && info.IsDir() {
			existing = append(existing, root)
		}
	}
	return existing
}

func workspaceSearchTerms(query string) []string {
	normalized := strings.ToLower(strings.TrimSpace(query))
	for _, word := range []string{
		"我的", "那个", "这个", "项目", "目录", "文件夹", "仓库", "文稿",
		"project", "directory", "folder", "repository", "repo", "workspace", "my", "the",
	} {
		normalized = strings.ReplaceAll(normalized, word, " ")
	}
	fields := strings.FieldsFunc(normalized, func(r rune) bool {
		return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '-' && r != '_'
	})
	result := make([]string, 0, len(fields))
	for _, field := range fields {
		if field = strings.TrimSpace(field); field != "" {
			result = append(result, field)
		}
	}
	return result
}

func scoreWorkspaceDirectory(path string, terms []string) int {
	base := strings.ToLower(filepath.Base(path))
	full := strings.ToLower(path)
	score := 0
	for _, term := range terms {
		switch {
		case base == term:
			score += 100
		case strings.Contains(base, term):
			score += 60
		case strings.Contains(full, term):
			score += 20
		default:
			return 0
		}
	}
	return score
}

func shouldSkipWorkspaceDiscoveryDirectory(name string) bool {
	if strings.HasPrefix(name, ".") {
		return true
	}
	switch strings.ToLower(name) {
	case "library", "node_modules", "vendor", "dist", "build", "target", "cache", "caches":
		return true
	default:
		return false
	}
}
