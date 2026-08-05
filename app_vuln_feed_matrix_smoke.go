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
	vulnerabilityFeedMatrixSmokeResultEnv  = "MILKSU_VULN_FEED_MATRIX_SMOKE_RESULT"
	vulnerabilityFeedMatrixSmokeCVEIDEnv   = "MILKSU_VULN_FEED_MATRIX_SMOKE_CVE_ID"
	defaultVulnerabilityFeedMatrixSmokeCVE = "CVE-2023-46604"
)

type vulnerabilityFeedMatrixSmokeReport struct {
	Schema         string                                    `json:"schema"`
	RanAt          string                                    `json:"ranAt"`
	CVEID          string                                    `json:"cveId"`
	DataDirectory  string                                    `json:"dataDirectory"`
	Downloads      []vulnerabilityFeedSmokeDownload          `json:"downloads"`
	NVD            vulnerabilityFeedSmokeCVEFact             `json:"nvd"`
	EPSS           vulnerabilityFeedMatrixEPSSFact           `json:"epss"`
	OSV            vulnerabilityFeedMatrixOSVFact            `json:"osv"`
	GitHubAdvisory vulnerabilityFeedMatrixGitHubAdvisoryFact `json:"githubAdvisory"`
	CISAKEV        vulnerabilityFeedMatrixCISAKEVFact        `json:"cisaKev"`
	Vulhub         vulnerabilityFeedMatrixVulhubPracticeFact `json:"vulhub"`
	Gates          vulnerabilityFeedMatrixSmokeGates         `json:"gates"`
	Error          string                                    `json:"error,omitempty"`
}

type vulnerabilityFeedMatrixSmokeGates struct {
	FetchedNVD                   bool `json:"fetchedNvd"`
	FetchedFIRSTEPSS             bool `json:"fetchedFirstEpss"`
	FetchedOSV                   bool `json:"fetchedOsv"`
	FetchedGitHubAdvisory        bool `json:"fetchedGithubAdvisory"`
	FetchedCISAKEV               bool `json:"fetchedCisaKev"`
	FetchedVulhub                bool `json:"fetchedVulhub"`
	SourceTimingPresent          bool `json:"sourceTimingPresent"`
	SnapshotsPersisted           bool `json:"snapshotsPersisted"`
	SelectedCVEInNVD             bool `json:"selectedCveInNvd"`
	SelectedCVEInFIRSTEPSS       bool `json:"selectedCveInFirstEpss"`
	SelectedCVEInOSV             bool `json:"selectedCveInOsv"`
	SelectedCVEInGitHubAdvisory  bool `json:"selectedCveInGithubAdvisory"`
	SelectedCVEInCISAKEV         bool `json:"selectedCveInCisaKev"`
	SelectedCVEHasVulhubPractice bool `json:"selectedCveHasVulhubPractice"`
	RawFeedBodiesOmitted         bool `json:"rawFeedBodiesOmitted"`
}

type vulnerabilityFeedMatrixEPSSFact struct {
	Present    bool   `json:"present"`
	CVE        string `json:"cve,omitempty"`
	EPSS       string `json:"epss,omitempty"`
	Percentile string `json:"percentile,omitempty"`
	Date       string `json:"date,omitempty"`
}

type vulnerabilityFeedMatrixOSVFact struct {
	Present   bool     `json:"present"`
	ID        string   `json:"id,omitempty"`
	Aliases   []string `json:"aliases,omitempty"`
	Summary   string   `json:"summary,omitempty"`
	Published string   `json:"published,omitempty"`
	Modified  string   `json:"modified,omitempty"`
	Package   string   `json:"package,omitempty"`
}

type vulnerabilityFeedMatrixGitHubAdvisoryFact struct {
	Present     bool   `json:"present"`
	GHSAID      string `json:"ghsaId,omitempty"`
	CVEID       string `json:"cveId,omitempty"`
	Severity    string `json:"severity,omitempty"`
	PublishedAt string `json:"publishedAt,omitempty"`
	UpdatedAt   string `json:"updatedAt,omitempty"`
	Package     string `json:"package,omitempty"`
	HTMLURL     string `json:"htmlUrl,omitempty"`
}

type vulnerabilityFeedMatrixCISAKEVFact struct {
	Present                    bool   `json:"present"`
	CVEID                      string `json:"cveId,omitempty"`
	VendorProject              string `json:"vendorProject,omitempty"`
	Product                    string `json:"product,omitempty"`
	VulnerabilityName          string `json:"vulnerabilityName,omitempty"`
	DateAdded                  string `json:"dateAdded,omitempty"`
	DueDate                    string `json:"dueDate,omitempty"`
	KnownRansomwareCampaignUse string `json:"knownRansomwareCampaignUse,omitempty"`
}

type vulnerabilityFeedMatrixVulhubPracticeFact struct {
	Present    bool                                      `json:"present"`
	ItemCount  int                                       `json:"itemCount"`
	MatchCount int                                       `json:"matchCount"`
	FirstMatch vulnerabilityFeedMatrixVulhubPracticeItem `json:"firstMatch,omitempty"`
}

type vulnerabilityFeedMatrixVulhubPracticeItem struct {
	CVEID       string `json:"cveId,omitempty"`
	Title       string `json:"title,omitempty"`
	Directory   string `json:"directory,omitempty"`
	SourceHref  string `json:"sourceHref,omitempty"`
	Revision    string `json:"revision,omitempty"`
	Environment string `json:"environmentId,omitempty"`
}

type vulnerabilityFeedMatrixFetchers struct {
	FetchNVD            func(string) (vuln.FeedSnapshotDownload, error)
	FetchEPSS           func(string) (vuln.FeedSnapshotDownload, error)
	FetchOSV            func(string) (vuln.FeedSnapshotDownload, error)
	FetchGitHubAdvisory func(string) (vuln.FeedSnapshotDownload, error)
	FetchCISAKEV        func() (vuln.FeedSnapshotDownload, error)
	FetchVulhub         func() (vuln.FeedSnapshotDownload, error)
}

func (a *App) maybeRunVulnerabilityFeedMatrixSmoke() {
	resultPath := strings.TrimSpace(os.Getenv(vulnerabilityFeedMatrixSmokeResultEnv))
	if resultPath == "" {
		return
	}
	cveID := strings.TrimSpace(os.Getenv(vulnerabilityFeedMatrixSmokeCVEIDEnv))
	if cveID == "" {
		cveID = defaultVulnerabilityFeedMatrixSmokeCVE
	}
	report := a.buildVulnerabilityFeedMatrixSmokeReport(cveID, vulnerabilityFeedMatrixFetchers{
		FetchNVD:            a.FetchNVDCVE,
		FetchEPSS:           a.FetchFIRSTEPSS,
		FetchOSV:            a.FetchOSVCVE,
		FetchGitHubAdvisory: a.FetchGitHubAdvisories,
		FetchCISAKEV:        a.FetchCISAKEVFeed,
		FetchVulhub:         a.FetchVulhubPracticeCatalog,
	})
	if err := writeVulnerabilityFeedMatrixSmokeReport(resultPath, report); err != nil {
		a.diagnostics.Record("vuln-feed", "error", "packaged matrix smoke report failed")
	}
}

func (a *App) buildVulnerabilityFeedMatrixSmokeReport(
	cveID string,
	fetchers vulnerabilityFeedMatrixFetchers,
) vulnerabilityFeedMatrixSmokeReport {
	report := vulnerabilityFeedMatrixSmokeReport{
		Schema:        "milksu-vuln-feed-matrix-packaged-smoke/v1",
		RanAt:         time.Now().UTC().Format(time.RFC3339Nano),
		CVEID:         strings.ToUpper(strings.TrimSpace(cveID)),
		DataDirectory: a.dataDirectory,
	}
	if report.CVEID == "" {
		report.CVEID = defaultVulnerabilityFeedMatrixSmokeCVE
	}

	nvd, ok := appendVulnerabilityFeedMatrixDownload(
		&report,
		vuln.NVDCVEFeedName,
		func() (vuln.FeedSnapshotDownload, error) { return fetchers.FetchNVD(report.CVEID) },
	)
	if !ok {
		return report
	}
	report.NVD = extractNVDFeedCVEFact(nvd.Body, report.CVEID)

	epss, ok := appendVulnerabilityFeedMatrixDownload(
		&report,
		vuln.FIRSTEPSSFeedName,
		func() (vuln.FeedSnapshotDownload, error) { return fetchers.FetchEPSS(report.CVEID) },
	)
	if !ok {
		return report
	}
	report.EPSS = extractFIRSTEPSSFeedFact(epss.Body, report.CVEID)

	osv, ok := appendVulnerabilityFeedMatrixDownload(
		&report,
		vuln.OSVCVEFeedName,
		func() (vuln.FeedSnapshotDownload, error) { return fetchers.FetchOSV(report.CVEID) },
	)
	if !ok {
		return report
	}
	report.OSV = extractOSVFeedFact(osv.Body, report.CVEID)

	githubAdvisory, ok := appendVulnerabilityFeedMatrixDownload(
		&report,
		vuln.GitHubAdvisoriesName,
		func() (vuln.FeedSnapshotDownload, error) { return fetchers.FetchGitHubAdvisory(report.CVEID) },
	)
	if !ok {
		return report
	}
	report.GitHubAdvisory = extractGitHubAdvisoryFeedFact(githubAdvisory.Body, report.CVEID)

	cisa, ok := appendVulnerabilityFeedMatrixDownload(
		&report,
		vuln.CISAKEVFeedName,
		fetchers.FetchCISAKEV,
	)
	if !ok {
		return report
	}
	report.CISAKEV = extractCISAKEVFeedFact(cisa.Body, report.CVEID)

	vulhub, ok := appendVulnerabilityFeedMatrixDownload(
		&report,
		vuln.VulhubPracticeCatalog,
		fetchers.FetchVulhub,
	)
	if !ok {
		return report
	}
	report.Vulhub = extractVulhubPracticeFact(vulhub.Body, report.CVEID)
	report.Gates = buildVulnerabilityFeedMatrixGates(report)
	if !report.Gates.FetchedNVD ||
		!report.Gates.FetchedFIRSTEPSS ||
		!report.Gates.FetchedOSV ||
		!report.Gates.FetchedGitHubAdvisory ||
		!report.Gates.FetchedCISAKEV ||
		!report.Gates.FetchedVulhub ||
		!report.Gates.SourceTimingPresent ||
		!report.Gates.SnapshotsPersisted ||
		!report.Gates.SelectedCVEInNVD ||
		!report.Gates.SelectedCVEInFIRSTEPSS ||
		!report.Gates.SelectedCVEInOSV ||
		!report.Gates.SelectedCVEInGitHubAdvisory ||
		!report.Gates.SelectedCVEInCISAKEV ||
		!report.Gates.SelectedCVEHasVulhubPractice {
		report.Error = "CVE feed matrix smoke did not prove every source and practice match gate"
	}
	return report
}

func appendVulnerabilityFeedMatrixDownload(
	report *vulnerabilityFeedMatrixSmokeReport,
	sourceName string,
	fetch func() (vuln.FeedSnapshotDownload, error),
) (vuln.FeedSnapshotDownload, bool) {
	if fetch == nil {
		report.Error = fmt.Sprintf("fetch %s: fetcher is unavailable", sourceName)
		return vuln.FeedSnapshotDownload{}, false
	}
	download, err := fetch()
	if err != nil {
		report.Error = fmt.Sprintf("fetch %s: %v", sourceName, err)
		return vuln.FeedSnapshotDownload{}, false
	}
	report.Downloads = append(report.Downloads, summarizeVulnerabilityFeedDownload(download, report.CVEID))
	return download, true
}

func summarizeVulnerabilityFeedDownload(
	download vuln.FeedSnapshotDownload,
	cveID string,
) vulnerabilityFeedSmokeDownload {
	return vulnerabilityFeedSmokeDownload{
		SourceName:        download.SourceName,
		SourceURL:         download.SourceURL,
		RetrievedAt:       download.RetrievedAt,
		LastModified:      download.LastModified,
		HTTPStatus:        download.HTTPStatus,
		ContentType:       download.ContentType,
		BodyBytes:         len(download.Body),
		BodyContainsCVE:   strings.Contains(strings.ToUpper(download.Body), strings.ToUpper(cveID)),
		SnapshotPath:      download.SnapshotPath,
		SnapshotSHA256:    download.SnapshotSHA256,
		SnapshotSizeBytes: download.SnapshotSizeBytes,
	}
}

func buildVulnerabilityFeedMatrixGates(
	report vulnerabilityFeedMatrixSmokeReport,
) vulnerabilityFeedMatrixSmokeGates {
	gates := vulnerabilityFeedMatrixSmokeGates{
		SelectedCVEInNVD:             report.NVD.Present,
		SelectedCVEInFIRSTEPSS:       report.EPSS.Present,
		SelectedCVEInOSV:             report.OSV.Present,
		SelectedCVEInGitHubAdvisory:  report.GitHubAdvisory.Present,
		SelectedCVEInCISAKEV:         report.CISAKEV.Present,
		SelectedCVEHasVulhubPractice: report.Vulhub.Present,
		RawFeedBodiesOmitted:         true,
	}
	for _, download := range report.Downloads {
		sourceOK := download.HTTPStatus >= 200 &&
			download.HTTPStatus < 300 &&
			download.BodyBytes > 0
		timingOK := strings.TrimSpace(download.RetrievedAt) != "" ||
			strings.TrimSpace(download.LastModified) != ""
		snapshotOK := strings.TrimSpace(download.SnapshotPath) != "" &&
			strings.TrimSpace(download.SnapshotSHA256) != "" &&
			download.SnapshotSizeBytes > 0
		gates.SourceTimingPresent = gates.SourceTimingPresent || timingOK
		switch download.SourceName {
		case vuln.NVDCVEFeedName:
			gates.FetchedNVD = sourceOK && timingOK && snapshotOK
		case vuln.FIRSTEPSSFeedName:
			gates.FetchedFIRSTEPSS = sourceOK && timingOK && snapshotOK
		case vuln.OSVCVEFeedName:
			gates.FetchedOSV = sourceOK && timingOK && snapshotOK
		case vuln.GitHubAdvisoriesName:
			gates.FetchedGitHubAdvisory = sourceOK && timingOK && snapshotOK
		case vuln.CISAKEVFeedName:
			gates.FetchedCISAKEV = sourceOK && timingOK && snapshotOK
		case vuln.VulhubPracticeCatalog:
			gates.FetchedVulhub = sourceOK && timingOK && snapshotOK
		}
	}
	gates.SourceTimingPresent =
		gates.FetchedNVD &&
			gates.FetchedFIRSTEPSS &&
			gates.FetchedOSV &&
			gates.FetchedGitHubAdvisory &&
			gates.FetchedCISAKEV &&
			gates.FetchedVulhub
	gates.SnapshotsPersisted = gates.SourceTimingPresent
	return gates
}

func extractFIRSTEPSSFeedFact(body string, cveID string) vulnerabilityFeedMatrixEPSSFact {
	var payload struct {
		Data []struct {
			CVE        string `json:"cve"`
			EPSS       string `json:"epss"`
			Percentile string `json:"percentile"`
			Date       string `json:"date"`
		} `json:"data"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return vulnerabilityFeedMatrixEPSSFact{}
	}
	for _, item := range payload.Data {
		if !strings.EqualFold(item.CVE, cveID) {
			continue
		}
		return vulnerabilityFeedMatrixEPSSFact{
			Present:    true,
			CVE:        strings.ToUpper(item.CVE),
			EPSS:       item.EPSS,
			Percentile: item.Percentile,
			Date:       item.Date,
		}
	}
	return vulnerabilityFeedMatrixEPSSFact{}
}

func extractOSVFeedFact(body string, cveID string) vulnerabilityFeedMatrixOSVFact {
	var payload struct {
		ID        string   `json:"id"`
		Aliases   []string `json:"aliases"`
		Summary   string   `json:"summary"`
		Published string   `json:"published"`
		Modified  string   `json:"modified"`
		Affected  []struct {
			Package struct {
				Ecosystem string `json:"ecosystem"`
				Name      string `json:"name"`
			} `json:"package"`
		} `json:"affected"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return vulnerabilityFeedMatrixOSVFact{}
	}
	present := strings.EqualFold(payload.ID, cveID)
	for _, alias := range payload.Aliases {
		if strings.EqualFold(alias, cveID) {
			present = true
			break
		}
	}
	if !present {
		return vulnerabilityFeedMatrixOSVFact{}
	}
	packageName := ""
	for _, affected := range payload.Affected {
		if affected.Package.Name == "" {
			continue
		}
		if affected.Package.Ecosystem != "" {
			packageName = affected.Package.Ecosystem + ":" + affected.Package.Name
		} else {
			packageName = affected.Package.Name
		}
		break
	}
	return vulnerabilityFeedMatrixOSVFact{
		Present:   true,
		ID:        payload.ID,
		Aliases:   payload.Aliases,
		Summary:   payload.Summary,
		Published: payload.Published,
		Modified:  payload.Modified,
		Package:   packageName,
	}
}

func extractGitHubAdvisoryFeedFact(body string, cveID string) vulnerabilityFeedMatrixGitHubAdvisoryFact {
	var payload []struct {
		GHSAID          string `json:"ghsa_id"`
		CVEID           string `json:"cve_id"`
		Severity        string `json:"severity"`
		PublishedAt     string `json:"published_at"`
		UpdatedAt       string `json:"updated_at"`
		HTMLURL         string `json:"html_url"`
		Vulnerabilities []struct {
			Package struct {
				Ecosystem string `json:"ecosystem"`
				Name      string `json:"name"`
			} `json:"package"`
		} `json:"vulnerabilities"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return vulnerabilityFeedMatrixGitHubAdvisoryFact{}
	}
	for _, item := range payload {
		if !strings.EqualFold(item.CVEID, cveID) {
			continue
		}
		packageName := ""
		for _, vulnerability := range item.Vulnerabilities {
			if vulnerability.Package.Name == "" {
				continue
			}
			if vulnerability.Package.Ecosystem != "" {
				packageName = vulnerability.Package.Ecosystem + ":" + vulnerability.Package.Name
			} else {
				packageName = vulnerability.Package.Name
			}
			break
		}
		return vulnerabilityFeedMatrixGitHubAdvisoryFact{
			Present:     true,
			GHSAID:      item.GHSAID,
			CVEID:       strings.ToUpper(item.CVEID),
			Severity:    item.Severity,
			PublishedAt: item.PublishedAt,
			UpdatedAt:   item.UpdatedAt,
			Package:     packageName,
			HTMLURL:     item.HTMLURL,
		}
	}
	return vulnerabilityFeedMatrixGitHubAdvisoryFact{}
}

func extractCISAKEVFeedFact(body string, cveID string) vulnerabilityFeedMatrixCISAKEVFact {
	var payload struct {
		Vulnerabilities []struct {
			CVEID                      string `json:"cveID"`
			VendorProject              string `json:"vendorProject"`
			Product                    string `json:"product"`
			VulnerabilityName          string `json:"vulnerabilityName"`
			DateAdded                  string `json:"dateAdded"`
			DueDate                    string `json:"dueDate"`
			KnownRansomwareCampaignUse string `json:"knownRansomwareCampaignUse"`
		} `json:"vulnerabilities"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return vulnerabilityFeedMatrixCISAKEVFact{}
	}
	for _, item := range payload.Vulnerabilities {
		if !strings.EqualFold(item.CVEID, cveID) {
			continue
		}
		return vulnerabilityFeedMatrixCISAKEVFact{
			Present:                    true,
			CVEID:                      strings.ToUpper(item.CVEID),
			VendorProject:              item.VendorProject,
			Product:                    item.Product,
			VulnerabilityName:          item.VulnerabilityName,
			DateAdded:                  item.DateAdded,
			DueDate:                    item.DueDate,
			KnownRansomwareCampaignUse: item.KnownRansomwareCampaignUse,
		}
	}
	return vulnerabilityFeedMatrixCISAKEVFact{}
}

func extractVulhubPracticeFact(body string, cveID string) vulnerabilityFeedMatrixVulhubPracticeFact {
	var payload struct {
		ItemCount int                                         `json:"itemCount"`
		Items     []vulnerabilityFeedMatrixVulhubPracticeItem `json:"items"`
	}
	if err := json.Unmarshal([]byte(body), &payload); err != nil {
		return vulnerabilityFeedMatrixVulhubPracticeFact{}
	}
	fact := vulnerabilityFeedMatrixVulhubPracticeFact{
		ItemCount: payload.ItemCount,
	}
	for _, item := range payload.Items {
		if !strings.EqualFold(item.CVEID, cveID) {
			continue
		}
		fact.MatchCount++
		if !fact.Present {
			item.CVEID = strings.ToUpper(item.CVEID)
			fact.FirstMatch = item
			fact.Present = true
		}
	}
	return fact
}

func writeVulnerabilityFeedMatrixSmokeReport(
	path string,
	report vulnerabilityFeedMatrixSmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve vulnerability feed matrix smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create vulnerability feed matrix smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode vulnerability feed matrix smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-vuln-feed-matrix-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary vulnerability feed matrix smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary vulnerability feed matrix smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary vulnerability feed matrix smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary vulnerability feed matrix smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary vulnerability feed matrix smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install vulnerability feed matrix smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect vulnerability feed matrix smoke report: %w", err)
	}
	return nil
}
