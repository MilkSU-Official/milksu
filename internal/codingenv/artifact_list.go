package codingenv

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Preview itself accepts any UTF-8 file. This narrower set only decides which
// paths are offered as candidate chips, so it stays on the formats an agent
// writes as a deliverable rather than every touched source file.
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

const (
	maxSuggestedArtifacts = 12
	// A scan runs on every environment snapshot, so it is bounded by the number
	// of directory entries it may look at rather than by the size of the tree.
	maxArtifactScanEntries = 6000
	maxArtifactScanDepth   = 6
	// A scanned file is offered only if it was written recently. A Git change is
	// evidence that this task touched the file; a file sitting in an output
	// directory is not, and last month's build output is not a deliverable of
	// the conversation the user is looking at.
	artifactRecencyWindow = 24 * time.Hour
)

// DiscoverArtifacts lists the paths a task's deliverables are most likely to be
// at, relative to the workspace and slash-separated.
//
// Git status answers this for tracked and untracked files, and those come first
// because a reported change is direct evidence that the task wrote the file. It
// cannot answer it for the two places agents also write: an ignored output
// directory such as out/ or dist/, which status collapses into a single entry
// without naming the files inside, and a workspace that is not a repository and
// therefore has no status at all.
//
// Both are filled in by a bounded scan over scanRoots, newest file first. The
// scan descends into the most recently modified directory first, so a directory
// the task just wrote to is reached before a dependency tree that has not
// changed in weeks, and it stops after a fixed number of entries so a large tree
// cannot make a snapshot expensive.
func DiscoverArtifacts(workspace string, changes []GitChange, scanRoots []string) []string {
	seen := make(map[string]struct{})
	paths := make([]string, 0, maxSuggestedArtifacts)
	for _, change := range changes {
		path := filepath.ToSlash(strings.TrimSpace(change.Path))
		if path == "" || !isSuggestedArtifactPath(path) {
			continue
		}
		if _, exists := seen[path]; exists {
			continue
		}
		seen[path] = struct{}{}
		paths = append(paths, path)
		if len(paths) >= maxSuggestedArtifacts {
			return paths
		}
	}

	scan := &artifactScan{
		workspace: workspace,
		budget:    maxArtifactScanEntries,
		seen:      seen,
		notBefore: time.Now().Add(-artifactRecencyWindow),
	}
	directories, files := scan.classifyRoots(scanRoots)
	for _, file := range files {
		scan.consider(file)
	}
	for _, directory := range directories {
		scan.walk(directory, 0)
	}
	for _, found := range scan.newestFirst() {
		paths = append(paths, found)
		if len(paths) >= maxSuggestedArtifacts {
			break
		}
	}
	return paths
}

type artifactCandidate struct {
	path     string
	modified int64
}

type artifactScan struct {
	workspace  string
	budget     int
	seen       map[string]struct{}
	notBefore  time.Time
	candidates []artifactCandidate
}

// classifyRoots splits the scan roots into directories to walk and files to take
// directly, and orders the directories so the budget is spent on the ones a task
// most likely just wrote to. Git lists ignored paths alphabetically, which would
// otherwise spend the whole budget inside a dependency tree before ever reaching
// an output directory.
func (s *artifactScan) classifyRoots(roots []string) ([]string, []string) {
	type scanRoot struct {
		path     string
		modified int64
	}
	var ordered []scanRoot
	var files []string
	for _, root := range roots {
		path := filepath.Join(s.workspace, filepath.FromSlash(root))
		info, err := os.Stat(path)
		if err != nil {
			continue
		}
		if info.IsDir() {
			ordered = append(ordered, scanRoot{path: path, modified: info.ModTime().Unix()})
			continue
		}
		if info.Mode().IsRegular() {
			files = append(files, path)
		}
	}
	sort.SliceStable(ordered, func(first, second int) bool {
		return ordered[first].modified > ordered[second].modified
	})
	directories := make([]string, 0, len(ordered))
	for _, root := range ordered {
		directories = append(directories, root.path)
	}
	return directories, files
}

// consider records one path as a candidate when it looks like a deliverable.
func (s *artifactScan) consider(path string) {
	info, err := os.Lstat(path)
	if err != nil || !info.Mode().IsRegular() {
		return
	}
	relative, relErr := filepath.Rel(s.workspace, path)
	if relErr != nil {
		return
	}
	s.record(filepath.ToSlash(relative), info.ModTime())
}

func (s *artifactScan) record(path string, modified time.Time) {
	if modified.Before(s.notBefore) {
		return
	}
	if !isSuggestedArtifactPath(path) || isMilkSUInternalPath(path) {
		return
	}
	if _, exists := s.seen[path]; exists {
		return
	}
	s.seen[path] = struct{}{}
	s.candidates = append(s.candidates, artifactCandidate{
		path:     path,
		modified: modified.Unix(),
	})
}

func (s *artifactScan) walk(directory string, depth int) {
	if s.budget <= 0 || depth > maxArtifactScanDepth {
		return
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return
	}
	type child struct {
		name     string
		modified int64
	}
	var directories []child
	for _, entry := range entries {
		if s.budget <= 0 {
			return
		}
		s.budget--
		name := entry.Name()
		if name == ".git" || name == ".milksu" {
			continue
		}
		info, infoErr := entry.Info()
		if infoErr != nil {
			continue
		}
		if entry.IsDir() {
			directories = append(directories, child{name: name, modified: info.ModTime().Unix()})
			continue
		}
		if !info.Mode().IsRegular() {
			continue
		}
		relative, relErr := filepath.Rel(s.workspace, filepath.Join(directory, name))
		if relErr != nil {
			continue
		}
		s.record(filepath.ToSlash(relative), info.ModTime())
	}
	// Descend into the most recently modified directory first. Recency is the
	// only signal available here that separates a directory a task just wrote
	// into from a dependency tree, and it does not need a hardcoded name list.
	sort.SliceStable(directories, func(first, second int) bool {
		return directories[first].modified > directories[second].modified
	})
	for _, entry := range directories {
		s.walk(filepath.Join(directory, entry.name), depth+1)
	}
}

func (s *artifactScan) newestFirst() []string {
	sort.SliceStable(s.candidates, func(first, second int) bool {
		if s.candidates[first].modified != s.candidates[second].modified {
			return s.candidates[first].modified > s.candidates[second].modified
		}
		return s.candidates[first].path < s.candidates[second].path
	})
	paths := make([]string, 0, len(s.candidates))
	for _, candidate := range s.candidates {
		paths = append(paths, candidate.path)
	}
	return paths
}

func isSuggestedArtifactPath(path string) bool {
	_, ok := suggestedArtifactExtensions[strings.ToLower(filepath.Ext(path))]
	return ok
}
