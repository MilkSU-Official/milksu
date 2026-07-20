package browsercap

import (
	"context"
	"crypto/rand"
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
	ID         string                    `json:"id"`
	Title      string                    `json:"title"`
	URL        string                    `json:"url"`
	Text       string                    `json:"text"`
	CapturedAt time.Time                 `json:"capturedAt"`
	Provenance string                    `json:"provenance"`
	Scope      securitypolicy.ScopeGrant `json:"scope"`
}

type BridgeInfo struct {
	Endpoint      string `json:"endpoint"`
	Token         string `json:"token"`
	ExtensionPath string `json:"extensionPath"`
	Active        bool   `json:"active"`
}

type managedSession struct {
	public Session
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
	extensionPath  string
	httpClient     *http.Client
}

func New(root string) (*Manager, error) {
	root = filepath.Join(root, "browser")
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create browser capability root: %w", err)
	}
	manager := &Manager{
		root: root, sessions: make(map[string]*managedSession), sharedPath: filepath.Join(root, "shared-pages.json"),
		httpClient: &http.Client{Timeout: 5 * time.Second, Transport: &http.Transport{Proxy: nil}},
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
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return BridgeInfo{}, fmt.Errorf("start loopback browser bridge: %w", err)
	}
	tokenBytes := make([]byte, 24)
	if _, err := rand.Read(tokenBytes); err != nil {
		_ = listener.Close()
		return BridgeInfo{}, err
	}
	m.bridgeToken = hex.EncodeToString(tokenBytes)
	m.bridgeListener = listener
	mux := http.NewServeMux()
	mux.HandleFunc("/ingest", m.handleBridgeIngest)
	m.bridgeServer = &http.Server{Handler: mux, ReadHeaderTimeout: 3 * time.Second, ReadTimeout: 5 * time.Second, WriteTimeout: 5 * time.Second}
	go func() { _ = m.bridgeServer.Serve(listener) }()
	return m.bridgeInfoLocked(), nil
}

func (m *Manager) SharedPages() []SharedPage {
	m.mu.Lock()
	defer m.mu.Unlock()
	return append([]SharedPage{}, m.sharedPages...)
}

func (m *Manager) Close() {
	m.mu.Lock()
	sessions := make([]*managedSession, 0, len(m.sessions))
	for _, session := range m.sessions {
		sessions = append(sessions, session)
	}
	server := m.bridgeServer
	listener := m.bridgeListener
	m.sessions = make(map[string]*managedSession)
	m.bridgeServer = nil
	m.bridgeListener = nil
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

func (m *Manager) bridgeInfoLocked() BridgeInfo {
	endpoint := ""
	if m.bridgeListener != nil {
		endpoint = "http://" + m.bridgeListener.Addr().String()
	}
	return BridgeInfo{Endpoint: endpoint, Token: m.bridgeToken, ExtensionPath: m.extensionPath, Active: m.bridgeListener != nil}
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
		Title string `json:"title"`
		URL   string `json:"url"`
		Text  string `json:"text"`
	}
	decoder := json.NewDecoder(http.MaxBytesReader(writer, request.Body, maxPageTextBytes+64*1024))
	if err := decoder.Decode(&input); err != nil {
		http.Error(writer, "invalid shared page", http.StatusBadRequest)
		return
	}
	target, err := originTarget(input.URL)
	if err != nil || strings.TrimSpace(input.Title) == "" || len(input.Text) > maxPageTextBytes {
		http.Error(writer, "shared page is missing a valid URL, title, or bounded text", http.StatusBadRequest)
		return
	}
	grant, err := securitypolicy.NewGrant("user-browser-bridge", "security learning page shared by local user", []securitypolicy.Target{target}, 8*time.Hour)
	if err != nil {
		http.Error(writer, err.Error(), http.StatusBadRequest)
		return
	}
	page := SharedPage{
		ID: "shared_" + uuid.NewString(), Title: strings.TrimSpace(input.Title), URL: input.URL,
		Text: input.Text, CapturedAt: time.Now().UTC(), Provenance: "user-browser-extension:active-tab", Scope: grant,
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
