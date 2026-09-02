package main

import (
	"fmt"

	"github.com/MilkSU-Official/milksu/internal/sessionindex"
)

func (a *App) refreshSessionIndex() (sessionindex.RefreshResult, error) {
	if a.sessionIndex == nil {
		return sessionindex.RefreshResult{}, fmt.Errorf("session index is not ready")
	}
	conversations, err := a.conversations.List()
	if err != nil {
		return sessionindex.RefreshResult{}, err
	}
	return a.sessionIndex.RefreshMilkSUConversations(a.commandContext(), conversations)
}
