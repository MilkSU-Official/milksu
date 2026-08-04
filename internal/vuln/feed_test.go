package vuln

import (
	"context"
	"net/http"
	"net/http/httptest"
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
