package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/envbroker"
	"github.com/MilkSU-Official/milksu/internal/lab"
)

type downCompose struct{}

func (downCompose) LookPath(name string) (string, error) {
	if name == "docker" {
		return "/usr/bin/docker", nil
	}
	return "", os.ErrNotExist
}

func (downCompose) Run(_ context.Context, _ string, args []string, _ string) ([]byte, error) {
	return []byte("Cannot connect"), os.ErrNotExist
}

func TestEnvWorkspaceActionUsesBoundLabPackage(t *testing.T) {
	t.Setenv(appdata.DirectoryOverrideEnv, filepath.Join(t.TempDir(), "appdata"))
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	labJobs, err := lab.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	broker, err := envbroker.NewForTest(t.TempDir(), downCompose{}, nil)
	if err != nil {
		t.Fatal(err)
	}
	application := &App{conversations: conversations, labJobs: labJobs, envBroker: broker}
	if err := labJobs.Save(lab.Job{
		ID:        "job-juice",
		Title:     "OWASP Juice Shop",
		Scope:     "local",
		Request:   "练习",
		PackageID: "juice-shop",
		CreatedAt: 1,
		UpdatedAt: 1,
	}); err != nil {
		t.Fatal(err)
	}
	if err := conversations.Save(conversation.StoredConversation{
		ID:    "lab-job-job-juice",
		Title: "OWASP Juice Shop",
		DomainTaskContext: map[string]any{
			"kind":  "lab",
			"jobId": "job-juice",
		},
	}); err != nil {
		t.Fatal(err)
	}

	status, err := application.handleCodingWorkspaceAction("lab-job-job-juice", "env_status", "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(status, `"state":"none"`) {
		t.Fatalf("status: %s", status)
	}

	started, err := application.handleCodingWorkspaceAction("lab-job-job-juice", "env_start", "")
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(started, "docker-down") {
		t.Fatalf("start: %s", started)
	}
}

func TestEnvWorkspaceActionRejectsPlainCoding(t *testing.T) {
	t.Setenv(appdata.DirectoryOverrideEnv, filepath.Join(t.TempDir(), "appdata"))
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	broker, err := envbroker.NewForTest(t.TempDir(), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	application := &App{conversations: conversations, envBroker: broker}
	if err := conversations.Save(conversation.StoredConversation{
		ID:    "chat-plain",
		Title: "普通",
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := application.handleCodingWorkspaceAction("chat-plain", "env_start", ""); err == nil {
		t.Fatal("expected plain coding to lack an environment job")
	}
}
