package research

import (
	"context"
	"testing"
)

func TestStartAssignsAndPersistsTraceID(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store)
	ctx := context.Background()

	generated, err := service.Start(ctx, "conversation-trace-generated", "assign a trace id")
	if err != nil {
		t.Fatal(err)
	}
	if !researchTraceIDPattern.MatchString(generated.TraceID) {
		t.Fatalf("generated TraceID = %q, want trc_ uuid", generated.TraceID)
	}
	storedGenerated, err := store.GetRun(ctx, generated.ID)
	if err != nil || storedGenerated.TraceID != generated.TraceID {
		t.Fatalf("persisted generated TraceID = %#v, %v", storedGenerated, err)
	}

	const supplied = "trc_550e8400-e29b-41d4-a716-446655440000"
	fromArg, err := service.Start(ctx, "conversation-trace-arg", "keep the supplied id", supplied)
	if err != nil {
		t.Fatal(err)
	}
	if fromArg.TraceID != supplied {
		t.Fatalf("Start(traceID) = %q, want %q", fromArg.TraceID, supplied)
	}

	fromContext, err := service.Start(
		WithTraceID(ctx, supplied),
		"conversation-trace-context",
		"keep the context id",
	)
	if err != nil {
		t.Fatal(err)
	}
	if fromContext.TraceID != supplied {
		t.Fatalf("Start(context) = %q, want %q", fromContext.TraceID, supplied)
	}

	replaced, err := service.Start(ctx, "conversation-trace-junk", "ignore junk", "conversation-1")
	if err != nil {
		t.Fatal(err)
	}
	if replaced.TraceID == "conversation-1" || !researchTraceIDPattern.MatchString(replaced.TraceID) {
		t.Fatalf("Start(junk) = %q, want a generated trc_ uuid", replaced.TraceID)
	}
}

func TestWorkerCompletionClaimsContinuationOnce(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store)
	ctx := context.Background()
	run, err := service.Start(ctx, "conversation-one", "compare the two standards")
	if err != nil {
		t.Fatal(err)
	}
	taskA, err := service.RegisterTask(ctx, run.ConversationID, run.ID, "collect standard A")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.RecordWorkerUpdates(ctx, run.ConversationID, run.ID, []WorkerUpdate{{
		ID:       taskA.ID,
		Prompt:   taskA.Prompt,
		Status:   "running",
		WorkerID: "worker-one",
	}}); err != nil {
		t.Fatal(err)
	}
	taskB, err := service.RegisterTask(ctx, run.ConversationID, run.ID, "collect standard B")
	if err != nil {
		t.Fatal(err)
	}

	updates := []WorkerUpdate{
		{ID: taskA.ID, Prompt: taskA.Prompt, Status: "running", WorkerID: "worker-one"},
		{ID: taskB.ID, Prompt: taskB.Prompt, Status: "running", WorkerID: "worker-two"},
	}
	if _, ready, err := service.RecordWorkerUpdates(ctx, run.ConversationID, run.ID, updates); err != nil || ready {
		t.Fatalf("RecordWorkerUpdates(start) = ready %v, error %v", ready, err)
	}
	run, err = service.SealBatch(ctx, run.ConversationID, run.ID)
	if err != nil || run.Phase != PhaseWaiting {
		t.Fatalf("SealBatch() = %#v, %v; want waiting", run, err)
	}

	updates[0].Status = "succeeded"
	updates[0].Result = "Standard A requires..."
	if _, ready, err := service.RecordWorkerUpdates(ctx, run.ConversationID, run.ID, updates); err != nil || ready {
		t.Fatalf("RecordWorkerUpdates(partial) = ready %v, error %v", ready, err)
	}
	updates[1].Status = "succeeded"
	updates[1].Result = "Standard B requires..."
	run, ready, err := service.RecordWorkerUpdates(ctx, run.ConversationID, run.ID, updates)
	if err != nil || !ready || run.Phase != PhaseSynthesisPending {
		t.Fatalf("RecordWorkerUpdates(terminal) = %#v, ready %v, error %v", run, ready, err)
	}
	run, claimed, err := service.ClaimContinuation(ctx, run.ConversationID, run.ID)
	if err != nil || !claimed || run.Phase != PhaseSynthesizing {
		t.Fatalf("ClaimContinuation() = %#v, claimed %v, error %v", run, claimed, err)
	}
	if _, claimed, err := service.ClaimContinuation(ctx, run.ConversationID, run.ID); err != nil || claimed {
		t.Fatalf("second ClaimContinuation() = claimed %v, error %v; want no second dispatch", claimed, err)
	}
}

func TestSealBatchRequiresRegisteredWorkerToHaveStarted(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store)
	ctx := context.Background()
	run, err := service.Start(ctx, "conversation-unlaunched", "verify the standard")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.RegisterTask(ctx, run.ConversationID, run.ID, "read the official standard"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SealBatch(ctx, run.ConversationID, run.ID); err == nil {
		t.Fatal("SealBatch() accepted a registered task without a Sidecar worker start")
	}
}

func TestGapFillIsOneBatchAndCompletesReport(t *testing.T) {
	dataDirectory := t.TempDir()
	store, err := OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store)
	ctx := context.Background()
	run, err := service.Start(ctx, "conversation-two", "compare public release dates")
	if err != nil {
		t.Fatal(err)
	}
	_, _, err = service.RecordWorkerUpdates(ctx, run.ConversationID, run.ID, []WorkerUpdate{
		{ID: "call-one", Prompt: "find primary source", Status: "succeeded", Result: "The source gives a release date."},
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err = service.SealBatch(ctx, run.ConversationID, run.ID)
	if err != nil || run.Phase != PhaseSynthesizing {
		t.Fatalf("SealBatch() = %#v, %v; want active synthesis", run, err)
	}
	run, err = service.BeginGapFill(ctx, run.ConversationID, run.ID)
	if err != nil || run.Phase != PhaseGapFillCollecting {
		t.Fatalf("BeginGapFill() = %#v, %v", run, err)
	}
	_, _, err = service.RecordWorkerUpdates(ctx, run.ConversationID, run.ID, []WorkerUpdate{
		{ID: "call-gap", Prompt: "resolve the date discrepancy", Status: "succeeded", Result: "The second source confirms the date."},
	})
	if err != nil {
		t.Fatal(err)
	}
	run, err = service.SealBatch(ctx, run.ConversationID, run.ID)
	if err != nil || run.Phase != PhaseFinalizing {
		t.Fatalf("gap-fill SealBatch() = %#v, %v; want final synthesis", run, err)
	}
	if _, err := service.BeginGapFill(ctx, run.ConversationID, run.ID); err == nil {
		t.Fatal("BeginGapFill() allowed a second gap-fill batch")
	}
	run, err = service.Complete(ctx, run.ConversationID, run.ID, "The primary sources agree on the release date.")
	if err != nil || run.Status != RunCompleted || run.Report == "" {
		t.Fatalf("Complete() = %#v, %v", run, err)
	}
	report, err := service.ReadReport(ctx, run.ConversationID, run.ID)
	if err != nil || report != run.Report {
		t.Fatalf("ReadReport() = %q, %v; want persisted report", report, err)
	}
	snapshot, err := service.Get(ctx, run.ConversationID, run.ID)
	if err != nil || snapshot.Run.Report != "" {
		t.Fatalf("Get() should leave the large report on its explicit read action: %#v, %v", snapshot.Run, err)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = OpenStore(dataDirectory)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service = NewService(store)
	report, err = service.ReadReport(ctx, run.ConversationID, run.ID)
	if err != nil || report != run.Report {
		t.Fatalf("ReadReport() after reopen = %q, %v", report, err)
	}
}

func TestRegisteredTaskStaysLaunchingUntilWorkerIdentityExists(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store)
	ctx := context.Background()
	run, err := service.Start(ctx, "conversation-launching", "verify launch lifecycle")
	if err != nil {
		t.Fatal(err)
	}
	registered, err := service.RegisterTask(ctx, run.ConversationID, run.ID, "read the official standard")
	if err != nil {
		t.Fatal(err)
	}
	if registered.Status != TaskLaunching || registered.WorkerID != "" {
		t.Fatalf("registered task = %#v; want launching without a worker identity", registered)
	}
	// A worker update without a concrete worker identity must not mark the task running.
	if _, _, err := service.RecordWorkerUpdates(ctx, run.ConversationID, run.ID, []WorkerUpdate{{
		ID:     registered.ID,
		Prompt: registered.Prompt,
		Status: "running",
	}}); err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.Get(ctx, run.ConversationID, run.ID)
	if err != nil || len(snapshot.Tasks) != 1 ||
		snapshot.Tasks[0].Status != TaskLaunching || snapshot.Tasks[0].WorkerID != "" {
		t.Fatalf("task without worker identity = %#v, %v; want still launching", snapshot.Tasks, err)
	}
	// Once the worker identity is known the task becomes running.
	if _, _, err := service.RecordWorkerUpdates(ctx, run.ConversationID, run.ID, []WorkerUpdate{{
		ID:       registered.ID,
		Prompt:   registered.Prompt,
		Status:   "running",
		WorkerID: "worker-one",
	}}); err != nil {
		t.Fatal(err)
	}
	snapshot, err = service.Get(ctx, run.ConversationID, run.ID)
	if err != nil || len(snapshot.Tasks) != 1 ||
		snapshot.Tasks[0].Status != TaskRunning || snapshot.Tasks[0].WorkerID != "worker-one" {
		t.Fatalf("task with worker identity = %#v, %v; want running", snapshot.Tasks, err)
	}
}

func TestRecoveryResumeAndCancel(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store)
	ctx := context.Background()
	run, err := service.Start(ctx, "conversation-three", "research interrupted tasks")
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := service.RecordWorkerUpdates(ctx, run.ConversationID, run.ID, []WorkerUpdate{
		{ID: "call-resume", Prompt: "compare two sources", Status: "running", WorkerID: "worker-old"},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := service.SealBatch(ctx, run.ConversationID, run.ID); err != nil {
		t.Fatal(err)
	}
	if err := service.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	snapshot, err := service.Get(ctx, run.ConversationID, run.ID)
	if err != nil || snapshot.Run.Status != RunInterrupted || len(snapshot.Tasks) != 1 ||
		snapshot.Tasks[0].Status != TaskInterrupted {
		t.Fatalf("Get() after recovery = %#v, %v", snapshot, err)
	}
	snapshot, err = service.Resume(ctx, run.ConversationID, run.ID)
	if err != nil || snapshot.Run.Status != RunRunning || snapshot.Run.Phase != PhaseCollecting {
		t.Fatalf("Resume() = %#v, %v", snapshot, err)
	}
	if snapshot.Tasks[0].Prompt != "compare two sources" {
		t.Fatalf("unfinished task prompt was not retained: %#v", snapshot.Tasks[0])
	}
	resumedTask, err := service.RegisterTask(ctx, run.ConversationID, run.ID, "compare two sources")
	if err != nil || resumedTask.ID != "call-resume" {
		t.Fatalf("RegisterTask() after resume = %#v, %v; want the original task", resumedTask, err)
	}
	if _, _, err := service.RecordWorkerUpdates(ctx, run.ConversationID, run.ID, []WorkerUpdate{{
		ID:       resumedTask.ID,
		Prompt:   resumedTask.Prompt,
		Status:   "running",
		WorkerID: "worker-new",
	}}); err != nil {
		t.Fatal(err)
	}
	snapshot, err = service.Get(ctx, run.ConversationID, run.ID)
	if err != nil || len(snapshot.Tasks) != 1 || snapshot.Tasks[0].ID != "call-resume" ||
		snapshot.Tasks[0].WorkerID != "worker-new" || snapshot.Tasks[0].Status != TaskRunning {
		t.Fatalf("resumed worker did not replace its interrupted task: %#v, %v", snapshot.Tasks, err)
	}
	run, err = service.Cancel(ctx, run.ConversationID, run.ID)
	if err != nil || run.Status != RunCancelled {
		t.Fatalf("Cancel() = %#v, %v", run, err)
	}
	snapshot, err = service.Get(ctx, run.ConversationID, run.ID)
	if err != nil || len(snapshot.Tasks) != 1 || snapshot.Tasks[0].Status != TaskCancelled {
		t.Fatalf("task status after cancel = %#v, %v", snapshot.Tasks, err)
	}
}

func TestResumeDoesNotCreateSecondActiveRunInConversation(t *testing.T) {
	store, err := OpenStore(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	service := NewService(store)
	ctx := context.Background()
	interrupted, err := service.Start(ctx, "conversation-four", "first query")
	if err != nil {
		t.Fatal(err)
	}
	if err := service.Recover(ctx); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Start(ctx, "conversation-four", "second query"); err != nil {
		t.Fatal(err)
	}
	if _, err := service.Resume(ctx, "conversation-four", interrupted.ID); err == nil {
		t.Fatal("Resume() allowed a second active run in the conversation")
	}
}
