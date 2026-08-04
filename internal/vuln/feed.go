package vuln

import (
	"context"
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"
)

const (
	CISAKEVFeedName = "CISA KEV"
	CISAKEVFeedURL  = "https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json"
	maxFeedBytes    = 12 << 20
)

// FeedSnapshotDownload is a read-only vulnerability intelligence payload.
// It carries raw JSON plus source timing so the frontend can parse, cache, and
// attribute records without treating the feed as a Judge or exploit signal.
type FeedSnapshotDownload struct {
	SourceName   string `json:"sourceName"`
	SourceURL    string `json:"sourceUrl"`
	RetrievedAt  string `json:"retrievedAt"`
	LastModified string `json:"lastModified"`
	HTTPStatus   int    `json:"httpStatus"`
	ContentType  string `json:"contentType"`
	Body         string `json:"body"`
}

func FetchCISAKEVFeed(ctx context.Context, client *http.Client) (FeedSnapshotDownload, error) {
	return FetchFeedSnapshot(ctx, client, CISAKEVFeedName, CISAKEVFeedURL)
}

func FetchFeedSnapshot(
	ctx context.Context,
	client *http.Client,
	sourceName string,
	sourceURL string,
) (FeedSnapshotDownload, error) {
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, sourceURL, nil)
	if err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("create vulnerability feed request: %w", err)
	}
	request.Header.Set("Accept", "application/json")
	request.Header.Set("User-Agent", "MilkSU-CVE-Learning/0.1")

	response, err := client.Do(request)
	if err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch vulnerability feed: %w", err)
	}
	defer response.Body.Close()

	contentType := response.Header.Get("Content-Type")
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return FeedSnapshotDownload{}, fmt.Errorf("fetch vulnerability feed: unexpected HTTP %d", response.StatusCode)
	}
	if mediaType, _, err := mime.ParseMediaType(contentType); err == nil {
		if !strings.Contains(strings.ToLower(mediaType), "json") {
			return FeedSnapshotDownload{}, fmt.Errorf("fetch vulnerability feed: unexpected content type %q", contentType)
		}
	}

	limited := io.LimitReader(response.Body, maxFeedBytes+1)
	body, err := io.ReadAll(limited)
	if err != nil {
		return FeedSnapshotDownload{}, fmt.Errorf("read vulnerability feed: %w", err)
	}
	if len(body) > maxFeedBytes {
		return FeedSnapshotDownload{}, fmt.Errorf("read vulnerability feed: payload exceeds %d bytes", maxFeedBytes)
	}
	return FeedSnapshotDownload{
		SourceName:   sourceName,
		SourceURL:    sourceURL,
		RetrievedAt:  retrievedAtFromHeaders(response.Header),
		LastModified: response.Header.Get("Last-Modified"),
		HTTPStatus:   response.StatusCode,
		ContentType:  contentType,
		Body:         string(body),
	}, nil
}

func retrievedAtFromHeaders(header http.Header) string {
	for _, key := range []string{"Last-Modified", "Date"} {
		value := header.Get(key)
		if value == "" {
			continue
		}
		parsed, err := http.ParseTime(value)
		if err == nil {
			return parsed.UTC().Format(time.RFC3339)
		}
	}
	return time.Now().UTC().Format(time.RFC3339)
}
