package main

import (
	"errors"
	"fmt"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/agentresources"
)

func (a *App) ListAgentResourceCatalog() (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{
			MCPServers:    []agentresources.MCPServerSnapshot{},
			Skills:        []agentresources.SkillSnapshot{},
			BuiltinMCP:    []agentresources.BuiltinMCPSnapshot{},
			BuiltinSkills: []agentresources.BuiltinSkillSnapshot{},
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

func (a *App) UpsertBuiltinMCP(input agentresources.BuiltinMCPInput) (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{}, errAgentResourcesUnavailable
	}
	return a.agentResources.UpsertBuiltinMCP(input)
}

func (a *App) SetBuiltinMCPEnabled(name string, enabled bool) (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{}, errAgentResourcesUnavailable
	}
	if a.securityTools != nil {
		if err := a.securityTools.SetEnabled(name, enabled); err != nil {
			return agentresources.CatalogSnapshot{}, err
		}
	}
	return a.agentResources.SetBuiltinMCPEnabled(name, enabled)
}

func (a *App) RestoreBuiltinMCP(name string) (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{}, errAgentResourcesUnavailable
	}
	if a.securityTools != nil {
		_ = a.securityTools.SetEnabled(name, true)
	}
	return a.agentResources.RestoreBuiltinMCP(name)
}

func (a *App) GetBuiltinSkillDocument(name string) (agentresources.BuiltinSkillDocument, error) {
	if a.agentResources == nil {
		return agentresources.BuiltinSkillDocument{}, errAgentResourcesUnavailable
	}
	return a.agentResources.GetBuiltinSkillDocument(name)
}

func (a *App) SetBuiltinSkillDocument(name, document string) (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{}, errAgentResourcesUnavailable
	}
	return a.agentResources.SetBuiltinSkillDocument(name, document)
}

func (a *App) RestoreBuiltinSkill(name string) (agentresources.CatalogSnapshot, error) {
	if a.agentResources == nil {
		return agentresources.CatalogSnapshot{}, errAgentResourcesUnavailable
	}
	return a.agentResources.RestoreBuiltinSkill(name)
}

func (a *App) PrepareBuiltinConfigHandoff(kind, name string) (agentresources.ConfigHandoff, error) {
	if a.agentResources == nil {
		return agentresources.ConfigHandoff{}, errAgentResourcesUnavailable
	}
	workspace, err := a.agentResources.EnsureConfigWorkspace()
	if err != nil {
		return agentresources.ConfigHandoff{}, err
	}
	kind = strings.TrimSpace(kind)
	name = strings.TrimSpace(name)
	handoff := agentresources.ConfigHandoff{
		Kind:           kind,
		Name:           name,
		WorkspacePath:  workspace,
		ExecutionMode:  "go",
		ApprovalPolicy: "full-auto",
	}
	switch kind {
	case "mcp":
		if a.securityTools == nil {
			return agentresources.ConfigHandoff{}, fmt.Errorf("unknown built-in MCP %q", name)
		}
		prepared, prepareErr := a.securityTools.CodingHandoff(a.commandContext(), name)
		if prepareErr != nil {
			return agentresources.ConfigHandoff{}, prepareErr
		}
		handoff.Title = prepared.Title
		handoff.Prompt = prepared.Prompt + builtinMCPWorkspacePrompt(name)
		handoff.VisibleText = prepared.VisibleText
		return handoff, nil
	case "skill":
		handoff.Title = "配置 " + name
		handoff.VisibleText = "按这段对话修改内置 Skill " + name + "，或把它恢复成当前版本的默认内容。"
		handoff.Prompt = builtinSkillWorkspacePrompt(name)
		return handoff, nil
	default:
		return agentresources.ConfigHandoff{}, fmt.Errorf("unsupported built-in config kind %q", kind)
	}
}

func builtinMCPWorkspacePrompt(name string) string {
	return fmt.Sprintf(
		" 当前会话工作区已指向 MilkSU 内置资源配置目录。请直接编辑 mcp/%s.json：command/args 覆盖本机检测结果，留空则继续用当前版本的检测默认值。不要把密钥写进这些文件。改完后告诉我设置页还需要重新检测什么。",
		name,
	)
}

func builtinSkillWorkspacePrompt(name string) string {
	return fmt.Sprintf(
		"当前会话工作区已指向 MilkSU 内置资源配置目录。请按我的自然语言要求编辑 skills/%s/SKILL.md。保持 Pi 名录规则：frontmatter 只放 name 和 when-to-use description；需要仅斜杠调用时写 disable-model-invocation: true；正文留在这个文件里供 read 或 /skill:%s 加载。不要把 Skill 正文贴进 system prompt，也不要扫描我的其他句子来猜测该改哪个文件。如果我要求恢复默认，把该文件改回当前版本的出厂内容。",
		name,
		name,
	)
}

var errAgentResourcesUnavailable = errors.New("agent resource catalog is unavailable")
