package codingenv

import (
	"context"
	"fmt"
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

func TestGitHunkActionsStageUnstageAndDiscardExactCurrentHunks(t *testing.T) {
	requireGit(t)
	workspace := initializedMultiHunkGitFixture(t)
	file := filepath.Join(workspace, "multi.txt")
	changed := strings.Join([]string{
		"line 01",
		"line 02 changed",
		"line 03",
		"line 04",
		"line 05",
		"line 06",
		"line 07",
		"line 08",
		"line 09",
		"line 10",
		"line 11 changed",
		"line 12",
		"",
	}, "\n")
	if err := os.WriteFile(file, []byte(changed), 0o600); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()

	initial, err := InspectDiff(ctx, workspace, "multi.txt")
	if err != nil {
		t.Fatal(err)
	}
	hunks := splitUnifiedDiffHunks(initial.WorkingTree)
	if len(hunks) != 2 {
		t.Fatalf("expected two working-tree hunks, got %d\n%s", len(hunks), initial.WorkingTree)
	}

	staged, err := ApplyGitHunkAction(
		ctx,
		workspace,
		GitActionStageHunk,
		"multi.txt",
		hunks[0],
	)
	if err != nil {
		t.Fatal(err)
	}
	if staged.Snapshot.Git.Staged != 1 || staged.Snapshot.Git.Modified != 1 {
		t.Fatalf("expected staged and unstaged changes, got %#v", staged.Snapshot.Git)
	}
	afterStage, err := InspectDiff(ctx, workspace, "multi.txt")
	if err != nil {
		t.Fatal(err)
	}
	if len(splitUnifiedDiffHunks(afterStage.Staged)) != 1 {
		t.Fatalf("expected one staged hunk\n%s", afterStage.Staged)
	}
	remaining := splitUnifiedDiffHunks(afterStage.WorkingTree)
	if len(remaining) != 1 || !strings.Contains(remaining[0], "line 11 changed") {
		t.Fatalf("expected the second hunk to remain unstaged\n%s", afterStage.WorkingTree)
	}

	if _, err := ApplyGitHunkAction(
		ctx,
		workspace,
		GitActionDiscardHunk,
		"multi.txt",
		remaining[0],
	); err != nil {
		t.Fatal(err)
	}
	afterDiscard, err := InspectDiff(ctx, workspace, "multi.txt")
	if err != nil {
		t.Fatal(err)
	}
	if afterDiscard.WorkingTree != "" || !strings.Contains(afterDiscard.Staged, "line 02 changed") {
		t.Fatalf("discard should preserve only the staged hunk: %#v", afterDiscard)
	}

	stagedHunks := splitUnifiedDiffHunks(afterDiscard.Staged)
	if len(stagedHunks) != 1 {
		t.Fatalf("expected one staged hunk, got %d", len(stagedHunks))
	}
	if _, err := ApplyGitHunkAction(
		ctx,
		workspace,
		GitActionUnstageHunk,
		"multi.txt",
		stagedHunks[0],
	); err != nil {
		t.Fatal(err)
	}
	afterUnstage, err := InspectDiff(ctx, workspace, "multi.txt")
	if err != nil {
		t.Fatal(err)
	}
	if afterUnstage.Staged != "" || !strings.Contains(afterUnstage.WorkingTree, "line 02 changed") {
		t.Fatalf("unstage should return the selected hunk to the working tree: %#v", afterUnstage)
	}
}

func TestGitHunkActionsRejectStaleOrForeignPatch(t *testing.T) {
	requireGit(t)
	workspace := initializedMultiHunkGitFixture(t)
	file := filepath.Join(workspace, "multi.txt")
	if err := os.WriteFile(
		file,
		[]byte(strings.Replace(
			string(mustReadFile(t, file)),
			"line 02",
			"line 02 changed",
			1,
		)),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	ctx := context.Background()
	diff, err := InspectDiff(ctx, workspace, "multi.txt")
	if err != nil {
		t.Fatal(err)
	}
	hunks := splitUnifiedDiffHunks(diff.WorkingTree)
	if len(hunks) != 1 {
		t.Fatalf("expected one hunk, got %d", len(hunks))
	}

	foreign := strings.Replace(hunks[0], "a/multi.txt", "a/other.txt", 1)
	if _, err := ApplyGitHunkAction(
		ctx,
		workspace,
		GitActionStageHunk,
		"multi.txt",
		foreign,
	); err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("expected foreign patch rejection, got %v", err)
	}

	if err := os.WriteFile(
		file,
		[]byte(strings.Replace(
			string(mustReadFile(t, file)),
			"line 03",
			"line 03 changed after review",
			1,
		)),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := ApplyGitHunkAction(
		ctx,
		workspace,
		GitActionStageHunk,
		"multi.txt",
		hunks[0],
	); err == nil || !strings.Contains(err.Error(), "stale") {
		t.Fatalf("expected stale patch rejection, got %v", err)
	}
}

func TestGitActionCheckoutSwitchesLocalBranch(t *testing.T) {
	requireGit(t)
	workspace := initializedGitFixture(t)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	before, err := Inspect(ctx, workspace)
	if err != nil || before.Git.Branch == "" {
		t.Fatalf("inspect fixture branch: %#v %v", before.Git, err)
	}
	runGitFixture(t, workspace, "checkout", "-b", "feature")
	switched, err := ApplyGitAction(ctx, workspace, GitActionCheckout, before.Git.Branch, "")
	if err != nil {
		t.Fatal(err)
	}
	if switched.Snapshot.Git.Branch != before.Git.Branch {
		t.Fatalf("checkout branch = %q, want %q", switched.Snapshot.Git.Branch, before.Git.Branch)
	}
	foundFeature := false
	for _, name := range switched.Snapshot.Git.LocalBranches {
		if name == "feature" || name == before.Git.Branch {
			foundFeature = foundFeature || name == "feature"
		}
	}
	if !foundFeature {
		t.Fatalf("local branches missing feature: %#v", switched.Snapshot.Git.LocalBranches)
	}
}

func TestSplitUnifiedDiffHunksRefusesAddedOrDeletedFiles(t *testing.T) {
	added := strings.Join([]string{
		"diff --git a/new.txt b/new.txt",
		"new file mode 100644",
		"--- /dev/null",
		"+++ b/new.txt",
		"@@ -0,0 +1 @@",
		"+new",
		"",
	}, "\n")
	if hunks := splitUnifiedDiffHunks(added); len(hunks) != 0 {
		t.Fatalf("new files must use file-level Git actions, got %d hunks", len(hunks))
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

func initializedMultiHunkGitFixture(t *testing.T) string {
	t.Helper()
	workspace := t.TempDir()
	runGitFixture(t, workspace, "init")
	runGitFixture(t, workspace, "config", "user.email", "fixture@example.test")
	runGitFixture(t, workspace, "config", "user.name", "MilkSU Fixture")
	lines := make([]string, 0, 13)
	for index := 1; index <= 12; index++ {
		lines = append(lines, fmt.Sprintf("line %02d", index))
	}
	lines = append(lines, "")
	if err := os.WriteFile(
		filepath.Join(workspace, "multi.txt"),
		[]byte(strings.Join(lines, "\n")),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	runGitFixture(t, workspace, "add", "multi.txt")
	runGitFixture(t, workspace, "commit", "-m", "fixture")
	return workspace
}

func mustReadFile(t *testing.T, path string) []byte {
	t.Helper()
	content, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	return content
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
