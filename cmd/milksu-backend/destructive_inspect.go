package main

import (
	"context"
	"errors"
	"io/fs"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"
)

// DestructiveTargetInspection is the measured half of a destructive approval card.
// The renderer cannot stat the filesystem or run git, so MilkSU measures here and the
// renderer only displays the result. Status distinguishes the failure modes so a
// missing path is never reported as "no backup".
type DestructiveTargetInspection struct {
	Path           string `json:"path"`
	Status         string `json:"status"`
	Exists         bool   `json:"exists"`
	IsDirectory    bool   `json:"isDirectory"`
	EmptyDirectory bool   `json:"emptyDirectory"`
	FileCount      int    `json:"fileCount"`
	TotalBytes     int64  `json:"totalBytes"`
	// DiskBytes is what deleting the target frees (du accounting). -1 means the platform
	// does not expose a block count, and the renderer must fall back to TotalBytes and
	// label it "content size" rather than "will free".
	DiskBytes       int64    `json:"diskBytes"`
	Sampled         bool     `json:"sampled"`
	InGitRepository bool     `json:"inGitRepository"`
	GitTracked      bool     `json:"gitTracked"`
	Rebuildable     bool     `json:"rebuildable"`
	Backups         []string `json:"backups"`
	Error           string   `json:"error,omitempty"`
}

const (
	inspectMaxFiles    = 20000
	inspectMaxDuration = 1500 * time.Millisecond
	inspectMaxDepth    = 32
	inspectMaxBackups  = 8
)

// InspectDestructiveTarget measures one delete target. It is strictly read-only: it
// never creates, renames or removes anything, and it uses lstat semantics so a symlink
// cannot lead the scan out of the target.
func (a *App) InspectDestructiveTarget(path string) (DestructiveTargetInspection, error) {
	target := strings.TrimSpace(path)
	result := DestructiveTargetInspection{Path: target, Backups: []string{}}
	if target == "" || !filepath.IsAbs(target) {
		return result, errors.New("an absolute path is required")
	}
	if strings.ContainsRune(target, 0) {
		return result, errors.New("path contains an invalid null byte")
	}

	info, err := os.Lstat(target)
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			result.Status = "missing"
			return result, nil
		}
		if errors.Is(err, fs.ErrPermission) {
			result.Status = "permission-denied"
			result.Error = "permission denied"
			return result, nil
		}
		result.Status = "error"
		result.Error = err.Error()
		return result, nil
	}

	result.Exists = true
	result.IsDirectory = info.IsDir()
	result.FileCount = 1
	result.TotalBytes = info.Size()
	result.DiskBytes = diskBytesOf(info)
	result.Status = "ok"

	if info.IsDir() {
		deadline := time.Now().Add(inspectMaxDuration)
		base := strings.Count(strings.TrimRight(target, "/"), "/")
		walkErr := filepath.WalkDir(target, func(current string, entry fs.DirEntry, err error) error {
			if err != nil {
				return nil
			}
			if current == target {
				return nil
			}
			depth := strings.Count(strings.TrimRight(current, "/"), "/") - base
			if depth > inspectMaxDepth {
				result.Sampled = true
				return fs.SkipDir
			}
			if time.Now().After(deadline) || result.FileCount >= inspectMaxFiles {
				result.Sampled = true
				return fs.SkipAll
			}
			entryInfo, lerr := entry.Info()
			if lerr != nil {
				return nil
			}
			result.FileCount++
			result.TotalBytes += entryInfo.Size()
			if result.DiskBytes >= 0 {
				if freed := diskBytesOf(entryInfo); freed >= 0 {
					result.DiskBytes += freed
				} else {
					result.DiskBytes = -1
				}
			}
			return nil
		})
		if walkErr != nil && !errors.Is(walkErr, fs.SkipAll) {
			result.Sampled = true
		}
		result.EmptyDirectory = result.FileCount <= 1
	}

	result.InGitRepository, result.GitTracked = inspectGit(context.Background(), target)
	result.Backups = findSiblingBackups(target)
	result.Rebuildable = result.GitTracked || len(result.Backups) > 0
	return result, nil
}

// inspectGit reports whether the target sits in a repository and whether git tracks it.
// Both commands are read-only and use a short timeout so a huge repository cannot hang
// the approval card.
func inspectGit(parent context.Context, target string) (inRepository bool, tracked bool) {
	ctx, cancel := context.WithTimeout(parent, 2*time.Second)
	defer cancel()

	directory := target
	if info, err := os.Lstat(target); err == nil && !info.IsDir() {
		directory = filepath.Dir(target)
	}
	root := exec.CommandContext(ctx, "git", "-C", directory, "rev-parse", "--show-toplevel")
	output, err := root.Output()
	if err != nil || strings.TrimSpace(string(output)) == "" {
		return false, false
	}
	inRepository = true

	check := exec.CommandContext(ctx, "git", "-C", directory, "ls-files", "--error-unmatch", "--", target)
	if err := check.Run(); err == nil {
		tracked = true
	}
	return inRepository, tracked
}

// findSiblingBackups lists read-only hints that the target can be rebuilt: the naming
// conventions the rolling backup and the install script use.
func findSiblingBackups(target string) []string {
	directory := filepath.Dir(target)
	base := filepath.Base(target)
	entries, err := os.ReadDir(directory)
	if err != nil {
		return []string{}
	}
	found := []string{}
	for _, entry := range entries {
		if len(found) >= inspectMaxBackups {
			break
		}
		name := entry.Name()
		if name == base {
			continue
		}
		switch {
		case strings.HasPrefix(name, base+".bak"), strings.HasPrefix(name, "."+base+".bak"):
			found = append(found, filepath.Join(directory, name))
		case base == entry.Name()+"-*", strings.HasPrefix(base, name+"-"):
			found = append(found, filepath.Join(directory, name))
		}
	}
	return found
}
