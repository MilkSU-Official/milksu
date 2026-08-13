package main

import "github.com/MilkSU-Official/milksu/internal/securitytools"

func (a *App) ListSecurityTools() []securitytools.ToolSnapshot {
	return a.securityTools.List(a.commandContext())
}

func (a *App) SetSecurityToolEnabled(id string, enabled bool) error {
	return a.securityTools.SetEnabled(id, enabled)
}

func (a *App) StartSecurityToolSetup(id string) (securitytools.SetupSnapshot, error) {
	return a.securityTools.StartSetup(a.commandContext(), id)
}

func (a *App) GetSecurityToolSetup(id string) (securitytools.SetupSnapshot, error) {
	return a.securityTools.SetupStatus(id)
}

func (a *App) CheckSecurityTool(id string) (securitytools.ToolSnapshot, error) {
	return a.securityTools.Check(a.commandContext(), id)
}

func (a *App) PrepareSecurityToolCodingHandoff(id string) (securitytools.CodingHandoff, error) {
	return a.securityTools.CodingHandoff(a.commandContext(), id)
}

func (a *App) emitSecurityToolSetup(snapshot securitytools.SetupSnapshot) {
	if a.ctx == nil {
		return
	}
	a.emitDesktopEvent("security-tool-setup", snapshot)
}
