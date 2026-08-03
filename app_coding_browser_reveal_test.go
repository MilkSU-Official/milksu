package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCodingBrowserEvidenceRevealStaysInTheBrowserAdapter(t *testing.T) {
	repositoryRoot, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	readSource := func(relativePath string) string {
		t.Helper()
		data, readErr := os.ReadFile(filepath.Join(repositoryRoot, relativePath))
		if readErr != nil {
			t.Fatal(readErr)
		}
		return string(data)
	}

	browserAdapter := readSource("app_coding_browser.go")
	appCore := readSource("app.go")

	// The desktop entry point must live in the Coding browser adapter, and
	// app.go must not grow the reveal responsibility.
	for _, fragment := range []string{
		"func (a *App) RevealCodingBrowserEvidence(conversationID string) error",
		"CodingEvidenceSessionID(conversationID)",
		"a.conversations.Get(conversationID)",
		"codingBrowserEvidenceWorkspace(",
		"codingevidence.Derive(codingevidence.Request{",
		"codingevidence.RevealInFinder(",
	} {
		if !strings.Contains(browserAdapter, fragment) {
			t.Fatalf("app_coding_browser.go does not expose %q", fragment)
		}
	}
	if strings.Contains(appCore, "RevealCodingBrowserEvidence") {
		t.Fatal("app.go must not take on the browser evidence reveal responsibility")
	}

	// The frontend command binding must send only the conversation id, never
	// an arbitrary evidence path or session id.
	desktopBinding := readSource("app/src/desktop.ts")
	for _, fragment := range []string{
		"RevealCodingBrowserEvidence(conversationId: string): Promise<void>",
		"case 'reveal_coding_browser_evidence':",
		"app.RevealCodingBrowserEvidence(",
		"args?.conversationId as string",
		"reveal_coding_browser_evidence",
	} {
		if !strings.Contains(desktopBinding, fragment) {
			t.Fatalf("app/src/desktop.ts does not expose %q", fragment)
		}
	}

	// The browser evidence card owns the entry point; it must pass only the
	// conversation id of the current session.
	chatPage := readSource("app/src/components-vue/ChatPage.vue")
	for _, fragment := range []string{
		"reveal_coding_browser_evidence",
		"在 Finder 中显示",
	} {
		if !strings.Contains(chatPage, fragment) {
			t.Fatalf("ChatPage.vue does not expose %q", fragment)
		}
	}
	revealIndex := strings.Index(chatPage, "reveal_coding_browser_evidence")
	if revealIndex < 0 {
		t.Fatal("ChatPage.vue does not invoke reveal_coding_browser_evidence")
	}
	revealEnd := strings.Index(chatPage[revealIndex:], "})")
	if revealEnd < 0 {
		t.Fatal("cannot isolate reveal_coding_browser_evidence command arguments")
	}
	revealBlock := chatPage[revealIndex : revealIndex+revealEnd]
	if strings.Contains(revealBlock, "sessionId") || strings.Contains(revealBlock, "browser-evidence") {
		t.Fatal("the reveal entry must not submit an evidence path or session id")
	}
}

func TestCodingBrowserEvidenceWorkspaceUsesOnlyTrustedAppState(t *testing.T) {
	explicit, err := codingBrowserEvidenceWorkspace(
		"/tmp/project",
		"/tmp/app-data",
	)
	if err != nil || explicit != "/tmp/project" {
		t.Fatalf("unexpected explicit workspace: %q, %v", explicit, err)
	}
	temporary, err := codingBrowserEvidenceWorkspace("", "/tmp/app-data")
	if err != nil {
		t.Fatalf("derive temporary workspace: %v", err)
	}
	if temporary != filepath.Join("/tmp/app-data", "agent-workspace") {
		t.Fatalf("unexpected temporary workspace: %q", temporary)
	}
	if _, err := codingBrowserEvidenceWorkspace("", ""); err == nil {
		t.Fatal("expected missing trusted app data directory to be rejected")
	}
}
