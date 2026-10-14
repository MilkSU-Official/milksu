package research

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/google/uuid"
)

const (
	maxResearchQueryCodePoints  = 2000
	maxResearchTaskCodePoints   = 16000
	maxResearchResultCodePoints = 8000
	maxResearchReportCodePoints = 30000
	maxResearchWorkersPerBatch  = 4
)

type Service struct {
	store *Store
	mu    sync.Mutex
}

type traceIDContextKey struct{}

func WithTraceID(ctx context.Context, traceID string) context.Context {
	if ctx == nil {
		ctx = context.Background()
	}
	return context.WithValue(ctx, traceIDContextKey{}, strings.TrimSpace(traceID))
}

func researchTraceIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	value, _ := ctx.Value(traceIDContextKey{}).(string)
	return value
}

func NewService(store *Store) *Service {
	return &Service{store: store}
}

func (s *Service) Close() error {
	if s == nil || s.store == nil {
		return nil
	}
	return s.store.Close()
}

func (s *Service) Start(ctx context.Context, conversationID, query string, traceID ...string) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	conversationID = strings.TrimSpace(conversationID)
	query = strings.TrimSpace(sanitizeResearchText(query))
	if conversationID == "" || query == "" {
		return Run{}, fmt.Errorf("conversation and research query are required")
	}
	if utf8.RuneCountInString(query) > maxResearchQueryCodePoints {
		return Run{}, fmt.Errorf("research query exceeds %d characters", maxResearchQueryCodePoints)
	}
	if _, err := s.store.FindUnconfirmedWorkerStop(ctx, conversationID); err == nil {
		return Run{}, fmt.Errorf("a previous research worker stop is unconfirmed")
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Run{}, err
	}
	if _, err := s.store.FindActiveRun(ctx, conversationID); err == nil {
		return Run{}, fmt.Errorf("this conversation already has an active research run")
	} else if !errors.Is(err, sql.ErrNoRows) {
		return Run{}, err
	}
	resolvedTraceID := ""
	if len(traceID) > 0 {
		resolvedTraceID = traceID[0]
	}
	if resolvedTraceID == "" {
		resolvedTraceID = researchTraceIDFromContext(ctx)
	}
	resolvedTraceID = normalizeResearchTraceID(resolvedTraceID)
	if resolvedTraceID == "" {
		resolvedTraceID = newResearchTraceID()
	}
	now := time.Now().UTC()
	run := Run{
		ID:             "research_" + uuid.NewString(),
		ConversationID: conversationID,
		Query:          query,
		Status:         RunRunning,
		Phase:          PhaseCollecting,
		TraceID:        resolvedTraceID,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	if err := s.store.CreateRun(ctx, run); err != nil {
		return Run{}, err
	}
	return run, nil
}

func (s *Service) RegisterTask(ctx context.Context, conversationID, runID, prompt string) (Task, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, err := s.ownedRun(ctx, conversationID, runID)
	if err != nil {
		return Task{}, err
	}
	if run.Status != RunRunning {
		return Task{}, fmt.Errorf("research run is not running")
	}
	prompt = strings.TrimSpace(sanitizeResearchText(prompt))
	if prompt == "" || utf8.RuneCountInString(prompt) > maxResearchTaskCodePoints {
		return Task{}, fmt.Errorf("research task prompt must contain 1-%d characters", maxResearchTaskCodePoints)
	}
	batch := 0
	switch run.Phase {
	case PhaseCollecting:
		batch = 1
	case PhaseGapFillCollecting:
		batch = 2
	default:
		return Task{}, fmt.Errorf("research run is not collecting a worker batch")
	}
	tasks, err := s.store.ListTasks(ctx, run.ID)
	if err != nil {
		return Task{}, err
	}
	count := 0
	for _, task := range tasks {
		if task.Batch != batch {
			continue
		}
		count++
		// A registered task that has not launched yet blocks another
		// registration in the same batch; the same prompt is idempotent.
		if task.Status == TaskLaunching {
			if task.Prompt == prompt {
				return task, nil
			}
			return Task{}, fmt.Errorf("launch the previously registered worker before registering another task")
		}
		if task.Prompt != prompt {
			continue
		}
		if task.Status == TaskInterrupted || task.Status == TaskFailed {
			task.Status = TaskLaunching
			task.WorkerID = ""
			task.Result = ""
			if err := s.store.UpsertTask(ctx, task); err != nil {
				return Task{}, err
			}
			return task, nil
		}
		if task.Status == TaskRunning {
			return Task{}, fmt.Errorf("research task prompt is already registered")
		}
	}
	if count >= maxResearchWorkersPerBatch {
		return Task{}, fmt.Errorf("research batch exceeds %d workers", maxResearchWorkersPerBatch)
	}
	task := Task{
		ID:     "research_task_" + uuid.NewString(),
		RunID:  run.ID,
		Prompt: prompt,
		Status: TaskLaunching,
		Batch:  batch,
	}
	if err := s.store.UpsertTask(ctx, task); err != nil {
		return Task{}, err
	}
	return task, nil
}

func (s *Service) List(ctx context.Context, conversationID string) ([]Run, error) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return nil, fmt.Errorf("conversation id is required")
	}
	runs, err := s.store.ListRuns(ctx, conversationID, 10)
	if err != nil {
		return nil, err
	}
	for index := range runs {
		runs[index].Report = ""
	}
	return runs, nil
}

func (s *Service) DeleteConversation(ctx context.Context, conversationID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.store.DeleteConversation(ctx, conversationID)
}

func (s *Service) Get(ctx context.Context, conversationID, runID string) (Snapshot, error) {
	run, err := s.ownedRun(ctx, conversationID, runID)
	if err != nil {
		return Snapshot{}, err
	}
	return s.snapshot(ctx, run)
}

func (s *Service) SealBatch(ctx context.Context, conversationID, runID string) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, err := s.ownedRun(ctx, conversationID, runID)
	if err != nil {
		return Run{}, err
	}
	if run.Status != RunRunning {
		return Run{}, fmt.Errorf("research run is not running")
	}
	waitingPhase, completedPhase, batch, ok := batchPhases(run.Phase)
	if !ok || (run.Phase != PhaseCollecting && run.Phase != PhaseGapFillCollecting) {
		return Run{}, fmt.Errorf("research run is not collecting a worker batch")
	}
	tasks, err := s.store.ListTasks(ctx, run.ID)
	if err != nil {
		return Run{}, err
	}
	current := tasksForBatch(tasks, batch)
	if len(current) == 0 {
		return Run{}, fmt.Errorf("research batch has no workers")
	}
	if len(current) > maxResearchWorkersPerBatch {
		return Run{}, fmt.Errorf("research batch exceeds %d workers", maxResearchWorkersPerBatch)
	}
	for _, task := range current {
		if task.Status == TaskInterrupted {
			return Run{}, fmt.Errorf("interrupted research tasks must be re-registered before sealing")
		}
		if task.Status == TaskLaunching || (task.Status == TaskRunning && task.WorkerID == "") {
			return Run{}, fmt.Errorf("a registered research task has not started its worker")
		}
	}
	run.Phase = waitingPhase
	if allTasksTerminal(current) {
		run.Phase = completedPhase
	}
	run.UpdatedAt = time.Now().UTC()
	if err := s.store.UpdateRun(ctx, run); err != nil {
		return Run{}, err
	}
	return run, nil
}

func (s *Service) RecordWorkerUpdates(
	ctx context.Context,
	conversationID, runID string,
	updates []WorkerUpdate,
) (Run, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, err := s.ownedRun(ctx, conversationID, runID)
	if err != nil {
		return Run{}, false, err
	}
	if run.Status != RunRunning {
		return run, false, nil
	}
	waitingPhase, completedPhase, batch, ok := batchPhases(run.Phase)
	if !ok {
		return run, false, nil
	}
	tasks, err := s.store.ListTasks(ctx, run.ID)
	if err != nil {
		return Run{}, false, err
	}
	existing := make(map[string]Task, len(tasks))
	currentIDs := make(map[string]struct{}, len(tasks)+len(updates))
	for _, task := range tasks {
		existing[task.ID] = task
		if task.Batch == batch {
			currentIDs[task.ID] = struct{}{}
		}
	}
	effectiveIDs := make([]string, len(updates))
	matchedInterrupted := make(map[string]struct{})
	for index := range updates {
		update := &updates[index]
		update.ID = strings.TrimSpace(update.ID)
		if update.ID == "" {
			return Run{}, false, fmt.Errorf("research worker id is required")
		}
		effectiveID := update.ID
		if _, exists := existing[effectiveID]; !exists && strings.TrimSpace(update.Prompt) != "" {
			for _, task := range tasks {
				if task.Batch != batch || task.Status != TaskInterrupted || task.Prompt != strings.TrimSpace(update.Prompt) {
					continue
				}
				if _, alreadyMatched := matchedInterrupted[task.ID]; alreadyMatched {
					continue
				}
				effectiveID = task.ID
				matchedInterrupted[task.ID] = struct{}{}
				break
			}
		}
		effectiveIDs[index] = effectiveID
		currentIDs[effectiveID] = struct{}{}
	}
	if len(currentIDs) > maxResearchWorkersPerBatch {
		return Run{}, false, fmt.Errorf("research batch exceeds %d workers", maxResearchWorkersPerBatch)
	}
	upserts := make([]Task, 0, len(updates))
	for index, update := range updates {
		status, err := normalizeWorkerStatus(update.Status)
		if err != nil {
			return Run{}, false, err
		}
		taskID := effectiveIDs[index]
		previous := existing[taskID]
		prompt := strings.TrimSpace(sanitizeResearchText(update.Prompt))
		if prompt == "" {
			prompt = previous.Prompt
		}
		if utf8.RuneCountInString(prompt) > maxResearchTaskCodePoints {
			return Run{}, false, fmt.Errorf("research worker prompt exceeds %d characters", maxResearchTaskCodePoints)
		}
		resumingInterrupted := previous.Status == TaskInterrupted && status == TaskRunning
		result := strings.TrimSpace(sanitizeResearchText(update.Result))
		if result == "" && !resumingInterrupted {
			result = previous.Result
		}
		if utf8.RuneCountInString(result) > maxResearchResultCodePoints {
			result = string([]rune(result)[:maxResearchResultCodePoints])
		}
		workerID := strings.TrimSpace(update.WorkerID)
		if workerID == "" {
			workerID = previous.WorkerID
		}
		if terminalTask(previous.Status) && previous.Status != TaskInterrupted && status == TaskRunning {
			status = previous.Status
		}
		// A task only counts as running once a concrete worker identity
		// exists that a later cancel can address.
		if status == TaskRunning && workerID == "" {
			status = TaskLaunching
		}
		task := Task{
			ID:       taskID,
			RunID:    run.ID,
			Prompt:   prompt,
			Status:   status,
			WorkerID: workerID,
			Batch:    batch,
			Result:   result,
		}
		upserts = append(upserts, task)
		existing[task.ID] = task
	}
	ready := false
	if run.Phase == waitingPhase {
		current := make([]Task, 0, len(currentIDs))
		for _, task := range existing {
			if task.Batch == batch {
				current = append(current, task)
			}
		}
		if allTasksTerminal(current) {
			run.Phase = completedPhase
			ready = true
		}
	}
	if len(upserts) == 0 {
		return run, false, nil
	}
	run.UpdatedAt = time.Now().UTC()
	if err := s.store.UpsertTasksAndRun(ctx, upserts, run); err != nil {
		return Run{}, false, err
	}
	return run, ready, nil
}

func (s *Service) ClaimContinuation(ctx context.Context, conversationID, runID string) (Run, bool, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, err := s.ownedRun(ctx, conversationID, runID)
	if err != nil {
		return Run{}, false, err
	}
	if run.Status != RunRunning {
		return run, false, nil
	}
	switch run.Phase {
	case PhaseSynthesisPending:
		run.Phase = PhaseSynthesizing
	case PhaseFinalSynthesisPending:
		run.Phase = PhaseFinalizing
	default:
		return run, false, nil
	}
	run.UpdatedAt = time.Now().UTC()
	if err := s.store.UpdateRun(ctx, run); err != nil {
		return Run{}, false, err
	}
	return run, true, nil
}

func (s *Service) BeginGapFill(ctx context.Context, conversationID, runID string) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, err := s.ownedRun(ctx, conversationID, runID)
	if err != nil {
		return Run{}, err
	}
	if run.Status != RunRunning || run.Phase != PhaseSynthesizing {
		return Run{}, fmt.Errorf("research run is not ready for a gap-fill batch")
	}
	run.Phase = PhaseGapFillCollecting
	run.UpdatedAt = time.Now().UTC()
	if err := s.store.UpdateRun(ctx, run); err != nil {
		return Run{}, err
	}
	return run, nil
}

func (s *Service) AddSource(
	ctx context.Context,
	conversationID, runID, sourceURL, title, extract string,
) (Source, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, err := s.ownedRun(ctx, conversationID, runID)
	if err != nil {
		return Source{}, err
	}
	if run.Status != RunRunning {
		return Source{}, fmt.Errorf("research run is not running")
	}
	return s.store.AddSource(ctx, run.ID, sourceURL, title, time.Now().UTC(), []byte(extract))
}

func (s *Service) ReadSource(ctx context.Context, conversationID, sourceID string) (Source, string, error) {
	source, data, err := s.store.ReadSource(ctx, sourceID)
	if err != nil {
		return Source{}, "", err
	}
	if _, err := s.ownedRun(ctx, conversationID, source.RunID); err != nil {
		return Source{}, "", err
	}
	return source, string(data), nil
}

func (s *Service) ReadReport(ctx context.Context, conversationID, runID string) (string, error) {
	run, err := s.ownedRun(ctx, conversationID, runID)
	if err != nil {
		return "", err
	}
	if run.Report == "" {
		return "", fmt.Errorf("research run has no saved report")
	}
	return run.Report, nil
}

func (s *Service) RecordCitation(
	ctx context.Context,
	conversationID, runID, claim, sourceID, verdict, reason string,
) (Citation, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	citation, err := NewCitation(runID, claim, sourceID, verdict, reason)
	if err != nil {
		return Citation{}, err
	}
	run, err := s.ownedRun(ctx, conversationID, citation.RunID)
	if err != nil {
		return Citation{}, err
	}
	if run.Status != RunRunning {
		return Citation{}, fmt.Errorf("research run is not running")
	}
	if err := s.store.AddCitation(ctx, citation); err != nil {
		return Citation{}, err
	}
	return citation, nil
}

func (s *Service) Complete(ctx context.Context, conversationID, runID, report string) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, err := s.ownedRun(ctx, conversationID, runID)
	if err != nil {
		return Run{}, err
	}
	if run.Status != RunRunning ||
		(run.Phase != PhaseSynthesizing && run.Phase != PhaseFinalizing) {
		return Run{}, fmt.Errorf("research run is not ready to complete")
	}
	report = strings.TrimSpace(sanitizeResearchText(report))
	if report == "" {
		return Run{}, fmt.Errorf("research report is required")
	}
	if utf8.RuneCountInString(report) > maxResearchReportCodePoints {
		return Run{}, fmt.Errorf("research report exceeds %d characters", maxResearchReportCodePoints)
	}
	run.Status = RunCompleted
	run.Phase = PhaseFinalizing
	run.Report = report
	run.UpdatedAt = time.Now().UTC()
	if err := s.store.UpdateRun(ctx, run); err != nil {
		return Run{}, err
	}
	return run, nil
}

func (s *Service) Cancel(ctx context.Context, conversationID, runID string) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, err := s.ownedRun(ctx, conversationID, runID)
	if err != nil {
		return Run{}, err
	}
	if run.Status == RunCancelled {
		return run, nil
	}
	if run.Status != RunRunning && run.Status != RunInterrupted {
		return Run{}, fmt.Errorf("research run is not active or interrupted")
	}
	run.Status = RunCancelled
	run.Phase = PhaseFinalizing
	run.UpdatedAt = time.Now().UTC()
	if err := s.store.CancelRun(ctx, run); err != nil {
		return Run{}, err
	}
	return run, nil
}

func (s *Service) SetWorkerStopUnconfirmed(
	ctx context.Context,
	conversationID,
	runID string,
	unconfirmed bool,
) (Run, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, err := s.ownedRun(ctx, conversationID, runID)
	if err != nil {
		return Run{}, err
	}
	if run.Status != RunCancelled {
		return Run{}, fmt.Errorf("research run is not cancelled")
	}
	if err := s.store.SetWorkerStopUnconfirmed(ctx, run.ConversationID, run.ID, unconfirmed); err != nil {
		return Run{}, err
	}
	run.WorkerStopUnconfirmed = unconfirmed
	return run, nil
}

func (s *Service) Resume(ctx context.Context, conversationID, runID string) (Snapshot, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, err := s.ownedRun(ctx, conversationID, runID)
	if err != nil {
		return Snapshot{}, err
	}
	if run.Status != RunInterrupted {
		return Snapshot{}, fmt.Errorf("research run is not interrupted")
	}
	if active, err := s.store.FindActiveRun(ctx, run.ConversationID); err == nil && active.ID != run.ID {
		return Snapshot{}, fmt.Errorf("this conversation already has an active research run")
	} else if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Snapshot{}, err
	}
	switch run.Phase {
	case PhaseWaiting:
		run.Phase = PhaseCollecting
	case PhaseGapFillWaiting:
		run.Phase = PhaseGapFillCollecting
	case PhaseSynthesisPending:
		run.Phase = PhaseSynthesizing
	case PhaseFinalSynthesisPending:
		run.Phase = PhaseFinalizing
	}
	run.Status = RunRunning
	run.UpdatedAt = time.Now().UTC()
	if err := s.store.UpdateRun(ctx, run); err != nil {
		return Snapshot{}, err
	}
	return s.snapshot(ctx, run)
}

func (s *Service) MarkInterrupted(ctx context.Context, conversationID, runID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	run, err := s.ownedRun(ctx, conversationID, runID)
	if err != nil {
		return err
	}
	if run.Status != RunRunning {
		return nil
	}
	run.Status = RunInterrupted
	run.UpdatedAt = time.Now().UTC()
	return s.store.InterruptRun(ctx, run)
}

func (s *Service) Recover(ctx context.Context) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.store.InterruptRunning(ctx)
}

func (s *Service) ownedRun(ctx context.Context, conversationID, runID string) (Run, error) {
	conversationID = strings.TrimSpace(conversationID)
	runID = strings.TrimSpace(runID)
	if conversationID == "" || runID == "" {
		return Run{}, fmt.Errorf("conversation and research run id are required")
	}
	run, err := s.store.GetRun(ctx, runID)
	if err != nil {
		return Run{}, err
	}
	if run.ConversationID != conversationID {
		return Run{}, fmt.Errorf("research run does not belong to this conversation")
	}
	return run, nil
}

func (s *Service) snapshot(ctx context.Context, run Run) (Snapshot, error) {
	tasks, err := s.store.ListTasks(ctx, run.ID)
	if err != nil {
		return Snapshot{}, err
	}
	sources, err := s.store.ListSources(ctx, run.ID)
	if err != nil {
		return Snapshot{}, err
	}
	citations, err := s.store.ListCitations(ctx, run.ID)
	if err != nil {
		return Snapshot{}, err
	}
	run.Report = ""
	return Snapshot{Run: run, Tasks: tasks, Sources: sources, Citations: citations}, nil
}

func batchPhases(phase string) (waiting, completed string, batch int, ok bool) {
	switch phase {
	case PhaseCollecting:
		return PhaseWaiting, PhaseSynthesizing, 1, true
	case PhaseWaiting:
		return PhaseWaiting, PhaseSynthesisPending, 1, true
	case PhaseGapFillCollecting:
		return PhaseGapFillWaiting, PhaseFinalizing, 2, true
	case PhaseGapFillWaiting:
		return PhaseGapFillWaiting, PhaseFinalSynthesisPending, 2, true
	default:
		return "", "", 0, false
	}
}

func tasksForBatch(tasks []Task, batch int) []Task {
	current := make([]Task, 0, len(tasks))
	for _, task := range tasks {
		if task.Batch == batch {
			current = append(current, task)
		}
	}
	return current
}

func allTasksTerminal(tasks []Task) bool {
	if len(tasks) == 0 {
		return false
	}
	for _, task := range tasks {
		if task.Status == TaskRunning || task.Status == TaskLaunching || task.Status == TaskInterrupted {
			return false
		}
	}
	return true
}

func terminalTask(status string) bool {
	return status != "" && status != TaskRunning && status != TaskLaunching
}

func normalizeWorkerStatus(status string) (string, error) {
	switch strings.ToLower(strings.TrimSpace(status)) {
	case "start", "running", "pending", "scheduled", "queued":
		return TaskRunning, nil
	case "succeeded", "completed", "complete":
		return TaskCompleted, nil
	case "failed", "error", "stopped", "timeout":
		return TaskFailed, nil
	case "cancelled", "canceled":
		return TaskCancelled, nil
	case "interrupted":
		return TaskInterrupted, nil
	default:
		return "", fmt.Errorf("unsupported research worker status %q", status)
	}
}
