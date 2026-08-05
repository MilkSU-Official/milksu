package vuln

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestFetchFeedSnapshotKeepsSourceTimingAndRawJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Accept") != "application/json" {
			t.Fatalf("missing JSON accept header")
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.Header().Set("Last-Modified", "Mon, 03 Aug 2026 18:55:08 GMT")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"title":"CISA Catalog of Known Exploited Vulnerabilities","vulnerabilities":[]}`))
	}))
	defer server.Close()

	download, err := FetchFeedSnapshot(context.Background(), server.Client(), "CISA KEV", server.URL)
	if err != nil {
		t.Fatalf("FetchFeedSnapshot() error = %v", err)
	}
	if download.SourceName != "CISA KEV" {
		t.Fatalf("SourceName = %q", download.SourceName)
	}
	if download.SourceURL != server.URL {
		t.Fatalf("SourceURL = %q", download.SourceURL)
	}
	if download.RetrievedAt != "2026-08-03T18:55:08Z" {
		t.Fatalf("RetrievedAt = %q", download.RetrievedAt)
	}
	if download.HTTPStatus != http.StatusOK {
		t.Fatalf("HTTPStatus = %d", download.HTTPStatus)
	}
	if download.Body == "" {
		t.Fatalf("Body is empty")
	}
}

func TestFetchFeedSnapshotRejectsNonJSON(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.Header().Set("Content-Type", "text/html")
		_, _ = writer.Write([]byte("<html></html>"))
	}))
	defer server.Close()

	_, err := FetchFeedSnapshot(context.Background(), server.Client(), "HTML", server.URL)
	if err == nil {
		t.Fatalf("FetchFeedSnapshot() expected non-JSON error")
	}
}

func TestFetchFeedSnapshotRejectsNonHTTPURL(t *testing.T) {
	_, err := FetchFeedSnapshot(context.Background(), nil, "local", "file:///etc/hosts")
	if err == nil || !strings.Contains(err.Error(), `unsupported URL scheme "file"`) {
		t.Fatalf("expected unsupported scheme error, got %v", err)
	}
}

func TestFetchNVDCVEBuildsExactQueryAndKeepsTiming(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/rest/json/cves/2.0" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if request.URL.Query().Get("cveId") != "CVE-2024-3400" {
			t.Fatalf("cveId query = %q", request.URL.Query().Get("cveId"))
		}
		if request.Header.Get("Accept") != "application/json" {
			t.Fatalf("missing JSON accept header")
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.Header().Set("Last-Modified", "Tue, 04 Aug 2026 07:00:00 GMT")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"vulnerabilities":[{"cve":{"id":"CVE-2024-3400"}}]}`))
	}))
	defer server.Close()

	download, err := FetchNVDCVEFrom(
		context.Background(),
		server.Client(),
		server.URL+"/rest/json/cves/2.0",
		" cve-2024-3400 ",
	)
	if err != nil {
		t.Fatalf("FetchNVDCVEFrom() error = %v", err)
	}
	if download.SourceName != NVDCVEFeedName {
		t.Fatalf("SourceName = %q", download.SourceName)
	}
	if !strings.Contains(download.SourceURL, "cveId=CVE-2024-3400") {
		t.Fatalf("SourceURL missing exact CVE query: %q", download.SourceURL)
	}
	if download.RetrievedAt != "2026-08-04T07:00:00Z" {
		t.Fatalf("RetrievedAt = %q", download.RetrievedAt)
	}
	if !strings.Contains(download.Body, "CVE-2024-3400") {
		t.Fatalf("Body = %q", download.Body)
	}
}

func TestFetchNVDCVERejectsInvalidCVEID(t *testing.T) {
	_, err := FetchNVDCVEFrom(context.Background(), nil, NVDCVEAPIURL, "2024-3400")
	if err == nil || !strings.Contains(err.Error(), "invalid CVE id") {
		t.Fatalf("expected invalid CVE id error, got %v", err)
	}
}

func TestFetchFIRSTEPSSBuildsExactQueryAndKeepsTiming(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/data/v1/epss" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if request.URL.Query().Get("cve") != "CVE-2024-3400" {
			t.Fatalf("cve query = %q", request.URL.Query().Get("cve"))
		}
		if request.Header.Get("Accept") != "application/json" {
			t.Fatalf("missing JSON accept header")
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.Header().Set("Date", "Tue, 04 Aug 2026 08:00:00 GMT")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"status":"OK","data":[{"cve":"CVE-2024-3400","epss":"0.932410000","percentile":"0.997200000","date":"2026-08-04"}]}`))
	}))
	defer server.Close()

	download, err := FetchFIRSTEPSSFrom(
		context.Background(),
		server.Client(),
		server.URL+"/data/v1/epss",
		" cve-2024-3400 ",
	)
	if err != nil {
		t.Fatalf("FetchFIRSTEPSSFrom() error = %v", err)
	}
	if download.SourceName != FIRSTEPSSFeedName {
		t.Fatalf("SourceName = %q", download.SourceName)
	}
	if !strings.Contains(download.SourceURL, "cve=CVE-2024-3400") {
		t.Fatalf("SourceURL missing exact CVE query: %q", download.SourceURL)
	}
	if download.RetrievedAt != "2026-08-04T08:00:00Z" {
		t.Fatalf("RetrievedAt = %q", download.RetrievedAt)
	}
	if !strings.Contains(download.Body, "0.932410000") {
		t.Fatalf("Body = %q", download.Body)
	}
}

func TestFetchFIRSTEPSSRejectsInvalidCVEID(t *testing.T) {
	_, err := FetchFIRSTEPSSFrom(context.Background(), nil, FIRSTEPSSAPIURL, "2024-3400")
	if err == nil || !strings.Contains(err.Error(), "invalid CVE id") {
		t.Fatalf("expected invalid CVE id error, got %v", err)
	}
}

func TestFetchOSVCVEBuildsExactPathAndKeepsTiming(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/v1/vulns/CVE-2023-46604" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if request.Header.Get("Accept") != "application/json" {
			t.Fatalf("missing JSON accept header")
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.Header().Set("Date", "Tue, 04 Aug 2026 09:00:00 GMT")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`{"schema_version":"1.7.3","id":"CVE-2023-46604","aliases":["GHSA-crg9-44h2-xw35"],"summary":"ActiveMQ OpenWire RCE"}`))
	}))
	defer server.Close()

	download, err := FetchOSVCVEFrom(
		context.Background(),
		server.Client(),
		server.URL+"/v1/vulns",
		" cve-2023-46604 ",
	)
	if err != nil {
		t.Fatalf("FetchOSVCVEFrom() error = %v", err)
	}
	if download.SourceName != OSVCVEFeedName {
		t.Fatalf("SourceName = %q", download.SourceName)
	}
	if !strings.HasSuffix(download.SourceURL, "/v1/vulns/CVE-2023-46604") {
		t.Fatalf("SourceURL missing exact CVE path: %q", download.SourceURL)
	}
	if download.RetrievedAt != "2026-08-04T09:00:00Z" {
		t.Fatalf("RetrievedAt = %q", download.RetrievedAt)
	}
	if !strings.Contains(download.Body, "GHSA-crg9-44h2-xw35") {
		t.Fatalf("Body = %q", download.Body)
	}
}

func TestFetchOSVCVERejectsInvalidCVEID(t *testing.T) {
	_, err := FetchOSVCVEFrom(context.Background(), nil, OSVCVEAPIURL, "GHSA-crg9-44h2-xw35")
	if err == nil || !strings.Contains(err.Error(), "invalid CVE id") {
		t.Fatalf("expected invalid CVE id error, got %v", err)
	}
}

func TestFetchGitHubAdvisoriesBuildsExactQueryAndKeepsTiming(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/advisories" {
			t.Fatalf("path = %q", request.URL.Path)
		}
		if request.URL.Query().Get("cve_id") != "CVE-2023-46604" {
			t.Fatalf("cve_id query = %q", request.URL.Query().Get("cve_id"))
		}
		if request.URL.Query().Get("per_page") != "10" {
			t.Fatalf("per_page query = %q", request.URL.Query().Get("per_page"))
		}
		if request.Header.Get("Accept") != "application/json" {
			t.Fatalf("missing JSON accept header")
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.Header().Set("Last-Modified", "Tue, 04 Aug 2026 10:00:00 GMT")
		writer.WriteHeader(http.StatusOK)
		_, _ = writer.Write([]byte(`[{"ghsa_id":"GHSA-crg9-44h2-xw35","cve_id":"CVE-2023-46604","severity":"critical"}]`))
	}))
	defer server.Close()

	download, err := FetchGitHubAdvisoriesFrom(
		context.Background(),
		server.Client(),
		server.URL+"/advisories",
		" cve-2023-46604 ",
	)
	if err != nil {
		t.Fatalf("FetchGitHubAdvisoriesFrom() error = %v", err)
	}
	if download.SourceName != GitHubAdvisoriesName {
		t.Fatalf("SourceName = %q", download.SourceName)
	}
	if !strings.Contains(download.SourceURL, "cve_id=CVE-2023-46604") ||
		!strings.Contains(download.SourceURL, "per_page=10") {
		t.Fatalf("SourceURL missing exact query: %q", download.SourceURL)
	}
	if download.RetrievedAt != "2026-08-04T10:00:00Z" {
		t.Fatalf("RetrievedAt = %q", download.RetrievedAt)
	}
	if !strings.Contains(download.Body, "GHSA-crg9-44h2-xw35") {
		t.Fatalf("Body = %q", download.Body)
	}
}

func TestFetchGitHubAdvisoriesRejectsInvalidCVEID(t *testing.T) {
	_, err := FetchGitHubAdvisoriesFrom(context.Background(), nil, GitHubAdvisoriesAPIURL, "2023-46604")
	if err == nil || !strings.Contains(err.Error(), "invalid CVE id") {
		t.Fatalf("expected invalid CVE id error, got %v", err)
	}
}

func TestFetchVulhubPracticeCatalogBuildsCVEComposeMatches(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Accept") != "application/vnd.github+json" {
			t.Fatalf("missing GitHub JSON accept header")
		}
		writer.Header().Set("Content-Type", "application/json")
		writer.Header().Set("Last-Modified", "Tue, 04 Aug 2026 06:00:00 GMT")
		switch {
		case request.URL.Path == "/branches/master":
			_, _ = writer.Write([]byte(`{"commit":{"sha":"aeaf65793f147f29bd50841ef77f4e9cad07ecc7"}}`))
		case request.URL.Path == "/git/trees/aeaf65793f147f29bd50841ef77f4e9cad07ecc7":
			if request.URL.Query().Get("recursive") != "1" {
				t.Fatalf("missing recursive tree query: %s", request.URL.RawQuery)
			}
			_, _ = writer.Write([]byte(`{
				"sha": "tree-sha",
				"truncated": false,
				"tree": [
					{"path":"activemq/CVE-2023-46604/docker-compose.yml","type":"blob"},
					{"path":"php/CVE-2024-4577/README.md","type":"blob"},
					{"path":"nginx/CVE-2021-23017/compose.yaml","type":"blob"},
					{"path":"no-cve/docker-compose.yml","type":"blob"}
				]
			}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	download, err := FetchVulhubPracticeCatalogFrom(
		context.Background(),
		server.Client(),
		server.URL,
		"https://github.com/vulhub/vulhub",
		"master",
	)
	if err != nil {
		t.Fatalf("FetchVulhubPracticeCatalogFrom() error = %v", err)
	}
	if download.SourceName != VulhubPracticeCatalog {
		t.Fatalf("SourceName = %q", download.SourceName)
	}
	if download.RetrievedAt != "2026-08-04T06:00:00Z" {
		t.Fatalf("RetrievedAt = %q", download.RetrievedAt)
	}
	if !strings.Contains(download.Body, "CVE-2023-46604") ||
		!strings.Contains(download.Body, "activemq/CVE-2023-46604") {
		t.Fatalf("catalog body missing ActiveMQ match: %s", download.Body)
	}
	if strings.Contains(download.Body, "CVE-2024-4577") {
		t.Fatalf("catalog imported a CVE without compose file: %s", download.Body)
	}
	var payload struct {
		ItemCount int `json:"itemCount"`
		Items     []struct {
			CVEID       string   `json:"cveId"`
			Directory   string   `json:"directory"`
			SourceHref  string   `json:"sourceHref"`
			Revision    string   `json:"revision"`
			Safety      []string `json:"safety"`
			MatchReason string   `json:"matchReason"`
		} `json:"items"`
	}
	if err := json.Unmarshal([]byte(download.Body), &payload); err != nil {
		t.Fatalf("decode generated catalog: %v", err)
	}
	if payload.ItemCount != 2 || len(payload.Items) != 2 {
		t.Fatalf("ItemCount = %d len = %d", payload.ItemCount, len(payload.Items))
	}
	if payload.Items[0].CVEID != "CVE-2021-23017" ||
		payload.Items[1].CVEID != "CVE-2023-46604" {
		t.Fatalf("items not sorted by CVE: %#v", payload.Items)
	}
	if !strings.Contains(payload.Items[1].SourceHref, "aeaf65793f147f29bd50841ef77f4e9cad07ecc7") {
		t.Fatalf("SourceHref did not pin commit: %q", payload.Items[1].SourceHref)
	}
	if !strings.Contains(payload.Items[1].Revision, "GitHub tree tree-sha") {
		t.Fatalf("Revision did not include tree sha: %q", payload.Items[1].Revision)
	}
	if len(payload.Items[1].Safety) == 0 || !strings.Contains(payload.Items[1].MatchReason, "只读目录树") {
		t.Fatalf("missing safety/match reason: %#v", payload.Items[1])
	}
}

func TestFetchVulhubPracticeCatalogRejectsTruncatedTree(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		switch {
		case request.URL.Path == "/branches/master":
			_, _ = writer.Write([]byte(`{"commit":{"sha":"commit-sha"}}`))
		case request.URL.Path == "/git/trees/commit-sha":
			_, _ = writer.Write([]byte(`{"sha":"tree-sha","truncated":true,"tree":[]}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	_, err := FetchVulhubPracticeCatalogFrom(
		context.Background(),
		server.Client(),
		server.URL,
		"https://github.com/vulhub/vulhub",
		"master",
	)
	if err == nil || !strings.Contains(err.Error(), "truncated") {
		t.Fatalf("expected truncated tree error, got %v", err)
	}
}
