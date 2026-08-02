package main

import (
	"context"
	"fmt"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/browsercap"
)

const (
	codingBrowserStartTimeout  = 20 * time.Second
	codingBrowserStatusTimeout = 4 * time.Second
)

// StartCodingBrowser creates an isolated, conversation-owned Chrome profile.
// The private CDP endpoint remains in the Go/Sidecar boundary.
func (a *App) StartCodingBrowser(
	conversationID,
	initialURL string,
) (browsercap.CodingBrowserStatus, error) {
	if a.browserBridge == nil {
		return browsercap.CodingBrowserStatus{}, fmt.Errorf("Coding browser service is unavailable")
	}
	initialURL = strings.TrimSpace(initialURL)
	if initialURL == "" {
		return browsercap.CodingBrowserStatus{}, fmt.Errorf("请输入要打开的 http 或 https 地址")
	}
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
	return status, nil
}

func (a *App) GetCodingBrowserStatus(
	conversationID string,
) (browsercap.CodingBrowserStatus, error) {
	if a.browserBridge == nil {
		return browsercap.CodingBrowserStatus{}, fmt.Errorf("Coding browser service is unavailable")
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
		return browsercap.CodingBrowserStatus{}, fmt.Errorf("Coding browser service is unavailable")
	}
	// Dispose the MCP client before stopping Chrome, while retaining the
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
