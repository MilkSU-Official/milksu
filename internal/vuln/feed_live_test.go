package vuln

import (
	"context"
	"encoding/json"
	"os"
	"strings"
	"testing"
	"time"
)

func TestLiveFetchVulnerabilityFeeds(t *testing.T) {
	if os.Getenv("MILKSU_LIVE_CVE_FEED_SMOKE") != "1" {
		t.Skip("set MILKSU_LIVE_CVE_FEED_SMOKE=1 to run the public read-only CVE feed smoke")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 75*time.Second)
	defer cancel()

	cisa, err := FetchCISAKEVFeed(ctx, nil)
	if err != nil {
		t.Fatalf("FetchCISAKEVFeed() live error = %v", err)
	}
	if cisa.SourceName != CISAKEVFeedName || cisa.RetrievedAt == "" || !strings.Contains(cisa.Body, "vulnerabilities") {
		t.Fatalf("unexpected CISA KEV response metadata: source=%q url=%q retrieved=%q status=%d content-type=%q body-bytes=%d",
			cisa.SourceName, cisa.SourceURL, cisa.RetrievedAt, cisa.HTTPStatus, cisa.ContentType, len(cisa.Body))
	}

	nvd, err := FetchNVDCVE(ctx, nil, "CVE-2024-3400")
	if err != nil {
		t.Fatalf("FetchNVDCVE() live error = %v", err)
	}
	if nvd.SourceName != NVDCVEFeedName || !strings.Contains(nvd.SourceURL, "cveId=CVE-2024-3400") ||
		!strings.Contains(nvd.Body, "CVE-2024-3400") {
		t.Fatalf("unexpected NVD response metadata: source=%q url=%q retrieved=%q status=%d content-type=%q body-bytes=%d",
			nvd.SourceName, nvd.SourceURL, nvd.RetrievedAt, nvd.HTTPStatus, nvd.ContentType, len(nvd.Body))
	}

	epss, err := FetchFIRSTEPSS(ctx, nil, "CVE-2024-3400")
	if err != nil {
		t.Fatalf("FetchFIRSTEPSS() live error = %v", err)
	}
	if epss.SourceName != FIRSTEPSSFeedName || !strings.Contains(epss.SourceURL, "cve=CVE-2024-3400") ||
		!strings.Contains(epss.Body, "CVE-2024-3400") || !strings.Contains(epss.Body, "epss") {
		t.Fatalf("unexpected FIRST EPSS response metadata: source=%q url=%q retrieved=%q status=%d content-type=%q body-bytes=%d",
			epss.SourceName, epss.SourceURL, epss.RetrievedAt, epss.HTTPStatus, epss.ContentType, len(epss.Body))
	}

	vulhub, err := FetchVulhubPracticeCatalog(ctx, nil)
	if err != nil {
		t.Fatalf("FetchVulhubPracticeCatalog() live error = %v", err)
	}
	var catalog struct {
		ItemCount int `json:"itemCount"`
		Items     []struct {
			CVEID     string `json:"cveId"`
			Directory string `json:"directory"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(vulhub.Body), &catalog); err != nil {
		t.Fatalf("decode live Vulhub catalog: %v", err)
	}
	if catalog.ItemCount == 0 || len(catalog.Items) == 0 {
		t.Fatalf("live Vulhub catalog had no practice candidates")
	}
}

func TestLiveFetchFIRSTEPSS(t *testing.T) {
	if os.Getenv("MILKSU_LIVE_EPSS_SMOKE") != "1" {
		t.Skip("set MILKSU_LIVE_EPSS_SMOKE=1 to run the public read-only FIRST EPSS smoke")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	epss, err := FetchFIRSTEPSS(ctx, nil, "CVE-2024-3400")
	if err != nil {
		t.Fatalf("FetchFIRSTEPSS() live error = %v", err)
	}
	if epss.SourceName != FIRSTEPSSFeedName || !strings.Contains(epss.SourceURL, "cve=CVE-2024-3400") ||
		!strings.Contains(epss.Body, "CVE-2024-3400") || !strings.Contains(epss.Body, "epss") {
		t.Fatalf("unexpected FIRST EPSS response metadata: source=%q url=%q retrieved=%q status=%d content-type=%q body-bytes=%d",
			epss.SourceName, epss.SourceURL, epss.RetrievedAt, epss.HTTPStatus, epss.ContentType, len(epss.Body))
	}
}
