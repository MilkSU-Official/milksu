package codingattachment

import (
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStoreImportsContentAddressedAttachment(t *testing.T) {
	root := filepath.Join(t.TempDir(), "attachments")
	store, err := NewStore(root)
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(t.TempDir(), "notes.md")
	content := []byte("# Evidence\nMilkSU attachment")
	if err := os.WriteFile(source, content, 0o600); err != nil {
		t.Fatal(err)
	}

	got, err := store.Import([]string{source})
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 {
		t.Fatalf("expected one attachment, got %#v", got)
	}
	digest := sha256.Sum256(content)
	wantDigest := hex.EncodeToString(digest[:])
	if got[0].ID != wantDigest || got[0].SHA256 != wantDigest ||
		got[0].Name != "notes.md" || got[0].Size != int64(len(content)) {
		t.Fatalf("unexpected metadata: %#v", got[0])
	}
	stored := filepath.Join(root, wantDigest, "notes.md")
	storedContent, err := os.ReadFile(stored)
	if err != nil {
		t.Fatal(err)
	}
	if string(storedContent) != string(content) {
		t.Fatalf("unexpected stored content: %q", storedContent)
	}
	info, err := os.Stat(stored)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("expected 0600 attachment, got %o", info.Mode().Perm())
	}
}

func TestStoreImportsClipboardPayloadAndPreviewsImage(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "attachments"))
	if err != nil {
		t.Fatal(err)
	}
	image := []byte("\x89PNG\r\n\x1a\nfixture")
	attachments, err := store.ImportPayloads([]ImportPayload{{
		Name: "clipboard.png", MediaType: "image/png",
		DataBase64: base64.StdEncoding.EncodeToString(image),
	}})
	if err != nil {
		t.Fatal(err)
	}
	if len(attachments) != 1 || attachments[0].MediaType != "image/png" {
		t.Fatalf("unexpected clipboard import: %#v", attachments)
	}
	preview, err := store.Preview(attachments[0])
	if err != nil {
		t.Fatal(err)
	}
	if preview.Kind != "image" || !strings.HasPrefix(preview.DataURL, "data:image/png;base64,") {
		t.Fatalf("unexpected image preview: %#v", preview)
	}
}

func TestStoreClipboardPayloadRejectsInvalidData(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "attachments"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.ImportPayloads([]ImportPayload{{
		Name: "broken.png", MediaType: "image/png", DataBase64: "not-base64",
	}}); err == nil {
		t.Fatal("invalid clipboard payload should fail")
	}
}

func TestStoreRejectsSymlinkAndOversizedBatch(t *testing.T) {
	store, err := NewStore(filepath.Join(t.TempDir(), "attachments"))
	if err != nil {
		t.Fatal(err)
	}
	source := filepath.Join(t.TempDir(), "source.txt")
	if err := os.WriteFile(source, []byte("fixture"), 0o600); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(t.TempDir(), "link.txt")
	if err := os.Symlink(source, link); err != nil {
		t.Fatal(err)
	}
	if _, err := store.Import([]string{link}); err == nil || !strings.Contains(err.Error(), "不能是链接") {
		t.Fatalf("expected symlink rejection, got %v", err)
	}
	paths := make([]string, MaxCount+1)
	if _, err := store.Import(paths); err == nil || !strings.Contains(err.Error(), "最多") {
		t.Fatalf("expected count rejection, got %v", err)
	}
}
