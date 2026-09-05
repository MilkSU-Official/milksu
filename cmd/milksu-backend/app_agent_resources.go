package main

import (
	"errors"

	"github.com/MilkSU-Official/milksu/internal/agentresources"
)

func (a *App) ListAgentResourceCatalog() (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{
			MCPServers: []agentresources.MCPServerSnapshot{},
			Skills:     []agentresources.SkillSnapshot{},
		}, nil
	}
	return a.agentResources.Snapshot()
}

func (a *App) UpsertUserMCPServer(input agentresources.MCPServerInput) (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{}, errAgentResourcesUnavailable
	}
	return a.agentResources.UpsertMCPServer(input)
}

func (a *App) SetUserMCPServerEnabled(name string, enabled bool) (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{}, errAgentResourcesUnavailable
	}
	return a.agentResources.SetMCPServerEnabled(name, enabled)
}

func (a *App) DeleteUserMCPServer(name string) (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{}, errAgentResourcesUnavailable
	}
	return a.agentResources.DeleteMCPServer(name)
}

func (a *App) ImportUserMCPJSON(document string) (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{}, errAgentResourcesUnavailable
	}
	return a.agentResources.ImportMCPJSON([]byte(document))
}

func (a *App) ImportUserSkill() (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{}, errAgentResourcesUnavailable
	}
	selected, err := a.openDirectory(desktopDialogOptions{
		Title: "选择包含 SKILL.md 的目录",
	})
	if err != nil {
		return agentresources.CatalogSnapshot{}, err
	}
	if selected == "" {
		return a.agentResources.Snapshot()
	}
	return a.agentResources.ImportSkill(selected)
}

func (a *App) SetUserSkillEnabled(name string, enabled bool) (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{}, errAgentResourcesUnavailable
	}
	return a.agentResources.SetSkillEnabled(name, enabled)
}

func (a *App) DeleteUserSkill(name string) (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{}, errAgentResourcesUnavailable
	}
	return a.agentResources.DeleteSkill(name)
}

var errAgentResourcesUnavailable = errors.New("agent resource catalog is unavailable")
