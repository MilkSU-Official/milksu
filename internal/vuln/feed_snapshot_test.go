package vuln

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestPersistFeedSnapshotStoresRawJSONWithAuditMetadata(t *testing.T) {
	root := t.TempDir()
	body := `{"vulnerabilities":[{"cveID":"CVE-2024-3400"}]}`

	download, err := PersistFeedSnapshot(root, FeedSnapshotDownload{
		SourceName:   "CISA KEV",
		SourceURL:    CISAKEVFeedURL,
		RetrievedAt:  "2026-08-04T07:08:09Z",
		LastModified: "Tue, 04 Aug 2026 07:08:09 GMT",
		HTTPStatus:   200,
		ContentType:  "application/json",
		Body:         body,
	})
	if err != nil {
		t.Fatalf("PersistFeedSnapshot() error = %v", err)
	}
	if !strings.HasPrefix(download.SnapshotPath, filepath.Join(root, "vuln", "feed-snapshots", "cisa-kev")) {
		t.Fatalf("snapshot path escaped app data directory: %q", download.SnapshotPath)
	}
	if !strings.Contains(filepath.Base(download.SnapshotPath), "20260804T070809Z-") {
		t.Fatalf("snapshot path did not include retrieved timestamp: %q", download.SnapshotPath)
	}
	if download.SnapshotSizeBytes != int64(len(body)) {
		t.Fatalf("SnapshotSizeBytes = %d", download.SnapshotSizeBytes)
	}
	sum := sha256.Sum256([]byte(body))
	expectedDigest := hex.EncodeToString(sum[:])
	if download.SnapshotSHA256 != expectedDigest {
		t.Fatalf("SnapshotSHA256 = %q", download.SnapshotSHA256)
	}
	saved, err := os.ReadFile(download.SnapshotPath)
	if err != nil {
		t.Fatalf("read snapshot: %v", err)
	}
	if string(saved) != body {
		t.Fatalf("snapshot body = %q", string(saved))
	}
	info, err := os.Stat(download.SnapshotPath)
	if err != nil {
		t.Fatalf("stat snapshot: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("snapshot mode = %o", info.Mode().Perm())
	}
}

func TestPersistFeedSnapshotRejectsMissingRootOrBody(t *testing.T) {
	if _, err := PersistFeedSnapshot("", FeedSnapshotDownload{Body: "{}"}); err == nil {
		t.Fatalf("expected missing root error")
	}
	if _, err := PersistFeedSnapshot(t.TempDir(), FeedSnapshotDownload{}); err == nil {
		t.Fatalf("expected empty body error")
	}
}
