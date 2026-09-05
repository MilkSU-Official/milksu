package main

import (
	"github.com/MilkSU-Official/milksu/internal/agentresources"
	"github.com/MilkSU-Official/milksu/internal/securitytools"
)

func applySecurityToolOverlays(store *agentresources.Store, tools []securitytools.RuntimeTool) []securitytools.RuntimeTool {
	if store == nil {
		return tools
	}
	result := make([]securitytools.RuntimeTool, 0, len(tools))
	for _, tool := range tools {
		command, args, enabled, _ := store.LookupBuiltinMCP(tool.ID)
		if !enabled {
			continue
		}
		if command != "" {
			tool.Command = command
		}
		if len(args) > 0 {
			tool.Args = args
		}
		result = append(result, tool)
	}
	return result
}

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
	handoff, err := a.securityTools.CodingHandoff(a.commandContext(), id)
	if err != nil {
		return securitytools.CodingHandoff{}, err
	}
	if a.agentResources != nil {
		workspace, workspaceErr := a.agentResources.EnsureConfigWorkspace()
		if workspaceErr != nil {
			return securitytools.CodingHandoff{}, workspaceErr
		}
		handoff.WorkspacePath = workspace
	}
	return handoff, nil
}

func (a *App) emitSecurityToolSetup(snapshot securitytools.SetupSnapshot) {
	if a.ctx == nil {
		return
	}
	a.emitDesktopEvent("security-tool-setup", snapshot)
}
