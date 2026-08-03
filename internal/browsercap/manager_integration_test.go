package browsercap

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestManagedBrowserRoundTrip(t *testing.T) {
	if os.Getenv("MILKSU_BROWSER_INTEGRATION") != "1" {
		t.Skip("set MILKSU_BROWSER_INTEGRATION=1 to launch an isolated local Chrome profile")
	}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/api/failure" {
			http.Error(writer, "expected fixture failure", http.StatusServiceUnavailable)
			return
		}
		_, _ = fmt.Fprint(writer, `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>MilkSU browser fixture</title>
<main>
  <h1>Authorized challenge</h1>
  <p>visible evidence</p>
  <button id="verify" type="button">Verify fixture</button>
  <output id="result" aria-live="polite">Pending</output>
</main>
<script>
  console.error("fixture-console-error")
  fetch("/api/failure")
  document.querySelector("#verify").addEventListener("click", () => {
    document.querySelector("#result").textContent = "Verified"
  })
</script>
</html>`)
	}))
	defer server.Close()
	workspace := t.TempDir()
	if os.Getenv("MILKSU_KEEP_BROWSER_FIXTURE") == "1" {
		keptWorkspace, err := os.MkdirTemp("", "milksu-coding-browser-evidence-")
		if err != nil {
			t.Fatal(err)
		}
		workspace = keptWorkspace
		t.Logf("kept Coding Browser evidence workspace: %s", workspace)
	}
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

	node, err := exec.LookPath("node")
	if err != nil {
		t.Fatal("Node.js is required for the Coding Browser MCP integration")
	}
	packageDirectory, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	repositoryRoot := filepath.Clean(filepath.Join(packageDirectory, "..", ".."))
	evidenceRelative := filepath.Join(
		".milksu",
		"browser-evidence",
		descriptor.SessionID,
	)
	command := exec.CommandContext(
		ctx,
		node,
		filepath.Join(repositoryRoot, "scripts", "test-coding-browser-mcp.mjs"),
	)
	command.Dir = repositoryRoot
	command.Env = []string{
		"HOME=" + workspace,
		"LANG=en_US.UTF-8",
		"MILKSU_CODING_BROWSER_CDP_ENDPOINT=" + descriptor.CDPEndpoint,
		"MILKSU_CODING_BROWSER_EVIDENCE_RELATIVE=" + filepath.ToSlash(evidenceRelative),
		"MILKSU_CODING_BROWSER_SESSION_ID=" + descriptor.SessionID,
		"MILKSU_CODING_BROWSER_URL=" + server.URL,
		"MILKSU_CODING_BROWSER_WORKSPACE=" + workspace,
		"PATH=" + os.Getenv("PATH"),
		"TMPDIR=" + workspace,
	}
	output, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("Coding Browser MCP integration: %v\n%s", err, output)
	}
	var report struct {
		SchemaVersion string `json:"schemaVersion"`
		Passed        bool   `json:"passed"`
		EvidenceFiles struct {
			MinimumScreenshot string `json:"minimumScreenshot"`
			WideScreenshot    string `json:"wideScreenshot"`
			Snapshot          string `json:"snapshot"`
			Console           string `json:"console"`
			Network           string `json:"network"`
		} `json:"evidenceFiles"`
	}
	if err := json.Unmarshal(output, &report); err != nil {
		t.Fatalf("decode Coding Browser MCP report: %v\n%s", err, output)
	}
	if report.SchemaVersion != "milksu-coding-browser-evidence/v1alpha1" ||
		!report.Passed {
		t.Fatalf("unexpected Coding Browser MCP report: %s", output)
	}
	for _, path := range []string{
		report.EvidenceFiles.MinimumScreenshot,
		report.EvidenceFiles.WideScreenshot,
		report.EvidenceFiles.Snapshot,
		report.EvidenceFiles.Console,
		report.EvidenceFiles.Network,
	} {
		info, err := os.Stat(filepath.Join(workspace, filepath.FromSlash(path)))
		if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
			t.Fatalf("missing Coding Browser evidence %q: %v", path, err)
		}
	}
}
