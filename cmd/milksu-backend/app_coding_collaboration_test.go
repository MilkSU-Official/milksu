package main

import (
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/codingcollab"
)

func TestAgentManagedCodingCollaborationPreparesAndReleasesCleanWriter(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("Agent-managed Coding collaboration is currently macOS-only")
	}
	repository := newAgentManagedTestRepository(t)
	manager, err := codingcollab.New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	application := &App{codingCollab: manager}

	descriptor, err := application.ensureAgentManagedCodingCollaboration(
		"conversation-auto-writer",
		repository,
		true,
	)
	if err != nil {
		t.Fatal(err)
	}
	if descriptor == nil || len(descriptor.Worktrees) != 1 {
		t.Fatalf("unexpected automatic worktree descriptor: %#v", descriptor)
	}
	writerPath := descriptor.Worktrees[0].Path
	if info, statErr := os.Stat(writerPath); statErr != nil || !info.IsDir() {
		t.Fatalf("automatic writer was not prepared: path=%s err=%v", writerPath, statErr)
	}

	if err := application.releaseAgentManagedCodingCollaboration(
		"conversation-auto-writer",
	); err != nil {
		t.Fatal(err)
	}
	if _, statErr := os.Stat(writerPath); !os.IsNotExist(statErr) {
		t.Fatalf("released writer still exists: path=%s err=%v", writerPath, statErr)
	}
}

func TestAgentManagedCodingCollaborationDoesNotHideDirtyWorkspace(t *testing.T) {
	repository := newAgentManagedTestRepository(t)
	if err := os.WriteFile(
		filepath.Join(repository, "dirty.txt"),
		[]byte("user change\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	manager, err := codingcollab.New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	application := &App{codingCollab: manager}

	descriptor, err := application.ensureAgentManagedCodingCollaboration(
		"conversation-dirty-workspace",
		repository,
		true,
	)
	if err != nil {
		t.Fatal(err)
	}
	if descriptor != nil {
		t.Fatalf("dirty workspace unexpectedly received an isolated writer: %#v", descriptor)
	}
}

func TestAgentManagedCodingCollaborationLeavesTemporaryWorkspaceToEngine(t *testing.T) {
	manager, err := codingcollab.New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	application := &App{codingCollab: manager}

	descriptor, err := application.ensureAgentManagedCodingCollaboration(
		"cve-research-cve-2024-3400",
		"",
		true,
	)
	if err != nil {
		t.Fatal(err)
	}
	if descriptor != nil {
		t.Fatalf("temporary workspace unexpectedly received a worktree: %#v", descriptor)
	}
}

func newAgentManagedTestRepository(t *testing.T) string {
	t.Helper()
	repository := t.TempDir()
	runAgentManagedTestGit(t, repository, "init", "-b", "main")
	runAgentManagedTestGit(t, repository, "config", "user.name", "MilkSU Test")
	runAgentManagedTestGit(t, repository, "config", "user.email", "test@milksu.local")
	if err := os.WriteFile(
		filepath.Join(repository, "README.md"),
		[]byte("fixture\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	runAgentManagedTestGit(t, repository, "add", "README.md")
	runAgentManagedTestGit(t, repository, "commit", "-m", "fixture")
	return repository
}

func runAgentManagedTestGit(t *testing.T, directory string, arguments ...string) {
	t.Helper()
	command := exec.Command("git", arguments...)
	command.Dir = directory
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v failed: %v\n%s", arguments, err, output)
	}
}
