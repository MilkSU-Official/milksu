package main

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

func TestMaybeRunCodingGitDeliverySmokeStagesCommitsAndPushes(t *testing.T) {
	if _, err := exec.LookPath("git"); err != nil {
		t.Skip("git is unavailable")
	}
	root := t.TempDir()
	workspace := filepath.Join(root, "workspace")
	remote := filepath.Join(root, "origin.git")
	mkdirAll(t, workspace)
	runGitSmokeFixture(t, "", "init", "--bare", remote)
	runGitSmokeFixture(t, workspace, "init")
	runGitSmokeFixture(t, workspace, "checkout", "-B", "main")
	runGitSmokeFixture(t, workspace, "config", "user.name", "MilkSU Git Smoke")
	runGitSmokeFixture(t, workspace, "config", "user.email", "milksu-git-smoke@example.invalid")
	writeFileFixture(t, filepath.Join(workspace, "README.md"), "initial\n")
	runGitSmokeFixture(t, workspace, "add", "--", ".")
	runGitSmokeFixture(t, workspace, "commit", "-m", "seed fixture")
	runGitSmokeFixture(t, workspace, "remote", "add", "origin", remote)
	runGitSmokeFixture(t, workspace, "push", "-u", "origin", "main")
	beforeHead := gitOutputFixture(t, workspace, "rev-parse", "--short=12", "HEAD")

	writeFileFixture(t, filepath.Join(workspace, "README.md"), "initial\nchanged\n")
	writeFileFixture(t, filepath.Join(workspace, "src", "main.go"), "package main\n")
	reportPath := filepath.Join(root, "git-delivery-smoke.json")
	t.Setenv(codingGitDeliverySmokeResultEnv, reportPath)
	t.Setenv(codingGitDeliverySmokeWorkspaceEnv, workspace)
	t.Setenv(codingGitDeliverySmokeMessageEnv, "test: packaged app git smoke")

	application := &App{
		dataDirectory: t.TempDir(),
		diagnostics:   appdata.NewDiagnosticRecorder(32),
	}
	application.maybeRunCodingGitDeliverySmoke()

	payload, err := os.ReadFile(reportPath)
	if err != nil {
		t.Fatalf("read Git delivery smoke report: %v", err)
	}
	var report codingGitDeliverySmokeReport
	if err := json.Unmarshal(payload, &report); err != nil {
		t.Fatalf("decode Git delivery smoke report: %v", err)
	}
	if report.Error != "" {
		t.Fatalf("Git delivery smoke failed: %s", report.Error)
	}
	if report.Schema != codingGitDeliverySmokeSchema {
		t.Fatalf("unexpected schema: %s", report.Schema)
	}
	if !report.Gates.WorkspaceIsRepository ||
		!report.Gates.HadPendingChanges ||
		!report.Gates.StageAllStagedChanges ||
		!report.Gates.CommitCreatedHead ||
		!report.Gates.PushUpdatedUpstream ||
		!report.Gates.CleanAfterPush {
		t.Fatalf("unexpected gates: %+v", report.Gates)
	}
	if report.Before.Git.Head != beforeHead ||
		report.Push.Snapshot.Git.Head == beforeHead ||
		report.Push.Snapshot.Git.Ahead != 0 ||
		report.Push.Snapshot.Git.Dirty {
		t.Fatalf("unexpected Git snapshots: before=%+v push=%+v", report.Before.Git, report.Push.Snapshot.Git)
	}
	remoteHead := gitOutputFixture(t, "", "--git-dir", remote, "rev-parse", "--short=12", "refs/heads/main")
	if remoteHead != report.Push.Snapshot.Git.Head {
		t.Fatalf("remote head %s did not match pushed head %s", remoteHead, report.Push.Snapshot.Git.Head)
	}
	if status := gitOutputFixture(t, workspace, "status", "--porcelain=v1"); status != "" {
		t.Fatalf("workspace not clean after smoke: %q", status)
	}
}

func mkdirAll(t *testing.T, path string) {
	t.Helper()
	if err := os.MkdirAll(path, 0o700); err != nil {
		t.Fatalf("mkdir %s: %v", path, err)
	}
}

func writeFileFixture(t *testing.T, path, content string) {
	t.Helper()
	mkdirAll(t, filepath.Dir(path))
	if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
		t.Fatalf("write %s: %v", path, err)
	}
}

func runGitSmokeFixture(t *testing.T, directory string, arguments ...string) {
	t.Helper()
	command := exec.Command("git", arguments...)
	if directory != "" {
		command.Dir = directory
	}
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("git %v failed: %v\n%s", arguments, err, output)
	}
}

func gitOutputFixture(t *testing.T, directory string, arguments ...string) string {
	t.Helper()
	command := exec.Command("git", arguments...)
	if directory != "" {
		command.Dir = directory
	}
	output, err := command.Output()
	if err != nil {
		t.Fatalf("git %v failed: %v", arguments, err)
	}
	return string(bytesTrimSpace(output))
}

func bytesTrimSpace(value []byte) []byte {
	for len(value) > 0 && (value[0] == '\n' || value[0] == '\r' || value[0] == '\t' || value[0] == ' ') {
		value = value[1:]
	}
	for len(value) > 0 {
		last := value[len(value)-1]
		if last != '\n' && last != '\r' && last != '\t' && last != ' ' {
			break
		}
		value = value[:len(value)-1]
	}
	return value
}
