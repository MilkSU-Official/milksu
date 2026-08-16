package main

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
)

func TestDiscoverWorkspaceDirectoriesUsesModelSearchPhrase(t *testing.T) {
	home := t.TempDir()
	t.Setenv("HOME", home)
	wanted := filepath.Join(home, "code", "MilkSU")
	other := filepath.Join(home, "Documents", "unrelated")
	for _, path := range []string{wanted, other} {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	paths, err := discoverWorkspaceDirectories("MilkSU project", other)
	if err != nil {
		t.Fatal(err)
	}
	resolvedWanted, err := normalizeAgentWorkspaceSelection(wanted)
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(paths, resolvedWanted) {
		t.Fatalf("candidate paths = %#v, want %q", paths, resolvedWanted)
	}
}

func TestWorkspaceAccessRequestAppliesConcreteModelSelection(t *testing.T) {
	t.Setenv(appdata.DirectoryOverrideEnv, filepath.Join(t.TempDir(), "appdata"))
	store, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	primary := filepath.Join(t.TempDir(), "primary")
	additional := filepath.Join(t.TempDir(), "Project With Spaces")
	for _, path := range []string{primary, additional} {
		if err := os.MkdirAll(path, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	stored := conversation.StoredConversation{
		ID: "coding-1", Title: "Coding", WorkspacePath: primary,
		Messages: []conversation.StoredMessage{},
	}
	if err := store.Save(stored); err != nil {
		t.Fatal(err)
	}
	app := &App{conversations: store}

	resolved, paths, restart, err := app.resolveWorkspaceAccessRequest(engine.Event{
		SessionID: "coding-1",
		Action:    workspaceAccessGrant,
		Path:      additional,
	})
	if err != nil {
		t.Fatal(err)
	}
	resolvedAdditional, err := normalizeAgentWorkspaceSelection(additional)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != resolvedAdditional || !restart || !slices.Equal(paths, []string{resolvedAdditional}) {
		t.Fatalf("unexpected grant: resolved=%q paths=%#v restart=%v", resolved, paths, restart)
	}
	persisted, err := store.Get("coding-1")
	if err != nil {
		t.Fatal(err)
	}
	if !slices.Equal(persisted.WorkspaceAccessPaths, []string{resolvedAdditional}) {
		t.Fatalf("persisted paths = %#v", persisted.WorkspaceAccessPaths)
	}

	_, paths, restart, err = app.resolveWorkspaceAccessRequest(engine.Event{
		SessionID: "coding-1",
		Action:    workspaceAccessGrant,
		Path:      additional,
	})
	if err != nil || restart || !slices.Equal(paths, []string{resolvedAdditional}) {
		t.Fatalf("duplicate grant changed Scope: paths=%#v restart=%v err=%v", paths, restart, err)
	}
}

func TestWorkspaceAccessRequestRejectsBroadOrCTFScope(t *testing.T) {
	t.Setenv(appdata.DirectoryOverrideEnv, filepath.Join(t.TempDir(), "appdata"))
	store, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	primary := filepath.Join(t.TempDir(), "primary")
	if err := os.MkdirAll(primary, 0o755); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"coding-1", "ctf_solver-1"} {
		if err := store.Save(conversation.StoredConversation{
			ID: id, Title: id, WorkspacePath: primary,
			Messages: []conversation.StoredMessage{},
		}); err != nil {
			t.Fatal(err)
		}
	}
	app := &App{conversations: store}
	if _, _, _, err := app.resolveWorkspaceAccessRequest(engine.Event{
		SessionID: "ctf_solver-1", Action: workspaceAccessGrant, Path: primary,
	}); err == nil {
		t.Fatal("CTF session scope expansion should fail")
	}
}

func TestWorkspaceAccessRequestAllowsExplicitWholeUserDirectoryGrant(t *testing.T) {
	t.Setenv(appdata.DirectoryOverrideEnv, filepath.Join(t.TempDir(), "appdata"))
	home := t.TempDir()
	primary := filepath.Join(home, "primary")
	if err := os.MkdirAll(primary, 0o755); err != nil {
		t.Fatal(err)
	}
	store, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Save(conversation.StoredConversation{
		ID: "coding-home", Title: "Coding", WorkspacePath: primary,
		Messages: []conversation.StoredMessage{},
	}); err != nil {
		t.Fatal(err)
	}
	app := &App{conversations: store}
	resolved, paths, restart, err := app.resolveWorkspaceAccessRequest(engine.Event{
		SessionID: "coding-home", Action: workspaceAccessGrant, Path: home,
	})
	if err != nil {
		t.Fatal(err)
	}
	resolvedHome, err := normalizeAgentWorkspaceSelection(home)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != resolvedHome || !restart || !slices.Equal(paths, []string{resolvedHome}) {
		t.Fatalf("whole-home grant was not preserved: resolved=%q paths=%#v restart=%v", resolved, paths, restart)
	}
}
