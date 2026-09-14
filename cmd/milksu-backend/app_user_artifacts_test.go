package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
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
		dataDirectory:     dataDirectory,
		artifactDirectory: artifactDirectory,
		conversations:     conversations,
	}

	for _, test := range []struct {
		name         string
		conversation conversation.StoredConversation
		wantSection  string
		wantBase     string
		wantRoot     string
	}{
		{
			name: "coding",
			conversation: conversation.StoredConversation{
				ID: "coding-one", Title: "分析登录回调", Messages: []conversation.StoredMessage{},
			},
			wantSection: string(userartifact.KindCoding),
			wantRoot:    filepath.Join(dataDirectory, "agent-workspaces"),
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
			wantRoot:    artifactDirectory,
		},
		{
			name: "lab",
			conversation: conversation.StoredConversation{
				ID: "lab-job-one", Title: "本机练习机",
				DomainTaskContext: map[string]any{
					"kind": "lab", "title": "本机练习机",
				},
				Messages: []conversation.StoredMessage{},
			},
			wantSection: string(userartifact.KindLab),
			wantRoot:    artifactDirectory,
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
			if relative, err := filepath.Rel(test.wantRoot, workspace); err != nil ||
				relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
				t.Fatalf("workspace = %q, want root %q", workspace, test.wantRoot)
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
			if test.wantSection == string(userartifact.KindCVE) || test.wantSection == string(userartifact.KindLab) {
				if _, err := os.Stat(filepath.Join(workspace, userartifact.ReportFileName)); err != nil {
					t.Fatalf("seeded report missing: %v", err)
				}
			}
			if test.wantSection == string(userartifact.KindCVE) {
				if _, err := os.Stat(filepath.Join(workspace, userartifact.RelatedFileName)); err != nil {
					t.Fatalf("seeded related CVE file missing: %v", err)
				}
			} else if _, err := os.Stat(filepath.Join(workspace, userartifact.RelatedFileName)); err == nil {
				t.Fatal("non-CVE workspace unexpectedly seeded related.md")
			}
		})
	}
}

func TestResolveConversationWorkspaceKeepsASelectedGitProject(t *testing.T) {
	dataDirectory := filepath.Join(t.TempDir(), "appdata")
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	repository := filepath.Join(t.TempDir(), "selected-repo")
	if err := conversations.Save(conversation.StoredConversation{
		ID:            "coding-git",
		Title:         "选过项目",
		WorkspacePath: repository,
		Messages:      []conversation.StoredMessage{},
	}); err != nil {
		t.Fatal(err)
	}
	app := &App{
		dataDirectory:     dataDirectory,
		artifactDirectory: filepath.Join(t.TempDir(), "Documents", "MilkSU"),
		conversations:     conversations,
	}
	workspace, err := app.resolveConversationWorkspace("coding-git", "")
	if err != nil {
		t.Fatal(err)
	}
	if workspace != repository {
		t.Fatalf("selected Git project was rewritten to %q", workspace)
	}
	stored, err := conversations.Get("coding-git")
	if err != nil {
		t.Fatal(err)
	}
	if stored.WorkspacePath != repository {
		t.Fatalf("stored workspace = %q, want the selected Git project", stored.WorkspacePath)
	}
}

func TestResolveConversationWorkspaceRemembersTheRequestedProject(t *testing.T) {
	dataDirectory := filepath.Join(t.TempDir(), "appdata")
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := conversations.Save(conversation.StoredConversation{
		ID:       "coding-send",
		Title:    "发消息时才带路径",
		Messages: []conversation.StoredMessage{},
	}); err != nil {
		t.Fatal(err)
	}
	repository := filepath.Join(t.TempDir(), "sent-repo")
	app := &App{
		dataDirectory:     dataDirectory,
		artifactDirectory: filepath.Join(t.TempDir(), "Documents", "MilkSU"),
		conversations:     conversations,
	}
	workspace, err := app.resolveConversationWorkspace("coding-send", repository)
	if err != nil {
		t.Fatal(err)
	}
	if workspace != repository {
		t.Fatalf("requested workspace = %q, want %q", workspace, repository)
	}
	again, err := app.resolveConversationWorkspace("coding-send", "")
	if err != nil {
		t.Fatal(err)
	}
	if again != repository {
		t.Fatalf("empty resolve after SendMessage invented %q", again)
	}
}

func TestResolveConversationWorkspacePrefersTheBoundSessionDirectory(t *testing.T) {
	dataDirectory := filepath.Join(t.TempDir(), "appdata")
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := conversations.Save(conversation.StoredConversation{
		ID:       "coding-bound",
		Title:    "回合已绑定项目",
		Messages: []conversation.StoredMessage{},
	}); err != nil {
		t.Fatal(err)
	}
	repository := filepath.Join(t.TempDir(), "bound-repo")
	supervisor := engine.NewSupervisor(nil)
	supervisor.BindSessionWorkspace("coding-bound", repository)
	app := &App{
		dataDirectory:     dataDirectory,
		artifactDirectory: filepath.Join(t.TempDir(), "Documents", "MilkSU"),
		conversations:     conversations,
		engines:           supervisor,
	}
	workspace, err := app.resolveConversationWorkspace("coding-bound", "")
	if err != nil {
		t.Fatal(err)
	}
	if workspace != repository {
		t.Fatalf("bound session workspace was ignored: got %q", workspace)
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
