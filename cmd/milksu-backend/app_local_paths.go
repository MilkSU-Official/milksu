package main

import (
	"fmt"

	"github.com/MilkSU-Official/milksu/internal/userartifact"
)

func (a *App) RevealLocalDataDirectory() error {
	if a.ctx == nil {
		return fmt.Errorf("desktop runtime is not ready")
	}
	return a.openPath(a.dataDirectory)
}

func (a *App) RevealUserArtifactDirectory() error {
	if a.ctx == nil {
		return fmt.Errorf("desktop runtime is not ready")
	}
	root, err := userartifact.Ensure(a.artifactDirectory)
	if err != nil {
		return err
	}
	return a.openPath(root)
}
