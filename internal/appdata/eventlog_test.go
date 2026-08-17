package appdata

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

func TestAppendEventLogPersistsOnlyAllowlistedEvents(t *testing.T) {
	root := t.TempDir()
	if err := AppendEventLog(root, PersistedSidecarStarted); err != nil {
		t.Fatal(err)
	}
	if err := AppendEventLog(root, PersistedSidecarProtocolError); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, eventLogRelativePath)
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	text := string(payload)
	for _, expected := range []string{
		string(PersistedSidecarStarted),
		string(PersistedSidecarProtocolError),
		"coding-engine",
		"error",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("persisted log missing %q: %q", expected, text)
		}
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && info.Mode().Perm() != 0o600 {
		t.Fatalf("log permissions = %o, want 600", info.Mode().Perm())
	}
	directory, err := os.Stat(filepath.Dir(path))
	if err != nil {
		t.Fatal(err)
	}
	if runtime.GOOS != "windows" && directory.Mode().Perm() != 0o700 {
		t.Fatalf("log directory permissions = %o, want 700", directory.Mode().Perm())
	}
}

func TestAppendEventLogRejectsFreeFormEvents(t *testing.T) {
	root := t.TempDir()
	raw := PersistedEvent("tool output api_key=must-not-persist")
	if err := AppendEventLog(root, raw); err == nil {
		t.Fatal("expected unknown free-form event to be rejected")
	}
	if _, err := os.Stat(filepath.Join(root, eventLogRelativePath)); !os.IsNotExist(err) {
		t.Fatalf("rejected event must not create a log file, got %v", err)
	}
}

func TestDiagnosticRecorderNeverPersistsFreeFormMessages(t *testing.T) {
	root := t.TempDir()
	recorder := NewDiagnosticRecorder(16)
	recorder.Record(
		"engine",
		"error",
		"tool raw output api_key=must-stay-in-memory",
	)
	if len(recorder.Snapshot()) != 1 {
		t.Fatalf("in-memory diagnostic event was lost: %#v", recorder.Snapshot())
	}
	if _, err := os.Stat(filepath.Join(root, eventLogRelativePath)); !os.IsNotExist(err) {
		t.Fatalf("free-form recorder event must not be persisted, got %v", err)
	}
}

func TestEventLogRotationKeepsOneArchive(t *testing.T) {
	root := t.TempDir()
	path := filepath.Join(root, eventLogRelativePath)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	filler := strings.Repeat("a", maxEventLogBytes)
	if err := os.WriteFile(path, []byte(filler), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := AppendEventLog(root, PersistedDesktopRuntimeStarted); err != nil {
		t.Fatal(err)
	}
	archive, err := os.Stat(path + ".1")
	if err != nil {
		t.Fatalf("expected rotated archive: %v", err)
	}
	if archive.Size() != int64(maxEventLogBytes) {
		t.Fatalf("archive size = %d, want %d", archive.Size(), maxEventLogBytes)
	}
	current, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(current), string(PersistedDesktopRuntimeStarted)) {
		t.Fatalf("rotated log lost new event: %q", current)
	}

	if err := os.WriteFile(path, []byte(filler), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := AppendEventLog(root, PersistedDesktopRuntimeExited); err != nil {
		t.Fatal(err)
	}
	currentAfter, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(currentAfter), string(PersistedDesktopRuntimeExited)) {
		t.Fatalf("log missing second event: %q", currentAfter)
	}
}

func TestEventLogRejectsSymlink(t *testing.T) {
	root := t.TempDir()
	target := filepath.Join(t.TempDir(), "outside.log")
	if err := os.WriteFile(target, []byte("must not be touched"), 0o600); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, eventLogRelativePath)
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(target, path); err != nil {
		t.Fatal(err)
	}
	if err := AppendEventLog(root, PersistedAppInitialized); err == nil {
		t.Fatal("expected AppendEventLog to reject a symlinked log")
	}
	payload, err := os.ReadFile(target)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), string(PersistedAppInitialized)) {
		t.Fatal("symlinked log target was written through")
	}
}

func TestEventLogRejectsSymlinkedRuntimeDirectory(t *testing.T) {
	root := t.TempDir()
	outside := t.TempDir()
	if err := os.Symlink(outside, filepath.Join(root, "runtime")); err != nil {
		t.Fatal(err)
	}
	if err := AppendEventLog(root, PersistedAppInitialized); err == nil {
		t.Fatal("expected a symlinked runtime directory to be rejected")
	}
	if _, err := os.Stat(filepath.Join(outside, "milksu.log")); !os.IsNotExist(err) {
		t.Fatalf("event log escaped through runtime symlink: %v", err)
	}
}
