package codingenv

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

const maxArchitecturePreviewBytes = 2 << 20

type ArchitecturePreview struct {
	Exists       bool   `json:"exists"`
	RelativePath string `json:"relativePath"`
	HTML         string `json:"html,omitempty"`
	SizeBytes    int64  `json:"sizeBytes,omitempty"`
}

func InspectArchitecturePreview(workspace, relativePath string) (ArchitecturePreview, error) {
	resolvedWorkspace, err := resolveWorkspace(workspace)
	if err != nil {
		return ArchitecturePreview{}, err
	}
	cleaned, absolute, err := resolveArchitecturePath(resolvedWorkspace, relativePath)
	if err != nil {
		return ArchitecturePreview{}, err
	}
	result := ArchitecturePreview{RelativePath: filepath.ToSlash(cleaned)}
	resolvedTarget, err := filepath.EvalSymlinks(absolute)
	if errors.Is(err, os.ErrNotExist) {
		return result, nil
	}
	if err != nil {
		return ArchitecturePreview{}, fmt.Errorf("resolve architecture preview: %w", err)
	}
	relativeTarget, err := filepath.Rel(resolvedWorkspace, resolvedTarget)
	if err != nil || relativeTarget == ".." ||
		strings.HasPrefix(relativeTarget, ".."+string(filepath.Separator)) {
		return ArchitecturePreview{}, errors.New("architecture preview escapes the Coding workspace")
	}
	absolute = resolvedTarget
	info, err := os.Stat(absolute)
	if err != nil {
		return ArchitecturePreview{}, fmt.Errorf("open architecture preview: %w", err)
	}
	if !info.Mode().IsRegular() {
		return ArchitecturePreview{}, errors.New("architecture preview is not a regular file")
	}
	if info.Size() > maxArchitecturePreviewBytes {
		return ArchitecturePreview{}, fmt.Errorf(
			"architecture preview exceeds %d bytes",
			maxArchitecturePreviewBytes,
		)
	}
	data, err := os.ReadFile(absolute)
	if err != nil {
		return ArchitecturePreview{}, fmt.Errorf("read architecture preview: %w", err)
	}
	html := string(data)
	if !strings.Contains(html, `<meta name="generator" content="archify`) {
		return ArchitecturePreview{}, errors.New("architecture preview is not an Archify artifact")
	}
	result.Exists = true
	result.HTML = html
	result.SizeBytes = info.Size()
	return result, nil
}

func resolveArchitecturePath(workspace, value string) (string, string, error) {
	if strings.TrimSpace(value) == "" || filepath.IsAbs(value) {
		return "", "", errors.New("architecture preview path must be workspace-relative")
	}
	cleaned := filepath.Clean(filepath.FromSlash(value))
	allowedRoot := filepath.Join("docs", "architecture", "generated")
	if cleaned == "." || cleaned == ".." ||
		!strings.HasPrefix(cleaned, allowedRoot+string(filepath.Separator)) ||
		!strings.EqualFold(filepath.Ext(cleaned), ".html") {
		return "", "", errors.New(
			"architecture preview must be an HTML file under docs/architecture/generated",
		)
	}
	absolute := filepath.Join(workspace, cleaned)
	parent, err := filepath.EvalSymlinks(filepath.Dir(absolute))
	if errors.Is(err, os.ErrNotExist) {
		parent = filepath.Dir(absolute)
	} else if err != nil {
		return "", "", fmt.Errorf("resolve architecture preview directory: %w", err)
	}
	target := filepath.Join(parent, filepath.Base(absolute))
	relativeTarget, err := filepath.Rel(workspace, target)
	if err != nil || relativeTarget == ".." ||
		strings.HasPrefix(relativeTarget, ".."+string(filepath.Separator)) {
		return "", "", errors.New("architecture preview escapes the Coding workspace")
	}
	return cleaned, target, nil
}
