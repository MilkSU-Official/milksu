package main

import (
	"strings"
	"testing"
)

func TestComputerUseWorkspaceActionsNeedTheHostService(t *testing.T) {
	application := &App{}
	if _, err := application.handleCodingWorkspaceAction(
		"chat-computer-use",
		"list_computer_use_windows",
		"",
	); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("list without Computer Use service: %v", err)
	}
	if _, err := application.handleCodingWorkspaceAction(
		"chat-computer-use",
		"lock_computer_use_window",
		`{"targetPid":4242,"targetWindowId":9001}`,
	); err == nil || !strings.Contains(err.Error(), "unavailable") {
		t.Fatalf("lock without Computer Use service: %v", err)
	}
}
