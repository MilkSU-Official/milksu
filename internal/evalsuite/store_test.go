package evalsuite

import (
	"path/filepath"
	"testing"
)

func TestStorePutScoreAndHistory(t *testing.T) {
	t.Parallel()
	store, err := NewStoreAt(filepath.Join(t.TempDir(), "board.json"))
	if err != nil {
		t.Fatal(err)
	}
	model := ModelRef{Provider: "tokenflux", Model: "grok-4.6"}
	first := ScoreRecord{Model: model, Solved: 0, Total: 1, Score: 0, Runs: []float64{0}}
	if err := store.PutScore(SuiteCybench, first); err != nil {
		t.Fatal(err)
	}
	second := ScoreRecord{Model: model, Solved: 1, Total: 1, Score: 100, Runs: []float64{0, 100}}
	if err := store.PutScore(SuiteCybench, second); err != nil {
		t.Fatal(err)
	}
	board, err := store.Load()
	if err != nil {
		t.Fatal(err)
	}
	got := board.Scores[SuiteCybench][model.Key()]
	if got.Score != 100 || len(got.Runs) != 2 {
		t.Fatalf("got %+v", got)
	}
}
