package main

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/browsercap"
)

func (a *App) RelaunchDesktopApp() (bool, error) {
	if a.host == nil {
		return false, fmt.Errorf("desktop host is unavailable")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	var started bool
	if err := a.host.Call(ctx, "app.relaunch", nil, &started); err != nil {
		return false, err
	}
	return started, nil
}

type desktopFileFilter struct {
	Name       string   `json:"name"`
	Extensions []string `json:"extensions"`
}

type desktopDialogOptions struct {
	Title       string              `json:"title"`
	DefaultPath string              `json:"defaultPath,omitempty"`
	Filters     []desktopFileFilter `json:"filters,omitempty"`
}

type desktopMessageOptions struct {
	Type          string   `json:"type"`
	Title         string   `json:"title"`
	Message       string   `json:"message"`
	Buttons       []string `json:"buttons"`
	DefaultButton int      `json:"defaultButton"`
	CancelButton  int      `json:"cancelButton"`
}

func (a *App) emitDesktopEvent(event string, value any) {
	if a.host != nil && a.ctx != nil {
		a.host.Emit(event, value)
	}
}

func (a *App) desktopCall(method string, payload, result any) error {
	if a.host == nil || a.ctx == nil {
		return errors.New("desktop host is not ready")
	}
	return a.host.Call(a.commandContext(), method, payload, result)
}

func (a *App) saveFile(options desktopDialogOptions) (string, error) {
	var path string
	err := a.desktopCall("dialog.save", options, &path)
	return path, err
}

func (a *App) openFile(options desktopDialogOptions) (string, error) {
	var path string
	err := a.desktopCall("dialog.openFile", options, &path)
	return path, err
}

func (a *App) openFiles(options desktopDialogOptions) ([]string, error) {
	var paths []string
	err := a.desktopCall("dialog.openFiles", options, &paths)
	return paths, err
}

func (a *App) openDirectory(options desktopDialogOptions) (string, error) {
	var path string
	err := a.desktopCall("dialog.openDirectory", options, &path)
	return path, err
}

func (a *App) showMessage(options desktopMessageOptions) (string, error) {
	var selection string
	err := a.desktopCall("dialog.message", options, &selection)
	return selection, err
}

func (a *App) openExternal(target string) error {
	return a.desktopCall("shell.openExternal", map[string]string{"url": target}, nil)
}

func (a *App) openPath(target string) error {
	return a.desktopCall("shell.openPath", map[string]string{"path": target}, nil)
}

type electronCodingHost struct {
	host desktopHost
}

func newElectronCodingHost(host desktopHost) browsercap.CodingHost {
	if host == nil {
		return nil
	}
	return &electronCodingHost{host: host}
}

func (h *electronCodingHost) Start(
	ctx context.Context,
	request browsercap.CodingHostStartRequest,
) (browsercap.CodingHostSession, error) {
	var session browsercap.CodingHostSession
	err := h.host.Call(ctx, "browser.start", request, &session)
	return session, err
}

func (h *electronCodingHost) call(method, sessionID string, payload any) error {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	request := map[string]any{"sessionId": strings.TrimSpace(sessionID)}
	if values, ok := payload.(map[string]any); ok {
		for key, value := range values {
			request[key] = value
		}
	}
	return h.host.Call(ctx, method, request, nil)
}

func (h *electronCodingHost) SetViewport(
	sessionID string,
	viewport browsercap.CodingViewport,
) error {
	return h.call("browser.setViewport", sessionID, map[string]any{"viewport": viewport})
}

func (h *electronCodingHost) Navigate(sessionID, target string) error {
	return h.call("browser.navigate", sessionID, map[string]any{"url": target})
}

func (h *electronCodingHost) Back(sessionID string) error {
	return h.call("browser.back", sessionID, nil)
}

func (h *electronCodingHost) Forward(sessionID string) error {
	return h.call("browser.forward", sessionID, nil)
}

func (h *electronCodingHost) Reload(sessionID string) error {
	return h.call("browser.reload", sessionID, nil)
}

func (h *electronCodingHost) list(method, sessionID string, payload map[string]any) (browsercap.CodingHostTabList, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	request := map[string]any{"sessionId": strings.TrimSpace(sessionID)}
	for key, value := range payload {
		request[key] = value
	}
	var tabs browsercap.CodingHostTabList
	err := h.host.Call(ctx, method, request, &tabs)
	return tabs, err
}

func (h *electronCodingHost) ListTabs(sessionID string) (browsercap.CodingHostTabList, error) {
	return h.list("browser.listTabs", sessionID, nil)
}

func (h *electronCodingHost) CreateTab(sessionID, targetURL string) (browsercap.CodingHostTabList, error) {
	return h.list("browser.createTab", sessionID, map[string]any{"url": targetURL})
}

func (h *electronCodingHost) ActivateTab(sessionID, tabID string) (browsercap.CodingHostTabList, error) {
	return h.list("browser.activateTab", sessionID, map[string]any{"tabId": tabID})
}

func (h *electronCodingHost) CloseTab(sessionID, tabID string) (browsercap.CodingHostTabList, error) {
	return h.list("browser.closeTab", sessionID, map[string]any{"tabId": tabID})
}

func (h *electronCodingHost) CloseAllTabs(sessionID string) (browsercap.CodingHostTabList, error) {
	return h.list("browser.closeAllTabs", sessionID, nil)
}

func (h *electronCodingHost) Stop(sessionID string) error {
	return h.call("browser.stop", sessionID, nil)
}

func (h *electronCodingHost) Close() {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	_ = h.host.Call(ctx, "browser.closeAll", struct{}{}, nil)
}
