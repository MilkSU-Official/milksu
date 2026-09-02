package main

import (
	"archive/zip"
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

	"github.com/MilkSU-Official/milksu/internal/browsercap"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/ctfshow"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
	"github.com/gorilla/websocket"
)

func TestCTFShowCatalogToWorkspaceAndJudgeEndToEnd(t *testing.T) {
	dataDirectory := t.TempDir()
	manager, err := browsercap.New(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	catalog, err := ctfshow.NewCatalogService(
		filepath.Join(dataDirectory, "ctfshow", "catalog.sqlite3"),
	)
	if err != nil {
		manager.Close()
		t.Fatal(err)
	}
	manager.SetCTFShowCatalogSink(func(ctx context.Context, problems []ctfshow.CatalogProblem) error {
		_, replaceErr := catalog.Replace(ctx, problems)
		return replaceErr
	})
	runtimeService, err := securityruntime.NewService(filepath.Join(dataDirectory, "runtime"), nil)
	if err != nil {
		manager.Close()
		_ = catalog.Close()
		t.Fatal(err)
	}
	ctfService, err := ctf.NewService(runtimeService, ctf.ServiceOptions{})
	if err != nil {
		manager.Close()
		_ = catalog.Close()
		_ = runtimeService.Close()
		t.Fatal(err)
	}
	app := &App{
		ctx:            context.Background(),
		dataDirectory:  dataDirectory,
		browserBridge:  manager,
		ctfshowCatalog: catalog,
		jobs:           runtimeService,
		ctfJobs:        ctfService,
	}
	app.ctfAgent = newCTFAgentRecorder(
		filepath.Join(dataDirectory, "ctf-workspaces"),
		ctfService,
		nil,
	)
	t.Cleanup(func() {
		_ = ctfService.Close()
		_ = runtimeService.Close()
		manager.Close()
		_ = catalog.Close()
	})

	bridgeInfo, err := manager.StartBridge()
	if err != nil {
		t.Fatal(err)
	}
	ingestCTFShowCatalog(t, bridgeInfo)
	connection := dialBrowserBridge(t, bridgeInfo, "ctfshow-session-integration")
	defer connection.Close()

	var archive bytes.Buffer
	archiveWriter := zip.NewWriter(&archive)
	entry, err := archiveWriter.Create("README.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("authorized CTF fixture")); err != nil {
		t.Fatal(err)
	}
	if err := archiveWriter.Close(); err != nil {
		t.Fatal(err)
	}
	archiveDigest := sha256.Sum256(archive.Bytes())
	archiveDigestText := hex.EncodeToString(archiveDigest[:])

	type importResult struct {
		workspace CTFShowChallengeWorkspace
		err       error
	}
	importChannel := make(chan importResult, 1)
	go func() {
		workspace, importErr := app.ImportCTFShowChallenge(12, "copilot", []ctf.MaterialRequest{{
			Name:       "operator-note.txt",
			MediaType:  "text/plain",
			DataBase64: base64.StdEncoding.EncodeToString([]byte("added from Challenge Desk")),
			Provenance: "local-file-picker:operator-note.txt:sha256:test-fixture",
		}})
		importChannel <- importResult{workspace: workspace, err: importErr}
	}()
	command := readBrowserBridgeCommand(t, connection)
	if command.Type != "ctfshow.fetch_challenge" || command.ProblemID != 12 {
		t.Fatalf("unexpected CTFshow import command: %#v", command)
	}
	if err := connection.WriteJSON(map[string]any{
		"type": "ctfshow_challenge_result", "commandId": command.ID,
		"bridgeSessionId": command.BridgeSessionID, "problemId": 12,
		"status": "ready", "title": "web1", "category": "Web",
		"statement": "Inspect the provided fixture.", "points": 50, "solvedCount": 21,
		"tags": []string{"web", "entry"},
		"materials": []map[string]any{{
			"name": "fixture.zip", "mediaType": "application/zip",
			"dataBase64": base64.StdEncoding.EncodeToString(archive.Bytes()),
			"sha256":     archiveDigestText, "size": archive.Len(),
		}},
	}); err != nil {
		t.Fatal(err)
	}
	imported := <-importChannel
	if imported.err != nil {
		t.Fatal(imported.err)
	}
	if len(imported.workspace.CTF.Challenge.Materials) != 2 ||
		imported.workspace.CTF.Challenge.Materials[0].Name != "operator-note.txt" ||
		imported.workspace.CTF.Challenge.Materials[1].Name != "fixture.zip" {
		t.Fatalf("CTFshow workspace did not merge local and captured materials: %#v",
			imported.workspace.CTF.Challenge.Materials)
	}
	if imported.workspace.CTF.Challenge.ExternalPlatform != "ctfshow-web" ||
		imported.workspace.CTF.Challenge.ExternalAttemptID != 12 ||
		len(imported.workspace.CTF.Challenge.Materials) != 2 {
		t.Fatalf("CTFshow challenge did not enter the shared CTF domain: %#v", imported.workspace)
	}

	handoff, err := app.PrepareCTFAgentWorkspace(imported.workspace.CTF.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	manifestData, err := os.ReadFile(filepath.Join(handoff.WorkspacePath, "challenge.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest ctf.AgentWorkspaceManifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.Materials) != 2 ||
		manifest.Materials[0].Name != "operator-note.txt" ||
		manifest.Materials[1].Inspection.ArchiveFormat != "zip" ||
		manifest.Materials[1].Inspection.EntryCount != 1 ||
		manifest.Materials[1].Inspection.ReviewRequired ||
		len(manifest.Materials[1].ExtractedPaths) != 1 {
		t.Fatalf("CTFshow material did not receive archive intake: %#v", manifest.Materials)
	}
	extractedData, err := os.ReadFile(filepath.Join(
		handoff.WorkspacePath,
		filepath.FromSlash(manifest.Materials[1].ExtractedPaths[0]),
	))
	if err != nil {
		t.Fatal(err)
	}
	if string(extractedData) != "authorized CTF fixture" {
		t.Fatalf("CTFshow ZIP was not safely expanded: %q", extractedData)
	}
	replay, err := app.GetCTFAgentReplay(imported.workspace.CTF.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if replay.JobID != imported.workspace.CTF.Job.ID ||
		replay.ConversationID != handoff.ConversationID ||
		len(replay.Events) != 0 {
		t.Fatalf("new CTFshow workspace returned an invalid replay contract: %#v", replay)
	}

	type submitResult struct {
		submission CTFShowWebSubmission
		err        error
	}
	submitChannel := make(chan submitResult, 1)
	go func() {
		submission, submitErr := app.SubmitCTFShowWebFlag(
			imported.workspace.CTF.Job.ID,
			"flag{verified}",
		)
		submitChannel <- submitResult{submission: submission, err: submitErr}
	}()
	command = readBrowserBridgeCommand(t, connection)
	if command.Type != "ctfshow.submit_flag" ||
		command.ProblemID != 12 ||
		command.Candidate != "flag{verified}" {
		t.Fatalf("unexpected CTFshow Judge command: %#v", command)
	}
	correct := true
	if err := connection.WriteJSON(map[string]any{
		"type": "ctfshow_judge_result", "commandId": command.ID,
		"bridgeSessionId": command.BridgeSessionID, "problemId": 12,
		"status": "accepted", "correct": correct, "message": "Correct",
		"url": "https://ctf.show/challenges#12",
	}); err != nil {
		t.Fatal(err)
	}
	submitted := <-submitChannel
	if submitted.err != nil {
		t.Fatal(submitted.err)
	}
	if submitted.submission.Receipt.Correct == nil ||
		!*submitted.submission.Receipt.Correct ||
		submitted.submission.CTF.Outcome == nil ||
		submitted.submission.CTF.Outcome.Status != securityruntime.OutcomeSucceeded ||
		len(submitted.submission.CTF.JudgeReceipts) != 1 {
		t.Fatalf("authoritative CTFshow Judge receipt did not close the CTF loop: %#v", submitted.submission)
	}
	catalogStatus, err := app.GetCTFShowCatalogStatus()
	if err != nil {
		t.Fatal(err)
	}
	if len(catalogStatus.AttemptedProblemIDs) != 1 ||
		catalogStatus.AttemptedProblemIDs[0] != 12 ||
		len(catalogStatus.CompletedProblemIDs) != 1 ||
		catalogStatus.CompletedProblemIDs[0] != 12 {
		t.Fatalf("CTFshow catalog did not reflect the verified training result: %#v", catalogStatus)
	}
	reportExport, err := app.GenerateCTFTrainingReport(imported.workspace.CTF.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reportExport.Report.Verified ||
		reportExport.Report.ExternalPlatform != "ctfshow-web" ||
		len(reportExport.Report.JudgeReceipts) != 1 {
		t.Fatalf("completed CTFshow run did not produce a verified training report: %#v", reportExport)
	}
	for _, path := range []string{reportExport.JSONPath, reportExport.MarkdownPath} {
		reportData, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(reportData, []byte("flag{verified}")) {
			t.Fatalf("shareable report leaked the raw candidate: %s", path)
		}
	}
}

func TestLatestCTFShowPagePrefersNewestLoggedInCapture(t *testing.T) {
	now := time.Now().UTC()
	selected := latestCTFShowPage([]browsercap.SharedPage{
		{
			ID: "old", CapturedAt: now.Add(-time.Minute),
			Connected: true,
			CTFShow:   &browsercap.CTFShowCatalogState{LoggedIn: true},
		},
		{
			ID: "logged-out", CapturedAt: now.Add(time.Minute),
			CTFShow: &browsercap.CTFShowCatalogState{LoggedIn: false},
		},
		{
			ID: "new", CapturedAt: now,
			Connected: true,
			CTFShow:   &browsercap.CTFShowCatalogState{LoggedIn: true},
		},
	})
	if selected == nil || selected.ID != "new" {
		t.Fatalf("unexpected CTFshow page selection: %#v", selected)
	}
}

func ingestCTFShowCatalog(t *testing.T, info browsercap.BridgeInfo) {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"bridgeSessionId": "ctfshow-session-integration",
		"adapter":         "ctfshow-catalog-v1",
		"title":           "CTFshow",
		"url":             "https://ctf.show/challenges",
		"text":            "",
		"ctfshow": map[string]any{
			"loggedIn": true,
			"total":    1,
			"problems": []map[string]any{{
				"platformId": 12,
				"title":      "web1",
				"category":   "Web",
				"points":     50,
			}},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, info.Endpoint+"/ingest", bytes.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Authorization", "Bearer "+info.Token)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		t.Fatalf("paired CTFshow catalog returned %d", response.StatusCode)
	}
}

func dialBrowserBridge(
	t *testing.T,
	info browsercap.BridgeInfo,
	sessionIDs ...string,
) *websocket.Conn {
	t.Helper()
	connection, _, err := (&websocket.Dialer{
		HandshakeTimeout: 2 * time.Second,
		Subprotocols:     []string{"milksu-bridge-v1", info.Token},
	}).Dial(
		"ws"+strings.TrimPrefix(info.Endpoint, "http")+"/ws",
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

func readBrowserBridgeCommand(t *testing.T, connection *websocket.Conn) browsercap.NSSCTFBridgeCommand {
	t.Helper()
	if err := connection.SetReadDeadline(time.Now().Add(3 * time.Second)); err != nil {
		t.Fatal(err)
	}
	var envelope struct {
		Type    string                         `json:"type"`
		Command browsercap.NSSCTFBridgeCommand `json:"command"`
	}
	if err := connection.ReadJSON(&envelope); err != nil {
		t.Fatal(err)
	}
	if envelope.Type != "command" {
		t.Fatalf("unexpected bridge envelope: %#v", envelope)
	}
	return envelope.Command
}
