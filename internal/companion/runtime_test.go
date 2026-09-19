package companion

import (
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/engine"
)

func TestObserveEngineEventOwnsRuntimeStatus(t *testing.T) {
	runtime := NewRuntime(RuntimeOptions{})
	runtime.board.ReplaceSessions([]ConversationRef{{ID: "live", Title: "Coding work", Status: "idle"}})
	runtime.ObserveEngineEvent(engine.Event{SessionID: "live", Type: "assistant.delta"})
	if statusOf(runtime, "live") != "running" {
		t.Fatalf("delta should mark running: %#v", runtime.BoardSnapshot())
	}
	runtime.ObserveEngineEvent(engine.Event{SessionID: "live", Type: "approval.requested"})
	if statusOf(runtime, "live") != "needs_approval" {
		t.Fatalf("approval should mark needs_approval: %#v", runtime.BoardSnapshot())
	}
	runtime.ObserveEngineEvent(engine.Event{SessionID: "live", Type: "assistant.settled"})
	if statusOf(runtime, "live") != "idle" {
		t.Fatalf("settled should mark idle: %#v", runtime.BoardSnapshot())
	}
	runtime.ObserveEngineEvent(engine.Event{SessionID: SessionID, Type: "assistant.delta"})
	if statusOf(runtime, SessionID) != "" {
		t.Fatal("companion session must not appear as a work-session row")
	}
}

func TestObserveEngineEventDoesNotBlockOnIndex(t *testing.T) {
	started := make(chan struct{}, 1)
	blocked := make(chan struct{})
	indexer := &blockingIndexer{started: started, blocked: blocked}
	runtime := NewRuntime(RuntimeOptions{Indexer: indexer})
	runtime.board.ReplaceSessions([]ConversationRef{{ID: "live", Title: "Coding work"}})
	runtime.ObserveEngineEvent(engine.Event{SessionID: "live", Type: "assistant.settled", Text: "done"})
	select {
	case <-started:
	case <-time.After(time.Second):
		t.Fatal("index write should start asynchronously")
	}
	close(blocked)
}

type blockingIndexer struct {
	started chan struct{}
	blocked chan struct{}
}

func (b *blockingIndexer) IndexEpisode(episode Episode) {
	b.started <- struct{}{}
	<-b.blocked
	_ = episode
}

func (b *blockingIndexer) Search(string, int) ([]MemoryHit, error) {
	return nil, nil
}

func statusOf(runtime *Runtime, id string) string {
	for _, session := range runtime.BoardSnapshot().Sessions {
		if session.ID == id {
			return session.Status
		}
	}
	return ""
}
