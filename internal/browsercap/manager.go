package browsercap

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/browserextension"
	"github.com/MilkSU-Official/milksu/internal/ctfshow"
	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/google/uuid"
	"github.com/gorilla/websocket"
)

const maxPageTextBytes = 1_000_000

type Session struct {
	ID            string                    `json:"id"`
	Phase         string                    `json:"phase"`
	InitialURL    string                    `json:"initialUrl"`
	ProfileLabel  string                    `json:"profileLabel"`
	Scope         securitypolicy.ScopeGrant `json:"scope"`
	StartedAt     time.Time                 `json:"startedAt"`
	BrowserBinary string                    `json:"browserBinary"`
	port          int
	command       *exec.Cmd
}

type Page struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	URL   string `json:"url"`
	Type  string `json:"type"`
	wsURL string
}

type Capture struct {
	SessionID        string                    `json:"sessionId"`
	PageID           string                    `json:"pageId"`
	Title            string                    `json:"title"`
	URL              string                    `json:"url"`
	Text             string                    `json:"text"`
	ScreenshotBase64 string                    `json:"screenshotBase64,omitempty"`
	CapturedAt       time.Time                 `json:"capturedAt"`
	Provenance       string                    `json:"provenance"`
	Scope            securitypolicy.ScopeGrant `json:"scope"`
}

type ActionRequest struct {
	SessionID string `json:"sessionId"`
	PageID    string `json:"pageId"`
	Kind      string `json:"kind"`
	URL       string `json:"url,omitempty"`
	Selector  string `json:"selector,omitempty"`
	Value     string `json:"value,omitempty"`
	Approved  bool   `json:"approved"`
}

type SharedPage struct {
	ID              string                    `json:"id"`
	BridgeSessionID string                    `json:"bridgeSessionId,omitempty"`
	Adapter         string                    `json:"adapter,omitempty"`
	Connected       bool                      `json:"connected"`
	Title           string                    `json:"title"`
	URL             string                    `json:"url"`
	Text            string                    `json:"text"`
	NSSCTF          *NSSCTFPageState          `json:"nssctf,omitempty"`
	CTFShow         *CTFShowCatalogState      `json:"ctfshow,omitempty"`
	CapturedAt      time.Time                 `json:"capturedAt"`
	Provenance      string                    `json:"provenance"`
	Scope           securitypolicy.ScopeGrant `json:"scope"`
}

type CTFShowCatalogState struct {
	LoggedIn bool                     `json:"loggedIn"`
	Total    int                      `json:"total"`
	Problems []ctfshow.CatalogProblem `json:"problems,omitempty"`
}

type BridgeInfo struct {
	Endpoint      string `json:"endpoint"`
	Token         string `json:"-"`
	PairingCode   string `json:"pairingCode"`
	ExtensionPath string `json:"extensionPath"`
	Active        bool   `json:"active"`
	Connected     bool   `json:"connected"`
	LastSeenAt    string `json:"lastSeenAt,omitempty"`
}

type NSSCTFPageState struct {
	ProblemID  int      `json:"problemId"`
	Title      string   `json:"title"`
	Category   string   `json:"category,omitempty"`
	Tags       []string `json:"tags"`
	LoggedIn   bool     `json:"loggedIn"`
	CanSubmit  bool     `json:"canSubmit"`
	NeedsStart bool     `json:"needsStart"`
	StartCost  int      `json:"startCost,omitempty"`
	Solved     bool     `json:"solved"`
}

type NSSCTFBridgeCommand struct {
	ID              string    `json:"id"`
	Type            string    `json:"type"`
	BridgeSessionID string    `json:"bridgeSessionId"`
	ProblemID       int       `json:"problemId"`
	Candidate       string    `json:"candidate"`
	CreatedAt       time.Time `json:"createdAt"`
	ExpiresAt       time.Time `json:"expiresAt"`
}

type NSSCTFAttachment struct {
	CommandID  string    `json:"commandId"`
	ProblemID  int       `json:"problemId"`
	Name       string    `json:"name"`
	MediaType  string    `json:"mediaType"`
	DataBase64 string    `json:"dataBase64"`
	SHA256     string    `json:"sha256"`
	Size       int64     `json:"size"`
	ReceivedAt time.Time `json:"receivedAt"`
}

type NSSCTFJudgeReceipt struct {
	CommandID  string    `json:"commandId"`
	ProblemID  int       `json:"problemId"`
	Status     string    `json:"status"`
	Correct    *bool     `json:"correct,omitempty"`
	Message    string    `json:"message"`
	URL        string    `json:"url"`
	ReceivedAt time.Time `json:"receivedAt"`
}

type managedSession struct {
	public Session
}

type bridgeClient struct {
	connection *websocket.Conn
	writeMu    sync.Mutex
	sessionIDs map[string]struct{}
}

type bridgePairingState struct {
	Version int    `json:"version"`
	Port    int    `json:"port"`
	Token   string `json:"token"`
}

type bridgeCommandState struct {
	command          NSSCTFBridgeCommand
	judgeResult      NSSCTFJudgeReceipt
	attachmentResult NSSCTFAttachment
	ctfshowChallenge ctfshow.ChallengeCapture
	ctfshowJudge     ctfshow.JudgeReceipt
	err              error
	done             chan struct{}
}

type Manager struct {
	mu             sync.Mutex
	root           string
	sessions       map[string]*managedSession
	sharedPages    []SharedPage
	sharedPath     string
	bridgeServer   *http.Server
	bridgeListener net.Listener
	bridgeToken    string
	bridgeClients  map[*bridgeClient]struct{}
	bridgeCommands map[string]*bridgeCommandState
	bridgeLastSeen time.Time
	bridgePort     int
	pairingPath    string
	extensionPath  string
	httpClient     *http.Client
	ctfshowSink    func(context.Context, []ctfshow.CatalogProblem) error
}

func New(root string) (*Manager, error) {
	root = filepath.Join(root, "browser")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create browser capability root: %w", err)
	}
	manager := &Manager{
		root: root, sessions: make(map[string]*managedSession), sharedPath: filepath.Join(root, "shared-pages.json"),
		bridgeClients: make(map[*bridgeClient]struct{}), bridgeCommands: make(map[string]*bridgeCommandState),
		pairingPath: filepath.Join(root, "bridge-pairing.json"),
		httpClient:  &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}},
	}
	if err := manager.loadBridgePairing(); err != nil {
		return nil, err
	}
	if err := manager.installExtension(); err != nil {
		return nil, err
	}
	if data, err := os.ReadFile(manager.sharedPath); err == nil {
		_ = json.Unmarshal(data, &manager.sharedPages)
	} else if !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("read shared browser pages: %w", err)
	}
	return manager, nil
}

func (m *Manager) Start(ctx context.Context, initialURL string) (Session, error) {
	origin, err := originTarget(initialURL)
	if err != nil {
		return Session{}, err
	}
	grant, err := securitypolicy.NewGrant("managed-browser", "authorized security learning", []securitypolicy.Target{origin}, 8*time.Hour)
	if err != nil {
		return Session{}, err
	}
	binary, err := findChrome()
	if err != nil {
		return Session{}, err
	}
	id := "browser_" + uuid.NewString()
	profile := filepath.Join(m.root, "profiles", id)
	if err := os.MkdirAll(profile, 0o700); err != nil {
		return Session{}, fmt.Errorf("create managed browser profile: %w", err)
	}
	arguments := []string{
		"--remote-debugging-address=127.0.0.1", "--remote-debugging-port=0", "--user-data-dir=" + profile,
		"--no-first-run", "--no-default-browser-check", "--disable-sync", "--disable-component-update",
		"--metrics-recording-only", "--disable-breakpad", "--new-window", initialURL,
	}
	command := exec.Command(binary, arguments...)
	command.Env = browserEnvironment()
	if err := command.Start(); err != nil {
		return Session{}, fmt.Errorf("start isolated Chrome profile: %w", err)
	}
	port, err := waitDevToolsPort(ctx, profile, command)
	if err != nil {
		_ = command.Process.Kill()
		return Session{}, err
	}
	public := Session{
		ID: id, Phase: "ready", InitialURL: initialURL, ProfileLabel: "MilkSU Managed · " + origin.Value,
		Scope: grant, StartedAt: time.Now().UTC(), BrowserBinary: filepath.Base(binary), port: port, command: command,
	}
	m.mu.Lock()
	m.sessions[id] = &managedSession{public: public}
	m.mu.Unlock()
	go func() {
		_ = command.Wait()
		m.mu.Lock()
		if current := m.sessions[id]; current != nil && current.public.command == command {
			current.public.Phase = "stopped"
		}
		m.mu.Unlock()
	}()
	return publicView(public), nil
}

func (m *Manager) Sessions() []Session {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]Session, 0, len(m.sessions))
	for _, session := range m.sessions {
		result = append(result, publicView(session.public))
	}
	return result
}

func (m *Manager) Pages(ctx context.Context, sessionID string) ([]Page, error) {
	session, err := m.session(sessionID)
	if err != nil {
		return nil, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, fmt.Sprintf("http://127.0.0.1:%d/json/list", session.port), nil)
	if err != nil {
		return nil, err
	}
	response, err := m.httpClient.Do(request)
	if err != nil {
		return nil, fmt.Errorf("list managed browser pages: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("managed browser returned %s", response.Status)
	}
	var raw []struct {
		ID                   string `json:"id"`
		Title                string `json:"title"`
		URL                  string `json:"url"`
		Type                 string `json:"type"`
		WebSocketDebuggerURL string `json:"webSocketDebuggerUrl"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&raw); err != nil {
		return nil, fmt.Errorf("decode managed browser pages: %w", err)
	}
	pages := make([]Page, 0, len(raw))
	for _, item := range raw {
		if item.Type != "page" || item.WebSocketDebuggerURL == "" {
			continue
		}
		pages = append(pages, Page{ID: item.ID, Title: item.Title, URL: item.URL, Type: item.Type, wsURL: item.WebSocketDebuggerURL})
	}
	return pages, nil
}

func (m *Manager) Capture(ctx context.Context, sessionID, pageID string) (Capture, error) {
	session, page, err := m.authorizedPage(ctx, sessionID, pageID, "read_remote", false)
	if err != nil {
		return Capture{}, err
	}
	var evaluation struct {
		Result struct {
			Result struct {
				Value struct {
					Title string `json:"title"`
					URL   string `json:"url"`
					Text  string `json:"text"`
					Ready string `json:"ready"`
				} `json:"value"`
			} `json:"result"`
		} `json:"result"`
	}
	expression := `(() => ({title: document.title, url: location.href, text: (document.body?.innerText || '').slice(0, 1000000), ready: document.readyState}))()`
	readyInScope := false
	for attempt := 0; attempt < 40; attempt++ {
		if err := cdpCall(ctx, page.wsURL, "Runtime.evaluate", map[string]any{"expression": expression, "returnByValue": true, "awaitPromise": true}, &evaluation); err != nil {
			return Capture{}, err
		}
		value := evaluation.Result.Result.Value
		if value.URL != "" && value.Ready != "loading" {
			if _, checkErr := m.checkOrigin(session, value.URL, "read_remote", false); checkErr == nil {
				readyInScope = true
				break
			} else if strings.HasPrefix(value.URL, "http://") || strings.HasPrefix(value.URL, "https://") {
				return Capture{}, checkErr
			}
		}
		select {
		case <-ctx.Done():
			return Capture{}, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	value := evaluation.Result.Result.Value
	if !readyInScope {
		return Capture{}, fmt.Errorf("managed browser page did not finish loading inside scope (last URL %q)", value.URL)
	}
	if _, err := m.checkOrigin(session, value.URL, "read_remote", false); err != nil {
		return Capture{}, err
	}
	var screenshot struct {
		Result struct {
			Data string `json:"data"`
		} `json:"result"`
	}
	_ = cdpCall(ctx, page.wsURL, "Page.captureScreenshot", map[string]any{"format": "png", "fromSurface": true}, &screenshot)
	return Capture{
		SessionID: sessionID, PageID: pageID, Title: value.Title, URL: value.URL, Text: value.Text,
		ScreenshotBase64: screenshot.Result.Data, CapturedAt: time.Now().UTC(),
		Provenance: "managed-browser:" + sessionID + ":" + pageID, Scope: session.Scope,
	}, nil
}

func (m *Manager) Act(ctx context.Context, request ActionRequest) error {
	effect := "modify"
	if request.Kind == "navigate" {
		effect = "read_remote"
	}
	session, page, err := m.authorizedPage(ctx, request.SessionID, request.PageID, effect, request.Approved)
	if err != nil {
		return err
	}
	switch request.Kind {
	case "navigate":
		if _, err := m.checkOrigin(session, request.URL, "read_remote", false); err != nil {
			return err
		}
		var ignored any
		return cdpCall(ctx, page.wsURL, "Page.navigate", map[string]any{"url": request.URL}, &ignored)
	case "click":
		if strings.TrimSpace(request.Selector) == "" || len(request.Selector) > 512 {
			return fmt.Errorf("a bounded CSS selector is required")
		}
		selector, _ := json.Marshal(request.Selector)
		expression := fmt.Sprintf(`(() => { const e = document.querySelector(%s); if (!e) throw new Error('selector not found'); e.click(); return true; })()`, selector)
		var ignored any
		return cdpCall(ctx, page.wsURL, "Runtime.evaluate", map[string]any{"expression": expression, "returnByValue": true}, &ignored)
	case "fill":
		if strings.TrimSpace(request.Selector) == "" || len(request.Selector) > 512 || len(request.Value) > 4096 {
			return fmt.Errorf("bounded selector and value are required")
		}
		selector, _ := json.Marshal(request.Selector)
		value, _ := json.Marshal(request.Value)
		expression := fmt.Sprintf(`(() => { const e = document.querySelector(%s); if (!e) throw new Error('selector not found'); e.focus(); e.value = %s; e.dispatchEvent(new Event('input',{bubbles:true})); e.dispatchEvent(new Event('change',{bubbles:true})); return true; })()`, selector, value)
		var ignored any
		return cdpCall(ctx, page.wsURL, "Runtime.evaluate", map[string]any{"expression": expression, "returnByValue": true}, &ignored)
	default:
		return fmt.Errorf("unsupported managed browser action %q", request.Kind)
	}
}

func (m *Manager) Stop(sessionID string) error {
	m.mu.Lock()
	session := m.sessions[sessionID]
	m.mu.Unlock()
	if session == nil {
		return nil
	}
	if session.public.command != nil && session.public.command.Process != nil {
		_ = session.public.command.Process.Signal(os.Interrupt)
		timer := time.NewTimer(2 * time.Second)
		defer timer.Stop()
		select {
		case <-timer.C:
			_ = session.public.command.Process.Kill()
		}
	}
	m.mu.Lock()
	delete(m.sessions, sessionID)
	m.mu.Unlock()
	return nil
}

func (m *Manager) StartBridge() (BridgeInfo, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.bridgeListener != nil {
		return m.bridgeInfoLocked(), nil
	}
	address := "127.0.0.1:0"
	if m.bridgePort > 0 {
		address = net.JoinHostPort("127.0.0.1", strconv.Itoa(m.bridgePort))
	}
	listener, err := net.Listen("tcp", address)
	if err != nil {
		if m.bridgePort > 0 {
			return BridgeInfo{}, fmt.Errorf(
				"restart persistent browser bridge on 127.0.0.1:%d: %w; quit any stale MilkSU process and retry",
				m.bridgePort,
				err,
			)
		}
		return BridgeInfo{}, fmt.Errorf("start loopback browser bridge: %w", err)
	}
	if m.bridgeToken == "" {
		tokenBytes := make([]byte, 24)
		if _, err := rand.Read(tokenBytes); err != nil {
			_ = listener.Close()
			return BridgeInfo{}, err
		}
		m.bridgeToken = hex.EncodeToString(tokenBytes)
	}
	m.bridgePort = listener.Addr().(*net.TCPAddr).Port
	if err := m.persistBridgePairingLocked(); err != nil {
		_ = listener.Close()
		m.bridgeToken = ""
		m.bridgePort = 0
		return BridgeInfo{}, err
	}
	m.bridgeListener = listener
	mux := http.NewServeMux()
	mux.HandleFunc("/ingest", m.handleBridgeIngest)
	mux.HandleFunc("/ws", m.handleBridgeWebSocket)
	bridgeServer := &http.Server{Handler: mux, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second}
	m.bridgeServer = bridgeServer
	go func() { _ = bridgeServer.Serve(listener) }()
	return m.bridgeInfoLocked(), nil
}

func (m *Manager) SharedPages() []SharedPage {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.connectedPagesLocked(m.sharedPages)
}

func (m *Manager) NSSCTFPages() []SharedPage {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]SharedPage, 0)
	for _, page := range m.sharedPages {
		if page.Adapter == "nssctf-web-v1" && page.NSSCTF != nil {
			page.Connected = m.bridgeSessionConnectedLocked(page.BridgeSessionID)
			result = append(result, page)
		}
	}
	return result
}

func (m *Manager) CTFShowPages() []SharedPage {
	m.mu.Lock()
	defer m.mu.Unlock()
	result := make([]SharedPage, 0)
	for _, page := range m.sharedPages {
		if page.Adapter == "ctfshow-catalog-v1" && page.CTFShow != nil {
			page.Connected = m.bridgeSessionConnectedLocked(page.BridgeSessionID)
			result = append(result, page)
		}
	}
	return result
}

func (m *Manager) SetCTFShowCatalogSink(sink func(context.Context, []ctfshow.CatalogProblem) error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.ctfshowSink = sink
}

func (m *Manager) Close() {
	m.mu.Lock()
	sessions := make([]*managedSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	server := m.bridgeServer
	listener := m.bridgeListener
	clients := make([]*bridgeClient, 0, len(m.bridgeClients))
	for client := range m.bridgeClients {
		clients = append(clients, client)
	}
	m.sessions = make(map[string]*managedSession)
	m.bridgeServer = nil
	m.bridgeListener = nil
	m.bridgeClients = make(map[*bridgeClient]struct{})
	m.mu.Unlock()
	for _, session := range sessions {
		if session.public.command != nil && session.public.command.Process != nil {
			_ = session.public.command.Process.Kill()
		}
	}
	if server != nil {
		ctx, cancel := context.WithTimeout(context.Background(), time.Second)
		_ = server.Shutdown(ctx)
		cancel()
	}
	if listener != nil {
		_ = listener.Close()
	}
	for _, client := range clients {
		_ = client.connection.Close()
	}
}

func (m *Manager) session(id string) (Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	session := m.sessions[id]
	if session == nil || session.public.Phase != "ready" {
		return Session{}, fmt.Errorf("managed browser session is not ready")
	}
	return session.public, nil
}

func (m *Manager) authorizedPage(ctx context.Context, sessionID, pageID, effect string, approved bool) (Session, Page, error) {
	session, err := m.session(sessionID)
	if err != nil {
		return Session{}, Page{}, err
	}
	var lastURL string
	for attempt := 0; attempt < 50; attempt++ {
		pages, listErr := m.Pages(ctx, sessionID)
		if listErr != nil {
			return Session{}, Page{}, listErr
		}
		for _, page := range pages {
			if page.ID != pageID {
				continue
			}
			lastURL = page.URL
			if page.URL == "" || page.URL == "about:blank" || strings.HasPrefix(page.URL, "chrome://") {
				break
			}
			if _, checkErr := m.checkOrigin(session, page.URL, effect, approved); checkErr != nil {
				return Session{}, Page{}, checkErr
			}
			return session, page, nil
		}
		select {
		case <-ctx.Done():
			return Session{}, Page{}, ctx.Err()
		case <-time.After(100 * time.Millisecond):
		}
	}
	return Session{}, Page{}, fmt.Errorf("managed browser page was not ready inside scope (last URL %q)", lastURL)
}

func (m *Manager) checkOrigin(session Session, rawURL, effect string, approved bool) (securitypolicy.PolicyDecision, error) {
	target, err := originTarget(rawURL)
	if err != nil {
		return securitypolicy.PolicyDecision{}, fmt.Errorf("normalize managed browser URL %q: %w", rawURL, err)
	}
	decision := securitypolicy.Decide(session.Scope, securitypolicy.EffectRequest{Class: effect, Target: target, Approved: approved}, time.Now())
	if !decision.Allowed {
		return decision, fmt.Errorf("managed browser policy denied action: %s", decision.Reason)
	}
	return decision, nil
}

func (m *Manager) installExtension() error {
	destination := filepath.Join(m.root, "current-tab-extension")
	if err := os.MkdirAll(destination, 0o700); err != nil {
		return err
	}
	if err := fs.WalkDir(browserextension.Assets, ".", func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || path == "." || filepath.Base(path) == "assets.go" {
			return nil
		}
		data, err := browserextension.Assets.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(filepath.Join(destination, filepath.Base(path)), data, 0o600)
	}); err != nil {
		return fmt.Errorf("install current-tab extension: %w", err)
	}
	m.extensionPath = destination
	return nil
}

func (m *Manager) loadBridgePairing() error {
	data, err := os.ReadFile(m.pairingPath)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return fmt.Errorf("read browser bridge pairing: %w", err)
	}
	var state bridgePairingState
	if json.Unmarshal(data, &state) != nil ||
		state.Version != 1 ||
		state.Port < 1024 ||
		state.Port > 65535 ||
		!validBridgeToken(state.Token) {
		return nil
	}
	m.bridgePort = state.Port
	m.bridgeToken = state.Token
	if err := os.Chmod(m.pairingPath, 0o600); err != nil {
		return fmt.Errorf("secure browser bridge pairing: %w", err)
	}
	return nil
}

func (m *Manager) persistBridgePairingLocked() error {
	if m.bridgePort < 1024 || m.bridgePort > 65535 || !validBridgeToken(m.bridgeToken) {
		return fmt.Errorf("browser bridge pairing state is invalid")
	}
	data, err := json.Marshal(bridgePairingState{
		Version: 1,
		Port:    m.bridgePort,
		Token:   m.bridgeToken,
	})
	if err != nil {
		return fmt.Errorf("encode browser bridge pairing: %w", err)
	}
	temporaryPath := m.pairingPath + ".tmp"
	if err := os.WriteFile(temporaryPath, data, 0o600); err != nil {
		return fmt.Errorf("write browser bridge pairing: %w", err)
	}
	if err := os.Rename(temporaryPath, m.pairingPath); err != nil {
		_ = os.Remove(temporaryPath)
		return fmt.Errorf("install browser bridge pairing: %w", err)
	}
	if err := os.Chmod(m.pairingPath, 0o600); err != nil {
		return fmt.Errorf("secure browser bridge pairing: %w", err)
	}
	return nil
}

func validBridgeToken(token string) bool {
	if len(token) != 48 || strings.ToLower(token) != token {
		return false
	}
	decoded, err := hex.DecodeString(token)
	return err == nil && len(decoded) == 24
}

func (m *Manager) bridgeSessionConnectedLocked(sessionID string) bool {
	if !validBridgeSessionID(sessionID) {
		return false
	}
	for client := range m.bridgeClients {
		if _, connected := client.sessionIDs[sessionID]; connected {
			return true
		}
	}
	return false
}

func (m *Manager) clientsForSessionLocked(sessionID string) []*bridgeClient {
	clients := make([]*bridgeClient, 0, len(m.bridgeClients))
	for client := range m.bridgeClients {
		if _, connected := client.sessionIDs[sessionID]; connected {
			clients = append(clients, client)
		}
	}
	return clients
}

func (m *Manager) connectedPagesLocked(pages []SharedPage) []SharedPage {
	result := make([]SharedPage, 0, len(pages))
	for _, page := range pages {
		page.Connected = m.bridgeSessionConnectedLocked(page.BridgeSessionID)
		result = append(result, page)
	}
	return result
}

func (m *Manager) bridgeInfoLocked() BridgeInfo {
	endpoint := ""
	if m.bridgeListener != nil {
		endpoint = "http://" + m.bridgeListener.Addr().String()
	}
	pairingData, _ := json.Marshal(map[string]string{"endpoint": endpoint, "token": m.bridgeToken})
	lastSeen := ""
	if !m.bridgeLastSeen.IsZero() {
		lastSeen = m.bridgeLastSeen.Format(time.RFC3339)
	}
	return BridgeInfo{
		Endpoint: endpoint, Token: m.bridgeToken,
		PairingCode:   base64.RawURLEncoding.EncodeToString(pairingData),
		ExtensionPath: m.extensionPath, Active: m.bridgeListener != nil,
		Connected: len(m.bridgeClients) > 0, LastSeenAt: lastSeen,
	}
}

func (m *Manager) handleBridgeIngest(writer http.ResponseWriter, request *http.Request) {
	writer.Header().Set("Access-Control-Allow-Origin", "*")
	writer.Header().Set("Access-Control-Allow-Headers", "authorization, content-type")
	writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS")
	if request.Method == http.MethodOptions {
		writer.WriteHeader(http.StatusNoContent)
		return
	}
	if request.Method != http.MethodPost {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	m.mu.Lock()
	token := m.bridgeToken
	m.mu.Unlock()
	if request.Header.Get("Authorization") != "Bearer "+token || token == "" {
		http.Error(writer, "invalid MilkSU pairing token", http.StatusUnauthorized)
		return
	}
	var input struct {
		BridgeSessionID string               `json:"bridgeSessionId"`
		Adapter         string               `json:"adapter"`
		Title           string               `json:"title"`
		URL             string               `json:"url"`
		Text            string               `json:"text"`
		NSSCTF          *NSSCTFPageState     `json:"nssctf"`
		CTFShow         *CTFShowCatalogState `json:"ctfshow"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, maxPageTextBytes+4*1024*1024))
	if err := decoder.Decode(&input); err != nil {
		http.Error(writer, "invalid shared page", http.StatusBadRequest)
		return
	}
	target, err := originTarget(input.URL)
	if err != nil || strings.TrimSpace(input.Title) == "" || len(input.Text) > maxPageTextBytes {
		http.Error(writer, "shared page is missing a valid URL, title, or bounded text", http.StatusBadRequest)
		return
	}
	switch input.Adapter {
	case "":
	case "nssctf-web-v1":
		if !validBridgeSessionID(input.BridgeSessionID) ||
			input.NSSCTF == nil || validateNSSCTFPage(input.URL, input.NSSCTF) != nil {
			http.Error(writer, "invalid NSSCTF browser adapter state", http.StatusBadRequest)
			return
		}
	case "ctfshow-catalog-v1":
		if !validBridgeSessionID(input.BridgeSessionID) ||
			validateCTFShowCatalog(input.URL, input.CTFShow) != nil {
			http.Error(writer, "invalid CTFshow catalog adapter state", http.StatusBadRequest)
			return
		}
	default:
		http.Error(writer, "unsupported browser adapter", http.StatusBadRequest)
		return
	}
	grant, err := securitypolicy.NewGrant("user-browser-bridge", "security learning page shared by local user", []securitypolicy.Target{target}, 8*time.Hour)
	if err != nil {
		http.Error(writer, err.Error(), http.StatusBadRequest)
		return
	}
	if input.Adapter == "ctfshow-catalog-v1" {
		m.mu.Lock()
		sink := m.ctfshowSink
		m.mu.Unlock()
		if sink == nil {
			http.Error(writer, "CTFshow catalog store is unavailable", http.StatusServiceUnavailable)
			return
		}
		if err := sink(request.Context(), input.CTFShow.Problems); err != nil {
			http.Error(writer, "store CTFshow catalog", http.StatusInternalServerError)
			return
		}
		input.CTFShow.Total = len(input.CTFShow.Problems)
		input.CTFShow.Problems = nil
	}
	page := SharedPage{
		ID: "shared_" + uuid.NewString(), BridgeSessionID: input.BridgeSessionID, Adapter: input.Adapter,
		Title: strings.TrimSpace(input.Title), URL: input.URL, Text: input.Text,
		NSSCTF: input.NSSCTF, CTFShow: input.CTFShow,
		CapturedAt: time.Now().UTC(), Provenance: "user-browser-extension:active-tab", Scope: grant,
	}
	m.mu.Lock()
	previous := m.sharedPages
	m.sharedPages = append([]SharedPage{page}, previous...)
	if len(m.sharedPages) > 20 {
		m.sharedPages = m.sharedPages[:20]
	}
	if err := m.persistSharedLocked(); err != nil {
		m.sharedPages = previous
		m.mu.Unlock()
		http.Error(writer, "persist shared page", http.StatusInternalServerError)
		return
	}
	m.mu.Unlock()
	writer.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(writer).Encode(map[string]string{"id": page.ID})
}

func (m *Manager) SubmitNSSCTFFlag(ctx context.Context, pageID, candidate string) (NSSCTFJudgeReceipt, error) {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" || len([]rune(candidate)) > 512 {
		return NSSCTFJudgeReceipt{}, fmt.Errorf("NSSCTF submission candidate is required and must be at most 512 characters")
	}

	m.mu.Lock()
	var page *SharedPage
	for index := range m.sharedPages {
		if m.sharedPages[index].ID == pageID {
			value := m.sharedPages[index]
			page = &value
			break
		}
	}
	if page == nil || page.Adapter != "nssctf-web-v1" || page.NSSCTF == nil || !validBridgeSessionID(page.BridgeSessionID) {
		m.mu.Unlock()
		return NSSCTFJudgeReceipt{}, fmt.Errorf("NSSCTF browser page is not connected")
	}
	if page.NSSCTF.NeedsStart || !page.NSSCTF.CanSubmit {
		m.mu.Unlock()
		return NSSCTFJudgeReceipt{}, fmt.Errorf(
			"请先在 NSSCTF 由你本人确认开启 P%d，再用 MilkSU 扩展重新连接当前题目；MilkSU 不会自动花金币",
			page.NSSCTF.ProblemID,
		)
	}
	clients := m.clientsForSessionLocked(page.BridgeSessionID)
	if len(clients) == 0 {
		m.mu.Unlock()
		return NSSCTFJudgeReceipt{}, fmt.Errorf("the paired NSSCTF tab is not connected")
	}
	now := time.Now().UTC()
	command := NSSCTFBridgeCommand{
		ID: "browser_command_" + uuid.NewString(), Type: "nssctf.submit_flag",
		BridgeSessionID: page.BridgeSessionID, ProblemID: page.NSSCTF.ProblemID, Candidate: candidate,
		CreatedAt: now, ExpiresAt: now.Add(30 * time.Second),
	}
	state := &bridgeCommandState{command: command, done: make(chan struct{})}
	m.bridgeCommands[command.ID] = state
	m.mu.Unlock()

	envelope := map[string]any{"type": "command", "command": command}
	delivered := false
	for _, client := range clients {
		client.writeMu.Lock()
		err := client.connection.WriteJSON(envelope)
		client.writeMu.Unlock()
		if err == nil {
			delivered = true
		}
	}
	if !delivered {
		m.mu.Lock()
		delete(m.bridgeCommands, command.ID)
		m.mu.Unlock()
		return NSSCTFJudgeReceipt{}, fmt.Errorf("MilkSU browser extension did not accept the command")
	}

	select {
	case <-ctx.Done():
		m.mu.Lock()
		delete(m.bridgeCommands, command.ID)
		m.mu.Unlock()
		return NSSCTFJudgeReceipt{}, ctx.Err()
	case <-state.done:
		m.mu.Lock()
		result := state.judgeResult
		delete(m.bridgeCommands, command.ID)
		m.mu.Unlock()
		return result, nil
	}
}

func (m *Manager) FetchNSSCTFAttachment(
	ctx context.Context,
	pageID string,
) (NSSCTFAttachment, error) {
	m.mu.Lock()
	var page *SharedPage
	for index := range m.sharedPages {
		if m.sharedPages[index].ID == pageID {
			value := m.sharedPages[index]
			page = &value
			break
		}
	}
	if page == nil || page.Adapter != "nssctf-web-v1" || page.NSSCTF == nil ||
		!validBridgeSessionID(page.BridgeSessionID) {
		m.mu.Unlock()
		return NSSCTFAttachment{}, fmt.Errorf("NSSCTF browser page is not connected")
	}
	clients := m.clientsForSessionLocked(page.BridgeSessionID)
	if len(clients) == 0 {
		m.mu.Unlock()
		return NSSCTFAttachment{}, fmt.Errorf("the paired NSSCTF tab is not connected")
	}
	now := time.Now().UTC()
	command := NSSCTFBridgeCommand{
		ID: "browser_command_" + uuid.NewString(), Type: "nssctf.fetch_attachment",
		BridgeSessionID: page.BridgeSessionID, ProblemID: page.NSSCTF.ProblemID,
		CreatedAt: now, ExpiresAt: now.Add(45 * time.Second),
	}
	state := &bridgeCommandState{command: command, done: make(chan struct{})}
	m.bridgeCommands[command.ID] = state
	m.mu.Unlock()

	envelope := map[string]any{"type": "command", "command": command}
	delivered := false
	for _, client := range clients {
		client.writeMu.Lock()
		err := client.connection.WriteJSON(envelope)
		client.writeMu.Unlock()
		if err == nil {
			delivered = true
		}
	}
	if !delivered {
		m.mu.Lock()
		delete(m.bridgeCommands, command.ID)
		m.mu.Unlock()
		return NSSCTFAttachment{}, fmt.Errorf("MilkSU browser extension did not accept the attachment command")
	}

	select {
	case <-ctx.Done():
		m.mu.Lock()
		delete(m.bridgeCommands, command.ID)
		m.mu.Unlock()
		return NSSCTFAttachment{}, ctx.Err()
	case <-state.done:
		m.mu.Lock()
		result := state.attachmentResult
		resultErr := state.err
		delete(m.bridgeCommands, command.ID)
		m.mu.Unlock()
		if resultErr != nil {
			return NSSCTFAttachment{}, resultErr
		}
		return result, nil
	}
}

func (m *Manager) FetchCTFShowChallenge(
	ctx context.Context,
	pageID string,
	problemID int,
) (ctfshow.ChallengeCapture, error) {
	if problemID <= 0 || problemID > 100_000_000 {
		return ctfshow.ChallengeCapture{}, fmt.Errorf("invalid CTFshow challenge id")
	}
	m.mu.Lock()
	var page *SharedPage
	for index := range m.sharedPages {
		if m.sharedPages[index].ID == pageID {
			value := m.sharedPages[index]
			page = &value
			break
		}
	}
	if page == nil || page.Adapter != "ctfshow-catalog-v1" ||
		page.CTFShow == nil || !page.CTFShow.LoggedIn ||
		!validBridgeSessionID(page.BridgeSessionID) {
		m.mu.Unlock()
		return ctfshow.ChallengeCapture{}, fmt.Errorf("CTFshow browser page is not connected")
	}
	clients := m.clientsForSessionLocked(page.BridgeSessionID)
	if len(clients) == 0 {
		m.mu.Unlock()
		return ctfshow.ChallengeCapture{}, fmt.Errorf("the paired CTFshow tab is not connected")
	}
	now := time.Now().UTC()
	command := NSSCTFBridgeCommand{
		ID: "browser_command_" + uuid.NewString(), Type: "ctfshow.fetch_challenge",
		BridgeSessionID: page.BridgeSessionID, ProblemID: problemID,
		CreatedAt: now, ExpiresAt: now.Add(60 * time.Second),
	}
	state := &bridgeCommandState{command: command, done: make(chan struct{})}
	m.bridgeCommands[command.ID] = state
	m.mu.Unlock()

	if !deliverBridgeCommand(clients, command) {
		m.mu.Lock()
		delete(m.bridgeCommands, command.ID)
		m.mu.Unlock()
		return ctfshow.ChallengeCapture{}, fmt.Errorf("MilkSU browser extension did not accept the CTFshow import command")
	}

	select {
	case <-ctx.Done():
		m.mu.Lock()
		delete(m.bridgeCommands, command.ID)
		m.mu.Unlock()
		return ctfshow.ChallengeCapture{}, ctx.Err()
	case <-state.done:
		m.mu.Lock()
		result := state.ctfshowChallenge
		resultErr := state.err
		delete(m.bridgeCommands, command.ID)
		m.mu.Unlock()
		if resultErr != nil {
			return ctfshow.ChallengeCapture{}, resultErr
		}
		return result, nil
	}
}

func (m *Manager) SubmitCTFShowFlag(
	ctx context.Context,
	pageID string,
	problemID int,
	candidate string,
) (ctfshow.JudgeReceipt, error) {
	candidate = strings.TrimSpace(candidate)
	if problemID <= 0 || problemID > 100_000_000 ||
		candidate == "" || len([]rune(candidate)) > 512 {
		return ctfshow.JudgeReceipt{}, fmt.Errorf("invalid CTFshow submission")
	}
	m.mu.Lock()
	var page *SharedPage
	for index := range m.sharedPages {
		if m.sharedPages[index].ID == pageID {
			value := m.sharedPages[index]
			page = &value
			break
		}
	}
	if page == nil || page.Adapter != "ctfshow-catalog-v1" ||
		page.CTFShow == nil || !page.CTFShow.LoggedIn ||
		!validBridgeSessionID(page.BridgeSessionID) {
		m.mu.Unlock()
		return ctfshow.JudgeReceipt{}, fmt.Errorf("CTFshow browser page is not connected")
	}
	clients := m.clientsForSessionLocked(page.BridgeSessionID)
	if len(clients) == 0 {
		m.mu.Unlock()
		return ctfshow.JudgeReceipt{}, fmt.Errorf("the paired CTFshow tab is not connected")
	}
	now := time.Now().UTC()
	command := NSSCTFBridgeCommand{
		ID: "browser_command_" + uuid.NewString(), Type: "ctfshow.submit_flag",
		BridgeSessionID: page.BridgeSessionID, ProblemID: problemID, Candidate: candidate,
		CreatedAt: now, ExpiresAt: now.Add(30 * time.Second),
	}
	state := &bridgeCommandState{command: command, done: make(chan struct{})}
	m.bridgeCommands[command.ID] = state
	m.mu.Unlock()

	if !deliverBridgeCommand(clients, command) {
		m.mu.Lock()
		delete(m.bridgeCommands, command.ID)
		m.mu.Unlock()
		return ctfshow.JudgeReceipt{}, fmt.Errorf("MilkSU browser extension did not accept the CTFshow submission")
	}

	select {
	case <-ctx.Done():
		m.mu.Lock()
		delete(m.bridgeCommands, command.ID)
		m.mu.Unlock()
		return ctfshow.JudgeReceipt{}, ctx.Err()
	case <-state.done:
		m.mu.Lock()
		result := state.ctfshowJudge
		resultErr := state.err
		delete(m.bridgeCommands, command.ID)
		m.mu.Unlock()
		if resultErr != nil {
			return ctfshow.JudgeReceipt{}, resultErr
		}
		return result, nil
	}
}

func deliverBridgeCommand(clients []*bridgeClient, command NSSCTFBridgeCommand) bool {
	envelope := map[string]any{"type": "command", "command": command}
	delivered := false
	for _, client := range clients {
		client.writeMu.Lock()
		err := client.connection.WriteJSON(envelope)
		client.writeMu.Unlock()
		if err == nil {
			delivered = true
		}
	}
	return delivered
}

func (m *Manager) handleBridgeWebSocket(writer http.ResponseWriter, request *http.Request) {
	if request.Method != http.MethodGet {
		http.Error(writer, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	protocols := websocket.Subprotocols(request)
	m.mu.Lock()
	token := m.bridgeToken
	m.mu.Unlock()
	if len(protocols) != 2 || protocols[0] != "milksu-bridge-v1" || token == "" || protocols[1] != token {
		http.Error(writer, "invalid MilkSU browser bridge protocol", http.StatusUnauthorized)
		return
	}
	upgrader := websocket.Upgrader{
		CheckOrigin: func(request *http.Request) bool {
			origin := request.Header.Get("Origin")
			return origin == "" || strings.HasPrefix(origin, "chrome-extension://") || strings.HasPrefix(origin, "moz-extension://")
		},
	}
	connection, err := upgrader.Upgrade(
		writer,
		request,
		http.Header{"Sec-WebSocket-Protocol": []string{"milksu-bridge-v1"}},
	)
	if err != nil {
		return
	}
	connection.SetReadLimit(7 << 20)
	client := &bridgeClient{
		connection: connection,
		sessionIDs: make(map[string]struct{}),
	}
	m.mu.Lock()
	m.bridgeClients[client] = struct{}{}
	m.bridgeLastSeen = time.Now().UTC()
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		delete(m.bridgeClients, client)
		m.mu.Unlock()
		_ = connection.Close()
	}()

	for {
		var message struct {
			Type             string                      `json:"type"`
			CommandID        string                      `json:"commandId"`
			BridgeSessionID  string                      `json:"bridgeSessionId"`
			ProblemID        int                         `json:"problemId"`
			Status           string                      `json:"status"`
			Correct          *bool                       `json:"correct"`
			Message          string                      `json:"message"`
			URL              string                      `json:"url"`
			Name             string                      `json:"name"`
			MediaType        string                      `json:"mediaType"`
			DataBase64       string                      `json:"dataBase64"`
			SHA256           string                      `json:"sha256"`
			Size             int64                       `json:"size"`
			Title            string                      `json:"title"`
			Category         string                      `json:"category"`
			Statement        string                      `json:"statement"`
			Points           int                         `json:"points"`
			SolvedCount      int                         `json:"solvedCount"`
			Tags             []string                    `json:"tags"`
			Materials        []ctfshow.ChallengeMaterial `json:"materials"`
			Warnings         []string                    `json:"warnings"`
			BridgeSessionIDs []string                    `json:"bridgeSessionIds"`
		}
		if err := connection.ReadJSON(&message); err != nil {
			return
		}
		m.mu.Lock()
		m.bridgeLastSeen = time.Now().UTC()
		m.mu.Unlock()
		if message.Type == "hello" {
			if len(message.BridgeSessionIDs) > 24 {
				return
			}
			sessionIDs := make(map[string]struct{}, len(message.BridgeSessionIDs))
			for _, sessionID := range message.BridgeSessionIDs {
				if !validBridgeSessionID(sessionID) {
					return
				}
				sessionIDs[sessionID] = struct{}{}
			}
			m.mu.Lock()
			client.sessionIDs = sessionIDs
			m.mu.Unlock()
			client.writeMu.Lock()
			_ = connection.WriteJSON(map[string]string{"type": "hello_ack"})
			client.writeMu.Unlock()
			continue
		}
		if message.Type == "ping" {
			client.writeMu.Lock()
			_ = connection.WriteJSON(map[string]string{"type": "pong"})
			client.writeMu.Unlock()
			continue
		}
		if message.Type != "result" {
			switch message.Type {
			case "attachment_result":
				m.recordAttachmentResult(
					message.CommandID,
					message.BridgeSessionID,
					message.ProblemID,
					message.Status,
					message.Message,
					message.Name,
					message.MediaType,
					message.DataBase64,
					message.SHA256,
					message.Size,
				)
			case "ctfshow_challenge_result":
				m.recordCTFShowChallengeResult(
					message.CommandID,
					message.BridgeSessionID,
					message.ProblemID,
					message.Status,
					message.Message,
					message.Title,
					message.Category,
					message.Statement,
					message.Points,
					message.SolvedCount,
					message.Tags,
					message.Materials,
					message.Warnings,
				)
			case "ctfshow_judge_result":
				m.recordCTFShowJudgeResult(
					message.CommandID,
					message.BridgeSessionID,
					message.ProblemID,
					message.Status,
					message.Correct,
					message.Message,
					message.URL,
				)
			}
			continue
		}
		m.recordBridgeResult(message.CommandID, message.BridgeSessionID, message.ProblemID, message.Status, message.Correct, message.Message, message.URL)
	}
}

func (m *Manager) recordBridgeResult(
	commandID, bridgeSessionID string,
	problemID int,
	status string,
	correct *bool,
	message, rawURL string,
) {
	status = strings.ToLower(strings.TrimSpace(status))
	message = strings.TrimSpace(message)
	if len([]rune(message)) > 2000 {
		message = string([]rune(message)[:2000])
	}
	if status != "accepted" && status != "rejected" && status != "ambiguous" && status != "error" {
		return
	}
	if (status == "accepted" && (correct == nil || !*correct)) ||
		(status == "rejected" && (correct == nil || *correct)) ||
		((status == "ambiguous" || status == "error") && correct != nil) {
		return
	}
	urlProblemID, err := nssctfProblemID(rawURL)
	if err != nil || urlProblemID != problemID {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	state := m.bridgeCommands[commandID]
	if state == nil || state.judgeResult.CommandID != "" ||
		state.command.Type != "nssctf.submit_flag" ||
		state.command.BridgeSessionID != bridgeSessionID ||
		state.command.ProblemID != problemID ||
		time.Now().UTC().After(state.command.ExpiresAt) {
		return
	}
	state.judgeResult = NSSCTFJudgeReceipt{
		CommandID: commandID, ProblemID: problemID, Status: status, Correct: correct,
		Message: message, URL: rawURL, ReceivedAt: time.Now().UTC(),
	}
	if status != "error" {
		for index := range m.sharedPages {
			page := &m.sharedPages[index]
			if page.BridgeSessionID == bridgeSessionID && page.NSSCTF != nil && page.NSSCTF.ProblemID == problemID {
				page.NSSCTF.NeedsStart = false
				page.NSSCTF.CanSubmit = true
			}
		}
		_ = m.persistSharedLocked()
	}
	close(state.done)
}

func (m *Manager) recordAttachmentResult(
	commandID, bridgeSessionID string,
	problemID int,
	status, message, name, mediaType, dataBase64, digest string,
	size int64,
) {
	status = strings.ToLower(strings.TrimSpace(status))
	message = strings.TrimSpace(message)
	if len([]rune(message)) > 1000 {
		message = string([]rune(message)[:1000])
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	state := m.bridgeCommands[commandID]
	if state == nil || state.attachmentResult.CommandID != "" || state.err != nil ||
		state.command.Type != "nssctf.fetch_attachment" ||
		state.command.BridgeSessionID != bridgeSessionID ||
		state.command.ProblemID != problemID ||
		time.Now().UTC().After(state.command.ExpiresAt) {
		return
	}
	if status != "ready" {
		if message == "" {
			message = "NSSCTF attachment is not ready"
		}
		state.err = fmt.Errorf("%s", message)
		close(state.done)
		return
	}
	name = strings.TrimSpace(name)
	mediaType = strings.TrimSpace(mediaType)
	data, err := base64.StdEncoding.DecodeString(dataBase64)
	if err != nil || len(data) == 0 || len(data) > 4<<20 ||
		size != int64(len(data)) ||
		!validAttachmentFileName(name) ||
		!validAttachmentMediaType(mediaType) {
		state.err = fmt.Errorf("NSSCTF attachment payload is invalid")
		close(state.done)
		return
	}
	calculated := sha256.Sum256(data)
	if len(digest) != sha256.Size*2 || hex.EncodeToString(calculated[:]) != strings.ToLower(digest) {
		state.err = fmt.Errorf("NSSCTF attachment digest mismatch")
		close(state.done)
		return
	}
	state.attachmentResult = NSSCTFAttachment{
		CommandID: commandID, ProblemID: problemID, Name: name, MediaType: mediaType,
		DataBase64: dataBase64, SHA256: strings.ToLower(digest), Size: size,
		ReceivedAt: time.Now().UTC(),
	}
	close(state.done)
}

func (m *Manager) recordCTFShowChallengeResult(
	commandID, bridgeSessionID string,
	problemID int,
	status, message, title, category, statement string,
	points, solvedCount int,
	tags []string,
	materials []ctfshow.ChallengeMaterial,
	warnings []string,
) {
	status = strings.ToLower(strings.TrimSpace(status))
	message = strings.TrimSpace(message)
	m.mu.Lock()
	defer m.mu.Unlock()
	state := m.bridgeCommands[commandID]
	if state == nil || state.ctfshowChallenge.CommandID != "" || state.err != nil ||
		state.command.Type != "ctfshow.fetch_challenge" ||
		state.command.BridgeSessionID != bridgeSessionID ||
		state.command.ProblemID != problemID ||
		time.Now().UTC().After(state.command.ExpiresAt) {
		return
	}
	if status != "ready" {
		if message == "" {
			message = "CTFshow challenge is not ready"
		}
		state.err = fmt.Errorf("%s", truncateText(message, 1000))
		close(state.done)
		return
	}
	title = strings.TrimSpace(title)
	category = strings.TrimSpace(category)
	statement = strings.TrimSpace(statement)
	if title == "" || len([]rune(title)) > 240 ||
		category == "" || len([]rune(category)) > 80 ||
		statement == "" || len([]rune(statement)) > 12_000 ||
		points < 0 || points > 1_000_000 ||
		solvedCount < 0 || solvedCount > 100_000_000 ||
		len(materials) > 16 {
		state.err = fmt.Errorf("CTFshow challenge payload is invalid")
		close(state.done)
		return
	}
	cleanTags := normalizeShortStrings(tags, 32, 80)
	cleanWarnings := normalizeShortStrings(warnings, 16, 240)
	totalBytes := 0
	for index := range materials {
		material := &materials[index]
		material.Name = strings.TrimSpace(material.Name)
		material.MediaType = strings.TrimSpace(material.MediaType)
		data, err := base64.StdEncoding.DecodeString(material.DataBase64)
		if err != nil || len(data) == 0 || len(data) > 4<<20 ||
			material.Size != int64(len(data)) ||
			!validAttachmentFileName(material.Name) ||
			!validAttachmentMediaType(material.MediaType) {
			state.err = fmt.Errorf("CTFshow attachment payload is invalid")
			close(state.done)
			return
		}
		totalBytes += len(data)
		if totalBytes > 4<<20 {
			state.err = fmt.Errorf("CTFshow attachments exceed the 4 MiB browser bridge limit")
			close(state.done)
			return
		}
		calculated := sha256.Sum256(data)
		if len(material.SHA256) != sha256.Size*2 ||
			hex.EncodeToString(calculated[:]) != strings.ToLower(material.SHA256) {
			state.err = fmt.Errorf("CTFshow attachment digest mismatch")
			close(state.done)
			return
		}
		material.SHA256 = strings.ToLower(material.SHA256)
		material.Provenance = fmt.Sprintf(
			"user-browser-extension:ctfshow:%d:file:%s:sha256:%s",
			problemID,
			material.Name,
			material.SHA256,
		)
	}
	state.ctfshowChallenge = ctfshow.ChallengeCapture{
		CommandID: commandID, PlatformID: problemID,
		SourceURL: fmt.Sprintf("https://ctf.show/challenges#%d", problemID),
		Title:     title, Category: category, Statement: statement,
		Points: points, SolvedCount: solvedCount, Tags: cleanTags,
		Materials: materials, Warnings: cleanWarnings, ReceivedAt: time.Now().UTC(),
	}
	close(state.done)
}

func (m *Manager) recordCTFShowJudgeResult(
	commandID, bridgeSessionID string,
	problemID int,
	status string,
	correct *bool,
	message, rawURL string,
) {
	status = strings.ToLower(strings.TrimSpace(status))
	message = truncateText(strings.TrimSpace(message), 2000)
	if status != "accepted" && status != "rejected" &&
		status != "ambiguous" && status != "error" {
		return
	}
	if (status == "accepted" && (correct == nil || !*correct)) ||
		(status == "rejected" && (correct == nil || *correct)) ||
		((status == "ambiguous" || status == "error") && correct != nil) {
		return
	}
	urlProblemID, err := ctfshowProblemID(rawURL)
	if err != nil || urlProblemID != problemID {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	state := m.bridgeCommands[commandID]
	if state == nil || state.ctfshowJudge.CommandID != "" || state.err != nil ||
		state.command.Type != "ctfshow.submit_flag" ||
		state.command.BridgeSessionID != bridgeSessionID ||
		state.command.ProblemID != problemID ||
		time.Now().UTC().After(state.command.ExpiresAt) {
		return
	}
	state.ctfshowJudge = ctfshow.JudgeReceipt{
		CommandID: commandID, ProblemID: problemID, Status: status, Correct: correct,
		Message: message, URL: rawURL, ReceivedAt: time.Now().UTC(),
	}
	close(state.done)
}

func normalizeShortStrings(values []string, maxItems, maxRunes int) []string {
	result := make([]string, 0, min(len(values), maxItems))
	seen := make(map[string]struct{}, len(values))
	for _, value := range values {
		value = strings.TrimSpace(value)
		if value == "" || len([]rune(value)) > maxRunes {
			continue
		}
		if _, exists := seen[value]; exists {
			continue
		}
		seen[value] = struct{}{}
		result = append(result, value)
		if len(result) == maxItems {
			break
		}
	}
	return result
}

func truncateText(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func validAttachmentFileName(name string) bool {
	if name == "" ||
		name == "." ||
		name == ".." ||
		len([]rune(name)) > 160 ||
		filepath.Base(name) != name ||
		strings.ContainsAny(name, `/\`) {
		return false
	}
	for _, character := range name {
		if character < 0x20 || character == 0x7f {
			return false
		}
	}
	return true
}

func validAttachmentMediaType(mediaType string) bool {
	if mediaType == "" || len(mediaType) > 128 {
		return false
	}
	for _, character := range mediaType {
		if character < 0x21 || character == 0x7f {
			return false
		}
	}
	return true
}

func validateNSSCTFPage(rawURL string, state *NSSCTFPageState) error {
	id, err := nssctfProblemID(rawURL)
	if err != nil || state == nil || state.ProblemID != id {
		return fmt.Errorf("NSSCTF page state does not match its URL")
	}
	state.Title = strings.TrimSpace(state.Title)
	if state.Title == "" || len([]rune(state.Title)) > 160 || state.StartCost < 0 || state.StartCost > 1_000_000 {
		return fmt.Errorf("invalid NSSCTF page state")
	}
	if len(state.Tags) > 32 {
		state.Tags = state.Tags[:32]
	}
	if state.Tags == nil {
		state.Tags = []string{}
	}
	return nil
}

func validateCTFShowCatalog(rawURL string, state *CTFShowCatalogState) error {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "ctf.show" ||
		parsed.Port() != "" || parsed.User != nil || state == nil || !state.LoggedIn ||
		len(state.Problems) == 0 || len(state.Problems) > 10_000 {
		return fmt.Errorf("invalid CTFshow catalog state")
	}
	for _, problem := range state.Problems {
		if problem.PlatformID <= 0 || strings.TrimSpace(problem.Title) == "" {
			return fmt.Errorf("invalid CTFshow challenge")
		}
	}
	return nil
}

func nssctfProblemID(rawURL string) (int, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "www.nssctf.cn" ||
		parsed.Port() != "" || parsed.User != nil || parsed.RawQuery != "" || parsed.Fragment != "" {
		return 0, fmt.Errorf("NSSCTF page must use the canonical HTTPS origin")
	}
	parts := strings.Split(strings.Trim(parsed.EscapedPath(), "/"), "/")
	if len(parts) != 2 || parts[0] != "problem" {
		return 0, fmt.Errorf("NSSCTF page must be a problem detail page")
	}
	id, err := strconv.Atoi(parts[1])
	if err != nil || id <= 0 {
		return 0, fmt.Errorf("invalid NSSCTF problem id")
	}
	return id, nil
}

func ctfshowProblemID(rawURL string) (int, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "ctf.show" ||
		parsed.Port() != "" || parsed.User != nil || parsed.RawQuery != "" ||
		parsed.EscapedPath() != "/challenges" {
		return 0, fmt.Errorf("CTFshow page must use the canonical HTTPS origin")
	}
	id, err := strconv.Atoi(strings.TrimSpace(parsed.Fragment))
	if err != nil || id <= 0 || id > 100_000_000 {
		return 0, fmt.Errorf("invalid CTFshow challenge id")
	}
	return id, nil
}

func validBridgeSessionID(value string) bool {
	if len(value) < 16 || len(value) > 128 {
		return false
	}
	for _, character := range value {
		if (character >= 'a' && character <= 'z') ||
			(character >= 'A' && character <= 'Z') ||
			(character >= '0' && character <= '9') ||
			character == '-' || character == '_' {
			continue
		}
		return false
	}
	return true
}

func (m *Manager) persistSharedLocked() error {
	data, err := json.MarshalIndent(m.sharedPages, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.sharedPath, data, 0o600)
}

func originTarget(raw string) (securitypolicy.Target, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
		return securitypolicy.Target{}, fmt.Errorf("browser URL must be an http(s) URL without embedded credentials")
	}
	return securitypolicy.NormalizeTarget(securitypolicy.Target{Kind: securitypolicy.TargetOrigin, Value: parsed.String()})
}

func findChrome() (string, error) {
	if override := strings.TrimSpace(os.Getenv("MILKSU_CHROME_PATH")); override != "" {
		if info, err := os.Stat(override); err == nil && info.Mode().IsRegular() {
			return override, nil
		}
		return "", fmt.Errorf("MILKSU_CHROME_PATH is not an executable file")
	}
	candidates := []string{}
	if runtime.GOOS == "darwin" {
		candidates = []string{
			"/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
			"/Applications/Chromium.app/Contents/MacOS/Chromium",
			"/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
		}
	}
	for _, candidate := range candidates {
		if info, err := os.Stat(candidate); err == nil && info.Mode().IsRegular() {
			return candidate, nil
		}
	}
	for _, name := range []string{"google-chrome", "chromium", "chromium-browser", "microsoft-edge"} {
		if path, err := exec.LookPath(name); err == nil {
			return path, nil
		}
	}
	return "", fmt.Errorf("a Chromium-family browser is required for Managed Browser")
}

func browserEnvironment() []string {
	// The isolated browser has its own profile and needs only desktop/runtime
	// discovery variables. Provider credentials stay in the MilkSU sidecar.
	allowed := []string{
		"PATH", "HOME", "TMPDIR", "LANG", "LC_ALL",
		"DISPLAY", "WAYLAND_DISPLAY", "XDG_RUNTIME_DIR", "XAUTHORITY", "DBUS_SESSION_BUS_ADDRESS",
	}
	environment := make([]string, 0, len(allowed))
	for _, name := range allowed {
		if value, ok := os.LookupEnv(name); ok {
			environment = append(environment, name+"="+value)
		}
	}
	return environment
}

func waitDevToolsPort(ctx context.Context, profile string, command *exec.Cmd) (int, error) {
	path := filepath.Join(profile, "DevToolsActivePort")
	ticker := time.NewTicker(75 * time.Millisecond)
	defer ticker.Stop()
	timeout := time.NewTimer(12 * time.Second)
	defer timeout.Stop()
	for {
		select {
		case <-ctx.Done():
			return 0, ctx.Err()
		case <-timeout.C:
			return 0, fmt.Errorf("managed browser did not expose its loopback control port")
		case <-ticker.C:
			if command.ProcessState != nil && command.ProcessState.Exited() {
				return 0, fmt.Errorf("managed browser exited before becoming ready")
			}
			data, err := os.ReadFile(path)
			if err != nil {
				continue
			}
			line := strings.SplitN(string(data), "\n", 2)[0]
			port, err := strconv.Atoi(strings.TrimSpace(line))
			if err == nil && port > 0 && port <= 65535 {
				return port, nil
			}
		}
	}
}

func cdpCall(ctx context.Context, wsURL, method string, params any, output any) error {
	if !strings.HasPrefix(wsURL, "ws://127.0.0.1:") && !strings.HasPrefix(wsURL, "ws://localhost:") {
		return fmt.Errorf("refusing non-loopback CDP endpoint")
	}
	dialer := websocket.Dialer{HandshakeTimeout: 3 * time.Second, Proxy: nil}
	connection, _, err := dialer.DialContext(ctx, wsURL, nil)
	if err != nil {
		return fmt.Errorf("connect managed page: %w", err)
	}
	defer connection.Close()
	_ = connection.SetWriteDeadline(time.Now().Add(3 * time.Second))
	request := map[string]any{"id": 1, "method": method, "params": params}
	if err := connection.WriteJSON(request); err != nil {
		return err
	}
	_ = connection.SetReadDeadline(time.Now().Add(8 * time.Second))
	for {
		_, data, err := connection.ReadMessage()
		if err != nil {
			return fmt.Errorf("read managed page response: %w", err)
		}
		var envelope struct {
			ID    int             `json:"id"`
			Error json.RawMessage `json:"error"`
		}
		if err := json.Unmarshal(data, &envelope); err != nil || envelope.ID != 1 {
			continue
		}
		if len(envelope.Error) > 0 {
			return fmt.Errorf("managed page action failed: %s", envelope.Error)
		}
		if output != nil {
			if err := json.Unmarshal(data, output); err != nil {
				return err
			}
		}
		return nil
	}
}

func publicView(session Session) Session {
	session.port = 0
	session.command = nil
	return session
}

func DecodeScreenshot(value string) ([]byte, error) {
	if value == "" {
		return nil, nil
	}
	return base64.StdEncoding.DecodeString(value)
}
