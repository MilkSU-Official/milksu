package conversation

import (
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func TestConversationIDRejectsPaths(t *testing.T) {
	invalid := []string{"", "../settings", "a/b", "a b", "."}
	for _, id := range invalid {
		if validID.MatchString(id) {
			t.Fatalf("expected %q to be rejected", id)
		}
	}
}

func TestConversationIDAcceptsUUID(t *testing.T) {
	if !validID.MatchString("bb97144e-64b2-4bcc-a07f-4f5b3f9f8aa1") {
		t.Fatal("expected UUID to be accepted")
	}
}

func TestStoreGetReturnsTheSavedConversation(t *testing.T) {
	store := &Store{directory: t.TempDir()}
	if _, err := store.Get("conversation-1"); err == nil {
		t.Fatal("expected a missing conversation to be rejected")
	}
	want := StoredConversation{
		ID:            "conversation-1",
		Title:         "浏览器证据",
		CreatedAt:     42,
		WorkspacePath: "/tmp/milksu-workspace",
		LastContextUsage: &StoredContextUsage{
			InputTokens:     40000,
			OutputTokens:    1200,
			CacheReadTokens: 10000,
			TotalTokens:     51200,
			ContextWindow:   500000,
			Model:           "grok-4.6",
			RecordedAt:      42,
		},
		Messages: []StoredMessage{},
	}
	if err := store.Save(want); err != nil {
		t.Fatalf("save conversation: %v", err)
	}
	got, err := store.Get("conversation-1")
	if err != nil {
		t.Fatalf("get conversation: %v", err)
	}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("conversation did not round-trip: %#v", got)
	}
}

func TestStoreArchivesRestoresAndPermanentlyDeletesConversation(t *testing.T) {
	store := &Store{directory: t.TempDir()}
	want := StoredConversation{
		ID:        "conversation-archive",
		Title:     "需要稍后继续",
		CreatedAt: 42,
		Messages: []StoredMessage{{
			ID: "message-1", Role: "user", Content: "保留上下文", Timestamp: 43,
		}},
	}
	if err := store.Save(want); err != nil {
		t.Fatalf("save conversation: %v", err)
	}
	if err := store.Archive(want.ID); err != nil {
		t.Fatalf("archive conversation: %v", err)
	}
	active, err := store.List()
	if err != nil || len(active) != 0 {
		t.Fatalf("archived conversation remained active: %#v, %v", active, err)
	}
	archived, err := store.ListArchived()
	if err != nil || len(archived) != 1 || archived[0].ArchivedAt == 0 {
		t.Fatalf("archived conversation was not listed: %#v, %v", archived, err)
	}
	if !reflect.DeepEqual(archived[0].Messages, want.Messages) {
		t.Fatalf("archive did not preserve messages: %#v", archived[0].Messages)
	}
	if err := store.Restore(want.ID); err != nil {
		t.Fatalf("restore conversation: %v", err)
	}
	restored, err := store.Get(want.ID)
	if err != nil || restored.ArchivedAt != 0 || !reflect.DeepEqual(restored.Messages, want.Messages) {
		t.Fatalf("restored conversation is invalid: %#v, %v", restored, err)
	}
	if err := store.Archive(want.ID); err != nil {
		t.Fatalf("archive conversation again: %v", err)
	}
	if err := store.DeleteArchived(want.ID); err != nil {
		t.Fatalf("delete archived conversation: %v", err)
	}
	archived, err = store.ListArchived()
	if err != nil || len(archived) != 0 {
		t.Fatalf("deleted archived conversation remained: %#v, %v", archived, err)
	}
}

func TestStoreGetRejectsAMismatchedStoredConversation(t *testing.T) {
	store := &Store{directory: t.TempDir()}
	if err := os.WriteFile(
		filepath.Join(store.directory, "conversation-1.json"),
		[]byte(`{"id":"conversation-2","messages":[]}`),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Get("conversation-1"); err == nil {
		t.Fatal("expected a mismatched stored conversation to be rejected")
	}
}

func TestStorePreservesCTFLearningContext(t *testing.T) {
	store := &Store{directory: t.TempDir()}
	toolName := "bash"
	toolCallID := "call-1"
	durationMS := int64(1250)
	status := "done"
	approvalRequestID := "approval-1"
	approvalInput := `{"command":"npm test"}`
	approvalState := "approved"
	approvalReason := "approved by user"
	want := StoredConversation{
		ID:             "ctf_019fb283",
		Title:          "NSSCTF P316",
		CreatedAt:      42,
		WorkspacePath:  "/tmp/milksu-ctf",
		ExecutionMode:  "go",
		ApprovalPolicy: "workspace-auto",
		AgentCapabilities: []StoredCapability{{
			ID: "workspace-write", Label: "工作区写入", Status: "allowed", Detail: "workspace only",
		}},
		CTFJobID: "job-316",
		CTFMode:  "coach",
		Messages: []StoredMessage{{
			ID: "message-1", Role: "user", Content: "先帮我梳理题面", Timestamp: 43,
			Attachments: []StoredAttachment{{
				ID:   "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
				Name: "evidence.png", MediaType: "image/png", Size: 42,
				SHA256: "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
			}},
		}, {
			ID:                "message-2",
			Role:              "tool",
			Content:           "$ npm test",
			Timestamp:         44,
			ToolName:          &toolName,
			ToolCallID:        &toolCallID,
			DurationMS:        &durationMS,
			Status:            &status,
			ApprovalRequestID: &approvalRequestID,
			ApprovalInput:     &approvalInput,
			ApprovalState:     &approvalState,
			ApprovalReason:    &approvalReason,
		}},
	}
	if err := store.Save(want); err != nil {
		t.Fatalf("save CTF conversation: %v", err)
	}
	got, err := store.List()
	if err != nil {
		t.Fatalf("list CTF conversations: %v", err)
	}
	if len(got) != 1 || !reflect.DeepEqual(got[0], want) {
		t.Fatalf("CTF learning context did not round-trip: %#v", got)
	}
}
