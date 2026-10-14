package browsercap

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/gorilla/websocket"
)

type codingHostFixture struct {
	started            CodingHostStartRequest
	tabs               CodingHostTabList
	researchTabCreated bool
}

func (host *codingHostFixture) Start(
	_ context.Context,
	request CodingHostStartRequest,
) (CodingHostSession, error) {
	host.started = request
	return CodingHostSession{
		Name:        "Electron Chromium fixture",
		CDPEndpoint: "http://127.0.0.1:43117",
	}, nil
}

func (*codingHostFixture) SetViewport(string, CodingViewport) error { return nil }
func (*codingHostFixture) Navigate(string, string) error            { return nil }
func (*codingHostFixture) Back(string) error                        { return nil }
func (*codingHostFixture) Forward(string) error                     { return nil }
func (*codingHostFixture) Reload(string) error                      { return nil }
func (host *codingHostFixture) ListTabs(string) (CodingHostTabList, error) {
	return host.tabs, nil
}
func (*codingHostFixture) CreateTab(string, string) (CodingHostTabList, error) {
	return CodingHostTabList{}, nil
}
func (host *codingHostFixture) CreateResearchTab(sessionID, targetURL string) (CodingHostTabList, error) {
	host.researchTabCreated = true
	host.tabs = CodingHostTabList{
		ActiveTabID: "tab_research",
		Tabs:        []CodingBrowserTab{{ID: "tab_research", URL: targetURL, Active: true}},
	}
	return host.tabs, nil
}
func (*codingHostFixture) ActivateTab(string, string) (CodingHostTabList, error) {
	return CodingHostTabList{}, nil
}
func (*codingHostFixture) CloseTab(string, string) (CodingHostTabList, error) {
	return CodingHostTabList{}, nil
}
func (*codingHostFixture) CloseAllTabs(string) (CodingHostTabList, error) {
	return CodingHostTabList{}, nil
}
func (*codingHostFixture) Stop(string) error { return nil }
func (*codingHostFixture) Close()            {}

func TestCodingBrowserUsesUserFacingOriginWithoutSandboxLabel(t *testing.T) {
	host := &codingHostFixture{}
	manager, err := NewWithCodingHost(t.TempDir(), host)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()

	status, err := manager.StartCoding(
		context.Background(),
		"conversation-1",
		"https://example.com/docs",
	)
	if err != nil {
		t.Fatal(err)
	}
	if status.ProfileLabel != "https://example.com" {
		t.Fatalf("profile label = %q, want user-facing origin", status.ProfileLabel)
	}
	if strings.Contains(strings.ToLower(status.ProfileLabel), "sandbox") {
		t.Fatalf("profile label exposes implementation terminology: %q", status.ProfileLabel)
	}
	if host.started.SessionID == "" || host.started.InitialURL != "https://example.com/docs" {
		t.Fatalf("unexpected host request: %#v", host.started)
	}
}

func TestEnsureCodingStartsBlankOnce(t *testing.T) {
	host := &codingHostFixture{}
	manager, err := NewWithCodingHost(t.TempDir(), host)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()

	first, err := manager.EnsureCoding(context.Background(), "conversation-blank")
	if err != nil {
		t.Fatal(err)
	}
	if !first.Enabled || first.SessionID == "" || first.ProfileLabel != "浏览器" {
		t.Fatalf("blank browser status = %#v", first)
	}
	if host.started.InitialURL != "" {
		t.Fatalf("expected a blank start, got %#v", host.started)
	}
	second, err := manager.EnsureCoding(context.Background(), "conversation-blank")
	if err != nil {
		t.Fatal(err)
	}
	if second.SessionID != first.SessionID {
		t.Fatalf("ensure replaced the live session: %s -> %s", first.SessionID, second.SessionID)
	}
}

func TestCreateResearchCodingTabUsesFreshResearchHostView(t *testing.T) {
	host := &codingHostFixture{}
	manager, err := NewWithCodingHost(t.TempDir(), host)
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	if _, err := manager.EnsureCoding(context.Background(), "research-conversation"); err != nil {
		t.Fatal(err)
	}

	status, err := manager.CreateResearchCodingTab("research-conversation", "https://example.test/paper")
	if err != nil {
		t.Fatal(err)
	}
	if !host.researchTabCreated {
		t.Fatal("Research tab used the ordinary browser creation path")
	}
	if status.ActiveTabID != "tab_research" || len(status.Tabs) != 1 || status.Tabs[0].URL != "https://example.test/paper" {
		t.Fatalf("unexpected Research tab status: %#v", status)
	}
}

func TestCodingBrowserDescriptorStaysLoopbackAndConversationBound(t *testing.T) {
	manager, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	manager.sessions["browser_fixture"] = &managedSession{
		public: Session{
			ID:    "browser_fixture",
			Phase: "ready",
			port:  43117,
		},
		conversationID: "conversation-1",
	}

	descriptor, ok := manager.CodingDescriptor("conversation-1")
	if !ok {
		t.Fatal("expected a Coding browser descriptor")
	}
	if descriptor.SessionID != "browser_fixture" ||
		descriptor.CDPEndpoint != "http://127.0.0.1:43117" {
		t.Fatalf("unexpected descriptor: %#v", descriptor)
	}
	if _, ok := manager.CodingDescriptor("conversation-2"); ok {
		t.Fatal("descriptor must not leak across conversations")
	}
}

func TestPagesCanProbeStartingHostedSession(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path != "/json/list" {
			http.NotFound(writer, request)
			return
		}
		writer.Header().Set("Content-Type", "application/json")
		_, _ = writer.Write([]byte(`[{
			"id":"page-1",
			"title":"Starting",
			"url":"http://127.0.0.1/",
			"type":"page",
			"webSocketDebuggerUrl":"ws://127.0.0.1/devtools/page/page-1"
		}]`))
	}))
	defer server.Close()

	parsed, err := url.Parse(server.URL)
	if err != nil {
		t.Fatal(err)
	}
	port, err := strconv.Atoi(parsed.Port())
	if err != nil {
		t.Fatal(err)
	}
	manager, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	manager.sessions["browser_starting"] = &managedSession{
		public: Session{ID: "browser_starting", Phase: "starting", port: port},
	}

	pages, err := manager.Pages(context.Background(), "browser_starting")
	if err != nil {
		t.Fatal(err)
	}
	if len(pages) != 1 || pages[0].Title != "Starting" {
		t.Fatalf("unexpected pages: %#v", pages)
	}
}

func TestNormalizeCodingConversationIDRejectsUnsafeValues(t *testing.T) {
	for _, value := range []string{"", "conversation/1", "conversation 1", "对话"} {
		if _, err := normalizeCodingConversationID(value); err == nil {
			t.Fatalf("expected %q to be rejected", value)
		}
	}
	if value, err := normalizeCodingConversationID("conversation-1:retry"); err != nil ||
		value != "conversation-1:retry" {
		t.Fatalf("expected safe id, got %q, %v", value, err)
	}
}

func TestCodingEvidenceSessionIDIsConversationBound(t *testing.T) {
	manager, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	if _, err := manager.CodingEvidenceSessionID("conversation-1"); err == nil {
		t.Fatal("expected a missing session to be rejected")
	}
	manager.sessions["browser_evidence_fixture"] = &managedSession{
		public: Session{
			ID:    "browser_evidence_fixture",
			Phase: "ready",
		},
		conversationID: "conversation-1",
	}
	sessionID, err := manager.CodingEvidenceSessionID("conversation-1")
	if err != nil {
		t.Fatalf("read trusted session: %v", err)
	}
	if sessionID != "browser_evidence_fixture" {
		t.Fatalf("unexpected session id %q", sessionID)
	}
	if _, err := manager.CodingEvidenceSessionID("conversation-2"); err == nil {
		t.Fatal("evidence session must not leak across conversations")
	}
}

func TestCurrentTabBridgeRequiresPairingAndPersistsExactPage(t *testing.T) {
	manager, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	info, err := manager.StartBridge()
	if err != nil {
		t.Fatal(err)
	}
	serializedInfo, err := json.Marshal(info)
	if err != nil {
		t.Fatal(err)
	}
	if bytes.Contains(serializedInfo, []byte(info.Token)) || bytes.Contains(serializedInfo, []byte(`"token"`)) {
		t.Fatalf("bridge token leaked through public JSON: %s", serializedInfo)
	}
	body, _ := json.Marshal(map[string]string{"title": "Challenge", "url": "https://ctf.example/challenge/7", "text": "flag format and attachments"})
	request, _ := http.NewRequest(http.MethodPost, info.Endpoint+"/ingest", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusUnauthorized {
		t.Fatalf("unpaired request returned %d", response.StatusCode)
	}
	request, _ = http.NewRequest(http.MethodPost, info.Endpoint+"/ingest", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+info.Token)
	response, err = http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("paired request returned %d", response.StatusCode)
	}
	pages := manager.SharedPages()
	if len(pages) != 1 || pages[0].URL != "https://ctf.example/challenge/7" || pages[0].Scope.Targets[0].Value != "https://ctf.example" {
		t.Fatalf("unexpected shared page: %#v", pages)
	}
}

func TestCurrentTabBridgePairingSurvivesApplicationRestart(t *testing.T) {
	root := t.TempDir()
	first, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	firstInfo, err := first.StartBridge()
	if err != nil {
		t.Fatal(err)
	}
	pairingPath := filepath.Join(root, "bridge-pairing.json")
	pairingStat, err := os.Stat(pairingPath)
	if err != nil {
		t.Fatal(err)
	}
	if pairingStat.Mode().Perm() != 0o600 {
		t.Fatalf("browser pairing permissions = %o, want 600", pairingStat.Mode().Perm())
	}
	first.Close()

	second, err := New(root)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	secondInfo, err := second.StartBridge()
	if err != nil {
		t.Fatal(err)
	}
	if secondInfo.Endpoint != firstInfo.Endpoint ||
		secondInfo.Token != firstInfo.Token ||
		secondInfo.PairingCode != firstInfo.PairingCode {
		t.Fatalf(
			"browser pairing changed across restart:\nfirst=%#v\nsecond=%#v",
			firstInfo,
			secondInfo,
		)
	}
	connection := dialBridge(t, secondInfo, "persistent-session-123456")
	defer connection.Close()
	if pages := second.SharedPages(); len(pages) != 0 {
		t.Fatalf("unexpected shared pages after pairing restart: %#v", pages)
	}
}

func TestStartBridgeCanCloseImmediately(t *testing.T) {
	root := t.TempDir()
	for iteration := 0; iteration < 100; iteration++ {
		manager, err := New(root)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := manager.StartBridge(); err != nil {
			manager.Close()
			t.Fatal(err)
		}
		// StartBridge launches Serve asynchronously. Close is allowed as soon
		// as StartBridge returns, even when that goroutine has not run yet.
		manager.Close()
	}
}

func TestOriginTargetRejectsCredentialsAndNonHTTP(t *testing.T) {
	for _, value := range []string{"ssh://host:22", "https://user:pass@example.com", "file:///tmp/x"} {
		if _, err := originTarget(value); err == nil {
			t.Fatalf("unsafe browser target was accepted: %s", value)
		}
	}
}

func dialBridge(
	t *testing.T,
	info BridgeInfo,
	sessionIDs ...string,
) *websocket.Conn {
	t.Helper()
	wsURL := "ws" + strings.TrimPrefix(info.Endpoint, "http") + "/ws"
	connection, _, err := (&websocket.Dialer{
		HandshakeTimeout: 2 * time.Second,
		Subprotocols:     []string{"milksu-bridge-v1", info.Token},
	}).Dial(
		wsURL,
		http.Header{"Origin": []string{"chrome-extension://milksu-test"}},
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := connection.WriteJSON(map[string]any{
		"type":             "hello",
		"bridgeSessionIds": sessionIDs,
	}); err != nil {
		connection.Close()
		t.Fatal(err)
	}
	var acknowledgement map[string]any
	if err := connection.ReadJSON(&acknowledgement); err != nil {
		connection.Close()
		t.Fatal(err)
	}
	if acknowledgement["type"] != "hello_ack" {
		connection.Close()
		t.Fatalf("unexpected browser bridge hello response: %#v", acknowledgement)
	}
	return connection
}

func TestManagedBrowserDoesNotInheritApplicationSecrets(t *testing.T) {
	t.Setenv("MILKSU_TEST_SECRET", "must-not-reach-browser")
	for _, entry := range browserEnvironment() {
		if strings.HasPrefix(entry, "MILKSU_TEST_SECRET=") {
			t.Fatalf("managed browser inherited an unrelated secret: %q", entry)
		}
	}
}
