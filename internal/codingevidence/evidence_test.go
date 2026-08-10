package codingevidence

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

const fixtureSessionID = "browser_12345678-abcd-4567-8901-123456789abc"

func workspaceWithEvidence(t *testing.T) string {
	t.Helper()
	workspace := t.TempDir()
	evidence := filepath.Join(workspace, EvidenceRelativeDir, fixtureSessionID)
	if err := os.MkdirAll(evidence, 0o755); err != nil {
		t.Fatal(err)
	}
	return workspace
}

func TestValidSessionID(t *testing.T) {
	for _, value := range []string{
		fixtureSessionID,
		"browser_abc12345",
		"browser_00000000-0000-4000-8000-000000000000",
	} {
		if !ValidSessionID(value) {
			t.Fatalf("expected %q to be a valid session id", value)
		}
	}
	for _, value := range []string{
		"",
		"browser_",
		"browser_abc",
		"other_abc12345",
		"browser_abc12345/..",
		"../browser_abc12345",
		"browser_abc 12345",
		"browser_" + strings.Repeat("a", 129),
	} {
		if ValidSessionID(value) {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
}

func TestDeriveRejectsMissingConversationID(t *testing.T) {
	workspace := workspaceWithEvidence(t)
	_, err := Derive(Request{
		ConversationID: "  ",
		SessionID:      fixtureSessionID,
		Workspace:      workspace,
	})
	if err == nil || !strings.Contains(err.Error(), "会话标识") {
		t.Fatalf("expected a conversation id error, got %v", err)
	}
}

func TestDeriveRejectsMissingSession(t *testing.T) {
	workspace := workspaceWithEvidence(t)
	_, err := Derive(Request{
		ConversationID: "conversation-1",
		SessionID:      "  ",
		Workspace:      workspace,
	})
	if err == nil || !strings.Contains(err.Error(), "没有活跃的浏览器") {
		t.Fatalf("expected a no-session error, got %v", err)
	}
}

func TestDeriveRejectsInvalidSessionID(t *testing.T) {
	workspace := workspaceWithEvidence(t)
	for _, sessionID := range []string{"../browser_abc12345", "browser_abc", "shared_session"} {
		_, err := Derive(Request{
			ConversationID: "conversation-1",
			SessionID:      sessionID,
			Workspace:      workspace,
		})
		if err == nil || !strings.Contains(err.Error(), "会话标识无效") {
			t.Fatalf("expected session id %q to be rejected, got %v", sessionID, err)
		}
	}
}

func TestDeriveRejectsInconsistentWorkspace(t *testing.T) {
	workspace := workspaceWithEvidence(t)
	values := []string{"", "relative/workspace", filepath.Join(workspace, "does-not-exist")}
	file, err := os.Create(filepath.Join(workspace, "some-file"))
	if err != nil {
		t.Fatal(err)
	}
	_ = file.Close()
	values = append(values, filepath.Join(workspace, "some-file"))
	for _, value := range values {
		_, err := Derive(Request{
			ConversationID: "conversation-1",
			SessionID:      fixtureSessionID,
			Workspace:      value,
		})
		if err == nil {
			t.Fatalf("expected workspace %q to be rejected", value)
		}
	}
}

func TestDeriveRejectsMissingEvidenceDirectory(t *testing.T) {
	workspace := t.TempDir()
	_, err := Derive(Request{
		ConversationID: "conversation-1",
		SessionID:      fixtureSessionID,
		Workspace:      workspace,
	})
	if err == nil || !strings.Contains(err.Error(), "浏览器证据目录不存在") {
		t.Fatalf("expected a missing-directory error, got %v", err)
	}
}

func TestDeriveRejectsMissingSessionDirectoryWithinEvidence(t *testing.T) {
	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, EvidenceRelativeDir), 0o755); err != nil {
		t.Fatal(err)
	}
	_, err := Derive(Request{
		ConversationID: "conversation-1",
		SessionID:      fixtureSessionID,
		Workspace:      workspace,
	})
	if err == nil || !strings.Contains(err.Error(), "浏览器证据目录不存在") {
		t.Fatalf("expected a missing-directory error, got %v", err)
	}
}

func TestDeriveRejectsSymlinkedSessionDirectory(t *testing.T) {
	workspace := t.TempDir()
	outside := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, EvidenceRelativeDir), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(
		outside,
		filepath.Join(workspace, EvidenceRelativeDir, fixtureSessionID),
	); err != nil {
		t.Fatal(err)
	}
	_, err := Derive(Request{
		ConversationID: "conversation-1",
		SessionID:      fixtureSessionID,
		Workspace:      workspace,
	})
	if err == nil || !strings.Contains(err.Error(), "符号链接") {
		t.Fatalf("expected a symlink rejection, got %v", err)
	}
}

func TestDeriveRejectsSymlinkedEvidenceParent(t *testing.T) {
	workspace := t.TempDir()
	outside := t.TempDir()
	if err := os.MkdirAll(filepath.Join(outside, fixtureSessionID), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(workspace, ".milksu"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(
		outside,
		filepath.Join(workspace, ".milksu", "browser-evidence"),
	); err != nil {
		t.Fatal(err)
	}
	_, err := Derive(Request{
		ConversationID: "conversation-1",
		SessionID:      fixtureSessionID,
		Workspace:      workspace,
	})
	if err == nil || !strings.Contains(err.Error(), "符号链接") {
		t.Fatalf("expected a symlink rejection, got %v", err)
	}
}

func TestDeriveRejectsEvidenceFileInsteadOfDirectory(t *testing.T) {
	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, EvidenceRelativeDir), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(workspace, EvidenceRelativeDir, fixtureSessionID),
		[]byte("not a directory"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	_, err := Derive(Request{
		ConversationID: "conversation-1",
		SessionID:      fixtureSessionID,
		Workspace:      workspace,
	})
	if err == nil || !strings.Contains(err.Error(), "不是目录") {
		t.Fatalf("expected a not-directory rejection, got %v", err)
	}
}

func TestDeriveReturnsExactDirectory(t *testing.T) {
	workspace := workspaceWithEvidence(t)
	resolvedWorkspace, err := filepath.EvalSymlinks(workspace)
	if err != nil {
		t.Fatal(err)
	}
	want := filepath.Join(resolvedWorkspace, EvidenceRelativeDir, fixtureSessionID)
	got, err := Derive(Request{
		ConversationID: "conversation-1",
		SessionID:      fixtureSessionID,
		Workspace:      workspace + string(filepath.Separator),
	})
	if err != nil {
		t.Fatalf("derive exact directory: %v", err)
	}
	if got != want {
		t.Fatalf("unexpected evidence directory: got %q want %q", got, want)
	}
	info, err := os.Stat(got)
	if err != nil || !info.IsDir() {
		t.Fatalf("derived directory is not a real directory: %v", err)
	}
}

func TestRevealInFinderUsesTheInjectedOpener(t *testing.T) {
	if runtime.GOOS != "darwin" {
		t.Skip("Finder integration is macOS-only")
	}
	var revealed []string
	open := func(directory string) error {
		revealed = append(revealed, directory)
		return nil
	}
	if err := RevealInFinder("/tmp/evidence", open); err != nil {
		t.Fatalf("reveal evidence directory: %v", err)
	}
	if len(revealed) != 1 || revealed[0] != "/tmp/evidence" {
		t.Fatalf("expected the opener to receive the exact directory, got %#v", revealed)
	}
	if err := RevealInFinder("/tmp/evidence", func(string) error {
		return os.ErrPermission
	}); err == nil || !strings.Contains(err.Error(), "打开浏览器证据目录") {
		t.Fatalf("expected opener errors to surface, got %v", err)
	}
}
