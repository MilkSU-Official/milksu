package codingenv

import (
	"path/filepath"
	"strings"
)

var previewableArtifactExtensions = map[string]struct{}{
	".gif":      {},
	".htm":      {},
	".html":     {},
	".jpeg":     {},
	".jpg":      {},
	".markdown": {},
	".md":       {},
	".png":      {},
	".webp":     {},
}

func SuggestedArtifactPaths(snapshot Snapshot) []string {
	seen := make(map[string]struct{})
	var paths []string
	for _, change := range snapshot.Git.Changes {
		path := filepath.ToSlash(strings.TrimSpace(change.Path))
		if path == "" {
			continue
		}
		if _, exists := seen[path]; exists {
			continue
		}
		if _, ok := previewableArtifactExtensions[strings.ToLower(filepath.Ext(path))]; !ok {
			continue
		}
		seen[path] = struct{}{}
		paths = append(paths, path)
		if len(paths) >= 12 {
			break
		}
	}
	return paths
}
