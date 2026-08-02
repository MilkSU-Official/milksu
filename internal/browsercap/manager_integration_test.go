package browsercap

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"testing"
	"time"
)

func TestManagedBrowserRoundTrip(t *testing.T) {
	if os.Getenv("MILKSU_BROWSER_INTEGRATION") != "1" {
		t.Skip("set MILKSU_BROWSER_INTEGRATION=1 to launch an isolated local Chrome profile")
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = fmt.Fprint(writer, `<!doctype html><title>MilkSU browser fixture</title><main><h1>Authorized challenge</h1><p>visible evidence</p></main>`)
	}))
	defer server.Close()
	manager, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	status, err := manager.StartCoding(ctx, "conversation-browser-fixture", server.URL)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.StopCoding("conversation-browser-fixture")
	if !status.Enabled || status.SessionID == "" {
		t.Fatalf("Coding browser did not become ready: %#v", status)
	}
	descriptor, enabled := manager.CodingDescriptor("conversation-browser-fixture")
	if !enabled || descriptor.SessionID != status.SessionID ||
		!strings.HasPrefix(descriptor.CDPEndpoint, "http://127.0.0.1:") {
		t.Fatalf("unexpected Coding browser descriptor: %#v, %v", descriptor, enabled)
	}
	var pages []Page
	for deadline := time.Now().Add(8 * time.Second); time.Now().Before(deadline); {
		pages, err = manager.Pages(ctx, status.SessionID)
		if err == nil && len(pages) > 0 && strings.HasPrefix(pages[0].URL, server.URL) {
			break
		}
		time.Sleep(100 * time.Millisecond)
	}
	if len(pages) == 0 {
		t.Fatalf("managed browser exposed no page: %v", err)
	}
	capture, err := manager.Capture(ctx, status.SessionID, pages[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if capture.Title != "MilkSU browser fixture" || !strings.Contains(capture.Text, "visible evidence") || capture.ScreenshotBase64 == "" {
		t.Fatalf("unexpected managed capture: %#v", capture)
	}
}
