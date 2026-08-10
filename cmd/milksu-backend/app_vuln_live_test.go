package main

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

func TestLiveAppFetchNVDCVEPersistsSnapshot(t *testing.T) {
	if os.Getenv("MILKSU_LIVE_CVE_APP_SMOKE") != "1" {
		t.Skip("set MILKSU_LIVE_CVE_APP_SMOKE=1 to run the public read-only App CVE feed smoke")
	}
	dataDirectory := t.TempDir()
	application := &App{
		dataDirectory: dataDirectory,
		diagnostics:   appdata.NewDiagnosticRecorder(32),
	}

	download, err := application.FetchNVDCVE("CVE-2024-3400")
	if err != nil {
		t.Fatalf("FetchNVDCVE() live error = %v", err)
	}
	if download.SourceName != "NVD" ||
		!strings.Contains(download.SourceURL, "cveId=CVE-2024-3400") ||
		download.RetrievedAt == "" ||
		!strings.Contains(download.Body, "CVE-2024-3400") {
		t.Fatalf(
			"unexpected App CVE feed metadata: source=%q url=%q retrieved=%q status=%d content-type=%q body-bytes=%d",
			download.SourceName,
			download.SourceURL,
			download.RetrievedAt,
			download.HTTPStatus,
			download.ContentType,
			len(download.Body),
		)
	}
	if download.SnapshotPath == "" || download.SnapshotSHA256 == "" || download.SnapshotSizeBytes <= 0 {
		t.Fatalf("App CVE feed did not return persisted snapshot metadata: %#v", download)
	}
	wantPrefix := filepath.Join(dataDirectory, "vuln", "feed-snapshots", "nvd") + string(os.PathSeparator)
	if !strings.HasPrefix(download.SnapshotPath, wantPrefix) {
		t.Fatalf("snapshot path escaped app data directory: %q, want prefix %q", download.SnapshotPath, wantPrefix)
	}
	body, err := os.ReadFile(download.SnapshotPath)
	if err != nil {
		t.Fatalf("read persisted NVD snapshot: %v", err)
	}
	if string(body) != download.Body {
		t.Fatalf("persisted snapshot body did not match returned App payload")
	}
	sum := sha256.Sum256(body)
	if got := hex.EncodeToString(sum[:]); got != download.SnapshotSHA256 {
		t.Fatalf("SnapshotSHA256 = %q, want %q", download.SnapshotSHA256, got)
	}
	info, err := os.Stat(download.SnapshotPath)
	if err != nil {
		t.Fatalf("stat persisted NVD snapshot: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("snapshot mode = %o, want 0600", info.Mode().Perm())
	}
	relativeSnapshotPath, err := filepath.Rel(dataDirectory, download.SnapshotPath)
	if err != nil {
		relativeSnapshotPath = filepath.Base(download.SnapshotPath)
	}
	t.Logf(
		"App NVD CVE live smoke persisted %s: retrievedAt=%s snapshot=%s size=%d sha256=%s…",
		download.SourceURL,
		download.RetrievedAt,
		relativeSnapshotPath,
		download.SnapshotSizeBytes,
		download.SnapshotSHA256[:16],
	)
}
