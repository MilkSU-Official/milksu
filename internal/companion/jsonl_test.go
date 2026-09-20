package companion

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func writeCompanionJSONL(t *testing.T, dir string, lines []string) string {
	t.Helper()
	sessionDir := filepath.Join(dir, "sessions")
	if err := os.MkdirAll(sessionDir, 0o700); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(sessionDir, "2026-01-01T00-00-00-000Z_companion.jsonl")
	body := strings.Join(lines, "\n") + "\n"
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return path
}

func TestTranscriptKeysetDoesNotUseOffset(t *testing.T) {
	dir := t.TempDir()
	lines := []string{
		`{"type":"session","id":"companion","timestamp":"2026-01-01T00:00:00Z"}`,
		`{"type":"message","id":"a1","timestamp":"2026-01-01T00:00:01Z","message":{"role":"user","content":[{"type":"text","text":"one"}]}}`,
		`{"type":"message","id":"a2","timestamp":"2026-01-01T00:00:02Z","message":{"role":"assistant","content":[{"type":"text","text":"two"}]}}`,
		`{"type":"message","id":"a3","timestamp":"2026-01-01T00:00:03Z","message":{"role":"user","content":[{"type":"text","text":"three"}]}}`,
		`{"type":"message","id":"a4","timestamp":"2026-01-01T00:00:04Z","message":{"role":"assistant","content":[{"type":"text","text":"four"}]}}`,
	}
	path := writeCompanionJSONL(t, dir, lines)
	found, err := FindCompanionSessionFile(dir)
	if err != nil || found != path {
		t.Fatalf("find: %s %v", found, err)
	}
	tail, err := ReadTranscriptPage(path, 2, nil, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(tail.Entries) != 2 || tail.Entries[0].ID != "a3" || tail.Entries[1].ID != "a4" {
		t.Fatalf("tail: %#v", tail.Entries)
	}
	if tail.PrevCursor == nil {
		t.Fatal("expected prev cursor")
	}
	older, err := ReadTranscriptPage(path, 2, tail.PrevCursor, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(older.Entries) != 2 || older.Entries[0].ID != "a1" || older.Entries[1].ID != "a2" {
		t.Fatalf("older: %#v", older.Entries)
	}
	newer, err := ReadTranscriptPage(path, 2, older.NextCursor, false)
	if err != nil {
		t.Fatal(err)
	}
	if len(newer.Entries) == 0 || newer.Entries[0].ID == "a1" && len(newer.Entries) > 1 && newer.Entries[0].ID == older.Entries[0].ID {
		// forward from a2 should start after a2
	}
	if newer.Entries[0].ID != "a3" {
		t.Fatalf("forward after a2: %#v", newer.Entries)
	}
}

func TestTranscriptKeepsAssistantErrorAndSkipsBareTypeNames(t *testing.T) {
	dir := t.TempDir()
	lines := []string{
		`{"type":"session","id":"companion","timestamp":"2026-01-01T00:00:00Z"}`,
		`{"type":"model_change","id":"m1","timestamp":"2026-01-01T00:00:00Z","provider":"tokenflux","modelId":"google/gemini-3.8-flash"}`,
		`{"type":"message","id":"u1","timestamp":"2026-01-01T00:00:01Z","message":{"role":"user","content":[{"type":"text","text":"hi"}]}}`,
		`{"type":"message","id":"a1","timestamp":"2026-01-01T00:00:02Z","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"403: {\"message\":\"The current group does not support the requested model\"}"}}`,
	}
	path := writeCompanionJSONL(t, dir, lines)
	page, err := ReadTranscriptPage(path, 10, nil, true)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Entries) != 2 {
		t.Fatalf("entries: %#v", page.Entries)
	}
	if page.Entries[0].Role != "user" || page.Entries[0].Text != "hi" {
		t.Fatalf("user: %#v", page.Entries[0])
	}
	if page.Entries[1].Role != "assistant" {
		t.Fatalf("assistant role: %#v", page.Entries[1])
	}
	if page.Entries[1].Text != "" {
		t.Fatalf("failed assistant must not invent text: %#v", page.Entries[1])
	}
	if !strings.Contains(page.Entries[1].Error, "does not support the requested model") {
		t.Fatalf("assistant error: %#v", page.Entries[1])
	}
}

func TestArchiveAndDeleteCompanionSegment(t *testing.T) {
	dir := t.TempDir()
	path := writeCompanionJSONL(t, dir, []string{
		`{"type":"session","id":"companion","timestamp":"2026-01-01T00:00:00Z"}`,
		`{"type":"message","id":"a1","timestamp":"2026-01-01T00:00:01Z","message":{"role":"user","content":"hi"}}`,
	})
	archived, err := ArchiveCompanionFile(dir, path)
	if err != nil {
		t.Fatal(err)
	}
	if archived.Name == "" || !archived.Exportable {
		t.Fatalf("archive: %#v", archived)
	}
	listed, err := ListCompanionArchives(dir)
	if err != nil || len(listed) != 1 {
		t.Fatalf("list: %#v %v", listed, err)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Fatal("live file should be gone")
	}
	if err := DeleteCompanionArchive(dir, archived.Name); err != nil {
		t.Fatal(err)
	}
	listed, err = ListCompanionArchives(dir)
	if err != nil || len(listed) != 0 {
		t.Fatalf("deleted: %#v %v", listed, err)
	}
	if err := DeleteCompanionArchive(dir, "../escape.jsonl"); err == nil {
		t.Fatal("path escape must fail")
	}
}
