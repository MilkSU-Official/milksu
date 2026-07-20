package securityruntime

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

var (
	errUserCancelled = errors.New("job cancelled by user")
	errAppShutdown   = errors.New("application shutdown")
)

type ServiceOptions struct {
	Engine      AgentEngine
	Capability  Capability
	Environment Environment
	Evaluator   Evaluator
	StepDelay   time.Duration
	OnEvent     func(Event)
}

type activeRun struct {
	cancel context.CancelCauseFunc
	done   chan struct{}
}

type runState struct {
	attempt *Attempt
	step    *Step
	action  *Action
	lease   *EnvironmentLease
}

type Service struct {
	store       *EventStore
	artifacts   *ArtifactStore
	engine      AgentEngine
	capability  Capability
	environment Environment
	evaluator   Evaluator
	stepDelay   time.Duration
	emit        func(Event)

	mu     sync.Mutex
	active map[string]*activeRun
	closed bool
	wg     sync.WaitGroup
}

func NewService(root string, onEvent func(Event)) (*Service, error) {
	return newService(root, ServiceOptions{
		Engine:      FakeAgentEngine{},
		Capability:  FakeCapability{},
		Environment: FakeEnvironment{},
		Evaluator:   FakeEvaluator{},
		StepDelay:   450 * time.Millisecond,
		OnEvent:     onEvent,
	})
}

func newService(root string, options ServiceOptions) (*Service, error) {
	if options.Engine == nil || options.Capability == nil || options.Environment == nil || options.Evaluator == nil {
		return nil, fmt.Errorf("runtime engine, capability, environment, and evaluator are required")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return nil, fmt.Errorf("create runtime directory: %w", err)
	}
	store, err := OpenEventStore(filepath.Join(root, "events.sqlite3"))
	if err != nil {
		return nil, err
	}
	artifacts, err := NewArtifactStore(filepath.Join(root, "artifacts"))
	if err != nil {
		store.Close()
		return nil, err
	}
	return &Service{
		store:       store,
		artifacts:   artifacts,
		engine:      options.Engine,
		capability:  options.Capability,
		environment: options.Environment,
		evaluator:   options.Evaluator,
		stepDelay:   options.StepDelay,
		emit:        options.OnEvent,
		active:      make(map[string]*activeRun),
	}, nil
}

func (s *Service) StartWalkingSkeleton(ctx context.Context, title string) (JobProjection, error) {
	title, err := validateTitle(title)
	if err != nil {
		return JobProjection{}, err
	}
	s.mu.Lock()
	closed := s.closed
	s.mu.Unlock()
	if closed {
		return JobProjection{}, fmt.Errorf("runtime is closed")
	}

	now := time.Now().UTC()
	job := Job{
		ID:                newID("job"),
		Title:             title,
		Role:              WalkingSkeletonRole,
		CollaborationMode: "delegate",
		Status:            JobQueued,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if _, err := s.append(ctx, EventDraft{
		JobID:   job.ID,
		Kind:    EventJobCreated,
		Payload: jobCreatedPayload{Job: job},
	}); err != nil {
		return JobProjection{}, err
	}
	if err := s.startRunner(job.ID); err != nil {
		return JobProjection{}, err
	}
	return s.store.Projection(ctx, job.ID)
}

func (s *Service) CancelJob(ctx context.Context, jobID string) error {
	projection, err := s.store.Projection(ctx, jobID)
	if err != nil {
		return err
	}
	if projection.Terminal() {
		return nil
	}
	// Once an evaluator-backed outcome is committed it is the authoritative
	// result. The runner (or startup recovery) only has terminal bookkeeping
	// left, so a late cancel must not create a competing outcome.
	if projection.Outcome != nil {
		return nil
	}
	if _, err := s.append(ctx, EventDraft{
		JobID:   jobID,
		Kind:    EventJobCancelRequested,
		Payload: reasonPayload{Reason: errUserCancelled.Error()},
	}); err != nil {
		return err
	}

	s.mu.Lock()
	run := s.active[jobID]
	s.mu.Unlock()
	if run != nil {
		run.cancel(errUserCancelled)
		return nil
	}
	return s.finishCancellation(jobID, runState{})
}

func (s *Service) Recover(ctx context.Context) error {
	projections, err := s.store.Projections(ctx)
	if err != nil {
		return err
	}
	for _, projection := range projections {
		if projection.Job.Role != WalkingSkeletonRole || projection.Terminal() {
			continue
		}
		if projection.Outcome != nil {
			if err := s.completeCommittedOutcome(ctx, projection); err != nil {
				return err
			}
			continue
		}
		if projection.Job.Status == JobCancelling {
			if err := s.finishCancellation(projection.Job.ID, stateFromProjection(projection)); err != nil {
				return err
			}
			continue
		}

		state := stateFromProjection(projection)
		previousAttemptID := ""
		if state.attempt != nil {
			previousAttemptID = state.attempt.ID
			if state.attempt.Status == AttemptRunning {
				if _, err := s.append(ctx, EventDraft{
					JobID:     projection.Job.ID,
					AttemptID: previousAttemptID,
					Kind:      EventAttemptInterrupted,
					Payload: attemptStatePayload{
						AttemptID: previousAttemptID,
						Reason:    "previous process ended before the attempt reached a terminal event",
					},
				}); err != nil {
					return err
				}
			}
		}
		if _, err := s.append(ctx, EventDraft{
			JobID: projection.Job.ID,
			Kind:  EventJobRecoveryStarted,
			Payload: recoveryPayload{
				PreviousAttemptID: previousAttemptID,
			},
		}); err != nil {
			return err
		}
		if err := s.startRunner(projection.Job.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) completeCommittedOutcome(ctx context.Context, projection JobProjection) error {
	state := stateFromProjection(projection)
	if state.attempt != nil && state.attempt.Status == AttemptRunning {
		attemptKind := EventAttemptCompleted
		if projection.Outcome.Status == OutcomeCancelled {
			attemptKind = EventAttemptInterrupted
		}
		if _, err := s.append(ctx, EventDraft{
			JobID:     projection.Job.ID,
			AttemptID: state.attempt.ID,
			Kind:      attemptKind,
			Payload: attemptStatePayload{
				AttemptID: state.attempt.ID,
				Reason:    "recovery finalized an already committed outcome",
			},
		}); err != nil {
			return err
		}
	}
	terminalKind := EventJobFailed
	if projection.Outcome.Status == OutcomeSucceeded {
		terminalKind = EventJobCompleted
	} else if projection.Outcome.Status == OutcomeCancelled {
		terminalKind = EventJobCancelled
	}
	_, err := s.append(ctx, EventDraft{
		JobID: projection.Job.ID,
		Kind:  terminalKind,
		Payload: reasonPayload{
			Reason: "recovery finalized an already committed outcome",
		},
	})
	return err
}

func (s *Service) ListJobs(ctx context.Context) ([]JobSummary, error) {
	projections, err := s.store.Projections(ctx)
	if err != nil {
		return nil, err
	}
	values := make([]JobSummary, 0, len(projections))
	for _, projection := range projections {
		values = append(values, projection.Summary())
	}
	sort.Slice(values, func(i, j int) bool { return values[i].UpdatedAt.After(values[j].UpdatedAt) })
	return values, nil
}

func (s *Service) GetJob(ctx context.Context, jobID string) (JobProjection, error) {
	return s.store.Projection(ctx, jobID)
}

func (s *Service) Wait(ctx context.Context, jobID string) error {
	s.mu.Lock()
	run := s.active[jobID]
	s.mu.Unlock()
	if run == nil {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-run.done:
		return nil
	}
}

func (s *Service) startRunner(jobID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("runtime is closed")
	}
	if _, exists := s.active[jobID]; exists {
		return nil
	}
	ctx, cancel := context.WithCancelCause(context.Background())
	run := &activeRun{cancel: cancel, done: make(chan struct{})}
	s.active[jobID] = run
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		state, err := s.runJob(ctx, jobID)
		if err != nil {
			_ = s.finalizeRunError(jobID, state, context.Cause(ctx), err)
		}
		s.mu.Lock()
		delete(s.active, jobID)
		close(run.done)
		s.mu.Unlock()
	}()
	return nil
}

func (s *Service) runJob(ctx context.Context, jobID string) (state runState, resultErr error) {
	projection, err := s.store.Projection(ctx, jobID)
	if err != nil {
		return state, err
	}
	attempt := Attempt{
		ID:          newID("attempt"),
		JobID:       jobID,
		Engine:      s.engine.Name(),
		Model:       s.engine.Model(),
		Environment: s.environment.Name(),
		Evaluator:   s.evaluator.Name() + "@" + s.evaluator.Version(),
		Status:      AttemptRunning,
		StartedAt:   time.Now().UTC(),
	}
	if _, err := s.append(ctx, EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		Kind:      EventAttemptStarted,
		Payload:   attemptPayload{Attempt: attempt},
	}); err != nil {
		return state, err
	}
	state.attempt = &attempt
	if err := s.pause(ctx); err != nil {
		return state, err
	}

	lease, err := s.environment.Prepare(ctx, projection.Job, attempt)
	if err != nil {
		return state, fmt.Errorf("prepare environment: %w", err)
	}
	state.lease = &lease
	if _, err := s.append(ctx, EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		Kind:      EventEnvironmentPrepared,
		Payload:   environmentPayload{Lease: lease},
	}); err != nil {
		return state, err
	}
	if err := s.pause(ctx); err != nil {
		return state, err
	}

	step := Step{
		ID:          newID("step"),
		AttemptID:   attempt.ID,
		Name:        "verify-persisted-fact-chain",
		Description: "让 Capability 产出原始事实，再由独立 Evaluator 判定",
		Status:      StepRunning,
		StartedAt:   time.Now().UTC(),
	}
	if _, err := s.append(ctx, EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		StepID:    step.ID,
		Kind:      EventStepStarted,
		Payload:   stepPayload{Step: step},
	}); err != nil {
		return state, err
	}
	state.step = &step

	projection, err = s.store.Projection(ctx, jobID)
	if err != nil {
		return state, err
	}
	proposal, err := s.engine.Propose(ctx, EngineInput{Projection: projection, Attempt: attempt, Step: step})
	if err != nil {
		return state, fmt.Errorf("engine propose: %w", err)
	}
	if proposal.Capability != s.capability.Name() {
		return state, fmt.Errorf("engine proposed unavailable capability %q", proposal.Capability)
	}
	action := Action{
		ID:             newID("action"),
		StepID:         step.ID,
		Capability:     proposal.Capability,
		Name:           proposal.Name,
		Input:          proposal.Input,
		Rationale:      proposal.Rationale,
		ExpectedEffect: proposal.ExpectedEffect,
		Status:         ActionProposed,
	}
	if _, err := s.append(ctx, EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		StepID:    step.ID,
		Kind:      EventActionProposed,
		Payload:   actionPayload{Action: action},
	}); err != nil {
		return state, err
	}
	state.action = &action
	if _, err := s.append(ctx, EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		StepID:    step.ID,
		Kind:      EventActionStarted,
		Payload:   actionStatePayload{ActionID: action.ID},
	}); err != nil {
		return state, err
	}
	if err := s.pause(ctx); err != nil {
		return state, err
	}

	capabilityResult, err := s.capability.Execute(ctx, action)
	if err != nil {
		return state, fmt.Errorf("execute capability: %w", err)
	}
	if len(capabilityResult.Artifacts) != 1 {
		return state, fmt.Errorf("walking skeleton capability must produce one artifact")
	}
	observation := Observation{
		ID:        newID("observation"),
		ActionID:  action.ID,
		Summary:   capabilityResult.Summary,
		MediaType: capabilityResult.MediaType,
		Complete:  capabilityResult.Complete,
	}
	if _, err := s.appendCommitted(EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		StepID:    step.ID,
		Kind:      EventObservationCommitted,
		Payload:   observationPayload{Observation: observation},
	}); err != nil {
		return state, err
	}

	artifactDraft := capabilityResult.Artifacts[0]
	artifact, created, err := s.artifacts.Put(context.Background(), jobID, action.ID, artifactDraft.MediaType, artifactDraft.Data)
	if err != nil {
		return state, fmt.Errorf("commit artifact: %w", err)
	}
	artifactAlreadyCommitted := false
	if !created {
		current, projectionErr := s.store.Projection(context.Background(), jobID)
		if projectionErr != nil {
			return state, projectionErr
		}
		for _, existing := range current.Artifacts {
			if existing.SHA256 == artifact.SHA256 && existing.MediaType == artifact.MediaType {
				artifact = existing
				artifactAlreadyCommitted = true
				break
			}
		}
	}
	if !artifactAlreadyCommitted {
		if _, err := s.appendCommitted(EventDraft{
			JobID:     jobID,
			AttemptID: attempt.ID,
			StepID:    step.ID,
			Kind:      EventArtifactCommitted,
			Payload:   artifactPayload{Artifact: artifact, Created: created},
		}); err != nil {
			return state, err
		}
	}
	effectState := "committed"
	effectKind := EventEffectCommitted
	if !created {
		effectState = "reused"
		effectKind = EventEffectReused
	}
	effect := Effect{
		ID:             newID("effect"),
		ActionID:       action.ID,
		Class:          action.ExpectedEffect.Class,
		IdempotencyKey: action.ExpectedEffect.IdempotencyKey,
		State:          effectState,
		Cleanup:        action.ExpectedEffect.Cleanup,
		ArtifactID:     artifact.ID,
	}
	if _, err := s.appendCommitted(EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		StepID:    step.ID,
		Kind:      effectKind,
		Payload:   effectPayload{Effect: effect},
	}); err != nil {
		return state, err
	}
	if _, err := s.appendCommitted(EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		StepID:    step.ID,
		Kind:      EventActionCompleted,
		Payload:   actionStatePayload{ActionID: action.ID},
	}); err != nil {
		return state, err
	}
	if err := ctx.Err(); err != nil {
		return state, err
	}

	evidence := Evidence{
		ID:             newID("evidence"),
		Claim:          "固定材料产生了一个可由外部判分器核对的候选结果",
		ObservationIDs: []string{observation.ID},
		ArtifactIDs:    []string{artifact.ID},
		Provenance:     "fake capability output committed by MilkSU Runtime",
	}
	if _, err := s.append(ctx, EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		StepID:    step.ID,
		Kind:      EventEvidenceLinked,
		Payload:   evidencePayload{Evidence: evidence},
	}); err != nil {
		return state, err
	}
	if _, err := s.append(ctx, EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		StepID:    step.ID,
		Kind:      EventStepCompleted,
		Payload:   stepStatePayload{StepID: step.ID},
	}); err != nil {
		return state, err
	}
	if err := s.pause(ctx); err != nil {
		return state, err
	}

	projection, err = s.store.Projection(ctx, jobID)
	if err != nil {
		return state, err
	}
	decision, err := s.evaluator.Evaluate(ctx, EvaluationInput{
		Projection: projection,
		Evidence:   evidence,
		Reader:     s.artifacts,
	})
	if err != nil {
		return state, fmt.Errorf("evaluate evidence: %w", err)
	}
	evaluation := Evaluation{
		ID:          newID("evaluation"),
		Evaluator:   s.evaluator.Name(),
		Version:     s.evaluator.Version(),
		Verdict:     decision.Verdict,
		Score:       decision.Score,
		Summary:     decision.Summary,
		EvidenceIDs: []string{evidence.ID},
	}
	if _, err := s.append(ctx, EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		Kind:      EventEvaluationRecorded,
		Payload:   evaluationPayload{Evaluation: evaluation},
	}); err != nil {
		return state, err
	}
	outcomeStatus := OutcomeFailed
	if decision.Verdict == VerdictPass {
		outcomeStatus = OutcomeSucceeded
	}
	outcome := Outcome{
		Status:       outcomeStatus,
		Summary:      decision.Summary,
		EvaluationID: evaluation.ID,
	}
	if _, err := s.append(ctx, EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		Kind:      EventOutcomeDecided,
		Payload:   outcomePayload{Outcome: outcome},
	}); err != nil {
		return state, err
	}
	if _, err := s.append(ctx, EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		Kind:      EventAttemptCompleted,
		Payload:   attemptStatePayload{AttemptID: attempt.ID},
	}); err != nil {
		return state, err
	}
	if err := s.releaseLease(jobID, attempt.ID, lease); err != nil {
		return state, err
	}
	state.lease = nil
	terminalKind := EventJobFailed
	if outcomeStatus == OutcomeSucceeded {
		terminalKind = EventJobCompleted
	}
	if _, err := s.append(ctx, EventDraft{
		JobID:     jobID,
		AttemptID: attempt.ID,
		Kind:      terminalKind,
		Payload:   reasonPayload{Reason: decision.Summary},
	}); err != nil {
		return state, err
	}
	return state, nil
}

func (s *Service) finalizeRunError(jobID string, state runState, cause, runErr error) error {
	if state.lease != nil && state.attempt != nil {
		_ = s.releaseLease(jobID, state.attempt.ID, *state.lease)
	}
	projection, projectionErr := s.store.Projection(context.Background(), jobID)
	if projectionErr == nil && projection.Outcome != nil {
		return s.completeCommittedOutcome(context.Background(), projection)
	}
	if errors.Is(cause, errUserCancelled) || errors.Is(runErr, errUserCancelled) {
		return s.finishCancellation(jobID, state)
	}
	if errors.Is(cause, errAppShutdown) || errors.Is(runErr, context.Canceled) {
		if state.attempt == nil {
			return nil
		}
		_, err := s.appendCommitted(EventDraft{
			JobID:     jobID,
			AttemptID: state.attempt.ID,
			Kind:      EventAttemptInterrupted,
			Payload: attemptStatePayload{
				AttemptID: state.attempt.ID,
				Reason:    "application stopped; job remains recoverable",
			},
		})
		return err
	}

	reason := runErr.Error()
	if state.action != nil && state.attempt != nil && state.step != nil {
		_, _ = s.appendCommitted(EventDraft{
			JobID: jobID, AttemptID: state.attempt.ID, StepID: state.step.ID,
			Kind: EventActionFailed, Payload: actionStatePayload{ActionID: state.action.ID, Reason: reason},
		})
	}
	if state.step != nil && state.attempt != nil {
		_, _ = s.appendCommitted(EventDraft{
			JobID: jobID, AttemptID: state.attempt.ID, StepID: state.step.ID,
			Kind: EventStepFailed, Payload: stepStatePayload{StepID: state.step.ID, Reason: reason},
		})
	}
	if state.attempt != nil {
		_, _ = s.appendCommitted(EventDraft{
			JobID: jobID, AttemptID: state.attempt.ID,
			Kind: EventAttemptFailed, Payload: attemptStatePayload{AttemptID: state.attempt.ID, Reason: reason},
		})
	}
	outcome := Outcome{Status: OutcomeFailed, Summary: reason}
	_, _ = s.appendCommitted(EventDraft{JobID: jobID, Kind: EventOutcomeDecided, Payload: outcomePayload{Outcome: outcome}})
	_, err := s.appendCommitted(EventDraft{JobID: jobID, Kind: EventJobFailed, Payload: reasonPayload{Reason: reason}})
	return err
}

func (s *Service) finishCancellation(jobID string, state runState) error {
	if state.attempt != nil && state.attempt.Status == AttemptRunning {
		if _, err := s.appendCommitted(EventDraft{
			JobID:     jobID,
			AttemptID: state.attempt.ID,
			Kind:      EventAttemptInterrupted,
			Payload: attemptStatePayload{
				AttemptID: state.attempt.ID,
				Reason:    errUserCancelled.Error(),
			},
		}); err != nil {
			return err
		}
	}
	outcome := Outcome{Status: OutcomeCancelled, Summary: "任务已由用户取消"}
	if _, err := s.appendCommitted(EventDraft{
		JobID: jobID, Kind: EventOutcomeDecided, Payload: outcomePayload{Outcome: outcome},
	}); err != nil {
		return err
	}
	_, err := s.appendCommitted(EventDraft{
		JobID: jobID, Kind: EventJobCancelled, Payload: reasonPayload{Reason: errUserCancelled.Error()},
	})
	return err
}

func (s *Service) releaseLease(jobID, attemptID string, lease EnvironmentLease) error {
	if err := s.environment.Release(context.Background(), lease); err != nil {
		return fmt.Errorf("release environment: %w", err)
	}
	_, err := s.appendCommitted(EventDraft{
		JobID: jobID, AttemptID: attemptID, Kind: EventEnvironmentReleased,
		Payload: environmentPayload{Lease: lease},
	})
	return err
}

func (s *Service) pause(ctx context.Context) error {
	if s.stepDelay <= 0 {
		return ctx.Err()
	}
	timer := time.NewTimer(s.stepDelay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func (s *Service) append(ctx context.Context, draft EventDraft) (Event, error) {
	event, err := s.store.Append(ctx, draft)
	if err == nil && s.emit != nil {
		s.emit(event)
	}
	return event, err
}

func (s *Service) appendCommitted(draft EventDraft) (Event, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return s.append(ctx, draft)
}

func stateFromProjection(projection JobProjection) runState {
	state := runState{}
	if len(projection.Attempts) > 0 {
		attempt := projection.Attempts[len(projection.Attempts)-1]
		state.attempt = &attempt
	}
	if len(projection.Steps) > 0 && state.attempt != nil {
		for index := len(projection.Steps) - 1; index >= 0; index-- {
			if projection.Steps[index].AttemptID == state.attempt.ID {
				step := projection.Steps[index]
				state.step = &step
				break
			}
		}
	}
	if len(projection.Actions) > 0 && state.step != nil {
		for index := len(projection.Actions) - 1; index >= 0; index-- {
			if projection.Actions[index].StepID == state.step.ID {
				action := projection.Actions[index]
				state.action = &action
				break
			}
		}
	}
	return state
}

func (s *Service) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	runs := make([]*activeRun, 0, len(s.active))
	for _, run := range s.active {
		runs = append(runs, run)
	}
	s.mu.Unlock()
	for _, run := range runs {
		run.cancel(errAppShutdown)
	}
	s.wg.Wait()
	return s.store.Close()
}
