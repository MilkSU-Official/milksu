package main

import (
	"path/filepath"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/conversation"
)

func newAttachmentTestApp(t *testing.T) *App {
	t.Helper()
	t.Setenv(appdata.DirectoryOverrideEnv, filepath.Join(t.TempDir(), "appdata"))
	store, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	return &App{conversations: store}
}

func attachmentFixture() []conversation.StoredAttachment {
	return []conversation.StoredAttachment{{
		ID:        "file-1",
		Name:      "loop.txt",
		MediaType: "text/plain",
		Size:      12,
		SHA256:    "abc",
	}}
}

// A direct SendMessage RPC turn stores its user message only through
// rememberSentAttachments. The composer's later whole-list save must not drop
// it, otherwise the attachment turn reads back as attached=false.
func TestSaveConversationPreservesRememberedAttachmentMessage(t *testing.T) {
	app := newAttachmentTestApp(t)
	existing := conversation.StoredConversation{
		ID:        "conv-183",
		Title:     "t",
		CreatedAt: 1,
		Messages: []conversation.StoredMessage{
			{ID: "a1", Role: "assistant", Content: "reply", Timestamp: 400},
			{ID: "att-1", Role: "user", Content: "看下这个文件", Timestamp: 300, Attachments: attachmentFixture()},
			{ID: "t1", Role: "tool", Content: "read loop.txt", Timestamp: 350},
		},
	}
	if err := app.conversations.Save(existing); err != nil {
		t.Fatal(err)
	}
	// The frontend list never carries the synthetic user message.
	incoming := existing
	incoming.Messages = []conversation.StoredMessage{
		{ID: "a1", Role: "assistant", Content: "reply", Timestamp: 400},
		{ID: "t1", Role: "tool", Content: "read loop.txt", Timestamp: 350},
	}
	if err := app.SaveConversation(incoming); err != nil {
		t.Fatal(err)
	}
	stored, err := app.conversations.Get("conv-183")
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Messages) != 3 {
		t.Fatalf("messages = %d, want 3 (attachment user message preserved)", len(stored.Messages))
	}
	if stored.Messages[0].ID != "att-1" || len(stored.Messages[0].Attachments) != 1 {
		t.Fatalf("first message = %+v, want the remembered attachment message in timestamp order", stored.Messages[0])
	}
}

// A whole-list save that carries the user message but lost its attachments
// (stale composer state) gets them back from the stored record.
func TestSaveConversationRestoresAttachmentsOntoMatchingMessage(t *testing.T) {
	app := newAttachmentTestApp(t)
	existing := conversation.StoredConversation{
		ID:        "conv-183b",
		Title:     "t",
		CreatedAt: 1,
		Messages: []conversation.StoredMessage{
			{ID: "u1", Role: "user", Content: "看下这个文件", Timestamp: 100, Attachments: attachmentFixture()},
			{ID: "a1", Role: "assistant", Content: "reply", Timestamp: 200},
		},
	}
	if err := app.conversations.Save(existing); err != nil {
		t.Fatal(err)
	}
	incoming := existing
	incoming.Messages = []conversation.StoredMessage{
		{ID: "u1", Role: "user", Content: "看下这个文件", Timestamp: 100},
		{ID: "a1", Role: "assistant", Content: "reply", Timestamp: 200},
	}
	if err := app.SaveConversation(incoming); err != nil {
		t.Fatal(err)
	}
	stored, err := app.conversations.Get("conv-183b")
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Messages[0].Attachments) != 1 {
		t.Fatalf("user message attachments = %+v, want the stored set restored", stored.Messages[0].Attachments)
	}
}

// TestSaveConversationKeepsEditResendTruncation 的相邻场景：回合刚开始时前端
// 会用空消息列表做一次元数据保存，这条不能把 rememberSentAttachments 补的
// 附件用户消息冲掉。
func TestSaveConversationKeepsAttachmentMessageAcrossEmptySave(t *testing.T) {
	app := newAttachmentTestApp(t)
	existing := conversation.StoredConversation{
		ID:        "conv-183d",
		Title:     "t",
		CreatedAt: 1,
		Messages: []conversation.StoredMessage{
			{ID: "att-1", Role: "user", Content: "看下这个文件", Timestamp: 300, Attachments: attachmentFixture()},
		},
	}
	if err := app.conversations.Save(existing); err != nil {
		t.Fatal(err)
	}
	incoming := existing
	incoming.Messages = nil
	if err := app.SaveConversation(incoming); err != nil {
		t.Fatal(err)
	}
	stored, err := app.conversations.Get("conv-183d")
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Messages) != 1 || len(stored.Messages[0].Attachments) != 1 {
		t.Fatalf("messages = %+v, want the attachment message to survive the empty save", stored.Messages)
	}
}

// Edit-resend truncates the tail on purpose; a dropped attachment message
// newer than every incoming message must stay dropped.
func TestSaveConversationKeepsEditResendTruncation(t *testing.T) {
	app := newAttachmentTestApp(t)
	existing := conversation.StoredConversation{
		ID:        "conv-183c",
		Title:     "t",
		CreatedAt: 1,
		Messages: []conversation.StoredMessage{
			{ID: "u1", Role: "user", Content: "第一问", Timestamp: 100},
			{ID: "a1", Role: "assistant", Content: "答", Timestamp: 200},
			{ID: "att-9", Role: "user", Content: "带附件的一问", Timestamp: 300, Attachments: attachmentFixture()},
		},
	}
	if err := app.conversations.Save(existing); err != nil {
		t.Fatal(err)
	}
	incoming := existing
	incoming.Messages = []conversation.StoredMessage{
		{ID: "u1", Role: "user", Content: "第一问（改）", Timestamp: 100},
	}
	if err := app.SaveConversation(incoming); err != nil {
		t.Fatal(err)
	}
	stored, err := app.conversations.Get("conv-183c")
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.Messages) != 1 {
		t.Fatalf("messages = %+v, want only the edited message after truncation", stored.Messages)
	}
}
