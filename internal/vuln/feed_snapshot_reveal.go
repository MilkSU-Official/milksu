package vuln

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
)

// ResolveFeedSnapshotPath validates a frontend-supplied vulnerability feed
// snapshot path against MilkSU's app data directory. The browser UI persists
// snapshot metadata in localStorage, so this function treats snapshotPath as
// untrusted and only accepts an existing regular JSON file below:
//
//	<app data>/vuln/feed-snapshots/<source>/<timestamp>-<digest>.json
//
// Symlinks anywhere below feed-snapshots are rejected before the path is
// revealed in Finder.
func ResolveFeedSnapshotPath(root string, snapshotPath string) (string, error) {
	root = strings.TrimSpace(root)
	snapshotPath = strings.TrimSpace(snapshotPath)
	if root == "" {
		return "", fmt.Errorf("resolve CVE Feed snapshot: data directory is required")
	}
	if snapshotPath == "" {
		return "", fmt.Errorf("resolve CVE Feed snapshot: snapshot path is required")
	}
	if !filepath.IsAbs(root) {
		return "", fmt.Errorf("resolve CVE Feed snapshot: data directory must be absolute")
	}
	if !filepath.IsAbs(snapshotPath) {
		return "", fmt.Errorf("resolve CVE Feed snapshot: snapshot path must be absolute")
	}
	base := filepath.Join(root, "vuln", "feed-snapshots")
	cleanBase := filepath.Clean(base)
	cleanSnapshot := filepath.Clean(snapshotPath)
	if filepath.Ext(cleanSnapshot) != ".json" {
		return "", fmt.Errorf("resolve CVE Feed snapshot: snapshot must be a JSON file")
	}
	if !pathWithin(cleanBase, cleanSnapshot) {
		return "", fmt.Errorf("resolve CVE Feed snapshot: snapshot escaped the feed snapshot directory")
	}
	if err := verifyFeedSnapshotFileChain(cleanBase, cleanSnapshot); err != nil {
		return "", err
	}
	resolvedBase, err := filepath.EvalSymlinks(cleanBase)
	if err != nil {
		return "", fmt.Errorf("resolve CVE Feed snapshot root: %w", err)
	}
	resolvedSnapshot, err := filepath.EvalSymlinks(cleanSnapshot)
	if err != nil {
		return "", fmt.Errorf("resolve CVE Feed snapshot file: %w", err)
	}
	relative, err := filepath.Rel(resolvedBase, resolvedSnapshot)
	if err != nil || filepath.IsAbs(relative) ||
		relative == ".." ||
		strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("resolve CVE Feed snapshot: snapshot escaped the feed snapshot directory")
	}
	info, err := os.Stat(resolvedSnapshot)
	if err != nil {
		return "", fmt.Errorf("inspect CVE Feed snapshot: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", fmt.Errorf("resolve CVE Feed snapshot: snapshot is not a regular file")
	}
	return cleanSnapshot, nil
}

func pathWithin(base string, target string) bool {
	relative, err := filepath.Rel(base, target)
	if err != nil || filepath.IsAbs(relative) {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

func verifyFeedSnapshotFileChain(base string, snapshotPath string) error {
	baseInfo, err := os.Lstat(base)
	if err != nil {
		return fmt.Errorf("inspect CVE Feed snapshot root: %w", err)
	}
	if baseInfo.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("resolve CVE Feed snapshot: snapshot root cannot be a symlink")
	}
	if !baseInfo.IsDir() {
		return fmt.Errorf("resolve CVE Feed snapshot: snapshot root is not a directory")
	}
	relative, err := filepath.Rel(base, snapshotPath)
	if err != nil || filepath.IsAbs(relative) ||
		relative == ".." ||
		strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("resolve CVE Feed snapshot: snapshot escaped the feed snapshot directory")
	}
	current := base
	parts := strings.Split(relative, string(filepath.Separator))
	for index, part := range parts {
		if part == "" || part == "." {
			continue
		}
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if err != nil {
			return fmt.Errorf("inspect CVE Feed snapshot path: %w", err)
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("resolve CVE Feed snapshot: snapshot path cannot contain symlinks")
		}
		if index == len(parts)-1 {
			if !info.Mode().IsRegular() {
				return fmt.Errorf("resolve CVE Feed snapshot: snapshot is not a regular file")
			}
			continue
		}
		if !info.IsDir() {
			return fmt.Errorf("resolve CVE Feed snapshot: snapshot parent is not a directory")
		}
	}
	return nil
}

// RevealFeedSnapshotInFinder reveals a validated CVE Feed snapshot file in
// Finder. Tests can inject an opener; production uses MacOSFinderReveal.
func RevealFeedSnapshotInFinder(snapshotPath string, open func(string) error) error {
	if runtime.GOOS != "darwin" {
		return fmt.Errorf("在 Finder 中显示 CVE Feed 快照当前仅支持 macOS 桌面运行时")
	}
	if err := open(snapshotPath); err != nil {
		return fmt.Errorf("打开 CVE Feed 快照: %w", err)
	}
	return nil
}

// MacOSFinderReveal reveals a file in the macOS Finder.
func MacOSFinderReveal(snapshotPath string) error {
	return exec.Command("/usr/bin/open", "-R", snapshotPath).Run()
}
