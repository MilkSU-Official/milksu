package securityruntime

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestWalkingSkeletonCompletesOnlyAfterEvaluatorPasses(t *testing.T) {
	service, err := newTestService(t.TempDir(), 0)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()

	started, err := service.StartWalkingSkeleton(context.Background(), "Verify the fact chain")
	if err != nil {
		t.Fatal(err)
	}
	waitForJob(t, service, started.Job.ID)
	projection, err := service.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Job.Status != JobSucceeded || projection.Outcome == nil || projection.Outcome.Status != OutcomeSucceeded {
		t.Fatalf("unexpected outcome: %#v", projection)
	}
	if len(projection.Evaluations) != 1 || projection.Evaluations[0].Verdict != VerdictPass {
		t.Fatalf("expected one passing evaluation: %#v", projection.Evaluations)
	}
	if projection.Outcome.EvaluationID != projection.Evaluations[0].ID {
		t.Fatal("outcome does not reference the passing evaluation")
	}
	if len(projection.Artifacts) != 1 || len(projection.Evidence) != 1 || len(projection.Effects) != 1 {
		t.Fatalf("incomplete fact chain: artifacts=%d evidence=%d effects=%d",
			len(projection.Artifacts), len(projection.Evidence), len(projection.Effects))
	}
	if projection.Effects[0].State != "committed" {
		t.Fatalf("first effect state = %q", projection.Effects[0].State)
	}
	expectedKinds := []EventKind{
		EventJobCreated, EventAttemptStarted, EventEnvironmentPrepared, EventStepStarted,
		EventActionProposed, EventActionStarted, EventObservationCommitted, EventArtifactCommitted,
		EventEffectCommitted, EventActionCompleted, EventEvidenceLinked, EventStepCompleted,
		EventEvaluationRecorded, EventOutcomeDecided, EventAttemptCompleted, EventEnvironmentReleased,
		EventJobCompleted,
	}
	if len(projection.Events) != len(expectedKinds) {
		t.Fatalf("event count = %d, want %d", len(projection.Events), len(expectedKinds))
	}
	for index, kind := range expectedKinds {
		if projection.Events[index].Kind != kind {
			t.Fatalf("event[%d] = %s, want %s", index, projection.Events[index].Kind, kind)
		}
	}
}

func TestWalkingSkeletonCanBeCancelled(t *testing.T) {
	service, err := newTestService(t.TempDir(), 250*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()

	started, err := service.StartWalkingSkeleton(context.Background(), "Cancel the fact chain")
	if err != nil {
		t.Fatal(err)
	}
	if err := service.CancelJob(context.Background(), started.Job.ID); err != nil {
		t.Fatal(err)
	}
	waitForJob(t, service, started.Job.ID)
	projection, err := service.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Job.Status != JobCancelled || projection.Outcome == nil || projection.Outcome.Status != OutcomeCancelled {
		t.Fatalf("job was not cancelled: status=%s outcome=%#v", projection.Job.Status, projection.Outcome)
	}
	if len(projection.Evaluations) != 0 {
		t.Fatal("cancelled job must not invent an evaluation")
	}
}

func TestRecoverStartsNewAttemptAndReusesOrphanedArtifact(t *testing.T) {
	root := t.TempDir()
	first, err := newTestService(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	job := testJob("job_recovery")
	if _, err := first.append(context.Background(), EventDraft{
		JobID: job.ID, Kind: EventJobCreated, Payload: jobCreatedPayload{Job: job},
	}); err != nil {
		t.Fatal(err)
	}
	attempt := Attempt{
		ID: "attempt_crashed", JobID: job.ID, Engine: "fake-agent-engine", Model: "deterministic-fixture-v1",
		Environment: "fake-isolated-environment", Evaluator: "walking-skeleton-judge@1",
		Status: AttemptRunning, StartedAt: time.Now().UTC(),
	}
	if _, err := first.append(context.Background(), EventDraft{
		JobID: job.ID, AttemptID: attempt.ID, Kind: EventAttemptStarted, Payload: attemptPayload{Attempt: attempt},
	}); err != nil {
		t.Fatal(err)
	}
	result, err := (FakeCapability{}).Execute(context.Background(), Action{Capability: "fixture-inspector", Name: "fixture.inspect"})
	if err != nil {
		t.Fatal(err)
	}
	if _, created, err := first.artifacts.Put(context.Background(), job.ID, "action_crashed", result.Artifacts[0].MediaType, result.Artifacts[0].Data); err != nil || !created {
		t.Fatalf("write orphaned effect: created=%v err=%v", created, err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second, err := newTestService(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if err := second.Recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitForJob(t, second, job.ID)
	projection, err := second.GetJob(context.Background(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Job.Status != JobSucceeded || len(projection.Attempts) != 2 {
		t.Fatalf("recovery did not complete in a new attempt: status=%s attempts=%d", projection.Job.Status, len(projection.Attempts))
	}
	if projection.Attempts[0].Status != AttemptInterrupted || projection.Attempts[1].Status != AttemptCompleted {
		t.Fatalf("unexpected attempt states: %#v", projection.Attempts)
	}
	if len(projection.Effects) != 1 || projection.Effects[0].State != "reused" {
		t.Fatalf("orphaned effect was not reused: %#v", projection.Effects)
	}
	if len(projection.Artifacts) != 1 {
		t.Fatalf("expected one committed artifact event, got %d", len(projection.Artifacts))
	}
}

func TestRecoverReusesAlreadyCommittedArtifactIdentity(t *testing.T) {
	root := t.TempDir()
	first, err := newTestService(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	job := testJob("job_committed_artifact")
	if _, err := first.append(context.Background(), EventDraft{
		JobID: job.ID, Kind: EventJobCreated, Payload: jobCreatedPayload{Job: job},
	}); err != nil {
		t.Fatal(err)
	}
	attempt := Attempt{
		ID: "attempt_crashed", JobID: job.ID, Engine: "fake-agent-engine", Model: "deterministic-fixture-v1",
		Environment: "fake-isolated-environment", Evaluator: "walking-skeleton-judge@1",
		Status: AttemptRunning, StartedAt: time.Now().UTC(),
	}
	if _, err := first.append(context.Background(), EventDraft{
		JobID: job.ID, AttemptID: attempt.ID, Kind: EventAttemptStarted, Payload: attemptPayload{Attempt: attempt},
	}); err != nil {
		t.Fatal(err)
	}
	step := Step{ID: "step_crashed", AttemptID: attempt.ID, Name: "crashed", Status: StepRunning, StartedAt: time.Now().UTC()}
	if _, err := first.append(context.Background(), EventDraft{
		JobID: job.ID, AttemptID: attempt.ID, StepID: step.ID, Kind: EventStepStarted, Payload: stepPayload{Step: step},
	}); err != nil {
		t.Fatal(err)
	}
	proposal, err := (FakeAgentEngine{}).Propose(context.Background(), EngineInput{Projection: JobProjection{Job: job}, Attempt: attempt, Step: step})
	if err != nil {
		t.Fatal(err)
	}
	action := Action{
		ID: "action_crashed", StepID: step.ID, Capability: proposal.Capability, Name: proposal.Name,
		Input: proposal.Input, ExpectedEffect: proposal.ExpectedEffect, Status: ActionProposed,
	}
	if _, err := first.append(context.Background(), EventDraft{
		JobID: job.ID, AttemptID: attempt.ID, StepID: step.ID, Kind: EventActionProposed, Payload: actionPayload{Action: action},
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := first.append(context.Background(), EventDraft{
		JobID: job.ID, AttemptID: attempt.ID, StepID: step.ID, Kind: EventActionStarted,
		Payload: actionStatePayload{ActionID: action.ID},
	}); err != nil {
		t.Fatal(err)
	}
	result, err := (FakeCapability{}).Execute(context.Background(), action)
	if err != nil {
		t.Fatal(err)
	}
	observation := Observation{ID: "observation_crashed", ActionID: action.ID, Summary: result.Summary, MediaType: result.MediaType, Complete: true}
	if _, err := first.append(context.Background(), EventDraft{
		JobID: job.ID, AttemptID: attempt.ID, StepID: step.ID, Kind: EventObservationCommitted,
		Payload: observationPayload{Observation: observation},
	}); err != nil {
		t.Fatal(err)
	}
	artifact, created, err := first.artifacts.Put(context.Background(), job.ID, action.ID, result.Artifacts[0].MediaType, result.Artifacts[0].Data)
	if err != nil || !created {
		t.Fatalf("commit artifact: created=%v err=%v", created, err)
	}
	if _, err := first.append(context.Background(), EventDraft{
		JobID: job.ID, AttemptID: attempt.ID, StepID: step.ID, Kind: EventArtifactCommitted,
		Payload: artifactPayload{Artifact: artifact, Created: true},
	}); err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second, err := newTestService(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if err := second.Recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitForJob(t, second, job.ID)
	projection, err := second.GetJob(context.Background(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Job.Status != JobSucceeded {
		t.Fatalf("recovery did not complete: %s", projection.Job.Status)
	}
	if len(projection.Artifacts) != 1 || len(projection.Effects) != 1 || projection.Effects[0].State != "reused" {
		t.Fatalf("committed artifact was not reused cleanly: artifacts=%d effects=%#v", len(projection.Artifacts), projection.Effects)
	}
}

func TestApplicationCloseLeavesActiveJobRecoverable(t *testing.T) {
	root := t.TempDir()
	first, err := newTestService(root, 250*time.Millisecond)
	if err != nil {
		t.Fatal(err)
	}
	started, err := first.StartWalkingSkeleton(context.Background(), "Resume after app close")
	if err != nil {
		t.Fatal(err)
	}
	if err := first.Close(); err != nil {
		t.Fatal(err)
	}

	second, err := newTestService(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if err := second.Recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	waitForJob(t, second, started.Job.ID)
	projection, err := second.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Job.Status != JobSucceeded {
		t.Fatalf("closed job did not recover: %s", projection.Job.Status)
	}
	foundRecovery := false
	for _, event := range projection.Events {
		if event.Kind == EventJobRecoveryStarted {
			foundRecovery = true
		}
	}
	if !foundRecovery {
		t.Fatal("recovered job has no recovery event")
	}
}

func TestRecoveryFinalizesCommittedOutcomeWithoutRerunningEvaluator(t *testing.T) {
	root := t.TempDir()
	environment := &blockingReleaseEnvironment{reached: make(chan struct{}), unblock: make(chan struct{})}
	first, err := newService(root, ServiceOptions{
		Engine: FakeAgentEngine{}, Capability: FakeCapability{}, Environment: environment,
		Evaluator: FakeEvaluator{}, StepDelay: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	started, err := first.StartWalkingSkeleton(context.Background(), "Finalize committed outcome")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-environment.reached:
	case <-time.After(5 * time.Second):
		t.Fatal("runner did not reach environment release")
	}
	if err := first.store.Close(); err != nil {
		t.Fatal(err)
	}
	close(environment.unblock)
	waitForJob(t, first, started.Job.ID)
	_ = first.Close()

	second, err := newTestService(root, 0)
	if err != nil {
		t.Fatal(err)
	}
	defer second.Close()
	if err := second.Recover(context.Background()); err != nil {
		t.Fatal(err)
	}
	projection, err := second.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Job.Status != JobSucceeded {
		t.Fatalf("committed outcome was not finalized: %s", projection.Job.Status)
	}
	if len(projection.Attempts) != 1 || len(projection.Evaluations) != 1 {
		t.Fatalf("recovery reran completed work: attempts=%d evaluations=%d", len(projection.Attempts), len(projection.Evaluations))
	}
}

func TestLateCancellationDoesNotReplaceCommittedOutcome(t *testing.T) {
	root := t.TempDir()
	environment := &blockingReleaseEnvironment{reached: make(chan struct{}), unblock: make(chan struct{})}
	service, err := newService(root, ServiceOptions{
		Engine: FakeAgentEngine{}, Capability: FakeCapability{}, Environment: environment,
		Evaluator: FakeEvaluator{}, StepDelay: 0,
	})
	if err != nil {
		t.Fatal(err)
	}
	defer service.Close()
	started, err := service.StartWalkingSkeleton(context.Background(), "Keep committed outcome")
	if err != nil {
		t.Fatal(err)
	}
	select {
	case <-environment.reached:
	case <-time.After(5 * time.Second):
		t.Fatal("runner did not reach environment release")
	}
	if err := service.CancelJob(context.Background(), started.Job.ID); err != nil {
		t.Fatal(err)
	}
	close(environment.unblock)
	waitForJob(t, service, started.Job.ID)
	projection, err := service.GetJob(context.Background(), started.Job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if projection.Job.Status != JobSucceeded || projection.Outcome == nil || projection.Outcome.Status != OutcomeSucceeded {
		t.Fatalf("late cancellation replaced committed outcome: status=%s outcome=%#v", projection.Job.Status, projection.Outcome)
	}
	for _, event := range projection.Events {
		if event.Kind == EventJobCancelRequested {
			t.Fatal("late cancellation was persisted after outcome")
		}
	}
}

func newTestService(root string, delay time.Duration) (*Service, error) {
	return newService(root, ServiceOptions{
		Engine: FakeAgentEngine{}, Capability: FakeCapability{}, Environment: FakeEnvironment{},
		Evaluator: FakeEvaluator{}, StepDelay: delay,
	})
}

func waitForJob(t *testing.T, service *Service, jobID string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := service.Wait(ctx, jobID); err != nil {
		t.Fatal(err)
	}
}

type blockingReleaseEnvironment struct {
	reached chan struct{}
	unblock chan struct{}
	once    sync.Once
}

func (environment *blockingReleaseEnvironment) Name() string {
	return "blocking-release-environment"
}

func (environment *blockingReleaseEnvironment) Prepare(_ context.Context, job Job, attempt Attempt) (EnvironmentLease, error) {
	return EnvironmentLease{ID: "env:" + attempt.ID, Provider: "fake", Target: "fixture:" + job.ID, Resettable: true}, nil
}

func (environment *blockingReleaseEnvironment) Release(context.Context, EnvironmentLease) error {
	first := false
	environment.once.Do(func() {
		first = true
		close(environment.reached)
	})
	if first {
		<-environment.unblock
	}
	return nil
}
