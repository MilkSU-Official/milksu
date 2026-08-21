package main

import (
	"context"
	"time"

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
	return codingenv.InspectMCPConfig(workspacePath)
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
