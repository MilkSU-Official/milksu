package securitytools

import (
	"embed"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

//go:embed overlays/ghidra-rpc/SKILL.md
//go:embed overlays/jadx-android-malware
var overlayFS embed.FS

func OverlayStubDocument(id string) (string, error) {
	id = strings.TrimSpace(id)
	if !knownTool(id) {
		return "", fmt.Errorf("unknown security tool %q", id)
	}
	data, err := overlayFS.ReadFile(filepath.ToSlash(filepath.Join("overlays", id, "SKILL.md")))
	if err != nil {
		return "", fmt.Errorf("read overlay stub %s: %w", id, err)
	}
	return string(data), nil
}

func (s *Service) materializeOverlayStub(id string) (string, error) {
	if !knownTool(id) {
		return "", fmt.Errorf("unknown security tool %q", id)
	}
	destination := filepath.Join(s.root, "overlays", id)
	root := filepath.ToSlash(filepath.Join("overlays", id))
	if err := fs.WalkDir(overlayFS, root, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		rel, err := filepath.Rel(filepath.FromSlash(root), filepath.FromSlash(path))
		if err != nil {
			return err
		}
		target := filepath.Join(destination, rel)
		if entry.IsDir() {
			return os.MkdirAll(target, 0o700)
		}
		data, err := overlayFS.ReadFile(path)
		if err != nil {
			return fmt.Errorf("read overlay %s: %w", path, err)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			return fmt.Errorf("create overlay directory: %w", err)
		}
		if err := os.WriteFile(target, data, 0o600); err != nil {
			return fmt.Errorf("write overlay %s: %w", rel, err)
		}
		return nil
	}); err != nil {
		return "", err
	}
	return destination, nil
}
