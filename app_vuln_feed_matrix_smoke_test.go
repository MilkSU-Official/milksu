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

func TestVulnerabilityFeedMatrixSmokeRequiresEverySourceAndPracticeMatch(t *testing.T) {
	dataDirectory := t.TempDir()
	application := &App{
		dataDirectory: dataDirectory,
		diagnostics:   appdata.NewDiagnosticRecorder(32),
	}
	report := application.buildVulnerabilityFeedMatrixSmokeReport(
		"CVE-2023-46604",
		vulnerabilityFeedMatrixFixtureFetchers(dataDirectory, true),
	)

	if report.Schema != "milksu-vuln-feed-matrix-packaged-smoke/v1" ||
		report.Error != "" ||
		report.CVEID != "CVE-2023-46604" ||
		len(report.Downloads) != 4 {
		t.Fatalf("unexpected matrix report: %#v", report)
	}
	if !report.Gates.FetchedNVD ||
		!report.Gates.FetchedFIRSTEPSS ||
		!report.Gates.FetchedCISAKEV ||
		!report.Gates.FetchedVulhub ||
		!report.Gates.SourceTimingPresent ||
		!report.Gates.SnapshotsPersisted ||
		!report.Gates.SelectedCVEInNVD ||
		!report.Gates.SelectedCVEInFIRSTEPSS ||
		!report.Gates.SelectedCVEInCISAKEV ||
		!report.Gates.SelectedCVEHasVulhubPractice ||
		!report.Gates.RawFeedBodiesOmitted {
		t.Fatalf("matrix gates did not prove every source: %#v", report.Gates)
	}
	if !report.NVD.Present ||
		report.NVD.Severity != "CRITICAL" ||
		report.NVD.BaseScore != 10 ||
		!report.EPSS.Present ||
		report.EPSS.EPSS != "0.932410000" ||
		!report.CISAKEV.Present ||
		!strings.Contains(report.CISAKEV.VulnerabilityName, "ActiveMQ") ||
		!report.Vulhub.Present ||
		report.Vulhub.FirstMatch.Directory != "activemq/CVE-2023-46604" {
		t.Fatalf("matrix report did not extract selected CVE facts: %#v", report)
	}
	serialized, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(serialized), `"body"`) ||
		strings.Contains(string(serialized), "OPENAI_API_KEY") ||
		strings.Contains(string(serialized), "sk-matrix-secret") {
		t.Fatalf("matrix report leaked raw feed body or key-shaped content: %s", serialized)
	}
}

func TestVulnerabilityFeedMatrixSmokeFailsClosedWithoutVulhubMatch(t *testing.T) {
	application := &App{
		dataDirectory: t.TempDir(),
		diagnostics:   appdata.NewDiagnosticRecorder(32),
	}
	report := application.buildVulnerabilityFeedMatrixSmokeReport(
		"CVE-2023-46604",
		vulnerabilityFeedMatrixFixtureFetchers(application.dataDirectory, false),
	)
	if report.Error == "" ||
		report.Gates.SelectedCVEHasVulhubPractice ||
		report.Vulhub.Present {
		t.Fatalf("matrix smoke accepted a catalog without selected CVE practice match: %#v", report)
	}
}

func TestMaybeRunVulnerabilityFeedMatrixSmokeWritesProtectedReport(t *testing.T) {
	reportPath := filepath.Join(t.TempDir(), "vuln-feed-matrix-smoke.json")
	t.Setenv(vulnerabilityFeedMatrixSmokeResultEnv, reportPath)
	t.Setenv(vulnerabilityFeedMatrixSmokeCVEIDEnv, "CVE-2023-46604")
	application := &App{
		dataDirectory: t.TempDir(),
		diagnostics:   appdata.NewDiagnosticRecorder(32),
	}
	report := application.buildVulnerabilityFeedMatrixSmokeReport(
		"CVE-2023-46604",
		vulnerabilityFeedMatrixFixtureFetchers(application.dataDirectory, true),
	)
	if err := writeVulnerabilityFeedMatrixSmokeReport(reportPath, report); err != nil {
		t.Fatalf("writeVulnerabilityFeedMatrixSmokeReport() error = %v", err)
	}
	info, err := os.Stat(reportPath)
	if err != nil {
		t.Fatalf("stat report: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("report mode = %o, want 0600", info.Mode().Perm())
	}
}

func vulnerabilityFeedMatrixFixtureFetchers(
	dataDirectory string,
	includeVulhubMatch bool,
) vulnerabilityFeedMatrixFetchers {
	return vulnerabilityFeedMatrixFetchers{
		FetchNVD: func(cveID string) (vuln.FeedSnapshotDownload, error) {
			return vulnerabilityFeedMatrixDownload(
				dataDirectory,
				vuln.NVDCVEFeedName,
				vuln.NVDCVEAPIURL+"?cveId="+cveID,
				`{"vulnerabilities":[{"cve":{"id":"CVE-2023-46604","published":"2023-10-27T00:00:00.000","lastModified":"2026-08-04T00:00:00.000","vulnStatus":"Analyzed","metrics":{"cvssMetricV31":[{"cvssData":{"baseScore":10.0,"baseSeverity":"CRITICAL"}}]}}}]}`,
			), nil
		},
		FetchEPSS: func(cveID string) (vuln.FeedSnapshotDownload, error) {
			return vulnerabilityFeedMatrixDownload(
				dataDirectory,
				vuln.FIRSTEPSSFeedName,
				vuln.FIRSTEPSSAPIURL+"?cve="+cveID,
				`{"status":"OK","data":[{"cve":"CVE-2023-46604","epss":"0.932410000","percentile":"0.997200000","date":"2026-08-04"}]}`,
			), nil
		},
		FetchCISAKEV: func() (vuln.FeedSnapshotDownload, error) {
			return vulnerabilityFeedMatrixDownload(
				dataDirectory,
				vuln.CISAKEVFeedName,
				vuln.CISAKEVFeedURL,
				`{"title":"CISA Known Exploited Vulnerabilities Catalog","vulnerabilities":[{"cveID":"CVE-2023-46604","vendorProject":"Apache","product":"ActiveMQ","vulnerabilityName":"Apache ActiveMQ OpenWire RCE","dateAdded":"2023-11-02","dueDate":"2023-11-23","knownRansomwareCampaignUse":"Known"}]}`,
			), nil
		},
		FetchVulhub: func() (vuln.FeedSnapshotDownload, error) {
			directory := "other/CVE-2099-0001"
			cveID := "CVE-2099-0001"
			if includeVulhubMatch {
				directory = "activemq/CVE-2023-46604"
				cveID = "CVE-2023-46604"
			}
			return vulnerabilityFeedMatrixDownload(
				dataDirectory,
				vuln.VulhubPracticeCatalog,
				vuln.VulhubRepoWebURL,
				`{"sourceName":"Vulhub Practice Catalog","itemCount":1,"items":[{"cveId":"`+cveID+`","title":"Vulhub · activemq · `+cveID+` Docker Compose","directory":"`+directory+`","sourceHref":"https://github.com/vulhub/vulhub/tree/commit/`+directory+`","revision":"vulhub/vulhub master abc123","environmentId":"vulhub-`+strings.ToLower(cveID)+`"}]}`,
			), nil
		},
	}
}

func vulnerabilityFeedMatrixDownload(
	dataDirectory string,
	sourceName string,
	sourceURL string,
	body string,
) vuln.FeedSnapshotDownload {
	return vuln.FeedSnapshotDownload{
		SourceName:        sourceName,
		SourceURL:         sourceURL,
		RetrievedAt:       "2026-08-04T08:00:00Z",
		HTTPStatus:        200,
		ContentType:       "application/json",
		Body:              body,
		SnapshotPath:      filepath.Join(dataDirectory, "vuln", "feed-snapshots", strings.ToLower(strings.ReplaceAll(sourceName, " ", "-")), "fixture.json"),
		SnapshotSHA256:    strings.Repeat("a", 64),
		SnapshotSizeBytes: int64(len(body)),
	}
}
