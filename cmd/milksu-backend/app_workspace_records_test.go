package main

import (
	"encoding/json"
	"path/filepath"
	"strings"
	"testing"

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

func TestWorkspaceRecordRejectsUnknownKind(t *testing.T) {
	application := &App{}
	if _, err := application.handleCodingWorkspaceAction("chat-one", "update_record", `{"kind":"settings","id":"x"}`); err == nil {
		t.Fatal("expected settings kind to be rejected")
	}
}
