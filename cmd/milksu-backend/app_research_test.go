package main

import (
	"context"
	"encoding/json"
	"net"
	"os"
	"path/filepath"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/browsercap"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/research"
)

func TestResearchWorkspaceActionsRequirePersistedPiConversation(t *testing.T) {
	dataDirectory := t.TempDir()
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []conversation.StoredConversation{
		{ID: "pi-conversation", Kernel: conversation.KernelPi},
		{ID: "dsh-conversation", Kernel: conversation.KernelDSH},
	} {
		if err := conversations.Save(value); err != nil {
			t.Fatal(err)
		}
	}
	researchStore, err := research.OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	service := research.NewService(researchStore)
	defer service.Close()

	app := &App{
		conversations: conversations,
		engines:       engine.NewSupervisor(nil),
		research:      service,
	}
	defer app.engines.Close()

	result, err := app.handleCodingWorkspaceAction(
		"pi-conversation",
		"start_research_run",
		`{"query":"Compare the primary-source release dates"}`,
	)
	if err != nil {
		t.Fatal(err)
	}
	var started struct {
		Run research.Run `json:"run"`
	}
	if err := json.Unmarshal([]byte(result), &started); err != nil {
		t.Fatal(err)
	}
	if started.Run.ConversationID != "pi-conversation" || started.Run.Status != research.RunRunning {
		t.Fatalf("unexpected Pi research run: %#v", started.Run)
	}
	if started.Run.TraceID == "" {
		t.Fatalf("started research run missing TraceID: %#v", started.Run)
	}
	if _, err := app.handleCodingWorkspaceAction(
		"pi-conversation",
		"open_browser_tab ",
		`{"url":"http://127.0.0.1/secret"}`,
	); err == nil {
		t.Fatal("managed Browser fallback bypassed the research URL check")
	}
	if _, err := app.handleCodingWorkspaceAction("pi-conversation", "list_browser_tabs", ""); err == nil {
		t.Fatal("generic Browser tab URLs were exposed during Deep Research")
	}
	registered, err := app.handleCodingWorkspaceAction(
		"pi-conversation",
		"register_research_task",
		`{"runId":"`+started.Run.ID+`","taskPrompt":"Collect official-source evidence"}`,
	)
	if err != nil {
		t.Fatal(err)
	}
	var taskResult struct {
		Task research.Task `json:"task"`
	}
	if err := json.Unmarshal([]byte(registered), &taskResult); err != nil {
		t.Fatal(err)
	}
	if taskResult.Task.RunID != started.Run.ID || taskResult.Task.Status != research.TaskLaunching {
		t.Fatalf("unexpected registered research task: %#v", taskResult.Task)
	}

	if _, err := app.handleCodingWorkspaceAction(
		"dsh-conversation",
		"start_research_run",
		`{"query":"must not route into Pi"}`,
	); err == nil {
		t.Fatal("research action was accepted for a DSH conversation")
	}
	runs, err := service.List(context.Background(), "dsh-conversation")
	if err != nil {
		t.Fatal(err)
	}
	if len(runs) != 0 {
		t.Fatalf("DSH conversation acquired a research run: %#v", runs)
	}
	app.interruptResearchRunForSession("pi-conversation")
	snapshot, err := service.Get(context.Background(), "pi-conversation", started.Run.ID)
	if err != nil || snapshot.Run.Status != research.RunInterrupted {
		t.Fatalf("research run after Sidecar loss = %#v, %v", snapshot.Run, err)
	}
}

func TestResearchWorkspaceStartPersistsSuppliedTraceID(t *testing.T) {
	dataDirectory := t.TempDir()
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := conversations.Save(conversation.StoredConversation{
		ID: "pi-conversation", Kernel: conversation.KernelPi,
	}); err != nil {
		t.Fatal(err)
	}
	researchStore, err := research.OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	service := research.NewService(researchStore)
	defer service.Close()
	app := &App{
		conversations: conversations,
		engines:       engine.NewSupervisor(nil),
		research:      service,
	}
	defer app.engines.Close()

	const suppliedTraceID = "trc_550e8400-e29b-41d4-a716-446655440000"
	result, err := app.handleCodingWorkspaceAction(
		"pi-conversation",
		"start_research_run",
		`{"query":"Keep the supplied trace","traceId":"`+suppliedTraceID+`"}`,
	)
	if err != nil {
		t.Fatal(err)
	}
	var started struct {
		Run research.Run `json:"run"`
	}
	if err := json.Unmarshal([]byte(result), &started); err != nil {
		t.Fatal(err)
	}
	if started.Run.TraceID != suppliedTraceID {
		t.Fatalf("workspace start TraceID = %q, want %q", started.Run.TraceID, suppliedTraceID)
	}
	stored, err := service.Get(context.Background(), "pi-conversation", started.Run.ID)
	if err != nil || stored.Run.TraceID != suppliedTraceID {
		t.Fatalf("persisted workspace TraceID = %#v, %v", stored.Run, err)
	}
}

func TestResearchRendererReadsUsePersistedPiConversationWithoutLiveSession(t *testing.T) {
	dataDirectory := t.TempDir()
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	for _, value := range []conversation.StoredConversation{
		{ID: "pi-conversation", Kernel: conversation.KernelPi},
		{ID: "dsh-conversation", Kernel: conversation.KernelDSH},
	} {
		if err := conversations.Save(value); err != nil {
			t.Fatal(err)
		}
	}

	researchStore, err := research.OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	service := research.NewService(researchStore)
	defer func() { _ = service.Close() }()
	ctx := context.Background()

	completed, err := service.Start(ctx, "pi-conversation", "Compare two release dates")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.AddSource(
		ctx,
		"pi-conversation",
		completed.ID,
		"https://example.test/releases",
		"Official release notes",
		"The release was published on 2026-01-02.",
	); err != nil {
		t.Fatal(err)
	}
	task, err := service.RegisterTask(ctx, "pi-conversation", completed.ID, "Read the release notes")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.RecordWorkerUpdates(ctx, "pi-conversation", completed.ID, []research.WorkerUpdate{{
		ID: task.ID, Prompt: task.Prompt, Status: research.TaskCompleted, Result: "Release date confirmed.",
	}}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SealBatch(ctx, "pi-conversation", completed.ID); err != nil {
		t.Fatal(err)
	}
	completed, err = service.Complete(ctx, "pi-conversation", completed.ID, "The official release date was January 2, 2026.")
	if err != nil {
		t.Fatal(err)
	}

	interrupted, err := service.Start(ctx, "pi-conversation", "Check another saved run")
	if err != nil {
		t.Fatal(err)
	}
	interruptedSource, err := service.AddSource(
		ctx,
		"pi-conversation",
		interrupted.ID,
		"https://example.test/archive",
		"Archived source",
		"Saved extract available after restart.",
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Close(); err != nil {
		t.Fatal(err)
	}

	researchStore, err = research.OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	service = research.NewService(researchStore)
	if err := service.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	app := &App{
		conversations: conversations,
		engines:       engine.NewSupervisor(nil),
		research:      service,
	}
	defer app.engines.Close()
	if app.engines.HasRegisteredSession("pi-conversation") {
		t.Fatal("test unexpectedly registered a live Pi session")
	}

	runs, err := app.ListResearchRuns("pi-conversation")
	if err != nil {
		t.Fatalf("list durable research runs without a live session: %v", err)
	}
	if len(runs) != 2 || runs[0].ID != interrupted.ID || runs[0].Status != research.RunInterrupted {
		t.Fatalf("unexpected persisted research runs: %#v", runs)
	}
	snapshot, err := app.GetResearchRun("pi-conversation", interrupted.ID)
	if err != nil || snapshot.Run.Status != research.RunInterrupted || len(snapshot.Sources) != 1 {
		t.Fatalf("get interrupted research snapshot = %#v, %v", snapshot, err)
	}
	sourceDetail, err := app.ReadResearchSource("pi-conversation", interruptedSource.ID)
	if err != nil || sourceDetail.Source.Title != "Archived source" ||
		sourceDetail.Extract != "Saved extract available after restart." {
		t.Fatalf("read durable research source = %#v, %v", sourceDetail, err)
	}
	report, err := app.ReadResearchReport("pi-conversation", completed.ID)
	if err != nil || report != "The official release date was January 2, 2026." {
		t.Fatalf("read durable research report = %q, %v", report, err)
	}
	if _, err := app.ListResearchRuns("dsh-conversation"); err == nil {
		t.Fatal("renderer research read was accepted for a DSH conversation")
	}
	stored, err := conversations.Get("pi-conversation")
	if err != nil || len(stored.Messages) != 0 {
		t.Fatalf("research state leaked into persisted conversation messages: %#v, %v", stored.Messages, err)
	}
}

func TestCancelResearchRunPersistsWithoutLivePiSession(t *testing.T) {
	dataDirectory := t.TempDir()
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := conversations.Save(conversation.StoredConversation{
		ID: "pi-conversation", Kernel: conversation.KernelPi,
	}); err != nil {
		t.Fatal(err)
	}
	researchStore, err := research.OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	service := research.NewService(researchStore)
	defer service.Close()
	run, err := service.Start(context.Background(), "pi-conversation", "Cancel after restart")
	if err != nil {
		t.Fatal(err)
	}
	app := &App{
		conversations: conversations,
		engines:       engine.NewSupervisor(nil),
		research:      service,
	}
	defer app.engines.Close()

	cancelled, err := app.CancelResearchRun("pi-conversation", run.ID)
	if err != nil {
		t.Fatalf("cancel persisted research run without a live Pi session: %v", err)
	}
	if cancelled.Status != research.RunCancelled || cancelled.WorkerStopUnconfirmed {
		t.Fatalf("cancelled run = %#v, want no pending worker stop", cancelled)
	}
}

func TestCancelResearchRunWithoutSidecarPersistsUnconfirmedWorkerStop(t *testing.T) {
	dataDirectory := t.TempDir()
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := conversations.Save(conversation.StoredConversation{
		ID: "pi-conversation", Kernel: conversation.KernelPi,
	}); err != nil {
		t.Fatal(err)
	}
	store, err := research.OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	service := research.NewService(store)
	defer service.Close()
	run, err := service.Start(context.Background(), "pi-conversation", "stop after Sidecar loss")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.RegisterTask(context.Background(), run.ConversationID, run.ID, "collect an official source"); err != nil {
		t.Fatal(err)
	}
	if err := service.MarkInterrupted(context.Background(), run.ConversationID, run.ID); err != nil {
		t.Fatal(err)
	}
	app := &App{conversations: conversations, research: service}
	cancelled, err := app.CancelResearchRun(run.ConversationID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.Status != research.RunCancelled || !cancelled.WorkerStopUnconfirmed {
		t.Fatalf("cancelled run after Sidecar loss = %#v; want unconfirmed worker stop", cancelled)
	}
	if _, err := service.Start(context.Background(), run.ConversationID, "do not overlap a worker"); err == nil {
		t.Fatal("new run started while detached worker stop was unconfirmed")
	}
}

func TestCancelResearchRunDuringLaunchingSkipsWorkerStop(t *testing.T) {
	dataDirectory := t.TempDir()
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := conversations.Save(conversation.StoredConversation{
		ID: "pi-conversation", Kernel: conversation.KernelPi,
	}); err != nil {
		t.Fatal(err)
	}
	store, err := research.OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	service := research.NewService(store)
	defer service.Close()
	run, err := service.Start(context.Background(), "pi-conversation", "cancel before launch")
	if err != nil {
		t.Fatal(err)
	}
	registered, err := service.RegisterTask(context.Background(), run.ConversationID, run.ID, "collect an official source")
	if err != nil {
		t.Fatal(err)
	}
	if registered.Status != research.TaskLaunching {
		t.Fatalf("registered task = %#v; want launching before cancel", registered)
	}
	app := &App{conversations: conversations, research: service}
	cancelled, err := app.CancelResearchRun(run.ConversationID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.Status != research.RunCancelled || cancelled.WorkerStopUnconfirmed {
		t.Fatalf("cancelled launching run = %#v; want no worker-stop attempt", cancelled)
	}
	snapshot, err := service.Get(context.Background(), run.ConversationID, run.ID)
	if err != nil || len(snapshot.Tasks) != 1 || snapshot.Tasks[0].Status != research.TaskCancelled {
		t.Fatalf("launching task after cancel = %#v, %v; want cancelled", snapshot.Tasks, err)
	}
}

func TestCancelResearchRunDuringRunningWorkerFlagsWorkerStop(t *testing.T) {
	dataDirectory := t.TempDir()
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := conversations.Save(conversation.StoredConversation{
		ID: "pi-conversation", Kernel: conversation.KernelPi,
	}); err != nil {
		t.Fatal(err)
	}
	store, err := research.OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	service := research.NewService(store)
	defer service.Close()
	run, err := service.Start(context.Background(), "pi-conversation", "cancel a live worker")
	if err != nil {
		t.Fatal(err)
	}
	registered, err := service.RegisterTask(context.Background(), run.ConversationID, run.ID, "collect an official source")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.RecordWorkerUpdates(context.Background(), run.ConversationID, run.ID, []research.WorkerUpdate{{
		ID:       registered.ID,
		Prompt:   registered.Prompt,
		Status:   "running",
		WorkerID: "call_00_live-worker",
	}}); err != nil {
		t.Fatal(err)
	}
	app := &App{conversations: conversations, research: service}
	cancelled, err := app.CancelResearchRun(run.ConversationID, run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if cancelled.Status != research.RunCancelled || !cancelled.WorkerStopUnconfirmed {
		t.Fatalf("cancelled running-worker run = %#v; want a flagged worker stop for the real worker", cancelled)
	}
	snapshot, err := service.Get(context.Background(), run.ConversationID, run.ID)
	if err != nil || len(snapshot.Tasks) != 1 || snapshot.Tasks[0].Status != research.TaskCancelled ||
		snapshot.Tasks[0].WorkerID != "call_00_live-worker" {
		t.Fatalf("running task after cancel = %#v, %v; want cancelled with its worker identity retained", snapshot.Tasks, err)
	}
}

func TestResearchCancelConfirmationClearsPersistedWorkerStopWarning(t *testing.T) {
	dataDirectory := t.TempDir()
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := conversations.Save(conversation.StoredConversation{
		ID: "pi-conversation", Kernel: conversation.KernelPi,
	}); err != nil {
		t.Fatal(err)
	}
	store, err := research.OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	service := research.NewService(store)
	defer service.Close()
	run, err := service.Start(context.Background(), "pi-conversation", "persist worker stop state")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Cancel(context.Background(), run.ConversationID, run.ID); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SetWorkerStopUnconfirmed(
		context.Background(), run.ConversationID, run.ID, false,
	); err != nil {
		t.Fatal(err)
	}
	app := &App{conversations: conversations, research: service}
	app.emitEngineEvent(engine.Event{
		Type:          "runtime.research_cancel_unconfirmed",
		SessionID:     run.ConversationID,
		ResearchRunID: run.ID,
	})
	warning, err := service.Get(context.Background(), run.ConversationID, run.ID)
	if err != nil || !warning.Run.WorkerStopUnconfirmed {
		t.Fatalf("run after stop warning = %#v, %v", warning.Run, err)
	}
	app.emitEngineEvent(engine.Event{
		Type:          "runtime.research_cancel_confirmed",
		SessionID:     run.ConversationID,
		ResearchRunID: run.ID,
	})
	got, err := service.Get(context.Background(), run.ConversationID, run.ID)
	if err != nil || got.Run.WorkerStopUnconfirmed {
		t.Fatalf("run after stop confirmation = %#v, %v", got.Run, err)
	}
}

func TestStopCodingBrowserCannotInterruptActiveResearch(t *testing.T) {
	dataDirectory := t.TempDir()
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := conversations.Save(conversation.StoredConversation{
		ID: "pi-conversation", Kernel: conversation.KernelPi,
	}); err != nil {
		t.Fatal(err)
	}
	store, err := research.OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	service := research.NewService(store)
	defer service.Close()
	run, err := service.Start(context.Background(), "pi-conversation", "keep Research session attached")
	if err != nil {
		t.Fatal(err)
	}
	browser, err := browsercap.New(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	defer browser.Close()
	app := &App{conversations: conversations, research: service, browserBridge: browser}
	if _, err := app.StopCodingBrowser("pi-conversation"); err == nil {
		t.Fatal("StopCodingBrowser interrupted an active Research run")
	}
	got, err := service.Get(context.Background(), run.ConversationID, run.ID)
	if err != nil || got.Run.Status != research.RunRunning {
		t.Fatalf("Research run after rejected Browser stop = %#v, %v", got.Run, err)
	}
}

func TestPermanentConversationDeletionRemovesResearchArtifacts(t *testing.T) {
	dataDirectory := t.TempDir()
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"active-conversation", "archived-conversation"} {
		if err := conversations.Save(conversation.StoredConversation{ID: id, Kernel: conversation.KernelPi}); err != nil {
			t.Fatal(err)
		}
	}
	researchStore, err := research.OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	service := research.NewService(researchStore)
	defer service.Close()
	artifacts := make(map[string]string)
	for _, id := range []string{"active-conversation", "archived-conversation"} {
		run, err := service.Start(context.Background(), id, "Delete research with conversation")
		if err != nil {
			t.Fatal(err)
		}
		source, err := service.AddSource(
			context.Background(), id, run.ID, "https://example.test/source", "Saved source", "Private saved extract",
		)
		if err != nil {
			t.Fatal(err)
		}
		artifacts[id] = filepath.Join(dataDirectory, "research", "artifacts", run.ID, source.ArtifactRef)
	}
	app := &App{
		conversations: conversations,
		engines:       engine.NewSupervisor(nil),
		research:      service,
	}
	defer app.engines.Close()
	if err := app.ArchiveConversation("archived-conversation"); err != nil {
		t.Fatal(err)
	}
	if err := app.DeleteArchivedConversation("archived-conversation"); err != nil {
		t.Fatal(err)
	}
	if err := app.DeleteConversation("active-conversation"); err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"active-conversation", "archived-conversation"} {
		runs, err := service.List(context.Background(), id)
		if err != nil || len(runs) != 0 {
			t.Fatalf("research runs after permanent deletion of %s = %#v, %v", id, runs, err)
		}
		if _, err := os.Stat(artifacts[id]); !os.IsNotExist(err) {
			t.Fatalf("research artifact for %s still exists (stat error %v)", id, err)
		}
	}
}

func TestDropResearchForConversationLeavesConversationJSON(t *testing.T) {
	dataDirectory := t.TempDir()
	t.Setenv(appdata.DirectoryOverrideEnv, dataDirectory)
	conversations, err := conversation.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	if err := conversations.Save(conversation.StoredConversation{
		ID:     "keep-json",
		Kernel: conversation.KernelPi,
		Title:  "still here",
	}); err != nil {
		t.Fatal(err)
	}
	researchStore, err := research.OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	service := research.NewService(researchStore)
	defer service.Close()
	if _, err := service.Start(context.Background(), "keep-json", "Drop research only"); err != nil {
		t.Fatal(err)
	}
	app := &App{conversations: conversations, research: service}
	if err := app.DropResearchForConversation("keep-json"); err != nil {
		t.Fatal(err)
	}
	stored, err := conversations.Get("keep-json")
	if err != nil {
		t.Fatalf("conversation JSON was deleted: %v", err)
	}
	if stored.Title != "still here" {
		t.Fatalf("conversation title = %q", stored.Title)
	}
	runs, err := service.List(context.Background(), "keep-json")
	if err != nil || len(runs) != 0 {
		t.Fatalf("research runs after DropResearchForConversation = %#v, %v", runs, err)
	}
}

func TestValidateResearchBrowserURL(t *testing.T) {
	if got, err := validateResearchBrowserURLWithLookup(
		"HTTPS://example.test/paper",
		func(string) ([]net.IP, error) { return []net.IP{net.ParseIP("8.8.8.8")}, nil },
	); err != nil || got != "https://example.test/paper" {
		t.Fatalf("validateResearchBrowserURL() = %q, %v", got, err)
	}
	if _, err := validateResearchBrowserURLWithLookup(
		"https://router.example/page",
		func(string) ([]net.IP, error) { return []net.IP{net.ParseIP("10.0.0.1")}, nil },
	); err == nil {
		t.Fatal("research Browser URL with private DNS result was allowed")
	}
	if _, err := validateResearchBrowserURLWithLookup(
		"https://fakeip.example/docs",
		func(string) ([]net.IP, error) { return []net.IP{net.ParseIP("198.18.0.188")}, nil },
	); err == nil {
		t.Fatal("research Browser URL with RFC 2544 benchmark DNS result was allowed")
	}
	if _, err := validateResearchBrowserURLWithLookup(
		"https://documentation.example/page",
		func(string) ([]net.IP, error) { return []net.IP{net.ParseIP("2001:db8::1")}, nil },
	); err == nil {
		t.Fatal("research Browser URL with IPv6 documentation DNS result was allowed")
	}
	for _, raw := range []string{
		"file:///private/data",
		"https://user:password@example.test/page",
		"http://localhost/page",
		"http://printer.local/page",
		"http://metadata.google.internal/latest/meta-data",
		"http://127.0.0.1/page",
		"http://2130706433/page",
		"http://0x7f000001/page",
		"http://100.64.0.1/page",
		"http://10.0.0.1/page",
		"http://[::1]/page",
		"http://0.1.2.3/page",
		"http://192.0.0.8/page",
		"http://192.0.2.1/page",
		"http://198.18.0.188/page",
		"http://198.51.100.7/page",
		"http://203.0.113.9/page",
		"http://240.0.0.1/page",
		"http://[2001:db8::1]/page",
	} {
		if _, err := validateResearchBrowserURL(raw); err == nil {
			t.Errorf("validateResearchBrowserURL(%q) succeeded for a blocked address", raw)
		}
	}
}
