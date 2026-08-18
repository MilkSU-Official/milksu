package main

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/browsercap"
	"github.com/MilkSU-Official/milksu/internal/codingenv"
)

type codingWorkspaceRequest struct {
	Action string `json:"action"`
	TabID  string `json:"tabId"`
	Query  string `json:"query"`
	URL    string `json:"url"`
	Path   string `json:"path"`
	Panel  string `json:"panel"`
}

type codingWorkspaceReveal struct {
	ConversationID string `json:"conversationId"`
	Panel          string `json:"panel,omitempty"`
	ArtifactPath   string `json:"artifactPath,omitempty"`
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
	case "list_browser_tabs":
		status, err := a.ensureWorkspaceBrowser(conversationID)
		if err != nil {
			return "", err
		}
		a.revealCodingWorkspace(conversationID, "browser", "")
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
		a.revealCodingWorkspace(conversationID, "browser", "")
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
		a.revealCodingWorkspace(conversationID, "browser", "")
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
		a.revealCodingWorkspace(conversationID, "browser", "")
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
		a.revealCodingWorkspace(conversationID, "browser", "")
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
		a.revealCodingWorkspace(conversationID, "artifacts", "")
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
		a.revealCodingWorkspace(conversationID, "artifacts", preview.RelativePath)
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
		a.revealCodingWorkspace(conversationID, "artifacts", "")
		return encodeWorkspaceResult(map[string]any{"revealed": true})
	case "show_panel":
		panel := strings.TrimSpace(request.Panel)
		if panel == "" {
			panel = "browser"
		}
		if panel != "browser" && panel != "artifacts" && panel != "changes" && panel != "environment" {
			return "", fmt.Errorf("unknown Coding panel")
		}
		a.revealCodingWorkspace(conversationID, panel, "")
		return encodeWorkspaceResult(map[string]any{"panel": panel})
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

func (a *App) revealCodingWorkspace(conversationID, panel, artifactPath string) {
	if a.ctx == nil {
		return
	}
	a.emitDesktopEvent("coding-workspace.reveal", codingWorkspaceReveal{
		ConversationID: conversationID,
		Panel:          panel,
		ArtifactPath:   artifactPath,
	})
}

func encodeWorkspaceResult(value any) (string, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return "", err
	}
	return string(data), nil
}
