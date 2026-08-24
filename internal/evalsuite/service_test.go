package evalsuite

import (
	"path/filepath"
	"testing"
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
	if len(board.All) != 3 {
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
