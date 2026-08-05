package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/vuln"
)

func TestVulnerabilityFeedSmokeReportRecordsSnapshotAndFactsWithoutBody(t *testing.T) {
	dataDirectory := t.TempDir()
	application := &App{
		dataDirectory: dataDirectory,
		diagnostics:   appdata.NewDiagnosticRecorder(32),
	}
	const fixtureSecret = "OPENAI_API_KEY=package-smoke-vuln-feed-secret-never-log"
	const body = `{
  "vulnerabilities": [{
    "cve": {
      "id": "CVE-2024-3400",
      "published": "2024-04-12T15:15:07.000",
      "lastModified": "2025-01-10T18:15:10.000",
      "vulnStatus": "Analyzed",
      "references": [{"url": "https://example.test/?token=` + fixtureSecret + `"}],
      "metrics": {
        "cvssMetricV31": [{
          "cvssData": {
            "baseScore": 10,
            "baseSeverity": "CRITICAL"
          }
        }]
      }
    }
  }]
}`
	report := application.buildVulnerabilityFeedSmokeReport(
		"CVE-2024-3400",
		func(cveID string) (vuln.FeedSnapshotDownload, error) {
			if cveID != "CVE-2024-3400" {
				t.Fatalf("fetcher cveID = %q", cveID)
			}
			return vuln.PersistFeedSnapshot(dataDirectory, vuln.FeedSnapshotDownload{
				SourceName:   vuln.NVDCVEFeedName,
				SourceURL:    vuln.NVDCVEAPIURL + "?cveId=CVE-2024-3400",
				RetrievedAt:  "2026-08-05T02:40:00Z",
				LastModified: "Wed, 05 Aug 2026 02:35:00 GMT",
				HTTPStatus:   200,
				ContentType:  "application/json",
				Body:         body,
			})
		},
	)
	if report.Error != "" {
		t.Fatalf("smoke report error = %q", report.Error)
	}
	if report.Schema != "milksu-vuln-feed-packaged-smoke/v1" ||
		report.Download.SourceName != vuln.NVDCVEFeedName ||
		report.Download.RetrievedAt == "" ||
		!report.Download.BodyContainsCVE {
		t.Fatalf("unexpected smoke report metadata: %#v", report)
	}
	if !report.Fact.Present ||
		report.Fact.ID != "CVE-2024-3400" ||
		report.Fact.Severity != "CRITICAL" ||
		report.Fact.BaseScore != 10 ||
		report.Fact.Published == "" ||
		report.Fact.LastModified == "" {
		t.Fatalf("unexpected smoke CVE fact: %#v", report.Fact)
	}
	if !strings.HasPrefix(
		report.Download.SnapshotPath,
		filepath.Join(dataDirectory, "vuln", "feed-snapshots", "nvd")+string(os.PathSeparator),
	) {
		t.Fatalf("snapshot escaped App data directory: %q", report.Download.SnapshotPath)
	}
	payload, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	serialized := string(payload)
	if strings.Contains(serialized, fixtureSecret) || strings.Contains(serialized, "references") {
		t.Fatalf("smoke report leaked raw feed body: %s", serialized)
	}
}

func TestWriteVulnerabilityFeedSmokeReportProtectsFile(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "vuln-feed-smoke.json")
	report := vulnerabilityFeedSmokeReport{
		Schema: "milksu-vuln-feed-packaged-smoke/v1",
		CVEID:  "CVE-2024-3400",
	}
	if err := writeVulnerabilityFeedSmokeReport(path, report); err != nil {
		t.Fatalf("writeVulnerabilityFeedSmokeReport() error = %v", err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("report mode = %o, want 0600", info.Mode().Perm())
	}
}
