package codingenv

import (
	"context"
	"os/exec"
	"path/filepath"
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

func TestParseNumstatIgnoresBinaryCounters(t *testing.T) {
	additions, deletions := parseNumstat("12\t4\tapp.go\n-\t-\tasset.png\n3\t0\tnew.go\n")
	if additions != 15 || deletions != 4 {
		t.Fatalf("unexpected numstat: +%d -%d", additions, deletions)
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
