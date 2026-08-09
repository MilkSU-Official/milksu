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
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/browsercap"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/nssctf"
	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func TestNSSCTFPageToAcceptedTrainingReportSurvivesRestart(t *testing.T) {
	dataDirectory := t.TempDir()
	runtimeDirectory := filepath.Join(dataDirectory, "runtime")
	manager, err := browsercap.New(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	runtimeService, err := securityruntime.NewService(runtimeDirectory, nil)
	if err != nil {
		manager.Close()
		t.Fatal(err)
	}
	ctfService, err := ctf.NewService(runtimeService, ctf.ServiceOptions{
		Engine: deferredIntegrationEngine{},
	})
	if err != nil {
		manager.Close()
		_ = runtimeService.Close()
		t.Fatal(err)
	}
	catalogService, err := nssctf.NewCatalogService(
		filepath.Join(dataDirectory, "nssctf", "catalog.sqlite3"),
		nssctf.NewClient(nssctf.ClientOptions{}),
	)
	if err != nil {
		manager.Close()
		_ = ctfService.Close()
		_ = runtimeService.Close()
		t.Fatal(err)
	}
	memoryStore, err := ctf.NewMemoryStore(
		filepath.Join(dataDirectory, "ctf", "memory.sqlite3"),
		filepath.Join(dataDirectory, "ctf", "memories"),
	)
	if err != nil {
		manager.Close()
		_ = catalogService.Close()
		_ = ctfService.Close()
		_ = runtimeService.Close()
		t.Fatal(err)
	}
	app := &App{
		ctx:           context.Background(),
		dataDirectory: dataDirectory,
		browserBridge: manager,
		jobs:          runtimeService,
		ctfJobs:       ctfService,
		ctfMemory:     memoryStore,
		nssctfCatalog: catalogService,
	}
	app.ctfAgent = newCTFAgentRecorder(
		filepath.Join(dataDirectory, "ctf-workspaces"),
		ctfService,
		nil,
	)
	var recoveredRuntime *securityruntime.Service
	var recoveredCTF *ctf.Service
	var recoveredCatalog *nssctf.CatalogService
	var recoveredMemory *ctf.MemoryStore
	t.Cleanup(func() {
		if recoveredMemory != nil {
			_ = recoveredMemory.Close()
		}
		if recoveredCatalog != nil {
			_ = recoveredCatalog.Close()
		}
		if recoveredCTF != nil {
			_ = recoveredCTF.Close()
		}
		if recoveredRuntime != nil {
			_ = recoveredRuntime.Close()
		}
		_ = memoryStore.Close()
		_ = catalogService.Close()
		_ = ctfService.Close()
		_ = runtimeService.Close()
		manager.Close()
	})

	bridgeInfo, err := manager.StartBridge()
	if err != nil {
		t.Fatal(err)
	}
	ingestNSSCTFProblem(t, bridgeInfo, 317)
	connection := dialBrowserBridge(t, bridgeInfo, "nssctf-session-integration")
	defer connection.Close()

	pageMaterial, err := app.ImportNSSCTFWebPageMaterial(317)
	if err != nil {
		t.Fatal(err)
	}
	pageText, err := base64.StdEncoding.DecodeString(pageMaterial.DataBase64)
	if err != nil {
		t.Fatal(err)
	}
	pageDigest := sha256.Sum256(pageText)
	pageDigestText := hex.EncodeToString(pageDigest[:])
	if pageMaterial.Name != "nssctf-p317-page.txt" ||
		pageMaterial.MediaType != "text/plain; charset=utf-8" ||
		!bytes.Contains(pageText, []byte("pwn.example:31337")) ||
		!strings.Contains(pageMaterial.Provenance, pageDigestText) {
		t.Fatalf("NSSCTF page text lost its bounded provenance: %#v", pageMaterial)
	}

	archive := nssctfFixtureArchive(t)
	archiveDigest := sha256.Sum256(archive)
	archiveDigestText := hex.EncodeToString(archiveDigest[:])

	type importResult struct {
		material ctf.MaterialRequest
		err      error
	}
	importChannel := make(chan importResult, 1)
	go func() {
		material, importErr := app.ImportNSSCTFWebAttachment(317)
		importChannel <- importResult{material: material, err: importErr}
	}()
	command := readBrowserBridgeCommand(t, connection)
	if command.Type != "nssctf.fetch_attachment" || command.ProblemID != 317 {
		t.Fatalf("unexpected NSSCTF attachment command: %#v", command)
	}
	if err := connection.WriteJSON(map[string]any{
		"type": "attachment_result", "commandId": command.ID,
		"bridgeSessionId": command.BridgeSessionID, "problemId": 317,
		"status": "ready", "name": "challenge.zip", "mediaType": "application/zip",
		"dataBase64": base64.StdEncoding.EncodeToString(archive),
		"sha256":     archiveDigestText, "size": len(archive),
	}); err != nil {
		t.Fatal(err)
	}
	imported := <-importChannel
	if imported.err != nil {
		t.Fatal(imported.err)
	}
	if imported.material.Name != "challenge.zip" ||
		imported.material.MediaType != "application/zip" ||
		!bytes.Contains([]byte(imported.material.Provenance), []byte(archiveDigestText)) {
		t.Fatalf("NSSCTF attachment lost its verified provenance: %#v", imported.material)
	}

	projection, err := app.StartCTFChallenge(ctf.ChallengeRequest{
		Title:             "P317 Browser integration",
		Statement:         "Inspect the authorized attachment and submit through the paired NSSCTF tab.",
		Category:          "misc",
		CollaborationMode: "copilot",
		DeferAgent:        true,
		TrackName:         "NSSCTF",
		HumanGoal:         "Complete a real browser-backed challenge with reproducible evidence.",
		SourceKind:        "url",
		SourceURI:         "https://www.nssctf.cn/problem/317",
		ExternalPlatform:  "nssctf-web",
		ExternalAttemptID: 317,
		KnowledgePoints:   []string{"attachment intake", "authoritative Judge receipt"},
		Materials:         []ctf.MaterialRequest{imported.material, pageMaterial},
	})
	if err != nil {
		t.Fatal(err)
	}
	if projection.Challenge.ExternalPlatform != "nssctf-web" ||
		projection.Challenge.ExternalAttemptID != 317 ||
		len(projection.Challenge.Materials) != 2 {
		t.Fatalf("NSSCTF problem did not enter the shared CTF domain: %#v", projection)
	}
	if len(projection.Challenge.Source.Scope.Targets) != 1 ||
		projection.Challenge.Source.Scope.Targets[0].Kind != securitypolicy.TargetOrigin ||
		strings.Contains(projection.Challenge.Source.Scope.Targets[0].Value, "pwn.example") {
		t.Fatalf("page text expanded the authorized challenge scope: %#v", projection.Challenge.Source.Scope)
	}
	missingCheckpoint, err := app.GetCTFAgentRunCheckpoint(projection.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if missingCheckpoint != nil {
		t.Fatalf("unprepared workspace exposed a fabricated recovery point: %#v", missingCheckpoint)
	}

	handoff, err := app.PrepareCTFAgentWorkspace(projection.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	checkpoint, err := app.GetCTFAgentRunCheckpoint(projection.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if checkpoint == nil ||
		checkpoint.JobID != projection.Job.ID ||
		checkpoint.ConversationID != handoff.ConversationID ||
		checkpoint.Status != "ready" {
		t.Fatalf("desktop did not expose the initial Agent recovery point: %#v", checkpoint)
	}
	manifestData, err := os.ReadFile(filepath.Join(handoff.WorkspacePath, "challenge.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest ctf.AgentWorkspaceManifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		t.Fatal(err)
	}
	if len(manifest.Source.Scope.Targets) != 1 ||
		manifest.Source.Scope.Targets[0] != (securitypolicy.Target{
			Kind: securitypolicy.TargetOrigin, Value: "https://www.nssctf.cn",
		}) {
		t.Fatalf("NSSCTF workspace has an unexpected authorization scope: %#v", manifest.Source.Scope)
	}
	if len(manifest.Materials) != 2 ||
		manifest.Materials[0].Inspection.ArchiveFormat != "zip" ||
		manifest.Materials[0].Inspection.EntryCount != 1 ||
		manifest.Materials[0].Inspection.ReviewRequired ||
		len(manifest.Materials[0].ExtractedPaths) != 1 {
		t.Fatalf("NSSCTF material did not receive archive intake: %#v", manifest.Materials)
	}
	extractedData, err := os.ReadFile(filepath.Join(
		handoff.WorkspacePath,
		filepath.FromSlash(manifest.Materials[0].ExtractedPaths[0]),
	))
	if err != nil {
		t.Fatal(err)
	}
	if string(extractedData) != "authorized NSSCTF fixture" {
		t.Fatalf("NSSCTF ZIP was not safely expanded: %q", extractedData)
	}

	type submitResult struct {
		submission NSSCTFWebSubmission
		err        error
	}
	submitChannel := make(chan submitResult, 1)
	go func() {
		submission, submitErr := app.SubmitNSSCTFWebFlag(
			projection.Job.ID,
			"NSSCTF{verified}",
		)
		submitChannel <- submitResult{submission: submission, err: submitErr}
	}()
	command = readBrowserBridgeCommand(t, connection)
	if command.Type != "nssctf.submit_flag" ||
		command.ProblemID != 317 ||
		command.Candidate != "NSSCTF{verified}" {
		t.Fatalf("unexpected NSSCTF Judge command: %#v", command)
	}
	correct := true
	if err := connection.WriteJSON(map[string]any{
		"type": "result", "commandId": command.ID,
		"bridgeSessionId": command.BridgeSessionID, "problemId": 317,
		"status": "accepted", "correct": correct, "message": "Accepted",
		"url": "https://www.nssctf.cn/problem/317",
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
		t.Fatalf("authoritative NSSCTF Judge receipt did not close the loop: %#v", submitted.submission)
	}

	contributed, err := app.RecordCTFLearning(projection.Job.ID, ctf.LearningRecordRequest{
		Kind:    "independent_step",
		Content: "我核对了附件摘要并在配对页面确认提交目标。",
		Concept: "NSSCTF 用户步骤",
	})
	if err != nil {
		t.Fatal(err)
	}
	if contributed.HumanOutcome.IndependentSteps != 0 ||
		contributed.HumanOutcome.Contribution.UserAssistedSteps != 1 ||
		contributed.HumanOutcome.Contribution.PrimaryActor != ctf.LearningActorShared {
		t.Fatalf("copilot user step was not kept separate from independent work: %#v", contributed.HumanOutcome)
	}
	reflected, err := app.RecordCTFLearning(projection.Job.ID, ctf.LearningRecordRequest{
		Kind:    "reflection",
		Content: "先核对附件来源和摘要，再把证据支持的候选交给平台 Judge。",
		Concept: "NSSCTF 复盘",
	})
	if err != nil {
		t.Fatal(err)
	}
	if reflected.HumanOutcome.ReflectionCount != 1 {
		t.Fatalf("accepted run did not retain the learner reflection: %#v", reflected.HumanOutcome)
	}
	memory, err := app.SaveCTFTrainingMemory(projection.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if memory.Confidence != 1 ||
		memory.SourceJobID != projection.Job.ID ||
		memory.Actor != ctf.LearningActorShared ||
		memory.Assistance != ctf.LearningAssistanceCopilot {
		t.Fatalf("accepted run did not produce a verified reusable memory: %#v", memory)
	}
	dashboard, err := app.GetNSSCTFTrainingDashboard()
	if err != nil {
		t.Fatal(err)
	}
	if dashboard.RealAttemptCount != 1 ||
		dashboard.RealSolvedCount != 1 ||
		len(dashboard.Sources) != 1 ||
		dashboard.Sources[0].Key != "nssctf" {
		t.Fatalf("accepted run did not update the ability dashboard: %#v", dashboard)
	}
	foundSolvedAxis := false
	for _, dimension := range dashboard.Dimensions {
		if dimension.Key == "misc" &&
			dimension.Attempts == 1 &&
			dimension.Solved == 1 &&
			dimension.CopilotSolved == 1 &&
			dimension.IndependentSolved == 0 {
			foundSolvedAxis = true
		}
	}
	if !foundSolvedAxis {
		t.Fatalf("accepted run did not calibrate its category axis: %#v", dashboard.Dimensions)
	}

	reportExport, err := app.GenerateCTFTrainingReport(projection.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertVerifiedNSSCTFReport(t, reportExport, "NSSCTF{verified}")

	if err := ctfService.Close(); err != nil {
		t.Fatal(err)
	}
	if err := runtimeService.Close(); err != nil {
		t.Fatal(err)
	}
	if err := memoryStore.Close(); err != nil {
		t.Fatal(err)
	}
	if err := catalogService.Close(); err != nil {
		t.Fatal(err)
	}
	recoveredRuntime, err = securityruntime.NewService(runtimeDirectory, nil)
	if err != nil {
		t.Fatal(err)
	}
	recoveredCTF, err = ctf.NewService(recoveredRuntime, ctf.ServiceOptions{
		Engine: deferredIntegrationEngine{},
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := recoveredCTF.Recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	recoveredCatalog, err = nssctf.NewCatalogService(
		filepath.Join(dataDirectory, "nssctf", "catalog.sqlite3"),
		nssctf.NewClient(nssctf.ClientOptions{}),
	)
	if err != nil {
		t.Fatal(err)
	}
	recoveredMemory, err = ctf.NewMemoryStore(
		filepath.Join(dataDirectory, "ctf", "memory.sqlite3"),
		filepath.Join(dataDirectory, "ctf", "memories"),
	)
	if err != nil {
		t.Fatal(err)
	}
	reopened := &App{
		ctx:           context.Background(),
		dataDirectory: dataDirectory,
		jobs:          recoveredRuntime,
		ctfJobs:       recoveredCTF,
		ctfMemory:     recoveredMemory,
		nssctfCatalog: recoveredCatalog,
	}
	reopened.ctfAgent = newCTFAgentRecorder(
		filepath.Join(dataDirectory, "ctf-workspaces"),
		recoveredCTF,
		nil,
	)
	recoveredProjection, err := reopened.GetCTFJob(projection.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recoveredProjection.Job.Status != securityruntime.JobSucceeded ||
		recoveredProjection.Outcome == nil ||
		recoveredProjection.Outcome.Status != securityruntime.OutcomeSucceeded ||
		len(recoveredProjection.JudgeReceipts) != 1 {
		t.Fatalf("restarted NSSCTF training lost its Accepted state: %#v", recoveredProjection)
	}
	replay, err := reopened.GetCTFAgentReplay(projection.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if replay.JobID != projection.Job.ID ||
		replay.ConversationID != handoff.ConversationID {
		t.Fatalf("restarted NSSCTF training lost its Agent replay: %#v", replay)
	}
	recoveredCheckpoint, err := reopened.GetCTFAgentRunCheckpoint(projection.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if recoveredCheckpoint == nil ||
		recoveredCheckpoint.JobID != projection.Job.ID ||
		recoveredCheckpoint.ConversationID != handoff.ConversationID {
		t.Fatalf("restarted NSSCTF training lost its Agent recovery point: %#v", recoveredCheckpoint)
	}
	recoveredReport, err := reopened.GenerateCTFTrainingReport(projection.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	assertVerifiedNSSCTFReport(t, recoveredReport, "NSSCTF{verified}")
	recoveredMemories, err := reopened.ctfMemory.Recall(context.Background(), "misc", "", 20)
	if err != nil {
		t.Fatal(err)
	}
	if len(recoveredMemories) != 1 ||
		recoveredMemories[0].SourceJobID != projection.Job.ID ||
		recoveredMemories[0].Confidence != 1 ||
		recoveredMemories[0].Actor != ctf.LearningActorShared ||
		recoveredMemories[0].Assistance != ctf.LearningAssistanceCopilot {
		t.Fatalf("restarted NSSCTF training lost its reusable memory: %#v", recoveredMemories)
	}
	recoveredDashboard, err := reopened.GetNSSCTFTrainingDashboard()
	if err != nil {
		t.Fatal(err)
	}
	if recoveredDashboard.RealAttemptCount != 1 || recoveredDashboard.RealSolvedCount != 1 {
		t.Fatalf("restarted NSSCTF training lost its ability signal: %#v", recoveredDashboard)
	}
}

func TestBoundedNSSCTFPageTextNormalizesAndTruncatesOnUTF8Boundary(t *testing.T) {
	normalized, err := boundedNSSCTFPageText("  第一行\r\n第二行\r第三行  ")
	if err != nil {
		t.Fatal(err)
	}
	if string(normalized) != "第一行\n第二行\n第三行" {
		t.Fatalf("unexpected normalized page text: %q", normalized)
	}
	large, err := boundedNSSCTFPageText(strings.Repeat("题", maxNSSCTFPageMaterialBytes))
	if err != nil {
		t.Fatal(err)
	}
	if len(large) > maxNSSCTFPageMaterialBytes || !utf8.Valid(large) {
		t.Fatalf("page material was not truncated safely: bytes=%d valid=%v", len(large), utf8.Valid(large))
	}
	if _, err := boundedNSSCTFPageText(" \r\n "); err == nil {
		t.Fatal("empty browser page text was accepted as a material")
	}
}

func ingestNSSCTFProblem(t *testing.T, info browsercap.BridgeInfo, problemID int) {
	t.Helper()
	body, err := json.Marshal(map[string]any{
		"bridgeSessionId": "nssctf-session-integration",
		"adapter":         "nssctf-web-v1",
		"title":           "P317 - NSSCTF",
		"url":             "https://www.nssctf.cn/problem/317",
		"text":            "Inspect the provided attachment.\r\nDynamic target suggestion: pwn.example:31337",
		"nssctf": map[string]any{
			"problemId": problemID, "title": "P317 Browser integration",
			"category": "Misc", "tags": []string{"attachment"},
			"loggedIn": true, "canSubmit": true, "needsStart": false, "solved": false,
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
		t.Fatalf("paired NSSCTF page returned %d", response.StatusCode)
	}
}

func nssctfFixtureArchive(t *testing.T) []byte {
	t.Helper()
	var archive bytes.Buffer
	writer := zip.NewWriter(&archive)
	entry, err := writer.Create("README.txt")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := entry.Write([]byte("authorized NSSCTF fixture")); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return archive.Bytes()
}

func assertVerifiedNSSCTFReport(
	t *testing.T,
	reportExport ctf.TrainingReportExport,
	rawCandidate string,
) {
	t.Helper()
	if !reportExport.Report.Verified ||
		reportExport.Report.ExternalPlatform != "nssctf-web" ||
		len(reportExport.Report.JudgeReceipts) != 1 {
		t.Fatalf("completed NSSCTF run did not produce a verified report: %#v", reportExport)
	}
	for _, path := range []string{reportExport.JSONPath, reportExport.MarkdownPath} {
		reportData, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if bytes.Contains(reportData, []byte(rawCandidate)) {
			t.Fatalf("shareable report leaked the raw candidate: %s", path)
		}
	}
}
