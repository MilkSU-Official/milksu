package codingenv

import (
	"path/filepath"
	"strings"
)

// Preview itself accepts any UTF-8 file. This narrower set only decides which
// changed paths are offered as candidate chips, so it stays on the formats an
// agent writes as a deliverable rather than every touched source file.
var suggestedArtifactExtensions = map[string]struct{}{
	".csv":      {},
	".diff":     {},
	".gif":      {},
	".htm":      {},
	".html":     {},
	".jpeg":     {},
	".jpg":      {},
	".json":     {},
	".log":      {},
	".markdown": {},
	".md":       {},
	".patch":    {},
	".png":      {},
	".txt":      {},
	".webp":     {},
	".xml":      {},
	".yaml":     {},
	".yml":      {},
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
		if _, ok := suggestedArtifactExtensions[strings.ToLower(filepath.Ext(path))]; !ok {
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
