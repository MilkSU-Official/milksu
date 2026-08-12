package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/userartifact"
)

func TestResolveConversationWorkspaceSeparatesCodingAndCVEArtifacts(t *testing.T) {
	dataDirectory := filepath.Join(t.TempDir(), "appdata")
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	artifactDirectory := filepath.Join(t.TempDir(), "Documents", "MilkSU")
	app := &App{
		artifactDirectory: artifactDirectory,
		conversations:     conversations,
	}

	for _, test := range []struct {
		name         string
		conversation conversation.StoredConversation
		wantSection  string
		wantBase     string
	}{
		{
			name: "coding",
			conversation: conversation.StoredConversation{
				ID: "coding-one", Title: "分析登录回调", Messages: []conversation.StoredMessage{},
			},
			wantSection: string(userartifact.KindCoding),
		},
		{
			name: "cve",
			conversation: conversation.StoredConversation{
				ID: "cve-research-cve-2024-3400", Title: "PAN-OS 研究接力",
				DomainTaskContext: map[string]any{
					"kind": "cve", "cveId": "CVE-2024-3400",
				},
				Messages: []conversation.StoredMessage{},
			},
			wantSection: string(userartifact.KindCVE),
			wantBase:    "CVE-2024-3400",
		},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := conversations.Save(test.conversation); err != nil {
				t.Fatal(err)
			}
			workspace, err := app.resolveConversationWorkspace(test.conversation.ID, "")
			if err != nil {
				t.Fatal(err)
			}
			if filepath.Base(filepath.Dir(workspace)) != test.wantSection {
				t.Fatalf("workspace = %q, want %s section", workspace, test.wantSection)
			}
			if test.wantBase != "" && filepath.Base(workspace) != test.wantBase {
				t.Fatalf("workspace = %q, want base %q", workspace, test.wantBase)
			}
			if _, err := os.Stat(filepath.Join(workspace, ".git")); err != nil {
				t.Fatalf("workspace boundary was not created: %v", err)
			}
			stored, err := conversations.Get(test.conversation.ID)
			if err != nil {
				t.Fatal(err)
			}
			if stored.WorkspacePath != workspace {
				t.Fatalf("stored workspace = %q, want %q", stored.WorkspacePath, workspace)
			}
		})
	}
}

func TestCTFWorkspaceRootUsesVisibleArtifactsWhenConfigured(t *testing.T) {
	app := &App{
		dataDirectory:     filepath.Join(t.TempDir(), "appdata"),
		artifactDirectory: filepath.Join(t.TempDir(), "Documents", "MilkSU"),
	}
	want := filepath.Join(app.artifactDirectory, string(userartifact.KindCTF))
	if got := app.ctfWorkspaceRoot(); got != want {
		t.Fatalf("ctfWorkspaceRoot() = %q, want %q", got, want)
	}
}
