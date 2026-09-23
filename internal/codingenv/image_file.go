package codingenv

import (
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

// WorkspaceImageFile resolves a workspace-relative image and checks that the
// file is a regular image inside that workspace. Callers use the absolute
// path for copy, save, and reveal.
func WorkspaceImageFile(workspace, relativePath string) (string, error) {
	resolvedWorkspace, err := resolveWorkspace(workspace)
	if err != nil {
		return "", err
	}
	cleaned, absolute, err := resolveArtifactPreviewPath(resolvedWorkspace, relativePath)
	if err != nil {
		return "", err
	}
	expected := artifactImageMediaType(strings.ToLower(filepath.Ext(cleaned)))
	if expected == "" {
		return "", errors.New("workspace image must be PNG, JPEG, GIF, or WebP")
	}
	file, err := os.Open(absolute)
	if err != nil {
		return "", fmt.Errorf("open workspace image: %w", err)
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "", fmt.Errorf("inspect workspace image: %w", err)
	}
	if !info.Mode().IsRegular() {
		return "", errors.New("workspace image is not a regular file")
	}
	if info.Size() <= 0 || info.Size() > maxArtifactImagePreviewBytes {
		return "", errors.New("workspace image has an invalid size")
	}
	header := make([]byte, 512)
	read, err := file.Read(header)
	if err != nil && !errors.Is(err, io.EOF) {
		return "", fmt.Errorf("read workspace image: %w", err)
	}
	detected := http.DetectContentType(header[:read])
	if detected != expected {
		return "", fmt.Errorf("workspace image content type %q does not match %s", detected, filepath.Ext(cleaned))
	}
	return absolute, nil
}

// CopyRegularFile writes source to an absolute destination chosen by the user.
func CopyRegularFile(source, destination string) error {
	sourceInfo, err := os.Lstat(source)
	if err != nil {
		return fmt.Errorf("open image source: %w", err)
	}
	if !sourceInfo.Mode().IsRegular() {
		return errors.New("image source is not a regular file")
	}
	destination = strings.TrimSpace(destination)
	if destination == "" {
		return errors.New("image destination is empty")
	}
	if !filepath.IsAbs(destination) {
		return errors.New("image destination must be absolute")
	}
	destination = filepath.Clean(destination)
	source = filepath.Clean(source)
	if source == destination {
		return errors.New("image destination is the source file")
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o755); err != nil {
		return fmt.Errorf("create image destination: %w", err)
	}
	in, err := os.Open(source)
	if err != nil {
		return fmt.Errorf("open image source: %w", err)
	}
	defer in.Close()
	out, err := os.OpenFile(destination, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return fmt.Errorf("create image destination: %w", err)
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return fmt.Errorf("write image destination: %w", copyErr)
	}
	if closeErr != nil {
		return fmt.Errorf("close image destination: %w", closeErr)
	}
	return nil
}
