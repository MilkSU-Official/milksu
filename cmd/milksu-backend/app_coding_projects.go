package main

import (
	"errors"

	"github.com/MilkSU-Official/milksu/internal/codingworkspace"
)

func (a *App) GetCodingProjectMemory() (codingworkspace.Snapshot, error) {
	if a.codingProjects == nil {
		return codingworkspace.Snapshot{}, errors.New("Coding project memory is unavailable")
	}
	return a.codingProjects.Get()
}

func (a *App) RememberCodingProject(path string) (codingworkspace.Snapshot, error) {
	if a.codingProjects == nil {
		return codingworkspace.Snapshot{}, errors.New("Coding project memory is unavailable")
	}
	return a.codingProjects.Remember(path)
}

func (a *App) ForgetCodingProject(path string) (codingworkspace.Snapshot, error) {
	if a.codingProjects == nil {
		return codingworkspace.Snapshot{}, errors.New("Coding project memory is unavailable")
	}
	return a.codingProjects.Forget(path)
}
