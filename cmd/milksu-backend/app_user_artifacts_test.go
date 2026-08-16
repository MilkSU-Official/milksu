package main

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/userartifact"
)

type workspaceAuthorizationTestHost struct {
	selected string
}

func (h *workspaceAuthorizationTestHost) Emit(string, any) {}

func (h *workspaceAuthorizationTestHost) Call(
	_ context.Context,
	method string,
	_ any,
	result any,
) error {
	if method == "dialog.openDirectory" {
		*(result.(*string)) = h.selected
	}
	return nil
}

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

func TestWorkspaceAccessRequiresDesktopAuthorizationAndCanBeRevoked(t *testing.T) {
	dataDirectory := filepath.Join(t.TempDir(), "appdata")
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	primary := t.TempDir()
	authorized := t.TempDir()
	unapproved := t.TempDir()
	stored := conversation.StoredConversation{
		ID: "coding-scope", Title: "跨项目任务", WorkspacePath: primary,
		Messages: []conversation.StoredMessage{},
	}
	if err := conversations.Save(stored); err != nil {
		t.Fatal(err)
	}
	host := &workspaceAuthorizationTestHost{selected: authorized}
	app := &App{
		ctx:           context.Background(),
		host:          host,
		conversations: conversations,
	}

	paths, err := app.AuthorizeConversationWorkspaceAccess(stored.ID)
	if err != nil {
		t.Fatal(err)
	}
	authorized, err = filepath.EvalSymlinks(authorized)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 1 || paths[0] != authorized {
		t.Fatalf("authorized paths = %#v, want %q", paths, authorized)
	}

	// Ordinary renderer persistence cannot widen the desktop-owned grant.
	stored.WorkspaceAccessPaths = []string{unapproved}
	if err := app.SaveConversation(stored); err != nil {
		t.Fatal(err)
	}
	stored, err = conversations.Get(stored.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(stored.WorkspaceAccessPaths) != 1 || stored.WorkspaceAccessPaths[0] != authorized {
		t.Fatalf("renderer changed workspace grant: %#v", stored.WorkspaceAccessPaths)
	}

	paths, err = app.RevokeConversationWorkspaceAccess(stored.ID, authorized)
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) != 0 {
		t.Fatalf("revoked paths = %#v, want empty", paths)
	}
}
