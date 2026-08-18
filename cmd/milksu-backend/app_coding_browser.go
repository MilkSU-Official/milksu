package main

import (
	"context"
	"fmt"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/browsercap"
	"github.com/MilkSU-Official/milksu/internal/codingevidence"
)

const (
	codingBrowserStartTimeout  = 20 * time.Second
	codingBrowserStatusTimeout = 4 * time.Second
)

// StartCodingBrowser creates a conversation-owned Chromium view inside the
// MilkSU window. The private CDP endpoint remains in the Go/Sidecar boundary.
func (a *App) StartCodingBrowser(
	conversationID,
	initialURL string,
) (browsercap.CodingBrowserStatus, error) {
	if a.browserBridge == nil {
		return browsercap.CodingBrowserStatus{}, fmt.Errorf("浏览器服务不可用")
	}
	initialURL = strings.TrimSpace(initialURL)
	startContext, cancel := context.WithTimeout(
		a.commandContext(),
		codingBrowserStartTimeout,
	)
	defer cancel()
	status, err := a.browserBridge.StartCoding(
		startContext,
		conversationID,
		initialURL,
	)
	if err != nil {
		return browsercap.CodingBrowserStatus{}, err
	}
	a.diagnostics.Record("coding-browser", "info", "isolated Coding browser started")
	a.emitDesktopEvent("coding-browser.ready", status)
	return status, nil
}

func (a *App) EnsureCodingBrowser(
	conversationID string,
) (browsercap.CodingBrowserStatus, error) {
	if a.browserBridge == nil {
		return browsercap.CodingBrowserStatus{}, fmt.Errorf("浏览器服务不可用")
	}
	if descriptor, enabled := a.browserBridge.CodingDescriptor(conversationID); enabled && descriptor.SessionID != "" {
		statusContext, cancel := context.WithTimeout(
			a.commandContext(),
			codingBrowserStatusTimeout,
		)
		defer cancel()
		return a.browserBridge.CodingStatus(statusContext, conversationID)
	}
	startContext, cancel := context.WithTimeout(
		a.commandContext(),
		codingBrowserStartTimeout,
	)
	defer cancel()
	status, err := a.browserBridge.EnsureCoding(startContext, conversationID)
	if err != nil {
		return browsercap.CodingBrowserStatus{}, err
	}
	a.diagnostics.Record("coding-browser", "info", "isolated Coding browser ready")
	a.emitDesktopEvent("coding-browser.ready", status)
	return status, nil
}

func (a *App) SetCodingBrowserViewport(
	conversationID string,
	x,
	y,
	width,
	height float64,
	visible bool,
) error {
	if a.browserBridge == nil {
		return fmt.Errorf("浏览器服务不可用")
	}
	return a.browserBridge.SetCodingViewport(
		conversationID,
		browsercap.CodingViewport{
			X: x, Y: y, Width: width, Height: height, Visible: visible,
		},
	)
}

func (a *App) NavigateCodingBrowser(conversationID, targetURL string) error {
	if a.browserBridge == nil {
		return fmt.Errorf("浏览器服务不可用")
	}
	targetURL = strings.TrimSpace(targetURL)
	if targetURL == "" {
		return fmt.Errorf("请输入要打开的 http 或 https 地址")
	}
	return a.browserBridge.NavigateCoding(conversationID, targetURL)
}

func (a *App) CodingBrowserGoBack(conversationID string) error {
	if a.browserBridge == nil {
		return fmt.Errorf("浏览器服务不可用")
	}
	return a.browserBridge.BackCoding(conversationID)
}

func (a *App) CodingBrowserGoForward(conversationID string) error {
	if a.browserBridge == nil {
		return fmt.Errorf("浏览器服务不可用")
	}
	return a.browserBridge.ForwardCoding(conversationID)
}

func (a *App) ReloadCodingBrowser(conversationID string) error {
	if a.browserBridge == nil {
		return fmt.Errorf("浏览器服务不可用")
	}
	return a.browserBridge.ReloadCoding(conversationID)
}

func (a *App) CreateCodingBrowserTab(
	conversationID,
	targetURL string,
) (browsercap.CodingBrowserStatus, error) {
	if a.browserBridge == nil {
		return browsercap.CodingBrowserStatus{}, fmt.Errorf("浏览器服务不可用")
	}
	return a.browserBridge.CreateCodingTab(conversationID, targetURL)
}

func (a *App) ActivateCodingBrowserTab(
	conversationID,
	tabID string,
) (browsercap.CodingBrowserStatus, error) {
	if a.browserBridge == nil {
		return browsercap.CodingBrowserStatus{}, fmt.Errorf("浏览器服务不可用")
	}
	return a.browserBridge.ActivateCodingTab(conversationID, tabID)
}

func (a *App) CloseCodingBrowserTab(
	conversationID,
	tabID string,
) (browsercap.CodingBrowserStatus, error) {
	if a.browserBridge == nil {
		return browsercap.CodingBrowserStatus{}, fmt.Errorf("浏览器服务不可用")
	}
	return a.browserBridge.CloseCodingTab(conversationID, tabID)
}

func (a *App) GetCodingBrowserStatus(
	conversationID string,
) (browsercap.CodingBrowserStatus, error) {
	if a.browserBridge == nil {
		return browsercap.CodingBrowserStatus{}, fmt.Errorf("浏览器服务不可用")
	}
	statusContext, cancel := context.WithTimeout(
		a.commandContext(),
		codingBrowserStatusTimeout,
	)
	defer cancel()
	return a.browserBridge.CodingStatus(statusContext, conversationID)
}

func (a *App) StopCodingBrowser(
	conversationID string,
) (browsercap.CodingBrowserStatus, error) {
	if a.browserBridge == nil {
		return browsercap.CodingBrowserStatus{}, fmt.Errorf("浏览器服务不可用")
	}
	// Dispose the MCP client before stopping Chromium, while retaining the
	// persisted Pi conversation for the next turn.
	a.engines.DetachSession(conversationID)
	if err := a.browserBridge.StopCoding(conversationID); err != nil {
		return browsercap.CodingBrowserStatus{}, err
	}
	a.diagnostics.Record("coding-browser", "info", "isolated Coding browser stopped")
	return browsercap.CodingBrowserStatus{
		Enabled:        false,
		ConversationID: strings.TrimSpace(conversationID),
		Phase:          "disabled",
	}, nil
}

// RevealCodingBrowserEvidence derives the exact evidence directory for the
// current Coding conversation from trusted backend state only (the live
// isolated Coding Browser session plus either the conversation's persisted
// workspace or MilkSU's fixed temporary workspace) and reveals it in Finder.
// The frontend/model never supplies an evidence path, workspace or session id;
// every inconsistency is rejected before any directory is opened.
func (a *App) RevealCodingBrowserEvidence(conversationID string) error {
	if a.ctx == nil {
		return fmt.Errorf("desktop runtime is not ready")
	}
	if a.browserBridge == nil {
		return fmt.Errorf("浏览器服务不可用")
	}
	sessionID, err := a.browserBridge.CodingEvidenceSessionID(conversationID)
	if err != nil {
		return err
	}
	saved, err := a.conversations.Get(conversationID)
	if err != nil {
		return fmt.Errorf("读取会话工作区: %w", err)
	}
	workspace, err := codingBrowserEvidenceWorkspace(
		saved.WorkspacePath,
		a.dataDirectory,
	)
	if err != nil {
		return err
	}
	directory, err := codingevidence.Derive(codingevidence.Request{
		ConversationID: conversationID,
		SessionID:      sessionID,
		Workspace:      workspace,
	})
	if err != nil {
		return err
	}
	if err := codingevidence.RevealInFinder(
		directory,
		codingevidence.MacOSFinderOpen,
	); err != nil {
		return err
	}
	a.diagnostics.Record(
		"coding-browser",
		"info",
		"browser evidence directory revealed in Finder",
	)
	return nil
}

func codingBrowserEvidenceWorkspace(savedWorkspace, dataDirectory string) (string, error) {
	if workspace := strings.TrimSpace(savedWorkspace); workspace != "" {
		return workspace, nil
	}
	dataDirectory = strings.TrimSpace(dataDirectory)
	if dataDirectory == "" {
		return "", fmt.Errorf("MilkSU 临时工作区不可用")
	}
	return filepath.Join(dataDirectory, "agent-workspace"), nil
}
