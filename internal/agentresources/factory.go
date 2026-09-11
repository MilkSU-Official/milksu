package agentresources

import (
	"os"
	"path/filepath"
	"strings"
)

func optionalCodingSkill(name string) bool {
	switch strings.TrimSpace(name) {
	case "ghidra-rpc", "jadx":
		return true
	default:
		return false
	}
}

func StripOptionalSkillPaths(paths []string) []string {
	result := make([]string, 0, len(paths))
	for _, path := range paths {
		if optionalCodingSkill(filepath.Base(path)) {
			continue
		}
		result = append(result, path)
	}
	return result
}

func (s *Store) OptionalSkillPaths(enabled []string) []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	result := make([]string, 0, len(enabled))
	seen := map[string]bool{}
	for _, name := range enabled {
		name = strings.TrimSpace(name)
		if !optionalCodingSkill(name) || seen[name] {
			continue
		}
		seen[name] = true
		if overlay := s.overlaySkillDir(name); skillDirOK(overlay) {
			result = append(result, overlay)
			continue
		}
		if factory := s.factorySkillDir(name); skillDirOK(factory) {
			result = append(result, factory)
		}
	}
	return result
}

func (s *Store) SetFactorySkillsDir(dir string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.factorySkills = strings.TrimSpace(dir)
}

func (s *Store) factorySkillDir(name string) string {
	if name == "archify" {
		for _, candidate := range archifySkillDirs(s.factorySkills) {
			if skillDirOK(candidate) {
				return candidate
			}
		}
	}
	if strings.TrimSpace(s.factorySkills) == "" {
		return ""
	}
	return filepath.Join(s.factorySkills, name)
}

func resolveFactorySkillsDir() string {
	if value := strings.TrimSpace(os.Getenv("MILKSU_FACTORY_SKILLS_DIR")); value != "" {
		if factorySkillsOK(value) {
			return filepath.Clean(value)
		}
	}
	var candidates []string
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		candidates = append(candidates,
			filepath.Join(dir, "skills"),
			filepath.Join(dir, "..", "skills"),
			filepath.Join(dir, "..", "..", "skills"),
			filepath.Join(dir, "..", "Resources", "milksu-sidecar", "skills"),
			filepath.Join(dir, "..", "Resources", "skills"),
		)
	}
	if cwd, err := os.Getwd(); err == nil {
		candidates = append(candidates,
			filepath.Join(cwd, "skills"),
			filepath.Join(cwd, "..", "skills"),
		)
	}
	for _, candidate := range candidates {
		if factorySkillsOK(candidate) {
			return filepath.Clean(candidate)
		}
	}
	return ""
}

func factorySkillsOK(dir string) bool {
	return skillDirOK(filepath.Join(dir, "product-design"))
}

func skillDirOK(dir string) bool {
	info, err := os.Stat(filepath.Join(dir, "SKILL.md"))
	return err == nil && info.Mode().IsRegular()
}

func archifySkillDirs(factory string) []string {
	var dirs []string
	if strings.TrimSpace(factory) != "" {
		dirs = append(dirs, filepath.Join(factory, "archify"))
	}
	if exe, err := os.Executable(); err == nil {
		dir := filepath.Dir(exe)
		dirs = append(dirs,
			filepath.Join(dir, "skills", "archify"),
			filepath.Join(dir, "..", "skills", "archify"),
			filepath.Join(dir, "..", "Resources", "milksu-sidecar", "skills", "archify"),
			filepath.Join(dir, "..", "sidecar", "pi", "skills", "archify"),
			filepath.Join(dir, "..", "sidecar", "pi", "third_party", "archify", "archify"),
			filepath.Join(dir, "..", "..", "third_party", "archify", "archify"),
		)
	}
	if cwd, err := os.Getwd(); err == nil {
		dirs = append(dirs,
			filepath.Join(cwd, "skills", "archify"),
			filepath.Join(cwd, "third_party", "archify", "archify"),
			filepath.Join(cwd, "..", "third_party", "archify", "archify"),
			filepath.Join(cwd, "..", "..", "third_party", "archify", "archify"),
			filepath.Join(cwd, "sidecar", "pi", "skills", "archify"),
			filepath.Join(cwd, "sidecar", "pi", "third_party", "archify", "archify"),
		)
	}
	return dirs
}
