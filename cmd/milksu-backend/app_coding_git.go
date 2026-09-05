package main

import (
	"context"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/agentresources"
	"github.com/MilkSU-Official/milksu/internal/codingenv"
	"github.com/MilkSU-Official/milksu/internal/externaleditor"
)

func (a *App) GetCodingEnvironment(workspacePath string) (codingenv.Snapshot, error) {
	inspectContext, cancel := context.WithTimeout(a.commandContext(), 4*time.Second)
	defer cancel()
	return codingenv.Inspect(inspectContext, workspacePath)
}

func (a *App) GetCodingMCPConfig(
	workspacePath string,
) (codingenv.MCPConfigSnapshot, error) {
	var snapshot codingenv.MCPConfigSnapshot
	if strings.TrimSpace(workspacePath) == "" {
		snapshot.Servers = []codingenv.MCPServerSummary{}
	} else {
		next, err := codingenv.InspectMCPConfig(workspacePath)
		if err != nil {
			return next, err
		}
		snapshot = next
	}
	if a.agentResources != nil {
		snapshot.Servers = append(codingServersFromUserMCP(a.agentResources.UserMCPSummaries()), snapshot.Servers...)
	}
	return snapshot, nil
}

func codingServersFromUserMCP(servers []agentresources.MCPServerSnapshot) []codingenv.MCPServerSummary {
	result := make([]codingenv.MCPServerSummary, 0, len(servers))
	for _, server := range servers {
		if !server.Enabled {
			continue
		}
		credentialAccess := "不注入；Provider Credential 保持隔离"
		if len(server.EnvNames) > 0 || len(server.HeaderNames) > 0 || server.HasBearer {
			credentialAccess = "使用用户设置；Provider Credential 保持隔离"
		}
		result = append(result, codingenv.MCPServerSummary{
			Name:             server.Name,
			Transport:        userMCPTransportLabel(server.Transport),
			Source:           "设置",
			TaskScope:        "用户级 MCP",
			Tools:            []string{},
			FileAccess:       server.FileAccess,
			NetworkAccess:    server.NetworkAccess,
			CredentialAccess: credentialAccess,
			ReviewReady:      true,
			Scope:            "user",
		})
	}
	return result
}

func userMCPTransportLabel(transport string) string {
	switch transport {
	case "command":
		return "本地进程"
	case "url":
		return "远程 HTTP"
	case "socket":
		return "本地 Socket"
	default:
		return transport
	}
}

func (a *App) GetCodingDiff(
	workspacePath,
	relativePath string,
) (codingenv.DiffSnapshot, error) {
	inspectContext, cancel := context.WithTimeout(a.commandContext(), 4*time.Second)
	defer cancel()
	return codingenv.InspectDiff(inspectContext, workspacePath, relativePath)
}

func (a *App) OpenCodingFileInEditor(workspacePath, relativePath string) error {
	editorID := externaleditor.DefaultID
	if a.settings != nil {
		editorID = a.settings.Get().PreferredExternalEditor
	}
	return externaleditor.Open(workspacePath, relativePath, editorID)
}

func (a *App) ApplyCodingGitAction(
	workspacePath,
	action,
	relativePath,
	message string,
) (codingenv.GitActionResult, error) {
	timeout := 15 * time.Second
	if action == codingenv.GitActionPush {
		timeout = 2 * time.Minute
	}
	actionContext, cancel := context.WithTimeout(a.commandContext(), timeout)
	defer cancel()
	return codingenv.ApplyGitAction(
		actionContext,
		workspacePath,
		action,
		relativePath,
		message,
	)
}

func (a *App) ApplyCodingGitHunkAction(
	workspacePath,
	action,
	relativePath,
	patch string,
) (codingenv.GitActionResult, error) {
	actionContext, cancel := context.WithTimeout(a.commandContext(), 15*time.Second)
	defer cancel()
	return codingenv.ApplyGitHunkAction(
		actionContext,
		workspacePath,
		action,
		relativePath,
		patch,
	)
}

func (a *App) PrepareCodingPullRequest(
	workspacePath string,
) (codingenv.PullRequestPreview, error) {
	actionContext, cancel := context.WithTimeout(a.commandContext(), 30*time.Second)
	defer cancel()
	return a.codingPRs.Prepare(actionContext, workspacePath)
}

func (a *App) PublishCodingPullRequest(
	workspacePath,
	confirmationToken,
	title,
	body string,
) (codingenv.PullRequestPublishResult, error) {
	actionContext, cancel := context.WithTimeout(a.commandContext(), 2*time.Minute)
	defer cancel()
	return a.codingPRs.Publish(
		actionContext,
		workspacePath,
		confirmationToken,
		title,
		body,
	)
}
