package securitytools

import (
	"embed"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

//go:embed overlays/*/SKILL.md
var overlayStubs embed.FS

func OverlayStubDocument(id string) (string, error) {
	id = strings.TrimSpace(id)
	if !knownTool(id) {
		return "", fmt.Errorf("unknown security tool %q", id)
	}
	data, err := overlayStubs.ReadFile(filepath.ToSlash(filepath.Join("overlays", id, "SKILL.md")))
	if err != nil {
		return "", fmt.Errorf("read overlay stub %s: %w", id, err)
	}
	return string(data), nil
}

func (s *Service) materializeOverlayStub(id string) (string, error) {
	body, err := OverlayStubDocument(id)
	if err != nil {
		return "", err
	}
	destination := filepath.Join(s.root, "overlays", id)
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return "", fmt.Errorf("create overlay stub: %w", err)
	}
	path := filepath.Join(destination, "SKILL.md")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		return "", fmt.Errorf("write overlay stub: %w", err)
	}
	return destination, nil
}
