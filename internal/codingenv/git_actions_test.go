package codingenv

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestGitActionsStageUnstageAndDiscardWorkingTreeChange(t *testing.T) {
	requireGit(t)
	workspace := initializedGitFixture(t)
	file := filepath.Join(workspace, "hello.txt")
	if err := os.WriteFile(file, []byte("first\nsecond\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()

	staged, err := ApplyGitAction(ctx, workspace, GitActionStage, "hello.txt", "")
	if err != nil {
		t.Fatal(err)
	}
	if staged.Snapshot.Git.Staged != 1 || staged.Snapshot.Git.Modified != 0 {
		t.Fatalf("unexpected staged state: %#v", staged.Snapshot.Git)
	}

	unstaged, err := ApplyGitAction(ctx, workspace, GitActionUnstage, "hello.txt", "")
	if err != nil {
		t.Fatal(err)
	}
	if unstaged.Snapshot.Git.Staged != 0 || unstaged.Snapshot.Git.Modified != 1 {
		t.Fatalf("unexpected unstaged state: %#v", unstaged.Snapshot.Git)
	}

	discarded, err := ApplyGitAction(
		ctx,
		workspace,
		GitActionDiscardWork,
		"hello.txt",
		"",
	)
	if err != nil {
		t.Fatal(err)
	}
	if discarded.Snapshot.Git.Dirty {
		t.Fatalf("discard left repository dirty: %#v", discarded.Snapshot.Git)
	}
	content, err := os.ReadFile(file)
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "first\n" {
		t.Fatalf("discard restored unexpected content: %q", content)
	}
}

func TestGitActionsCommitAndPushWithoutForce(t *testing.T) {
	requireGit(t)
	workspace := initializedGitFixture(t)
	remote := filepath.Join(t.TempDir(), "remote.git")
	if err := os.MkdirAll(remote, 0o700); err != nil {
		t.Fatal(err)
	}
	runGitFixture(t, remote, "init", "--bare")
	runGitFixture(t, workspace, "remote", "add", "origin", remote)

	file := filepath.Join(workspace, "hello.txt")
	if err := os.WriteFile(file, []byte("first\ncommitted\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	if _, err := ApplyGitAction(ctx, workspace, GitActionStageAll, "", ""); err != nil {
		t.Fatal(err)
	}
	committed, err := ApplyGitAction(
		ctx,
		workspace,
		GitActionCommit,
		"",
		"test: commit through MilkSU",
	)
	if err != nil {
		t.Fatal(err)
	}
	if committed.Snapshot.Git.Dirty || committed.Snapshot.Git.Head == "" {
		t.Fatalf("unexpected commit result: %#v", committed)
	}

	pushed, err := ApplyGitAction(ctx, workspace, GitActionPush, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if pushed.Snapshot.Git.Upstream == "" || pushed.Snapshot.Git.Ahead != 0 {
		t.Fatalf("unexpected push result: %#v", pushed.Snapshot.Git)
	}
	remoteHead := strings.TrimSpace(runGitFixtureOutput(
		t,
		remote,
		"rev-parse",
		"refs/heads/"+pushed.Snapshot.Git.Branch,
	))
	localHead := strings.TrimSpace(runGitFixtureOutput(t, workspace, "rev-parse", "HEAD"))
	if remoteHead != localHead {
		t.Fatalf("push did not update expected branch: remote=%s local=%s", remoteHead, localHead)
	}
}

func TestGitActionsRefuseUnsafeDiscardAndInvalidInputs(t *testing.T) {
	requireGit(t)
	workspace := initializedGitFixture(t)
	if err := os.WriteFile(filepath.Join(workspace, "new.txt"), []byte("new\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()

	if _, err := ApplyGitAction(
		ctx,
		workspace,
		GitActionDiscardWork,
		"new.txt",
		"",
	); err == nil || !strings.Contains(err.Error(), "not deleted") {
		t.Fatalf("expected untracked discard refusal, got %v", err)
	}
	if _, err := ApplyGitAction(
		ctx,
		workspace,
		GitActionStage,
		"../outside.txt",
		"",
	); err == nil {
		t.Fatal("expected staging workspace escape to fail")
	}
	if _, err := ApplyGitAction(
		ctx,
		workspace,
		GitActionCommit,
		"",
		"",
	); err == nil || !strings.Contains(err.Error(), "message") {
		t.Fatalf("expected empty commit message refusal, got %v", err)
	}
}

func initializedGitFixture(t *testing.T) string {
	t.Helper()
	workspace := t.TempDir()
	runGitFixture(t, workspace, "init")
	runGitFixture(t, workspace, "config", "user.email", "fixture@example.test")
	runGitFixture(t, workspace, "config", "user.name", "MilkSU Fixture")
	if err := os.WriteFile(filepath.Join(workspace, "hello.txt"), []byte("first\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitFixture(t, workspace, "add", "hello.txt")
	runGitFixture(t, workspace, "commit", "-m", "fixture")
	return workspace
}

func requireGit(t *testing.T) {
	t.Helper()
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is unavailable")
	}
}

func runGitFixtureOutput(t *testing.T, workspace string, arguments ...string) string {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", workspace}, arguments...)...)
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v failed: %v\n%s", arguments, err, output)
	}
	return string(output)
}
