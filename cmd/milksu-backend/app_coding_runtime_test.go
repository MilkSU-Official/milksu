package main

import (
	"errors"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/conversation"
)

func TestCompactionAllowsStoredHandoff(t *testing.T) {
	if compactionAllowsStoredHandoff(nil) {
		t.Fatal("nil error is not a stored handoff")
	}
	if !compactionAllowsStoredHandoff(errors.New("context compaction failed: Coding session not found: product-loop-1")) {
		t.Fatal("sidecar session-not-found should fall back to stored messages")
	}
	if !compactionAllowsStoredHandoff(errors.New("PI Sidecar is not running")) {
		t.Fatal("parked sidecar should fall back to stored messages")
	}
	if compactionAllowsStoredHandoff(errors.New("context compaction timed out after 30s")) {
		t.Fatal("timeout is not a stored handoff")
	}
}

func TestHandoffFromStoredConversationUsesTranscript(t *testing.T) {
	result := handoffFromStoredConversation(conversation.StoredConversation{
		Title: "product-loop coding-pi-handoff",
		Messages: []conversation.StoredMessage{
			{Role: "user", Content: "只回一句 READY。"},
			{Role: "assistant", Content: "READY"},
		},
	})
	if strings.TrimSpace(result.SessionID) == "" {
		t.Fatal("fallback handoff needs a new session id")
	}
	if !strings.Contains(result.Summary, "READY") || !strings.Contains(result.SurfaceText, "user:") {
		t.Fatalf("fallback summary %#v", result)
	}
}
