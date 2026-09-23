package lab

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestWriteJobContextMirrorsTheSavedRequest(t *testing.T) {
	workspace := t.TempDir()
	secret := "sk-abcdefghijklmnopqrstuv"
	err := WriteJobContext(workspace, Job{
		ID:      "job-one",
		Title:   "本机练习机",
		Scope:   "local",
		Request: "只看本机进程，不要带上 " + secret,
	})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(workspace, JobContextFileName))
	if err != nil {
		t.Fatal(err)
	}
	text := string(data)
	if strings.Contains(text, secret) || !strings.Contains(text, "[redacted]") {
		t.Fatalf("job context: %s", text)
	}
	if !strings.Contains(text, "本机练习机") || !strings.Contains(text, "范围：本机") || !strings.Contains(text, "只看本机进程") {
		t.Fatalf("job context: %s", text)
	}
	if !strings.Contains(text, "report.md") {
		t.Fatalf("job context: %s", text)
	}
	info, err := os.Stat(filepath.Join(workspace, JobContextFileName))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %o", info.Mode().Perm())
	}
}

func TestWriteJobContextRejectsASymlink(t *testing.T) {
	workspace := t.TempDir()
	outside := filepath.Join(t.TempDir(), "outside.md")
	if err := os.WriteFile(outside, []byte("outside"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(workspace, JobContextFileName)); err != nil {
		t.Fatal(err)
	}
	err := WriteJobContext(workspace, Job{ID: "job-one", Title: "练习", Scope: "local", Request: "看进程"})
	if err == nil {
		t.Fatal("symlink was overwritten")
	}
	data, readErr := os.ReadFile(outside)
	if readErr != nil || string(data) != "outside" {
		t.Fatalf("symlink target changed: %q %v", data, readErr)
	}
}
