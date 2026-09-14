package vuln

import (
	"fmt"
	"os"
	"path/filepath"
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

// RevealFeedSnapshot shows a validated CVE Feed snapshot in the platform file
// manager with the snapshot selected. The caller supplies the opener, which in
// production is the desktop runtime's own cross-platform one; tests inject a
// recorder.
func RevealFeedSnapshot(snapshotPath string, reveal func(string) error) error {
	if err := reveal(snapshotPath); err != nil {
		return fmt.Errorf("打开 CVE Feed 快照: %w", err)
	}
	return nil
}
