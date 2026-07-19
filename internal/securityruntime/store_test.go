package securityruntime

import (
	"context"
	"sync"
	"testing"
	"time"
)

func TestEventStoreIsAppendOnlyAndSequencesConcurrentWrites(t *testing.T) {
	store, err := OpenEventStore(t.TempDir() + "/events.sqlite3")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	job := testJob("job_sequence")
	if _, err := store.Append(context.Background(), EventDraft{
		JobID: job.ID, Kind: EventJobCreated, Payload: jobCreatedPayload{Job: job},
	}); err != nil {
		t.Fatal(err)
	}

	const writers = 12
	var wait sync.WaitGroup
	errors := make(chan error, writers)
	for range writers {
		wait.Add(1)
		go func() {
			defer wait.Done()
			_, err := store.Append(context.Background(), EventDraft{
				JobID: job.ID, Kind: EventJobRecoveryStarted, Payload: recoveryPayload{},
			})
			errors <- err
		}()
	}
	wait.Wait()
	close(errors)
	for err := range errors {
		if err != nil {
			t.Fatal(err)
		}
	}

	events, err := store.Events(context.Background(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != writers+1 {
		t.Fatalf("expected %d events, got %d", writers+1, len(events))
	}
	for index, event := range events {
		if event.Sequence != int64(index+1) {
			t.Fatalf("sequence[%d] = %d", index, event.Sequence)
		}
	}

	if _, err := store.db.Exec(`UPDATE events SET kind = kind WHERE job_id = ?`, job.ID); err == nil {
		t.Fatal("append-only trigger allowed UPDATE")
	}
	if _, err := store.db.Exec(`DELETE FROM events WHERE job_id = ?`, job.ID); err == nil {
		t.Fatal("append-only trigger allowed DELETE")
	}
}

func TestEventStoreRejectsSucceededOutcomeWithoutPassingEvaluation(t *testing.T) {
	store, err := OpenEventStore(t.TempDir() + "/events.sqlite3")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	job := testJob("job_invariant")
	if _, err := store.Append(context.Background(), EventDraft{
		JobID: job.ID, Kind: EventJobCreated, Payload: jobCreatedPayload{Job: job},
	}); err != nil {
		t.Fatal(err)
	}
	_, err = store.Append(context.Background(), EventDraft{
		JobID: job.ID,
		Kind:  EventOutcomeDecided,
		Payload: outcomePayload{Outcome: Outcome{
			Status: OutcomeSucceeded, EvaluationID: "evaluation_missing",
		}},
	})
	if err == nil {
		t.Fatal("store accepted model-style self-reported success")
	}
	events, listErr := store.Events(context.Background(), job.ID)
	if listErr != nil {
		t.Fatal(listErr)
	}
	if len(events) != 1 {
		t.Fatalf("invalid event was persisted: %d events", len(events))
	}
}

func TestEventStoreRejectsMismatchedObjectReferences(t *testing.T) {
	store, err := OpenEventStore(t.TempDir() + "/events.sqlite3")
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	job := testJob("job_reference")
	if _, err := store.Append(context.Background(), EventDraft{
		JobID: job.ID, Kind: EventJobCreated, Payload: jobCreatedPayload{Job: job},
	}); err != nil {
		t.Fatal(err)
	}
	attempt := Attempt{
		ID: "attempt_one", JobID: job.ID, Engine: "test", Model: "test", Environment: "test",
		Evaluator: "test@1", Status: AttemptRunning, StartedAt: time.Now().UTC(),
	}
	if _, err := store.Append(context.Background(), EventDraft{
		JobID: job.ID, AttemptID: attempt.ID, Kind: EventAttemptStarted, Payload: attemptPayload{Attempt: attempt},
	}); err != nil {
		t.Fatal(err)
	}
	step := Step{ID: "step_one", AttemptID: attempt.ID, Name: "test", Status: StepRunning, StartedAt: time.Now().UTC()}
	if _, err := store.Append(context.Background(), EventDraft{
		JobID: job.ID, AttemptID: "attempt_other", StepID: step.ID,
		Kind: EventStepStarted, Payload: stepPayload{Step: step},
	}); err == nil {
		t.Fatal("store accepted a step whose event and payload attempts disagree")
	}
	events, err := store.Events(context.Background(), job.ID)
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 2 {
		t.Fatalf("invalid reference was persisted: %d events", len(events))
	}
}

func testJob(id string) Job {
	now := time.Now().UTC()
	return Job{
		ID: id, Title: "M1 contract test", Role: "system.walking-skeleton",
		CollaborationMode: "delegate", Status: JobQueued, CreatedAt: now, UpdatedAt: now,
	}
}
