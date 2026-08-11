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

func TestParsePorcelainStatus(t *testing.T) {
	status := parsePorcelainStatus(
		"## codex/m3...origin/codex/m3 [ahead 2, behind 1]\n" +
			"M  staged.go\n" +
			" M modified.go\n" +
			"MM both.go\n" +
			"?? new.go\n" +
			"UU conflict.go\n",
	)
	if status.Branch != "codex/m3" || status.Upstream != "origin/codex/m3" {
		t.Fatalf("unexpected branch metadata: %#v", status)
	}
	if status.Ahead != 2 || status.Behind != 1 ||
		status.ChangedFiles != 5 || status.Staged != 3 ||
		status.Modified != 3 || status.Untracked != 1 ||
		status.Conflicts != 1 || !status.Dirty {
		t.Fatalf("unexpected status counts: %#v", status)
	}
}

func TestParsePorcelainStatusIgnoresMilkSURuntimeFiles(t *testing.T) {
	status := parsePorcelainStatus(
		"## main\n" +
			" M src/app.go\n" +
			"?? .milksu/\n",
	)
	if status.ChangedFiles != 1 || status.Modified != 1 || status.Untracked != 0 {
		t.Fatalf("MilkSU runtime files leaked into status counts: %#v", status)
	}
}

func TestParseNumstatIgnoresBinaryCounters(t *testing.T) {
	additions, deletions := parseNumstat("12\t4\tapp.go\n-\t-\tasset.png\n3\t0\tnew.go\n")
	if additions != 15 || deletions != 4 {
		t.Fatalf("unexpected numstat: +%d -%d", additions, deletions)
	}
}

func TestParseNumstatIgnoresMilkSURuntimeFiles(t *testing.T) {
	additions, deletions := parseNumstat(
		"12\t4\tapp.go\n" +
			"80\t0\t.milksu/home/npm.log\n",
	)
	if additions != 12 || deletions != 4 {
		t.Fatalf("MilkSU runtime files leaked into numstat: +%d -%d", additions, deletions)
	}
}

func TestParseNumstatByPathPreservesPerFileCounters(t *testing.T) {
	stats := parseNumstatByPath(
		"12\t4\tapp/src/App.vue\n" +
			"3\t0\tdocs/current notes.md\n" +
			"-\t-\tassets/icon.png\n",
	)
	if stats["app/src/App.vue"].additions != 12 || stats["app/src/App.vue"].deletions != 4 {
		t.Fatalf("unexpected app stat: %#v", stats["app/src/App.vue"])
	}
	if stats["docs/current notes.md"].additions != 3 || stats["docs/current notes.md"].deletions != 0 {
		t.Fatalf("unexpected spaced-path stat: %#v", stats["docs/current notes.md"])
	}
	if stats["assets/icon.png"] != (gitLineStat{}) {
		t.Fatalf("binary counters should remain zero: %#v", stats["assets/icon.png"])
	}
}

func TestParsePorcelainChangesPreservesStatusAndRename(t *testing.T) {
	changes, truncated := parsePorcelainChanges(
		"M  staged.go\x00 M modified.go\x00?? new.go\x00R  renamed.go\x00old.go\x00",
	)
	if truncated || len(changes) != 4 {
		t.Fatalf("unexpected change list: %#v truncated=%v", changes, truncated)
	}
	if !changes[0].Staged || changes[0].Path != "staged.go" ||
		!changes[1].Modified || !changes[2].Untracked ||
		changes[3].OriginalPath != "old.go" || changes[3].Path != "renamed.go" {
		t.Fatalf("unexpected parsed changes: %#v", changes)
	}
}

func TestParsePorcelainChangesIgnoresMilkSURuntimeFiles(t *testing.T) {
	changes, truncated := parsePorcelainChanges(
		" M src/app.go\x00?? .milksu/home/npm.log\x00",
	)
	if truncated || len(changes) != 1 || changes[0].Path != "src/app.go" {
		t.Fatalf("MilkSU runtime files leaked into change list: %#v", changes)
	}
}

func TestInspectNonRepository(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is unavailable")
	}
	workspace := t.TempDir()
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	snapshot, err := Inspect(ctx, workspace)
	if err != nil {
		t.Fatal(err)
	}
	resolved, err := filepath.EvalSymlinks(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if snapshot.Workspace != filepath.Clean(resolved) ||
		!snapshot.Git.Available || snapshot.Git.IsRepository {
		t.Fatalf("unexpected non-repository snapshot: %#v", snapshot)
	}
}

func TestInspectAndDiffExposeReadOnlyFileChanges(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is unavailable")
	}
	workspace := t.TempDir()
	runGitFixture(t, workspace, "init")
	runGitFixture(t, workspace, "config", "user.email", "fixture@example.test")
	runGitFixture(t, workspace, "config", "user.name", "MilkSU Fixture")
	file := filepath.Join(workspace, "hello.txt")
	if err := os.WriteFile(file, []byte("first\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	runGitFixture(t, workspace, "add", "hello.txt")
	runGitFixture(t, workspace, "commit", "-m", "fixture")
	if err := os.WriteFile(file, []byte("first\nsecond\n"), 0o600); err != nil {
		t.Fatal(err)
	}

	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	snapshot, err := Inspect(ctx, workspace)
	if err != nil {
		t.Fatal(err)
	}
	if len(snapshot.Git.Changes) != 1 ||
		snapshot.Git.Changes[0].Path != "hello.txt" ||
		!snapshot.Git.Changes[0].Modified ||
		snapshot.Git.Changes[0].Additions != 1 ||
		snapshot.Git.Changes[0].Deletions != 0 {
		t.Fatalf("unexpected change snapshot: %#v", snapshot.Git.Changes)
	}
	diff, err := InspectDiff(ctx, workspace, snapshot.Git.Changes[0].Path)
	if err != nil {
		t.Fatal(err)
	}
	if diff.Staged != "" || !strings.Contains(diff.WorkingTree, "+second") {
		t.Fatalf("unexpected diff: %#v", diff)
	}
}

func TestInspectDiffRejectsWorkspaceEscape(t *testing.T) {
	if _, err := InspectDiff(context.Background(), t.TempDir(), "../outside"); err == nil {
		t.Fatal("expected workspace escape to be rejected")
	}
}

func runGitFixture(t *testing.T, workspace string, arguments ...string) {
	t.Helper()
	command := exec.Command("git", append([]string{"-C", workspace}, arguments...)...)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v failed: %v\n%s", arguments, err, output)
	}
}
