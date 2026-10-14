package main

import (
	"fmt"
	"os"

	"github.com/MilkSU-Official/milksu/internal/sessionindex"
)

// SessionIndexStatusPayload is the renderer-facing view of the Obelisk
// session index: where it lives, how large it is, and what it holds.
type SessionIndexStatusPayload struct {
	sessionindex.Status
	Bytes int64 `json:"bytes"`
}

func fileBytes(path string) int64 {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return 0
	}
	return info.Size()
}

func (a *App) GetSessionIndexStatus() (SessionIndexStatusPayload, error) {
	if a == nil || a.sessionIndex == nil {
		return SessionIndexStatusPayload{}, fmt.Errorf("session index is not ready")
	}
	status, err := a.sessionIndex.Status(a.commandContext())
	if err != nil {
		return SessionIndexStatusPayload{}, err
	}
	return SessionIndexStatusPayload{Status: status, Bytes: fileBytes(a.sessionIndex.Path)}, nil
}

func (a *App) RefreshSessionIndex() (sessionindex.RefreshResult, error) {
	if a == nil {
		return sessionindex.RefreshResult{}, fmt.Errorf("application is not ready")
	}
	return a.refreshSessionIndex()
}
