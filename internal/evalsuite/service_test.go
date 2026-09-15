package evalsuite

import (
	"path/filepath"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/engine"
)

func TestSnapshotDedupesCatalogAndTiesEqualScores(t *testing.T) {
	t.Parallel()
	store, err := NewStoreAt(filepath.Join(t.TempDir(), "board.json"))
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewServiceAt(store, t.TempDir(), nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	sonnet := ModelRef{Provider: "tokenflux", Model: "claude/claude-sonnet-4-6", Source: "personal"}
	grok := ModelRef{Provider: "tokenflux", Model: "grok-4.6", Source: "account"}
	opus := ModelRef{Provider: "tokenflux", Model: "claude/claude-opus-4-6", Source: "personal"}
	if err := store.PutScore(SuiteCybench, ScoreRecord{Model: sonnet, Solved: 1, Total: 1, Score: 100}); err != nil {
		t.Fatal(err)
	}
	if err := store.PutScore(SuiteCybench, ScoreRecord{Model: grok, Solved: 1, Total: 1, Score: 100}); err != nil {
		t.Fatal(err)
	}
	board, err := service.Snapshot(SuiteCybench, []ModelRef{
		sonnet, grok, opus, opus, sonnet, grok,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(board.Models) != 2 {
		t.Fatalf("models: %+v", board.Models)
	}
	if board.Models[0].Rank == nil || *board.Models[0].Rank != 1 || board.Models[1].Rank == nil || *board.Models[1].Rank != 1 {
		t.Fatalf("tied scores should share rank 1: %+v", board.Models)
	}
}

func TestSnapshotKeepsUntestedModelsOffTheRank(t *testing.T) {
	t.Parallel()
	store, err := NewStoreAt(filepath.Join(t.TempDir(), "board.json"))
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewServiceAt(store, t.TempDir(), nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	model := ModelRef{Provider: "tokenflux", Model: "grok-4.6"}
	if err := store.PutScore(SuiteCybench, ScoreRecord{
		Model: model, Solved: 1, Total: 1, Score: 100,
	}); err != nil {
		t.Fatal(err)
	}
	board, err := service.Snapshot(SuiteCybench, []ModelRef{
		model,
		{Provider: "tokenflux", Model: "claude-sonnet-4.6"},
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(board.Models) != 1 {
		t.Fatalf("models: %+v", board.Models)
	}
	if board.Models[0].Rank == nil || *board.Models[0].Rank != 1 || board.Models[0].Score == nil {
		t.Fatalf("scored row: %+v", board.Models[0])
	}
}

func TestSnapshotSkipsEmptyCatalogModels(t *testing.T) {
	t.Parallel()
	store, err := NewStoreAt(filepath.Join(t.TempDir(), "board.json"))
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewServiceAt(store, t.TempDir(), nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	grok := ModelRef{Provider: "tokenflux", Model: "grok-4.6", Source: "account"}
	if err := store.PutScore(SuiteCybench, ScoreRecord{Model: grok, Solved: 1, Total: 1, Score: 100}); err != nil {
		t.Fatal(err)
	}
	board, err := service.Snapshot(SuiteCybench, []ModelRef{
		{},
		{Provider: "tokenflux", Source: "account"},
		grok,
	})
	if err != nil {
		t.Fatal(err)
	}
	if len(board.Models) != 1 || board.Models[0].Model.Model != grok.Model {
		t.Fatalf("models: %+v", board.Models)
	}
}

func TestFrontierSmokePicksOneTerminalAndOneDeepSWE(t *testing.T) {
	t.Parallel()
	tasks := TasksForRun(SuiteFrontier, true)
	if len(tasks) != 2 {
		t.Fatalf("smoke: %+v", tasks)
	}
	if tasks[0].Source != "terminal-bench" || tasks[1].Source != "deepswe" {
		t.Fatalf("smoke sources: %+v %+v", tasks[0], tasks[1])
	}
}

func TestRankAheadPrefersPassThenCostThenTime(t *testing.T) {
	t.Parallel()
	high := ScoreRecord{Score: 80, CostUSD: 4, MedianTimeMS: 1000}
	cheap := ScoreRecord{Score: 80, CostUSD: 1, MedianTimeMS: 5000}
	fast := ScoreRecord{Score: 60, MedianTimeMS: 100}
	if !rankAhead(cheap, high) {
		t.Fatal("same pass rate should rank lower cost first")
	}
	if rankAhead(fast, cheap) {
		t.Fatal("lower pass rate should not outrank")
	}
}

func TestSnapshotKeepsHarnessRowsOnTheBoard(t *testing.T) {
	t.Parallel()
	store, err := NewStoreAt(filepath.Join(t.TempDir(), "board.json"))
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewServiceAt(store, t.TempDir(), nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	pi := ModelRef{Provider: "tokenflux", Model: "grok-4.6", Kernel: KernelPi}
	dsh := ModelRef{Provider: "tokenflux", Model: "grok-4.6", Kernel: KernelDSH}
	if err := store.PutScore(SuiteFrontier, ScoreRecord{
		Model: pi, Solved: 18, Total: 30, Score: 60, MedianTimeMS: 400000, CostUSD: 2.4, CacheHitPct: 79,
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.PutScore(SuiteFrontier, ScoreRecord{
		Model: dsh, Solved: 19, Total: 30, Score: 63.3, MedianTimeMS: 404000, CostUSD: 3.28, CacheHitPct: 84,
	}); err != nil {
		t.Fatal(err)
	}
	board, err := service.Snapshot(SuiteFrontier, []ModelRef{pi, dsh})
	if err != nil {
		t.Fatal(err)
	}
	if len(board.Models) != 2 {
		t.Fatalf("models: %+v", board.Models)
	}
	if board.Models[0].Model.Kernel != KernelDSH || board.Models[0].Rank == nil || *board.Models[0].Rank != 1 {
		t.Fatalf("lead: %+v", board.Models[0])
	}
	if board.Models[0].CostUSD != 3.28 || board.Models[1].CacheHitPct != 79 {
		t.Fatalf("metrics: %+v", board.Models)
	}
}

func TestSnapshotReturnsEverySuiteBoard(t *testing.T) {
	t.Parallel()
	store, err := NewStoreAt(filepath.Join(t.TempDir(), "board.json"))
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewServiceAt(store, t.TempDir(), nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	grok := ModelRef{Provider: "tokenflux", Model: "grok-4.6"}
	claude := ModelRef{Provider: "tokenflux", Model: "claude-sonnet-4.6"}
	if err := store.PutScore(SuiteCybench, ScoreRecord{
		Model: grok, Solved: 1, Total: 1, Score: 100, Curve: []float64{100},
	}); err != nil {
		t.Fatal(err)
	}
	if err := store.PutScore(SuiteAutoPen, ScoreRecord{
		Model: claude, Solved: 2, Total: 3, Score: 67, Curve: []float64{67},
	}); err != nil {
		t.Fatal(err)
	}
	board, err := service.Snapshot("", []ModelRef{grok, claude})
	if err != nil {
		t.Fatal(err)
	}
	if len(board.All) != 5 {
		t.Fatalf("all suites: %+v", board.All)
	}
	byID := map[string]SuiteBoard{}
	for _, item := range board.All {
		byID[item.Suite.ID] = item
	}
	cybench := byID[SuiteCybench]
	if len(cybench.Models) != 1 || cybench.Models[0].Score == nil || *cybench.Models[0].Score != 100 {
		t.Fatalf("cybench: %+v", cybench.Models)
	}
	sec := byID[SuiteSECBench]
	if len(sec.Models) != 0 {
		t.Fatalf("sec-bench should omit untested catalog rows: %+v", sec.Models)
	}
	autopen := byID[SuiteAutoPen]
	if len(autopen.Models) != 1 || autopen.Models[0].Score == nil || *autopen.Models[0].Score != 67 {
		t.Fatalf("autopen: %+v", autopen.Models)
	}
}

func TestObserveProjectsAssistantReply(t *testing.T) {
	t.Parallel()
	store, err := NewStoreAt(filepath.Join(t.TempDir(), "board.json"))
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewServiceAt(store, t.TempDir(), nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	service.run = &activeRun{
		sessionID: "milksu_eval_1",
		startedAt: time.Now(),
		stepIndex: map[string]int{},
		progress:  Progress{State: StateRunning, Suite: SuiteCybench},
	}
	service.Observe(engine.Event{SessionID: "milksu_eval_1", Type: "assistant.delta", Text: "hello "})
	service.Observe(engine.Event{SessionID: "milksu_eval_1", Type: "assistant.delta", Text: "world"})
	if service.run.progress.Reply != "hello world" {
		t.Fatalf("delta reply: %q", service.run.progress.Reply)
	}
	service.Observe(engine.Event{SessionID: "milksu_eval_1", Type: "assistant.completed", Text: "final answer"})
	if service.run.progress.Reply != "final answer" {
		t.Fatalf("completed reply: %q", service.run.progress.Reply)
	}
}

func TestRecordTurnMovesReplyIntoHistory(t *testing.T) {
	t.Parallel()
	store, err := NewStoreAt(filepath.Join(t.TempDir(), "board.json"))
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewServiceAt(store, t.TempDir(), nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	service.run = &activeRun{
		startedAt: time.Now(),
		stepIndex: map[string]int{},
		progress:  Progress{State: StateRunning, Suite: SuiteCybench, Reply: "the flag"},
	}
	service.run.assistant.WriteString("the flag")
	service.recordTurnLocked(Task{Name: "Easy"}, Grade{Hits: 1, Total: 1})
	if service.run.progress.Reply != "" {
		t.Fatalf("reply should clear after grade: %q", service.run.progress.Reply)
	}
	if len(service.run.progress.Turns) != 1 {
		t.Fatalf("turns: %+v", service.run.progress.Turns)
	}
	turn := service.run.progress.Turns[0]
	if turn.TaskName != "Easy" || turn.Reply != "the flag" || !turn.Passed {
		t.Fatalf("turn: %+v", turn)
	}
	service.recordTurnLocked(Task{Name: "Hard"}, Grade{Hits: 0, Total: 1})
	if len(service.run.progress.Turns) != 2 || service.run.progress.Turns[1].Passed {
		t.Fatalf("failed turn: %+v", service.run.progress.Turns)
	}
}

func TestSnapshotKeepsIdleTurns(t *testing.T) {
	t.Parallel()
	store, err := NewStoreAt(filepath.Join(t.TempDir(), "board.json"))
	if err != nil {
		t.Fatal(err)
	}
	service, err := NewServiceAt(store, t.TempDir(), nil, nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	service.lastProgress = &Progress{
		State: StateIdle,
		Suite: SuiteCybench,
		Turns: []ReplyTurn{{TaskName: "Easy", Reply: "done", Passed: true}},
	}
	board, err := service.Snapshot(SuiteCybench, nil)
	if err != nil {
		t.Fatal(err)
	}
	if board.Progress == nil || len(board.Progress.Turns) != 1 || board.Progress.Turns[0].Reply != "done" {
		t.Fatalf("idle turns: %+v", board.Progress)
	}
	service.lastProgress = nil
	service.run = &activeRun{
		startedAt: time.Now(),
		progress:  Progress{State: StateRunning, Suite: SuiteCybench},
	}
	board, err = service.Snapshot(SuiteCybench, nil)
	if err != nil {
		t.Fatal(err)
	}
	if board.Progress == nil || board.Progress.State != StateRunning || len(board.Progress.Turns) != 0 {
		t.Fatalf("live progress should start empty: %+v", board.Progress)
	}
}
