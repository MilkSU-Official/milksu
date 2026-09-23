package main

import (
	"path/filepath"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/codingenv"
	"github.com/MilkSU-Official/milksu/internal/config"
)

func (a *App) workspaceImage(workspacePath, relativePath string) (string, error) {
	return codingenv.WorkspaceImageFile(workspacePath, relativePath)
}

func (a *App) CopyCodingImage(workspacePath, relativePath string) error {
	absolute, err := a.workspaceImage(workspacePath, relativePath)
	if err != nil {
		return err
	}
	return a.desktopCall("clipboard.writeImage", map[string]string{"path": absolute}, nil)
}

func (a *App) RevealCodingImage(workspacePath, relativePath string) error {
	absolute, err := a.workspaceImage(workspacePath, relativePath)
	if err != nil {
		return err
	}
	return a.revealPath(absolute)
}

func (a *App) SaveCodingImage(workspacePath, relativePath string) error {
	absolute, err := a.workspaceImage(workspacePath, relativePath)
	if err != nil {
		return err
	}
	title := "保存图片"
	if a.settings != nil && config.ResolvedUserInterfaceLocale(a.settings.Get()) == "en" {
		title = "Save image"
	}
	destination, err := a.saveFile(desktopDialogOptions{
		Title:       title,
		DefaultPath: filepath.Base(absolute),
		Filters:     []desktopFileFilter{imageSaveFilter(absolute)},
	})
	if err != nil {
		return err
	}
	if strings.TrimSpace(destination) == "" {
		return nil
	}
	return codingenv.CopyRegularFile(absolute, destination)
}

func imageSaveFilter(absolute string) desktopFileFilter {
	switch strings.ToLower(filepath.Ext(absolute)) {
	case ".jpg", ".jpeg":
		return desktopFileFilter{Name: "JPEG", Extensions: []string{"jpg", "jpeg"}}
	case ".gif":
		return desktopFileFilter{Name: "GIF", Extensions: []string{"gif"}}
	case ".webp":
		return desktopFileFilter{Name: "WebP", Extensions: []string{"webp"}}
	default:
		return desktopFileFilter{Name: "PNG", Extensions: []string{"png"}}
	}
}
