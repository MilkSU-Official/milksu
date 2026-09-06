package securitytools

import (
	"os"
	"path/filepath"
	"sort"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/hostpath"
	"github.com/MilkSU-Official/milksu/internal/userartifact"
)

const (
	maxSanitizedOutputBytes = 50 * 1024
	maxSanitizedOutputLines = 2000
)

func (s *Service) dataDirectory() string {
	return filepath.Dir(s.root)
}

func (s *Service) ghidraAllowedRoots() []string {
	var roots []string
	if artifacts, err := userartifact.Directory(); err == nil {
		for _, kind := range []userartifact.Kind{
			userartifact.KindCoding,
			userartifact.KindLab,
			userartifact.KindCVE,
		} {
			roots = append(roots, filepath.Join(artifacts, string(kind)))
		}
	}
	return roots
}

func (s *Service) jadxAllowedRoots() []string {
	var roots []string
	if artifacts, err := userartifact.Directory(); err == nil {
		roots = append(roots, filepath.Join(artifacts, string(userartifact.KindLab)))
	}
	roots = append(roots, filepath.Join(s.dataDirectory(), "envbroker", "cache"))
	return roots
}

func (s *Service) AllowGhidraPath(path string) bool {
	return pathUnderAny(path, s.ghidraAllowedRoots())
}

func (s *Service) AllowJADXPath(path string) bool {
	if !pathUnderAny(path, s.jadxAllowedRoots()) {
		return false
	}
	cache := filepath.Join(s.dataDirectory(), "envbroker", "cache")
	if pathUnderAny(path, []string{cache}) {
		return strings.HasPrefix(strings.ToLower(filepath.Base(path)), "injuredandroid")
	}
	return true
}

func pathUnderAny(path string, roots []string) bool {
	for _, root := range roots {
		if pathUnderRoot(path, root) {
			return true
		}
	}
	return false
}

func pathUnderRoot(path, root string) bool {
	if strings.TrimSpace(path) == "" || strings.TrimSpace(root) == "" {
		return false
	}
	absPath, err := filepath.Abs(filepath.Clean(path))
	if err != nil {
		return false
	}
	absRoot, err := filepath.Abs(filepath.Clean(root))
	if err != nil {
		return false
	}
	rel, err := filepath.Rel(absRoot, absPath)
	if err != nil {
		return false
	}
	return rel == "." || (rel != ".." && !strings.HasPrefix(rel, ".."+string(os.PathSeparator)))
}

// SanitizeLabOutput redacts home and ephemeral roots and clips to Pi's
// tool_result bound before lab overlay text enters the conversation.
func SanitizeLabOutput(text string) string {
	replacements := make([]string, 0, 6)
	if home, err := os.UserHomeDir(); err == nil && strings.TrimSpace(home) != "" {
		replacements = append(replacements, home, "$HOME")
	}
	if ephemeral := strings.TrimSpace(hostpath.EphemeralRoot()); ephemeral != "" {
		replacements = append(replacements, ephemeral, "$TMP")
	}
	if temp := strings.TrimSpace(os.TempDir()); temp != "" {
		replacements = append(replacements, temp, "$TMP")
	}
	type pair struct {
		from string
		to   string
	}
	pairs := make([]pair, 0, len(replacements)/2)
	for i := 0; i+1 < len(replacements); i += 2 {
		if replacements[i] == "" {
			continue
		}
		pairs = append(pairs, pair{from: replacements[i], to: replacements[i+1]})
	}
	sort.Slice(pairs, func(i, j int) bool {
		return len(pairs[i].from) > len(pairs[j].from)
	})
	for _, item := range pairs {
		text = strings.ReplaceAll(text, item.from, item.to)
	}
	lines := strings.Split(text, "\n")
	if len(lines) > maxSanitizedOutputLines {
		lines = append(lines[:maxSanitizedOutputLines], "...(truncated)")
	}
	text = strings.Join(lines, "\n")
	if len(text) > maxSanitizedOutputBytes {
		text = text[:maxSanitizedOutputBytes] + "\n...(truncated)"
	}
	return text
}
