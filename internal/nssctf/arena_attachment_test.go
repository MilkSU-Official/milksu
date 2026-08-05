package nssctf

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDownloadArenaAnnexKeepsTokenOnExactOriginAndChecksSize(t *testing.T) {
	const token = "nss_agent_fixture"
	data := []byte("fixture-attachment")
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/media/challenge.bin" {
			http.NotFound(writer, request)
			return
		}
		if request.Header.Get("Authorization") != "Bearer "+token {
			http.Error(writer, "missing token", http.StatusUnauthorized)
			return
		}
		writer.Header().Set("Content-Type", "application/octet-stream")
		_, _ = writer.Write(data)
	}))
	defer server.Close()

	client := NewArenaClient(ArenaClientOptions{
		BaseURL:    server.URL + "/api",
		HTTPClient: server.Client(),
	})
	attachment, err := client.DownloadAnnex(context.Background(), token, ArenaAnnex{
		Name: "challenge.bin", Size: int64(len(data)), URL: "/media/challenge.bin",
	})
	if err != nil {
		t.Fatal(err)
	}
	if attachment.Name != "challenge.bin" ||
		attachment.Size != int64(len(data)) ||
		string(attachment.Data) != string(data) {
		t.Fatalf("unexpected attachment: %#v", attachment)
	}
}

func TestDownloadArenaAnnexRejectsCrossOriginURLBeforeSendingToken(t *testing.T) {
	source := httptest.NewServer(http.NotFoundHandler())
	defer source.Close()
	destinationCalled := false
	destination := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		destinationCalled = true
	}))
	defer destination.Close()

	client := NewArenaClient(ArenaClientOptions{
		BaseURL:    source.URL + "/api",
		HTTPClient: source.Client(),
	})
	if _, err := client.DownloadAnnex(
		context.Background(),
		"nss_agent_fixture",
		ArenaAnnex{Name: "challenge.bin", URL: destination.URL + "/challenge.bin"},
	); err == nil {
		t.Fatal("expected a cross-origin attachment URL to be rejected")
	}
	if destinationCalled {
		t.Fatal("cross-origin attachment received a request")
	}
}
