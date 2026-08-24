package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/browsercap"
	"github.com/MilkSU-Official/milksu/internal/codingenv"
)

type codingWorkspaceRequest struct {
	Action     string   `json:"action"`
	TabID      string   `json:"tabId"`
	Query      string   `json:"query"`
	URL        string   `json:"url"`
	Path       string   `json:"path"`
	Panel      string   `json:"panel"`
	Kind       string   `json:"kind"`
	ID         string   `json:"id"`
	IDs        []string `json:"ids"`
	Title      string   `json:"title"`
	Archived   bool     `json:"archived"`
	Limit      int      `json:"limit"`
	Scope      string   `json:"scope"`
	Request    string   `json:"request"`
	Statement  string   `json:"statement"`
	Category   string   `json:"category"`
	Summary    string   `json:"summary"`
	CVEID      string   `json:"cveId"`
	Vendor     string   `json:"vendor"`
	Product    string   `json:"product"`
	Affected   string   `json:"affected"`
	SourceKind string   `json:"sourceKind"`
}

type codingWorkspaceReveal struct {
	ConversationID string `json:"conversationId"`
	Panel          string `json:"panel,omitempty"`
	ArtifactPath   string `json:"artifactPath,omitempty"`
	ChangePath     string `json:"changePath,omitempty"`
	Terminal       string `json:"terminal,omitempty"`
}

func (a *App) handleCodingWorkspaceAction(conversationID, action, input string) (string, error) {
	var request codingWorkspaceRequest
	if strings.TrimSpace(input) != "" {
		if err := json.Unmarshal([]byte(input), &request); err != nil {
			return "", fmt.Errorf("invalid workspace action input")
		}
	}
	if action == "" {
		action = request.Action
	}
	switch strings.TrimSpace(action) {
	case "computer_use_driver_status":
		result, err := a.PrepareCodingComputerUseDriver(false)
		if err != nil && !result.Ready {
			return encodeWorkspaceResult(result)
		}
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(result)
	case "prepare_computer_use_driver":
		result, err := a.PrepareCodingComputerUseDriver(true)
		if err != nil && !result.Ready {
			return encodeWorkspaceResult(result)
		}
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(result)
	case "list_browser_tabs":
		status, err := a.ensureWorkspaceBrowser(conversationID)
		if err != nil {
			return "", err
		}
		a.revealCodingWorkspace(conversationID, "browser", "", "", "")
		return encodeWorkspaceResult(map[string]any{
			"tabs":        status.Tabs,
			"activeTabId": status.ActiveTabID,
		})
	case "focus_browser_tab":
		status, err := a.ensureWorkspaceBrowser(conversationID)
		if err != nil {
			return "", err
		}
		tab, err := browsercap.MatchCodingTab(status.Tabs, request.TabID, request.Query)
		if err != nil {
			return "", err
		}
		status, err = a.ActivateCodingBrowserTab(conversationID, tab.ID)
		if err != nil {
			return "", err
		}
		a.revealCodingWorkspace(conversationID, "browser", "", "", "")
		return encodeWorkspaceResult(map[string]any{
			"focused":     tab.ID,
			"tabs":        status.Tabs,
			"activeTabId": status.ActiveTabID,
		})
	case "open_browser_tab":
		if _, err := a.ensureWorkspaceBrowser(conversationID); err != nil {
			return "", err
		}
		status, err := a.CreateCodingBrowserTab(conversationID, request.URL)
		if err != nil {
			return "", err
		}
		a.revealCodingWorkspace(conversationID, "browser", "", "", "")
		return encodeWorkspaceResult(map[string]any{
			"tabs":        status.Tabs,
			"activeTabId": status.ActiveTabID,
		})
	case "close_browser_tab":
		status, err := a.ensureWorkspaceBrowser(conversationID)
		if err != nil {
			return "", err
		}
		tab, err := browsercap.MatchCodingTab(status.Tabs, request.TabID, request.Query)
		if err != nil {
			return "", err
		}
		status, err = a.CloseCodingBrowserTab(conversationID, tab.ID)
		if err != nil {
			return "", err
		}
		a.revealCodingWorkspace(conversationID, "browser", "", "", "")
		return encodeWorkspaceResult(map[string]any{
			"closed":      tab.ID,
			"tabs":        status.Tabs,
			"activeTabId": status.ActiveTabID,
		})
	case "close_all_browser_tabs":
		if _, err := a.ensureWorkspaceBrowser(conversationID); err != nil {
			return "", err
		}
		status, err := a.browserBridge.CloseAllCodingTabs(conversationID)
		if err != nil {
			return "", err
		}
		a.emitDesktopEvent("coding-browser.ready", status)
		a.revealCodingWorkspace(conversationID, "browser", "", "", "")
		return encodeWorkspaceResult(map[string]any{
			"tabs":        status.Tabs,
			"activeTabId": status.ActiveTabID,
		})
	case "list_artifacts":
		workspace, err := a.workspaceForConversation(conversationID)
		if err != nil {
			return "", err
		}
		snapshot, err := codingenv.Inspect(a.commandContext(), workspace)
		if err != nil {
			return "", err
		}
		a.revealCodingWorkspace(conversationID, "artifacts", "", "", "")
		return encodeWorkspaceResult(map[string]any{
			"workspace": snapshot.WorkspaceName,
			"artifacts": codingenv.SuggestedArtifactPaths(snapshot),
		})
	case "preview_artifact":
		workspace, err := a.workspaceForConversation(conversationID)
		if err != nil {
			return "", err
		}
		preview, err := codingenv.InspectArtifactPreview(workspace, request.Path)
		if err != nil {
			return "", err
		}
		a.revealCodingWorkspace(conversationID, "artifacts", preview.RelativePath, "", "")
		return encodeWorkspaceResult(map[string]any{
			"path":      preview.RelativePath,
			"kind":      preview.Kind,
			"mediaType": preview.MediaType,
			"sizeBytes": preview.SizeBytes,
		})
	case "reveal_artifacts":
		if err := a.RevealUserArtifactDirectory(); err != nil {
			return "", err
		}
		a.revealCodingWorkspace(conversationID, "artifacts", "", "", "")
		return encodeWorkspaceResult(map[string]any{"revealed": true})
	case "show_panel":
		panel := strings.TrimSpace(request.Panel)
		if panel == "" {
			panel = "browser"
		}
		if panel != "browser" && panel != "artifacts" && panel != "changes" && panel != "environment" {
			return "", fmt.Errorf("unknown Coding panel")
		}
		changePath := ""
		if panel == "changes" {
			changePath = strings.TrimSpace(request.Path)
		}
		a.revealCodingWorkspace(conversationID, panel, "", changePath, "")
		return encodeWorkspaceResult(map[string]any{"panel": panel, "path": changePath})
	case "list_status":
		return a.listCodingWorkspaceStatus(conversationID)
	case "show_terminal":
		a.revealCodingWorkspace(conversationID, "", "", "", "open")
		return encodeWorkspaceResult(map[string]any{"terminal": "open"})
	case "hide_terminal":
		a.revealCodingWorkspace(conversationID, "", "", "", "close")
		return encodeWorkspaceResult(map[string]any{"terminal": "close"})
	case "list_terminals":
		sessions, err := a.ListCodingTerminals(conversationID)
		if err != nil {
			return "", err
		}
		rows := make([]map[string]any, 0, len(sessions))
		for _, session := range sessions {
			rows = append(rows, map[string]any{
				"id":        session.ID,
				"status":    session.Status,
				"workspace": session.Workspace,
				"pid":       session.PID,
			})
		}
		return encodeWorkspaceResult(map[string]any{"terminals": rows})
	case "list_background_tasks":
		status := a.engines.StatusForSession(conversationID)
		rows := make([]map[string]any, 0, len(status.BackgroundTasks))
		for _, task := range status.BackgroundTasks {
			rows = append(rows, map[string]any{
				"id":      task.ID,
				"name":    task.Name,
				"status":  task.Status,
				"command": task.Command,
				"cwd":     task.Cwd,
				"pid":     task.PID,
				"ports":   task.Ports,
			})
		}
		return encodeWorkspaceResult(map[string]any{"tasks": rows})
	case "list_records", "get_record", "create_record", "update_record", "archive_records", "restore_records", "focus_record", "search_records":
		return a.handleWorkspaceRecordAction(conversationID, action, request)
	case "env_status", "env_start", "env_reset", "env_stop":
		return a.handleEnvWorkspaceAction(conversationID, action)
	default:
		return "", fmt.Errorf("unknown Coding workspace action")
	}
}

func (a *App) ensureWorkspaceBrowser(conversationID string) (browsercap.CodingBrowserStatus, error) {
	return a.EnsureCodingBrowser(conversationID)
}

func (a *App) workspaceForConversation(conversationID string) (string, error) {
	return a.resolveConversationWorkspace(conversationID, "")
}

func (a *App) listCodingWorkspaceStatus(conversationID string) (string, error) {
	saved, err := a.conversations.Get(conversationID)
	if err != nil {
		return "", err
	}
	workspace, workspaceErr := a.workspaceForConversation(conversationID)
	var git map[string]any
	if workspaceErr == nil && strings.TrimSpace(workspace) != "" {
		if snapshot, inspectErr := codingenv.Inspect(a.commandContext(), workspace); inspectErr == nil {
			git = map[string]any{
				"branch":       snapshot.Git.Branch,
				"dirty":        snapshot.Git.Dirty,
				"changedFiles": snapshot.Git.ChangedFiles,
				"staged":       snapshot.Git.Staged,
				"modified":     snapshot.Git.Modified,
				"untracked":    snapshot.Git.Untracked,
				"conflicts":    snapshot.Git.Conflicts,
			}
		}
	}
	a.revealCodingWorkspace(conversationID, "environment", "", "", "")
	return encodeWorkspaceResult(map[string]any{
		"title":          saved.Title,
		"executionMode":  saved.ExecutionMode,
		"approvalPolicy": saved.ApprovalPolicy,
		"model":          strings.TrimSpace(saved.ModelProvider + "/" + saved.ModelID),
		"workspace":      workspace,
		"tools":          saved.AgentTools,
		"git":            git,
	})
}

func (a *App) revealCodingWorkspace(conversationID, panel, artifactPath, changePath, terminal string) {
	if a.ctx == nil {
		return
	}
	a.emitDesktopEvent("coding-workspace.reveal", codingWorkspaceReveal{
		ConversationID: conversationID,
		Panel:          panel,
		ArtifactPath:   artifactPath,
		ChangePath:     changePath,
		Terminal:       terminal,
	})
}

func encodeWorkspaceResult(value any) (string, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
