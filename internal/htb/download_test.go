package htb

import (
	"bytes"
	"context"
	"io"
	"net/http"
	"strings"
	"testing"
)

type roundTripFunc func(*http.Request) (*http.Response, error)

func (function roundTripFunc) RoundTrip(request *http.Request) (*http.Response, error) {
	return function(request)
}

func TestFetchDownloadImportsBoundedPublicHTTPSMaterial(t *testing.T) {
	client, err := newClient("https://mcp.example.test/", "token", http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}
	client.downloadClient = &http.Client{
		Transport: roundTripFunc(func(request *http.Request) (*http.Response, error) {
			if request.URL.String() != "https://cdn.example.test/files/warmup.zip" {
				t.Fatalf("unexpected download URL %q", request.URL)
			}
			return &http.Response{
				StatusCode: http.StatusOK,
				Header: http.Header{
					"Content-Type":        []string{"application/zip"},
					"Content-Disposition": []string{`attachment; filename="warmup.zip"`},
				},
				Body: io.NopCloser(bytes.NewReader([]byte("PK\x03\x04fixture"))),
			}, nil
		}),
	}

	material, err := client.FetchDownload(context.Background(), Download{
		ChallengeID: 901,
		URL:         "https://cdn.example.test/files/warmup.zip",
	})
	if err != nil {
		t.Fatal(err)
	}
	if material.Name != "warmup.zip" ||
		material.MediaType != "application/zip" ||
		material.Size != int64(len(material.Data)) ||
		len(material.SHA256) != 64 {
		t.Fatalf("unexpected HTB material: %#v", material)
	}
}

func TestHTBDownloadRejectsNonPublicOrCredentialedURLs(t *testing.T) {
	for _, raw := range []string{
		"http://cdn.example.test/file.zip",
		"https://localhost/file.zip",
		"https://127.0.0.1/file.zip",
		"https://10.0.0.1/file.zip",
		"https://user:secret@cdn.example.test/file.zip",
	} {
		if _, err := validatePublicHTTPSURL(raw); err == nil {
			t.Fatalf("accepted unsafe HTB download URL %q", raw)
		}
	}
}

func TestFetchDownloadRejectsOversizedResponse(t *testing.T) {
	client, err := newClient("https://mcp.example.test/", "token", http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}
	client.downloadClient = &http.Client{
		Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
			return &http.Response{
				StatusCode:    http.StatusOK,
				Header:        http.Header{},
				ContentLength: maxDownloadBytes + 1,
				Body:          io.NopCloser(strings.NewReader("not-read")),
			}, nil
		}),
	}
	if _, err := client.FetchDownload(context.Background(), Download{
		ChallengeID: 901,
		URL:         "https://cdn.example.test/large.bin",
	}); err == nil || !strings.Contains(err.Error(), "32 MiB") {
		t.Fatalf("expected oversized HTB download rejection, got %v", err)
	}
}
