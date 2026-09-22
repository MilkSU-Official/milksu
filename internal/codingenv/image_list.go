package codingenv

import (
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

var imageGalleryExtensions = map[string]struct{}{
	".gif":  {},
	".jpeg": {},
	".jpg":  {},
	".png":  {},
	".webp": {},
}

const (
	maxGalleryImages     = 48
	maxImageScanEntries  = 8000
	maxImageScanDepth    = 8
	imageRecencyWindow   = 7 * 24 * time.Hour
)

// DiscoverImages lists recent workspace images for the ContextRail gallery.
// It prefers Git changes and common asset roots, then a bounded recent scan.
// Chat models and ImageGen settings are unrelated; this only surfaces files.
func DiscoverImages(workspace string, changes []GitChange, scanRoots []string) []string {
	seen := make(map[string]struct{})
	paths := make([]string, 0, maxGalleryImages)
	for _, change := range changes {
		path := filepath.ToSlash(strings.TrimSpace(change.Path))
		if path == "" || !isGalleryImagePath(path) || isMilkSUInternalPath(path) {
			continue
		}
		if _, exists := seen[path]; exists {
			continue
		}
		seen[path] = struct{}{}
		paths = append(paths, path)
		if len(paths) >= maxGalleryImages {
			return paths
		}
	}

	roots := append([]string{}, scanRoots...)
	for _, preferred := range []string{"assets", "images", "generated", "out", "dist", "."} {
		roots = append(roots, preferred)
	}

	scan := &imageScan{
		workspace: workspace,
		budget:    maxImageScanEntries,
		seen:      seen,
		notBefore: time.Now().Add(-imageRecencyWindow),
	}
	directories, files := scan.classifyRoots(roots)
	for _, file := range files {
		scan.consider(file)
	}
	for _, directory := range directories {
		scan.walk(directory, 0)
	}
	for _, found := range scan.newestFirst() {
		if _, exists := seen[found]; exists {
			continue
		}
		seen[found] = struct{}{}
		paths = append(paths, found)
		if len(paths) >= maxGalleryImages {
			break
		}
	}
	return paths
}

func isGalleryImagePath(path string) bool {
	ext := strings.ToLower(filepath.Ext(path))
	_, ok := imageGalleryExtensions[ext]
	return ok
}

type imageScan struct {
	workspace  string
	budget     int
	seen       map[string]struct{}
	notBefore  time.Time
	candidates []artifactCandidate
}

func (s *imageScan) classifyRoots(roots []string) ([]string, []string) {
	type scanRoot struct {
		path     string
		modified int64
	}
	var ordered []scanRoot
	var files []string
	seenRoot := make(map[string]struct{})
	for _, root := range roots {
		path := filepath.Join(s.workspace, filepath.FromSlash(root))
		if _, exists := seenRoot[path]; exists {
			continue
		}
		seenRoot[path] = struct{}{}
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

func (s *imageScan) consider(path string) {
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

func (s *imageScan) record(path string, modified time.Time) {
	if modified.Before(s.notBefore) {
		return
	}
	if !isGalleryImagePath(path) || isMilkSUInternalPath(path) {
		return
	}
	if _, exists := s.seen[path]; exists {
		return
	}
	s.candidates = append(s.candidates, artifactCandidate{
		path:     path,
		modified: modified.Unix(),
	})
}

func (s *imageScan) walk(directory string, depth int) {
	if s.budget <= 0 || depth > maxImageScanDepth {
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
		if name == ".git" || name == "node_modules" || name == ".milksu" {
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
	sort.SliceStable(directories, func(first, second int) bool {
		return directories[first].modified > directories[second].modified
	})
	for _, entry := range directories {
		s.walk(filepath.Join(directory, entry.name), depth+1)
	}
}

func (s *imageScan) newestFirst() []string {
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
