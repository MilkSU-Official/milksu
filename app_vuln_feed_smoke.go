package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/vuln"
)

const (
	vulnerabilityFeedSmokeResultEnv  = "MILKSU_VULN_FEED_SMOKE_RESULT"
	vulnerabilityFeedSmokeCVEIDEnv   = "MILKSU_VULN_FEED_SMOKE_CVE_ID"
	defaultVulnerabilityFeedSmokeCVE = "CVE-2024-3400"
)

type vulnerabilityFeedSmokeReport struct {
	Schema        string                         `json:"schema"`
	RanAt         string                         `json:"ranAt"`
	CVEID         string                         `json:"cveId"`
	DataDirectory string                         `json:"dataDirectory"`
	Download      vulnerabilityFeedSmokeDownload `json:"download"`
	Fact          vulnerabilityFeedSmokeCVEFact  `json:"fact"`
	Error         string                         `json:"error,omitempty"`
}

type vulnerabilityFeedSmokeDownload struct {
	SourceName        string `json:"sourceName"`
	SourceURL         string `json:"sourceUrl"`
	RetrievedAt       string `json:"retrievedAt"`
	LastModified      string `json:"lastModified,omitempty"`
	HTTPStatus        int    `json:"httpStatus"`
	ContentType       string `json:"contentType"`
	BodyBytes         int    `json:"bodyBytes"`
	BodyContainsCVE   bool   `json:"bodyContainsCve"`
	SnapshotPath      string `json:"snapshotPath"`
	SnapshotSHA256    string `json:"snapshotSha256"`
	SnapshotSizeBytes int64  `json:"snapshotSizeBytes"`
}

type vulnerabilityFeedSmokeCVEFact struct {
	Present      bool    `json:"present"`
	ID           string  `json:"id,omitempty"`
	Published    string  `json:"published,omitempty"`
	LastModified string  `json:"lastModified,omitempty"`
	Status       string  `json:"status,omitempty"`
	Severity     string  `json:"severity,omitempty"`
	BaseScore    float64 `json:"baseScore,omitempty"`
}

func (a *App) maybeRunVulnerabilityFeedSmoke() {
	resultPath := strings.TrimSpace(os.Getenv(vulnerabilityFeedSmokeResultEnv))
	if resultPath == "" {
		return
	}

	cveID := strings.TrimSpace(os.Getenv(vulnerabilityFeedSmokeCVEIDEnv))
	if cveID == "" {
		cveID = defaultVulnerabilityFeedSmokeCVE
	}
	report := a.buildVulnerabilityFeedSmokeReport(cveID, a.FetchNVDCVE)
	if err := writeVulnerabilityFeedSmokeReport(resultPath, report); err != nil {
		a.diagnostics.Record("vuln-feed", "error", "packaged smoke report failed")
	}
}

func (a *App) buildVulnerabilityFeedSmokeReport(
	cveID string,
	fetch func(string) (vuln.FeedSnapshotDownload, error),
) vulnerabilityFeedSmokeReport {
	report := vulnerabilityFeedSmokeReport{
		Schema:        "milksu-vuln-feed-packaged-smoke/v1",
		RanAt:         time.Now().UTC().Format(time.RFC3339Nano),
		CVEID:         strings.ToUpper(strings.TrimSpace(cveID)),
		DataDirectory: a.dataDirectory,
	}
	if report.CVEID == "" {
		report.CVEID = defaultVulnerabilityFeedSmokeCVE
	}
	download, err := fetch(report.CVEID)
	if err != nil {
		report.Error = err.Error()
		return report
	}
	report.Download = vulnerabilityFeedSmokeDownload{
		SourceName:        download.SourceName,
		SourceURL:         download.SourceURL,
		RetrievedAt:       download.RetrievedAt,
		LastModified:      download.LastModified,
		HTTPStatus:        download.HTTPStatus,
		ContentType:       download.ContentType,
		BodyBytes:         len(download.Body),
		BodyContainsCVE:   strings.Contains(strings.ToUpper(download.Body), report.CVEID),
		SnapshotPath:      download.SnapshotPath,
		SnapshotSHA256:    download.SnapshotSHA256,
		SnapshotSizeBytes: download.SnapshotSizeBytes,
	}
	report.Fact = extractNVDFeedCVEFact(download.Body, report.CVEID)
	if !report.Download.BodyContainsCVE || !report.Fact.Present {
		report.Error = "NVD feed smoke did not find the selected CVE in the returned facts"
	}
	return report
}

func extractNVDFeedCVEFact(body string, cveID string) vulnerabilityFeedSmokeCVEFact {
	var payload struct {
		Vulnerabilities []struct {
			CVE struct {
				ID           string `json:"id"`
				Published    string `json:"published"`
				LastModified string `json:"lastModified"`
				Status       string `json:"vulnStatus"`
				Metrics      map[string][]struct {
					BaseSeverity string `json:"baseSeverity"`
					CVSSData     struct {
						BaseScore    float64 `json:"baseScore"`
						BaseSeverity string  `json:"baseSeverity"`
					} `json:"cvssData"`
				} `json:"metrics"`
			} `json:"cve"`
		} `json:"vulnerabilities"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return vulnerabilityFeedSmokeCVEFact{}
	}
	for _, vulnerability := range payload.Vulnerabilities {
		cve := vulnerability.CVE
		if !strings.EqualFold(cve.ID, cveID) {
			continue
		}
		fact := vulnerabilityFeedSmokeCVEFact{
			Present:      true,
			ID:           cve.ID,
			Published:    cve.Published,
			LastModified: cve.LastModified,
			Status:       cve.Status,
		}
		for _, key := range []string{"cvssMetricV31", "cvssMetricV30", "cvssMetricV2"} {
			for _, metric := range cve.Metrics[key] {
				if metric.CVSSData.BaseScore != 0 {
					fact.BaseScore = metric.CVSSData.BaseScore
				}
				if severity := strings.TrimSpace(metric.CVSSData.BaseSeverity); severity != "" {
					fact.Severity = severity
				} else if severity := strings.TrimSpace(metric.BaseSeverity); severity != "" {
					fact.Severity = severity
				}
				if fact.BaseScore != 0 || fact.Severity != "" {
					return fact
				}
			}
		}
		return fact
	}
	return vulnerabilityFeedSmokeCVEFact{}
}

func writeVulnerabilityFeedSmokeReport(path string, report vulnerabilityFeedSmokeReport) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve vulnerability feed smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create vulnerability feed smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode vulnerability feed smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-vuln-feed-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary vulnerability feed smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary vulnerability feed smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary vulnerability feed smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary vulnerability feed smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary vulnerability feed smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install vulnerability feed smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect vulnerability feed smoke report: %w", err)
	}
	return nil
}
