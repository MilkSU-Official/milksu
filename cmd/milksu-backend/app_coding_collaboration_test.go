package main

import (
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/codingcollab"
)

func TestCodingCollaborationManagerIsDisabledOutsideDarwin(t *testing.T) {
	t.Setenv("PATH", "")
	for _, goos := range []string{"windows", "linux"} {
		t.Run(goos, func(t *testing.T) {
			dataDirectory := t.TempDir()
			manager, err := newCodingCollaborationManager(dataDirectory, goos)
			if err != nil {
				t.Fatalf("newCodingCollaborationManager(%q) error = %v", goos, err)
			}
			if manager != nil {
				t.Fatalf("newCodingCollaborationManager(%q) returned a manager", goos)
			}
			collaborationDirectory := filepath.Join(
				dataDirectory,
				"agent-home",
				"coding-collaboration",
			)
			if _, err := os.Stat(collaborationDirectory); !errors.Is(err, os.ErrNotExist) {
				t.Fatalf("unsupported platform created collaboration state: %v", err)
			}
		})
	}
}

func TestCodingCollaborationManagerPreservesDarwinGitRequirement(t *testing.T) {
	t.Setenv("PATH", "")
	manager, err := newCodingCollaborationManager(t.TempDir(), "darwin")
	if manager != nil {
		t.Fatal("Darwin returned a Coding collaboration manager without Git")
	}
	if err == nil || err.Error() != "Git is not installed or unavailable" {
		t.Fatalf("Darwin Git requirement error = %v", err)
	}
}

// Sending a message must not provision anything. A writer worktree belongs to
// an effectful subagent, so a clean Git task still reports no collaboration
// until the model actually delegates writing work.
func TestSendingAMessageDoesNotProvisionAWriterWorktree(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("Agent-managed Coding collaboration is currently macOS-only")
	}
	repository := newAgentManagedTestRepository(t)
	manager, err := codingcollab.New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	application := &App{codingCollab: manager}

	descriptor, err := application.resolveAgentManagedCodingCollaboration(
		"conversation-lazy-writer",
		repository,
	)
	if err != nil {
		t.Fatal(err)
	}
	if descriptor != nil {
		t.Fatalf("sending a message provisioned a worktree: %#v", descriptor)
	}
}

func TestDelegatedWritingWorkPreparesAndReleasesCleanWriter(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("Agent-managed Coding collaboration is currently macOS-only")
	}
	repository := newAgentManagedTestRepository(t)
	manager, err := codingcollab.New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	application := &App{codingCollab: manager}

	descriptor, err := application.prepareAgentManagedCodingCollaboration(
		"conversation-auto-writer",
		repository,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if descriptor == nil || len(descriptor.Worktrees) != 1 {
		t.Fatalf("unexpected delegated worktree descriptor: %#v", descriptor)
	}
	writerPath := descriptor.Worktrees[0].Path
	if info, statErr := os.Stat(writerPath); statErr != nil || !info.IsDir() {
		t.Fatalf("delegated writer was not prepared: path=%s err=%v", writerPath, statErr)
	}

	// A second delegation in the same task reuses the prepared writer instead of
	// preparing a second one.
	again, err := application.prepareAgentManagedCodingCollaboration(
		"conversation-auto-writer",
		repository,
		1,
	)
	if err != nil {
		t.Fatal(err)
	}
	if again == nil || len(again.Worktrees) != 1 || again.Worktrees[0].Path != writerPath {
		t.Fatalf("second delegation did not reuse the writer: %#v", again)
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

func TestParallelWritingRolesReceiveTwoWriters(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("Agent-managed Coding collaboration is currently macOS-only")
	}
	repository := newAgentManagedTestRepository(t)
	manager, err := codingcollab.New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	application := &App{codingCollab: manager}

	descriptor, err := application.prepareAgentManagedCodingCollaboration(
		"conversation-two-writers",
		repository,
		2,
	)
	if err != nil {
		t.Fatal(err)
	}
	if descriptor == nil || len(descriptor.Worktrees) != 2 {
		t.Fatalf("parallel delegation did not receive two writers: %#v", descriptor)
	}
}

// A repository with work in progress is the case that needs isolation most, so
// delegation still gets a writer. The writer is checked out from baseHead, so
// the uncommitted file stays in the main worktree and never enters it.
func TestDelegatedWritingWorkIsolatesADirtyWorkspace(t *testing.T) {
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

	descriptor, err := application.prepareAgentManagedCodingCollaboration(
		"conversation-dirty-workspace",
		repository,
		1,
	)
	if err != nil {
		t.Fatalf("dirty workspace was denied an isolated writer: %v", err)
	}
	if descriptor == nil || len(descriptor.Worktrees) != 1 {
		t.Fatalf("dirty workspace did not receive one writer: %#v", descriptor)
	}
	if _, err := os.Stat(filepath.Join(descriptor.Worktrees[0].Path, "dirty.txt")); !os.IsNotExist(err) {
		t.Fatalf("uncommitted main worktree change leaked into the writer: %v", err)
	}
	if _, err := os.Stat(filepath.Join(repository, "dirty.txt")); err != nil {
		t.Fatalf("preparation disturbed the user's uncommitted change: %v", err)
	}
}

func TestDelegatedWritingWorkLeavesTemporaryWorkspaceToEngine(t *testing.T) {
	manager, err := codingcollab.New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	application := &App{codingCollab: manager}

	descriptor, err := application.prepareAgentManagedCodingCollaboration(
		"cve-research-cve-2024-3400",
		"",
		1,
	)
	if descriptor != nil {
		t.Fatalf("temporary workspace received a worktree: %#v", descriptor)
	}
	if err == nil {
		t.Fatal("a task without a Git project did not explain the refusal")
	}
}

func TestWriterCountStaysInsideTheCollaborationContract(t *testing.T) {
	for _, testCase := range []struct{ requested, want int }{
		{requested: -3, want: codingcollab.MinWriters},
		{requested: 0, want: codingcollab.MinWriters},
		{requested: 1, want: 1},
		{requested: 2, want: 2},
		{requested: 9, want: codingcollab.MaxWriters},
	} {
		if got := boundedWriterCount(testCase.requested); got != testCase.want {
			t.Fatalf(
				"boundedWriterCount(%d) = %d, want %d",
				testCase.requested,
				got,
				testCase.want,
			)
		}
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
