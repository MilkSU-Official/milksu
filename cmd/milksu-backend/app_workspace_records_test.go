package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/lab"
)

func TestHandleWorkspaceRecordActionsRenameAndBatchArchive(t *testing.T) {
	t.Setenv(appdata.DirectoryOverrideEnv, filepath.Join(t.TempDir(), "appdata"))
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatalf("conversation.NewStore: %v", err)
	}
	labJobs, err := lab.NewStore()
	if err != nil {
		t.Fatalf("lab.NewStore: %v", err)
	}
	application := &App{conversations: conversations, labJobs: labJobs}
	if err := conversations.Save(conversation.StoredConversation{
		ID:        "chat-one",
		Title:     "旧会话",
		CreatedAt: 1,
		Messages:  []conversation.StoredMessage{},
	}); err != nil {
		t.Fatalf("save conversation: %v", err)
	}
	if err := labJobs.Save(lab.Job{
		ID:        "job-one",
		Title:     "测试",
		Scope:     "local",
		Request:   "扫一下本机进程",
		CreatedAt: 1,
		UpdatedAt: 1,
	}); err != nil {
		t.Fatalf("save lab job: %v", err)
	}
	if err := conversations.Save(conversation.StoredConversation{
		ID:        "lab-job-job-one",
		Title:     "测试",
		CreatedAt: 2,
		DomainTaskContext: map[string]any{
			"kind":    "lab",
			"jobId":   "job-one",
			"title":   "测试",
			"scope":   "local",
			"request": "扫一下本机进程",
		},
		Messages: []conversation.StoredMessage{},
	}); err != nil {
		t.Fatalf("save lab conversation: %v", err)
	}

	listed, err := application.handleCodingWorkspaceAction("chat-one", "list_records", `{"kind":"lab"}`)
	if err != nil {
		t.Fatalf("list_records: %v", err)
	}
	if !strings.Contains(listed, `"title":"测试"`) {
		t.Fatalf("lab list missing title: %s", listed)
	}

	updated, err := application.handleCodingWorkspaceAction("chat-one", "update_record", `{
		"kind":"lab",
		"id":"job-one",
		"title":"本地进程反病毒测试"
	}`)
	if err != nil {
		t.Fatalf("update_record lab: %v", err)
	}
	if !strings.Contains(updated, "本地进程反病毒测试") {
		t.Fatalf("lab rename result: %s", updated)
	}
	job, err := labJobs.Get("job-one")
	if err != nil || job.Title != "本地进程反病毒测试" {
		t.Fatalf("lab store title: %#v, %v", job, err)
	}
	bound, err := conversations.Get("lab-job-job-one")
	if err != nil || bound.Title != "本地进程反病毒测试" {
		t.Fatalf("bound conversation title: %#v, %v", bound, err)
	}

	if _, err := application.handleCodingWorkspaceAction("chat-one", "update_record", `{
		"kind":"conversation",
		"id":"chat-one",
		"title":"新的会话名"
	}`); err != nil {
		t.Fatalf("update_record conversation: %v", err)
	}
	renamed, err := conversations.Get("chat-one")
	if err != nil || renamed.Title != "新的会话名" {
		t.Fatalf("conversation title: %#v, %v", renamed, err)
	}

	if _, err := application.handleCodingWorkspaceAction("chat-one", "archive_records", `{
		"kind":"conversation",
		"ids":["chat-one"]
	}`); err != nil {
		t.Fatalf("archive_records: %v", err)
	}
	active, err := conversations.List()
	if err != nil {
		t.Fatalf("list conversations: %v", err)
	}
	for _, item := range active {
		if item.ID == "chat-one" {
			t.Fatalf("archived conversation remained active: %#v", item)
		}
	}

	focused, err := application.handleCodingWorkspaceAction("chat-one", "focus_record", `{
		"kind":"lab",
		"id":"job-one"
	}`)
	if err != nil {
		t.Fatalf("focus_record: %v", err)
	}
	var payload map[string]any
	if err := json.Unmarshal([]byte(focused), &payload); err != nil {
		t.Fatalf("decode focus: %v", err)
	}
	if payload["focused"] != true {
		t.Fatalf("focus payload: %#v", payload)
	}

	if _, err := application.handleCodingWorkspaceAction("chat-one", "create_record", `{
		"kind":"lab",
		"title":"第二项作业",
		"scope":"remote",
		"request":"探测授权主机"
	}`); err != nil {
		t.Fatalf("create_record lab: %v", err)
	}
	jobs, err := labJobs.List()
	if err != nil || len(jobs) != 2 {
		t.Fatalf("lab list after create: %#v, %v", jobs, err)
	}
}

func TestParseNVDCVECandidatesKeepsPublicIDs(t *testing.T) {
	body := `{
		"vulnerabilities": [
			{
				"cve": {
					"id": "CVE-2024-3400",
					"descriptions": [
						{"lang": "en", "value": "A PAN-OS command injection vulnerability."}
					]
				}
			}
		]
	}`
	candidates := parseNVDCVECandidates(body, 10)
	if len(candidates) != 1 || candidates[0]["id"] != "CVE-2024-3400" {
		t.Fatalf("candidates: %#v", candidates)
	}
	if !strings.Contains(candidates[0]["summary"].(string), "command injection") {
		t.Fatalf("summary: %#v", candidates[0])
	}
}

func TestWorkspaceRecordFilterPinForkAndConfirmedDelete(t *testing.T) {
	t.Setenv(appdata.DirectoryOverrideEnv, filepath.Join(t.TempDir(), "appdata"))
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatalf("conversation.NewStore: %v", err)
	}
	labJobs, err := lab.NewStore()
	if err != nil {
		t.Fatalf("lab.NewStore: %v", err)
	}
	application := &App{conversations: conversations, labJobs: labJobs}
	now := time.Now().UnixMilli()
	old := time.Now().Add(-10 * 24 * time.Hour).UnixMilli()
	pinned := true
	order := int64(1)
	if err := conversations.Save(conversation.StoredConversation{
		ID:            "old-chat",
		Title:         "旧会话",
		WorkspacePath: "ws-alpha",
		CreatedAt:     uint64(old),
		Messages: []conversation.StoredMessage{{
			ID: "m1", Role: "user", Content: "keep this transcript", Timestamp: uint64(old),
		}},
	}); err != nil {
		t.Fatalf("save old: %v", err)
	}
	if err := conversations.Save(conversation.StoredConversation{
		ID:            "new-chat",
		Title:         "新会话",
		WorkspacePath: "ws-beta",
		CreatedAt:     uint64(now),
		Pinned:        pinned,
		PinnedOrder:   &order,
		Messages:      []conversation.StoredMessage{},
	}); err != nil {
		t.Fatalf("save new: %v", err)
	}
	if err := labJobs.Save(lab.Job{
		ID: "job-filter", Title: "实验室任务", Scope: "local", Request: "探测", CreatedAt: 1, UpdatedAt: 1,
	}); err != nil {
		t.Fatalf("save lab: %v", err)
	}

	if _, err := application.handleCodingWorkspaceAction("", "list_records", `{"workspacePath":"ws-alpha"}`); err != nil {
		t.Fatalf("record list without conversationId: %v", err)
	}
	byPath, err := application.handleCodingWorkspaceAction("actor", "list_records", `{"workspacePath":"ws-alpha"}`)
	if err != nil {
		t.Fatalf("list by path: %v", err)
	}
	if !strings.Contains(byPath, "old-chat") || strings.Contains(byPath, "new-chat") || strings.Contains(byPath, "实验室任务") {
		t.Fatalf("path filter: %s", byPath)
	}
	unpinned, err := application.handleCodingWorkspaceAction("actor", "list_records", `{"unpinned":true}`)
	if err != nil {
		t.Fatalf("list unpinned: %v", err)
	}
	if !strings.Contains(unpinned, "old-chat") || strings.Contains(unpinned, "new-chat") || strings.Contains(unpinned, "实验室任务") {
		t.Fatalf("unpinned filter: %s", unpinned)
	}
	aged, err := application.handleCodingWorkspaceAction("actor", "list_records", `{"olderThanDays":7}`)
	if err != nil {
		t.Fatalf("list aged: %v", err)
	}
	if !strings.Contains(aged, "old-chat") || strings.Contains(aged, "new-chat") {
		t.Fatalf("age filter: %s", aged)
	}
	if _, err := application.handleCodingWorkspaceAction("actor", "list_records", `{"kind":"lab","unpinned":true}`); err == nil {
		t.Fatal("conversation filters should not apply to lab records")
	}

	if _, err := application.handleCodingWorkspaceAction("actor", "pin_records", `{
		"kind":"conversation",
		"ids":["old-chat"],
		"pinned":true
	}`); err != nil {
		t.Fatalf("pin: %v", err)
	}
	pinnedRow, err := conversations.Get("old-chat")
	if err != nil || !pinnedRow.Pinned || pinnedRow.PinnedOrder == nil {
		t.Fatalf("pinned row: %#v, %v", pinnedRow, err)
	}

	preview, err := application.handleCodingWorkspaceAction("actor", "delete_records", `{
		"kind":"conversation",
		"ids":["new-chat"]
	}`)
	if err != nil {
		t.Fatalf("delete preview: %v", err)
	}
	var pending struct {
		NeedsConfirmation bool   `json:"needsConfirmation"`
		ConfirmationToken string `json:"confirmationToken"`
	}
	if err := json.Unmarshal([]byte(preview), &pending); err != nil {
		t.Fatalf("preview json: %v", err)
	}
	if !pending.NeedsConfirmation || pending.ConfirmationToken == "" {
		t.Fatalf("preview: %s", preview)
	}
	if _, err := conversations.Get("new-chat"); err != nil {
		t.Fatal("preview deleted the conversation")
	}
	if _, err := application.handleCodingWorkspaceAction("actor", "delete_records", `{
		"kind":"conversation",
		"ids":["old-chat"],
		"confirmationToken":"not-the-grant"
	}`); err == nil {
		t.Fatal("model-supplied token should not delete")
	}
	if _, err := conversations.Get("old-chat"); err != nil {
		t.Fatal("rejected token deleted a conversation")
	}
	deleted, err := application.handleCodingWorkspaceAction("actor", "delete_records", `{
		"kind":"conversation",
		"confirmationToken":"`+pending.ConfirmationToken+`"
	}`)
	if err != nil {
		t.Fatalf("commit delete: %v", err)
	}
	if !strings.Contains(deleted, `"deleted":true`) {
		t.Fatalf("delete result: %s", deleted)
	}
	if _, err := conversations.Get("new-chat"); err == nil {
		t.Fatal("confirmed delete left the conversation")
	}
	if _, err := application.handleCodingWorkspaceAction("actor", "delete_records", `{
		"kind":"conversation",
		"confirmationToken":"`+pending.ConfirmationToken+`"
	}`); err == nil {
		t.Fatal("confirmation token should be single use")
	}

	forked, err := application.handleCodingWorkspaceAction("actor", "fork_record", `{
		"kind":"conversation",
		"id":"old-chat"
	}`)
	if err != nil {
		t.Fatalf("fork: %v", err)
	}
	var forkPayload struct {
		Source string `json:"source"`
		Record struct {
			ID string `json:"id"`
		} `json:"record"`
	}
	if err := json.Unmarshal([]byte(forked), &forkPayload); err != nil {
		t.Fatalf("fork json: %v", err)
	}
	if forkPayload.Source != "old-chat" || forkPayload.Record.ID == "" || forkPayload.Record.ID == "old-chat" {
		t.Fatalf("fork payload: %s", forked)
	}
	clone, err := conversations.Get(forkPayload.Record.ID)
	if err != nil {
		t.Fatalf("forked row: %v", err)
	}
	if len(clone.Messages) != 0 || clone.WorkspacePath != "ws-alpha" || clone.Pinned {
		t.Fatalf("forked row: %#v", clone)
	}
	source, err := conversations.Get("old-chat")
	if err != nil || len(source.Messages) != 1 {
		t.Fatalf("source transcript changed: %#v, %v", source, err)
	}
}

func TestWorkspaceSessionActionRequiresConversation(t *testing.T) {
	application := &App{}
	_, err := application.handleCodingWorkspaceAction("", "list_background_tasks", `{}`)
	if err == nil || !strings.Contains(err.Error(), "conversationId") {
		t.Fatalf("session action: %v", err)
	}
	_, err = application.handleCodingWorkspaceAction("", "not_a_workspace_action", `{}`)
	if err == nil || !strings.Contains(err.Error(), "conversationId") {
		t.Fatalf("unknown action without conversationId: %v", err)
	}
}

func TestWorkspaceRecordActionsMatchToolList(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "sidecar", "pi", "bridge-workspace.js"))
	if err != nil {
		t.Fatalf("read tool list: %v", err)
	}
	const marker = "export const codingWorkspaceRecordActions = Object.freeze(["
	text := string(data)
	start := strings.Index(text, marker)
	if start < 0 {
		t.Fatal("codingWorkspaceRecordActions is missing from the workspace tool")
	}
	rest := text[start+len(marker):]
	end := strings.Index(rest, "]);")
	if end < 0 {
		t.Fatal("codingWorkspaceRecordActions is not closed")
	}
	var names []string
	for _, line := range strings.Split(rest[:end], "\n") {
		line = strings.TrimSpace(strings.Trim(strings.TrimSpace(line), ","))
		line = strings.Trim(line, `"`)
		if line == "" {
			continue
		}
		names = append(names, line)
	}
	if strings.Join(names, "\n") != strings.Join(codingWorkspaceRecordActions, "\n") {
		t.Fatalf("tool record actions:\n%s\ngo record actions:\n%s", strings.Join(names, "\n"), strings.Join(codingWorkspaceRecordActions, "\n"))
	}
}

func TestCompanionCoreRecordStory(t *testing.T) {
	t.Setenv(appdata.DirectoryOverrideEnv, filepath.Join(t.TempDir(), "appdata"))
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatalf("conversation.NewStore: %v", err)
	}
	application := &App{conversations: conversations}
	now := time.Now()
	clickPath := filepath.Join(t.TempDir(), "click")
	expressPath := filepath.Join(t.TempDir(), "express")
	seed := []conversation.StoredConversation{
		coreStory("product-loop-core-click", "click.edit 在 Windows 上大约一半失败", now.Add(-30*time.Hour), clickPath, "WinError 87，edit_files，shlex.split。"),
		coreStory("product-loop-core-express", "res.send(ArrayBuffer) 发出的是空对象", now.Add(-24*time.Hour), expressPath, "ArrayBuffer 走了 application/json。"),
		coreStory("product-loop-core-print", "pagesPerSheet 仍是一页一张", now.Add(-36*time.Hour), "", "pagesPerSheet 设成 2，打出来仍是一页一张。"),
		coreStory("product-loop-core-minsize", "setMinimumSize 没有立刻从 500 变成 700", now.Add(-72*time.Hour), "", "setMinimumSize(700, 700) 没有让 500 立刻变成 700。"),
		coreStory("product-loop-core-pickup", "周末去接孩子", now.Add(-10*time.Hour), "", "周六下午六点去学校接孩子。"),
	}
	for _, row := range seed {
		if err := conversations.Save(row); err != nil {
			t.Fatalf("save %s: %v", row.ID, err)
		}
	}

	stale, err := application.handleCodingWorkspaceAction("", "list_records", `{"kind":"conversation","olderThanDays":2}`)
	if err != nil {
		t.Fatalf("list stale: %v", err)
	}
	if !strings.Contains(stale, "product-loop-core-minsize") || strings.Contains(stale, "product-loop-core-print") || strings.Contains(stale, "product-loop-core-click") {
		t.Fatalf("two-day filter: %s", stale)
	}
	if _, err := application.handleCodingWorkspaceAction("", "archive_records", `{
		"kind":"conversation",
		"ids":["product-loop-core-minsize","product-loop-core-print"]
	}`); err != nil {
		t.Fatalf("archive stale: %v", err)
	}
	if _, err := conversations.Get("product-loop-core-minsize"); err == nil {
		t.Fatal("minsize stayed active")
	}
	if _, err := application.handleCodingWorkspaceAction("", "pin_records", `{
		"kind":"conversation",
		"ids":["product-loop-core-pickup"],
		"pinned":true
	}`); err != nil {
		t.Fatalf("pin pickup: %v", err)
	}
	pickup, err := conversations.Get("product-loop-core-pickup")
	if err != nil || !pickup.Pinned {
		t.Fatalf("pickup pin: %#v %v", pickup, err)
	}
	click, err := conversations.Get("product-loop-core-click")
	if err != nil || click.Pinned || len(click.Messages) == 0 {
		t.Fatalf("click should stay unpinned with its transcript: %#v %v", click, err)
	}
	preview, err := application.handleCodingWorkspaceAction("", "delete_records", `{
		"kind":"conversation",
		"archived":true,
		"ids":["product-loop-core-print"]
	}`)
	if err != nil {
		t.Fatalf("delete preview: %v", err)
	}
	if !strings.Contains(preview, "pagesPerSheet") || !strings.Contains(preview, "needsConfirmation") {
		t.Fatalf("preview: %s", preview)
	}
	var pending struct {
		ConfirmationToken string `json:"confirmationToken"`
	}
	if err := json.Unmarshal([]byte(preview), &pending); err != nil || pending.ConfirmationToken == "" {
		t.Fatalf("preview token: %v %s", err, preview)
	}
	archived, err := conversations.ListArchived()
	if err != nil {
		t.Fatalf("list archived: %v", err)
	}
	if !containsConversation(archived, "product-loop-core-print") {
		t.Fatal("print was deleted before confirmation")
	}
	forked, err := application.handleCodingWorkspaceAction("", "fork_record", `{
		"kind":"conversation",
		"id":"product-loop-core-click"
	}`)
	if err != nil {
		t.Fatalf("fork: %v", err)
	}
	var forkPayload struct {
		Record struct {
			ID string `json:"id"`
		} `json:"record"`
	}
	if err := json.Unmarshal([]byte(forked), &forkPayload); err != nil {
		t.Fatalf("fork json: %v", err)
	}
	clone, err := conversations.Get(forkPayload.Record.ID)
	if err != nil || len(clone.Messages) != 0 || clone.WorkspacePath != clickPath {
		t.Fatalf("fork clone: %#v %v", clone, err)
	}
	source, err := conversations.Get("product-loop-core-click")
	if err != nil || len(source.Messages) == 0 {
		t.Fatalf("fork emptied the source: %#v %v", source, err)
	}
	if _, err := application.handleCodingWorkspaceAction("", "delete_records", `{
		"kind":"conversation",
		"archived":true,
		"confirmationToken":"`+pending.ConfirmationToken+`"
	}`); err != nil {
		t.Fatalf("confirm delete: %v", err)
	}
	archived, err = conversations.ListArchived()
	if err != nil || containsConversation(archived, "product-loop-core-print") {
		t.Fatal("confirmed delete left the print conversation")
	}
}

func coreStory(id, title string, at time.Time, workspace, body string) conversation.StoredConversation {
	stamp := uint64(at.UnixMilli())
	row := conversation.StoredConversation{
		ID:        id,
		Title:     title,
		CreatedAt: stamp,
		Messages: []conversation.StoredMessage{{
			ID: id + "-m", Role: "user", Content: body, Timestamp: stamp,
		}},
	}
	if workspace != "" {
		row.WorkspacePath = workspace
	}
	return row
}

func containsConversation(rows []conversation.StoredConversation, id string) bool {
	for _, row := range rows {
		if row.ID == id {
			return true
		}
	}
	return false
}

func TestWorkspaceRecordRejectsUnknownKind(t *testing.T) {
	application := &App{}
	if _, err := application.handleCodingWorkspaceAction("chat-one", "update_record", `{"kind":"settings","id":"x"}`); err == nil {
		t.Fatal("expected settings kind to be rejected")
	}
}
