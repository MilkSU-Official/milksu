package conversation

import (
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

func TestStorePreservesCTFLearningContext(t *testing.T) {
	store := &Store{directory: t.TempDir()}
	toolName := "bash"
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
		}, {
			ID:                "message-2",
			Role:              "tool",
			Content:           "$ npm test",
			Timestamp:         44,
			ToolName:          &toolName,
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
