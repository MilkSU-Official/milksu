package codingcollab

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A writer worktree is checked out from a commit, and a detached HEAD is a
// commit. Refusing one only denied isolation to a task that is reviewing a tag
// or bisecting, which is exactly when a separate writing worktree helps.
func TestManagerPreparesFromADetachedHead(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repository := newRepository(t)
	head := git(t, repository, "rev-parse", "HEAD")
	git(t, repository, "checkout", "--detach", head)

	manager, err := New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.Prepare(ctx, "conversation-detached", repository, 1)
	if err != nil {
		t.Fatalf("a detached HEAD was denied a writer worktree: %v", err)
	}
	if !status.Active || len(status.Worktrees) != 1 {
		t.Fatalf("unexpected status: %+v", status)
	}
	if status.BaseHead != head {
		t.Fatalf("writer was not based on the detached commit: %+v", status)
	}
	if status.BaseBranch != "" {
		t.Fatalf("a detached HEAD reported a base branch: %q", status.BaseBranch)
	}
	if _, statErr := os.Stat(filepath.Join(status.Worktrees[0].Path, "README.md")); statErr != nil {
		t.Fatalf("the writer does not contain the base commit: %v", statErr)
	}
}

// A project inside a monorepo is a repository that especially wants writer
// isolation. The worktree checks out the whole repository; only the directory
// the writer starts in follows the selection.
func TestManagerPreparesForAProjectBelowTheRepositoryRoot(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repository := newRepository(t)
	project := filepath.Join(repository, "services", "api")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(project, "main.go"), []byte("package main\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	git(t, repository, "add", "services/api/main.go")
	git(t, repository, "commit", "-m", "add service")

	manager, err := New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	status, err := manager.Prepare(ctx, "conversation-subdirectory", project, 1)
	if err != nil {
		t.Fatalf("a project below the repository root was denied a writer: %v", err)
	}
	if !status.Active || len(status.Worktrees) != 1 {
		t.Fatalf("unexpected status: %+v", status)
	}

	descriptor, err := manager.Descriptor(ctx, "conversation-subdirectory", project)
	if err != nil {
		t.Fatal(err)
	}
	if descriptor == nil || len(descriptor.Worktrees) != 1 {
		t.Fatalf("unexpected descriptor: %+v", descriptor)
	}
	writer := descriptor.Worktrees[0].Path
	if !strings.HasSuffix(writer, filepath.Join("services", "api")) {
		t.Fatalf("the writer does not start in the selected project: %s", writer)
	}
	if _, statErr := os.Stat(filepath.Join(writer, "main.go")); statErr != nil {
		t.Fatalf("the selected project is missing from the writer: %v", statErr)
	}
}

// A directory that exists only in the working tree cannot be in a worktree
// checked out from a commit, so preparation says so instead of handing a writer
// a path that is not there.
func TestManagerRefusesAnUncommittedProjectDirectory(t *testing.T) {
	t.Parallel()
	ctx := context.Background()
	repository := newRepository(t)
	project := filepath.Join(repository, "scratch")
	if err := os.MkdirAll(project, 0o755); err != nil {
		t.Fatal(err)
	}

	manager, err := New(filepath.Join(t.TempDir(), "collaboration"))
	if err != nil {
		t.Fatal(err)
	}
	_, err = manager.Prepare(ctx, "conversation-uncommitted", project, 1)
	if err == nil || !strings.Contains(err.Error(), "not committed") {
		t.Fatalf("expected an uncommitted project directory to be named, got %v", err)
	}
}
