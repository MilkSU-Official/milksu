package browsercap

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/ctfshow"
	"github.com/gorilla/websocket"
)

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
	pairingPath := filepath.Join(root, "browser", "bridge-pairing.json")
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

func TestCurrentTabBridgeDoesNotTreatAnotherSessionAsTheSelectedJudge(t *testing.T) {
	manager, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	info, err := manager.StartBridge()
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{
		"bridgeSessionId": "nssctf-session-selected",
		"adapter":         "nssctf-web-v1",
		"title":           "selected - NSSCTF",
		"url":             "https://www.nssctf.cn/problem/317",
		"text":            "selected challenge",
		"nssctf": map[string]any{
			"problemId": 317, "title": "selected", "tags": []string{},
			"loggedIn": true, "canSubmit": true, "needsStart": false,
		},
	})
	request, _ := http.NewRequest(http.MethodPost, info.Endpoint+"/ingest", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+info.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("paired NSSCTF page returned %d", response.StatusCode)
	}
	connection := dialBridge(t, info, "different-session-123456")
	defer connection.Close()

	pages := manager.NSSCTFPages()
	if len(pages) != 1 || pages[0].Connected {
		t.Fatalf("stale NSSCTF page was reported connected: %#v", pages)
	}
	_, err = manager.SubmitNSSCTFFlag(
		context.Background(),
		pages[0].ID,
		"NSSCTF{must_not_be_sent}",
	)
	if err == nil || !strings.Contains(err.Error(), "paired NSSCTF tab is not connected") {
		t.Fatalf("unexpected stale-session submission result: %v", err)
	}
}

func TestOriginTargetRejectsCredentialsAndNonHTTP(t *testing.T) {
	for _, value := range []string{"ssh://host:22", "https://user:pass@example.com", "file:///tmp/x"} {
		if _, err := originTarget(value); err == nil {
			t.Fatalf("unsafe browser target was accepted: %s", value)
		}
	}
}

func TestCTFShowCatalogBridgeUsesAuthenticatedActiveTabSink(t *testing.T) {
	manager, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	var stored []ctfshow.CatalogProblem
	manager.SetCTFShowCatalogSink(func(_ context.Context, problems []ctfshow.CatalogProblem) error {
		stored = append([]ctfshow.CatalogProblem{}, problems...)
		return nil
	})
	info, err := manager.StartBridge()
	if err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{
		"bridgeSessionId": "ctfshow-session-123456",
		"adapter":         "ctfshow-catalog-v1",
		"title":           "CTFshow",
		"url":             "https://ctf.show/challenges",
		"text":            "",
		"ctfshow": map[string]any{
			"loggedIn": true,
			"total":    2,
			"problems": []map[string]any{
				{"platformId": 12, "title": "web1", "category": "Web", "points": 50},
				{"platformId": 13, "title": "misc1", "category": "Misc", "points": 100},
			},
		},
	})
	request, _ := http.NewRequest(http.MethodPost, info.Endpoint+"/ingest", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+info.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("paired CTFshow catalog returned %d", response.StatusCode)
	}
	if len(stored) != 2 || stored[0].PlatformID != 12 {
		t.Fatalf("unexpected CTFshow catalog sink payload: %#v", stored)
	}
	pages := manager.CTFShowPages()
	if len(pages) != 1 || pages[0].CTFShow == nil || pages[0].CTFShow.Total != 2 ||
		len(pages[0].CTFShow.Problems) != 0 {
		t.Fatalf("unexpected CTFshow page summary: %#v", pages)
	}
}

func TestCTFShowBridgeFetchesChallengeAndVerifiesMaterials(t *testing.T) {
	manager, info := prepareCTFShowBridge(t)
	defer manager.Close()
	connection := dialBridge(t, info, "ctfshow-session-command")
	defer connection.Close()

	type challengeResult struct {
		challenge ctfshow.ChallengeCapture
		err       error
	}
	resultChannel := make(chan challengeResult, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go func() {
		challenge, fetchErr := manager.FetchCTFShowChallenge(
			ctx,
			manager.CTFShowPages()[0].ID,
			12,
		)
		resultChannel <- challengeResult{challenge: challenge, err: fetchErr}
	}()

	var envelope struct {
		Type    string              `json:"type"`
		Command NSSCTFBridgeCommand `json:"command"`
	}
	if err := connection.ReadJSON(&envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Command.Type != "ctfshow.fetch_challenge" ||
		envelope.Command.ProblemID != 12 {
		t.Fatalf("unexpected CTFshow import command: %#v", envelope)
	}
	payload := []byte("ctfshow fixture")
	sum := sha256.Sum256(payload)
	digest := hex.EncodeToString(sum[:])
	if err := connection.WriteJSON(map[string]any{
		"type": "ctfshow_challenge_result", "commandId": envelope.Command.ID,
		"bridgeSessionId": envelope.Command.BridgeSessionID, "problemId": 12,
		"status": "ready", "title": "web1", "category": "Web",
		"statement": "Inspect the provided fixture.", "points": 50, "solvedCount": 21,
		"tags": []string{"web", "entry"},
		"materials": []map[string]any{{
			"name": "fixture.txt", "mediaType": "text/plain",
			"dataBase64": base64.StdEncoding.EncodeToString(payload),
			"sha256":     digest, "size": len(payload),
		}},
	}); err != nil {
		t.Fatal(err)
	}
	final := <-resultChannel
	if final.err != nil {
		t.Fatal(final.err)
	}
	if final.challenge.PlatformID != 12 ||
		final.challenge.SourceURL != "https://ctf.show/challenges#12" ||
		len(final.challenge.Materials) != 1 ||
		final.challenge.Materials[0].SHA256 != digest ||
		!strings.Contains(final.challenge.Materials[0].Provenance, "ctfshow:12") {
		t.Fatalf("unexpected CTFshow challenge capture: %#v", final.challenge)
	}
}

func TestCTFShowBridgeReturnsAuthoritativeJudgeReceipt(t *testing.T) {
	manager, info := prepareCTFShowBridge(t)
	defer manager.Close()
	connection := dialBridge(t, info, "ctfshow-session-command")
	defer connection.Close()

	type judgeResult struct {
		receipt ctfshow.JudgeReceipt
		err     error
	}
	resultChannel := make(chan judgeResult, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go func() {
		receipt, submitErr := manager.SubmitCTFShowFlag(
			ctx,
			manager.CTFShowPages()[0].ID,
			12,
			"flag{verified}",
		)
		resultChannel <- judgeResult{receipt: receipt, err: submitErr}
	}()

	var envelope struct {
		Type    string              `json:"type"`
		Command NSSCTFBridgeCommand `json:"command"`
	}
	if err := connection.ReadJSON(&envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Command.Type != "ctfshow.submit_flag" ||
		envelope.Command.Candidate != "flag{verified}" {
		t.Fatalf("unexpected CTFshow submission command: %#v", envelope)
	}
	correct := true
	if err := connection.WriteJSON(map[string]any{
		"type": "ctfshow_judge_result", "commandId": envelope.Command.ID,
		"bridgeSessionId": envelope.Command.BridgeSessionID, "problemId": 12,
		"status": "accepted", "correct": correct, "message": "Correct",
		"url": "https://ctf.show/challenges#12",
	}); err != nil {
		t.Fatal(err)
	}
	final := <-resultChannel
	if final.err != nil {
		t.Fatal(final.err)
	}
	if final.receipt.Correct == nil || !*final.receipt.Correct ||
		final.receipt.Status != "accepted" {
		t.Fatalf("unexpected CTFshow receipt: %#v", final.receipt)
	}
}

func prepareCTFShowBridge(t *testing.T) (*Manager, BridgeInfo) {
	t.Helper()
	manager, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	manager.SetCTFShowCatalogSink(func(_ context.Context, _ []ctfshow.CatalogProblem) error {
		return nil
	})
	info, err := manager.StartBridge()
	if err != nil {
		manager.Close()
		t.Fatal(err)
	}
	body, _ := json.Marshal(map[string]any{
		"bridgeSessionId": "ctfshow-session-command",
		"adapter":         "ctfshow-catalog-v1",
		"title":           "CTFshow",
		"url":             "https://ctf.show/challenges",
		"text":            "",
		"ctfshow": map[string]any{
			"loggedIn": true,
			"total":    1,
			"problems": []map[string]any{{
				"platformId": 12, "title": "web1", "category": "Web", "points": 50,
			}},
		},
	})
	request, _ := http.NewRequest(http.MethodPost, info.Endpoint+"/ingest", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+info.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		manager.Close()
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		manager.Close()
		t.Fatalf("paired CTFshow page returned %d", response.StatusCode)
	}
	return manager, info
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

func TestNSSCTFBridgeReturnsAuthoritativeJudgeReceipt(t *testing.T) {
	manager, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	info, err := manager.StartBridge()
	if err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]any{
		"bridgeSessionId": "nssctf-session-123456",
		"adapter":         "nssctf-web-v1",
		"title":           "binary - NSSCTF",
		"url":             "https://www.nssctf.cn/problem/7535",
		"text":            "binary challenge",
		"nssctf": map[string]any{
			"problemId": 7535, "title": "binary", "tags": []string{"编码分析"},
			"loggedIn": true, "canSubmit": true, "needsStart": false,
		},
	})
	request, _ := http.NewRequest(http.MethodPost, info.Endpoint+"/ingest", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+info.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("paired NSSCTF page returned %d", response.StatusCode)
	}
	pages := manager.NSSCTFPages()
	if len(pages) != 1 || pages[0].NSSCTF == nil || pages[0].NSSCTF.ProblemID != 7535 {
		t.Fatalf("unexpected NSSCTF pages: %#v", pages)
	}

	connection := dialBridge(t, info, "nssctf-session-123456")
	defer connection.Close()

	type result struct {
		receipt NSSCTFJudgeReceipt
		err     error
	}
	resultChannel := make(chan result, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go func() {
		receipt, submitErr := manager.SubmitNSSCTFFlag(ctx, pages[0].ID, "NSSCTF{b1n4ry_t0_t3xt}")
		resultChannel <- result{receipt: receipt, err: submitErr}
	}()

	var envelope struct {
		Type    string              `json:"type"`
		Command NSSCTFBridgeCommand `json:"command"`
	}
	if err := connection.ReadJSON(&envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Type != "command" || envelope.Command.ProblemID != 7535 ||
		envelope.Command.Candidate != "NSSCTF{b1n4ry_t0_t3xt}" {
		t.Fatalf("unexpected command: %#v", envelope)
	}
	correct := true
	if err := connection.WriteJSON(map[string]any{
		"type": "result", "commandId": envelope.Command.ID,
		"bridgeSessionId": envelope.Command.BridgeSessionID, "problemId": 7535,
		"status": "accepted", "correct": correct,
		"message": "恭喜您通过了该题", "url": "https://www.nssctf.cn/problem/7535",
	}); err != nil {
		t.Fatal(err)
	}
	final := <-resultChannel
	if final.err != nil {
		t.Fatal(final.err)
	}
	if final.receipt.Correct == nil || !*final.receipt.Correct || final.receipt.Status != "accepted" {
		t.Fatalf("unexpected receipt: %#v", final.receipt)
	}
	pages = manager.NSSCTFPages()
	if pages[0].NSSCTF.NeedsStart || !pages[0].NSSCTF.CanSubmit {
		t.Fatalf("page submission state was not updated after Judge receipt: %#v", pages[0].NSSCTF)
	}
}

func TestNSSCTFBridgeNeverSpendsCoinsToOpenSubmission(t *testing.T) {
	manager, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	info, err := manager.StartBridge()
	if err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]any{
		"bridgeSessionId": "nssctf-session-needs-start",
		"adapter":         "nssctf-web-v1",
		"title":           "locked - NSSCTF",
		"url":             "https://www.nssctf.cn/problem/316",
		"text":            "locked challenge",
		"nssctf": map[string]any{
			"problemId": 316, "title": "locked",
			"loggedIn": true, "canSubmit": false, "needsStart": true, "startCost": 10,
		},
	})
	request, _ := http.NewRequest(http.MethodPost, info.Endpoint+"/ingest", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+info.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("paired NSSCTF page returned %d", response.StatusCode)
	}
	connection := dialBridge(t, info, "nssctf-session-needs-start")
	defer connection.Close()

	pages := manager.NSSCTFPages()
	if len(pages) != 1 {
		t.Fatalf("unexpected NSSCTF pages: %#v", pages)
	}
	_, err = manager.SubmitNSSCTFFlag(
		context.Background(),
		pages[0].ID,
		"NSSCTF{must-not-submit}",
	)
	if err == nil || !strings.Contains(err.Error(), "不会自动花金币") {
		t.Fatalf("locked NSSCTF page was not stopped before submission: %v", err)
	}
	manager.mu.Lock()
	pendingCommands := len(manager.bridgeCommands)
	manager.mu.Unlock()
	if pendingCommands != 0 {
		t.Fatalf("locked NSSCTF page created %d bridge command(s)", pendingCommands)
	}
}

func TestNSSCTFBridgeFetchesVerifiedAttachment(t *testing.T) {
	manager, err := New(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer manager.Close()
	info, err := manager.StartBridge()
	if err != nil {
		t.Fatal(err)
	}

	body, _ := json.Marshal(map[string]any{
		"bridgeSessionId": "nssctf-session-attachment",
		"adapter":         "nssctf-web-v1",
		"title":           "attachment - NSSCTF",
		"url":             "https://www.nssctf.cn/problem/317",
		"text":            "challenge with attachment",
		"nssctf": map[string]any{
			"problemId": 317, "title": "attachment", "tags": []string{"附件"},
			"loggedIn": true, "canSubmit": true, "needsStart": false,
		},
	})
	request, _ := http.NewRequest(http.MethodPost, info.Endpoint+"/ingest", bytes.NewReader(body))
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+info.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	_ = response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("paired NSSCTF page returned %d", response.StatusCode)
	}

	connection := dialBridge(t, info, "nssctf-session-attachment")
	defer connection.Close()

	type attachmentResult struct {
		attachment NSSCTFAttachment
		err        error
	}
	resultChannel := make(chan attachmentResult, 1)
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
	defer cancel()
	go func() {
		attachment, fetchErr := manager.FetchNSSCTFAttachment(ctx, manager.NSSCTFPages()[0].ID)
		resultChannel <- attachmentResult{attachment: attachment, err: fetchErr}
	}()

	var envelope struct {
		Type    string              `json:"type"`
		Command NSSCTFBridgeCommand `json:"command"`
	}
	if err := connection.ReadJSON(&envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Command.Type != "nssctf.fetch_attachment" || envelope.Command.ProblemID != 317 {
		t.Fatalf("unexpected attachment command: %#v", envelope)
	}
	payload := []byte("verified attachment")
	sum := sha256.Sum256(payload)
	if err := connection.WriteJSON(map[string]any{
		"type": "attachment_result", "commandId": envelope.Command.ID,
		"bridgeSessionId": envelope.Command.BridgeSessionID, "problemId": 317,
		"status": "ready", "name": "challenge.zip", "mediaType": "application/zip",
		"dataBase64": base64.StdEncoding.EncodeToString(payload),
		"sha256":     hex.EncodeToString(sum[:]), "size": len(payload),
	}); err != nil {
		t.Fatal(err)
	}
	final := <-resultChannel
	if final.err != nil {
		t.Fatal(final.err)
	}
	if final.attachment.Name != "challenge.zip" ||
		final.attachment.SHA256 != hex.EncodeToString(sum[:]) ||
		final.attachment.Size != int64(len(payload)) {
		t.Fatalf("unexpected attachment: %#v", final.attachment)
	}
}

func TestNSSCTFAttachmentResultRequiresMatchingDigestAndSafeName(t *testing.T) {
	payload := []byte("trusted only after backend verification")
	encoded := base64.StdEncoding.EncodeToString(payload)
	sum := sha256.Sum256(payload)
	digest := hex.EncodeToString(sum[:])

	newState := func() (*Manager, *bridgeCommandState) {
		command := NSSCTFBridgeCommand{
			ID:              "browser_command_attachment_test",
			Type:            "nssctf.fetch_attachment",
			BridgeSessionID: "nssctf-session-123456",
			ProblemID:       317,
			ExpiresAt:       time.Now().UTC().Add(time.Minute),
		}
		state := &bridgeCommandState{command: command, done: make(chan struct{})}
		return &Manager{
			bridgeCommands: map[string]*bridgeCommandState{command.ID: state},
		}, state
	}

	t.Run("accepts verified payload", func(t *testing.T) {
		manager, state := newState()
		manager.recordAttachmentResult(
			state.command.ID,
			state.command.BridgeSessionID,
			state.command.ProblemID,
			"ready",
			"",
			"challenge.zip",
			"application/zip",
			encoded,
			digest,
			int64(len(payload)),
		)
		if state.err != nil {
			t.Fatal(state.err)
		}
		if state.attachmentResult.SHA256 != digest ||
			state.attachmentResult.DataBase64 != encoded ||
			state.attachmentResult.Name != "challenge.zip" {
			t.Fatalf("unexpected attachment result: %#v", state.attachmentResult)
		}
	})

	for name, testCase := range map[string]struct {
		fileName string
		digest   string
	}{
		"path_traversal":    {"../challenge.zip", digest},
		"control_character": {"challenge\n.zip", digest},
		"digest_mismatch":   {"challenge.zip", strings.Repeat("0", sha256.Size*2)},
	} {
		t.Run(name, func(t *testing.T) {
			manager, state := newState()
			manager.recordAttachmentResult(
				state.command.ID,
				state.command.BridgeSessionID,
				state.command.ProblemID,
				"ready",
				"",
				testCase.fileName,
				"application/zip",
				encoded,
				testCase.digest,
				int64(len(payload)),
			)
			if state.err == nil || state.attachmentResult.CommandID != "" {
				t.Fatalf("unsafe attachment was accepted: %#v", state.attachmentResult)
			}
		})
	}
}
