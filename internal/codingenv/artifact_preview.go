package codingenv

import (
	"encoding/base64"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"unicode/utf8"
)

const (
	maxArtifactTextPreviewBytes  = 2 << 20
	maxArtifactImagePreviewBytes = 8 << 20
)

type ArtifactPreview struct {
	RelativePath string `json:"relativePath"`
	Kind         string `json:"kind"`
	MediaType    string `json:"mediaType"`
	Content      string `json:"content,omitempty"`
	DataURL      string `json:"dataUrl,omitempty"`
	SizeBytes    int64  `json:"sizeBytes"`
}

func InspectArtifactPreview(workspace, relativePath string) (ArtifactPreview, error) {
	resolvedWorkspace, err := resolveWorkspace(workspace)
	if err != nil {
		return ArtifactPreview{}, err
	}
	cleaned, absolute, err := resolveArtifactPreviewPath(resolvedWorkspace, relativePath)
	if err != nil {
		return ArtifactPreview{}, err
	}

	extension := strings.ToLower(filepath.Ext(cleaned))
	preview := ArtifactPreview{
		RelativePath: filepath.ToSlash(cleaned),
	}
	var limit int64
	switch extension {
	case ".md", ".markdown":
		preview.Kind = "markdown"
		preview.MediaType = "text/markdown"
		limit = maxArtifactTextPreviewBytes
	case ".html", ".htm":
		preview.Kind = "html"
		preview.MediaType = "text/html"
		limit = maxArtifactTextPreviewBytes
	case ".png", ".jpg", ".jpeg", ".gif", ".webp":
		preview.Kind = "image"
		limit = maxArtifactImagePreviewBytes
	default:
		return ArtifactPreview{}, errors.New(
			"artifact preview supports Markdown, HTML, PNG, JPEG, GIF, and WebP files",
		)
	}

	file, err := os.Open(absolute)
	if err != nil {
		return ArtifactPreview{}, fmt.Errorf("open artifact preview: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return ArtifactPreview{}, fmt.Errorf("inspect artifact preview: %w", err)
	}
	if !info.Mode().IsRegular() {
		return ArtifactPreview{}, errors.New("artifact preview is not a regular file")
	}
	if info.Size() > limit {
		return ArtifactPreview{}, artifactPreviewTooLarge(limit)
	}
	data, err := io.ReadAll(io.LimitReader(file, limit+1))
	if err != nil {
		return ArtifactPreview{}, fmt.Errorf("read artifact preview: %w", err)
	}
	if int64(len(data)) > limit {
		return ArtifactPreview{}, artifactPreviewTooLarge(limit)
	}
	preview.SizeBytes = int64(len(data))
	if preview.Kind != "image" {
		if !utf8.Valid(data) || strings.IndexByte(string(data), 0) >= 0 {
			return ArtifactPreview{}, errors.New("artifact preview text must be valid UTF-8")
		}
		preview.Content = string(data)
		return preview, nil
	}

	detected := http.DetectContentType(data)
	expected := artifactImageMediaType(extension)
	if detected != expected {
		return ArtifactPreview{}, fmt.Errorf(
			"artifact preview content type %q does not match %s",
			detected,
			extension,
		)
	}
	preview.MediaType = detected
	preview.DataURL = "data:" + detected + ";base64," +
		base64.StdEncoding.EncodeToString(data)
	return preview, nil
}

func resolveArtifactPreviewPath(workspace, value string) (string, string, error) {
	if strings.TrimSpace(value) == "" || filepath.IsAbs(value) {
		return "", "", errors.New("artifact preview path must be workspace-relative")
	}
	cleaned := filepath.Clean(filepath.FromSlash(value))
	if cleaned == "." || cleaned == ".." ||
		strings.HasPrefix(cleaned, ".."+string(filepath.Separator)) {
		return "", "", errors.New("artifact preview escapes the Coding workspace")
	}
	target, err := filepath.EvalSymlinks(filepath.Join(workspace, cleaned))
	if err != nil {
		return "", "", fmt.Errorf("resolve artifact preview: %w", err)
	}
	relativeTarget, err := filepath.Rel(workspace, target)
	if err != nil || relativeTarget == ".." ||
		strings.HasPrefix(relativeTarget, ".."+string(filepath.Separator)) {
		return "", "", errors.New("artifact preview escapes the Coding workspace")
	}
	return cleaned, target, nil
}

func artifactPreviewTooLarge(limit int64) error {
	return fmt.Errorf("artifact preview exceeds %d bytes", limit)
}

func artifactImageMediaType(extension string) string {
	switch extension {
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".webp":
		return "image/webp"
	default:
		return ""
	}
}
