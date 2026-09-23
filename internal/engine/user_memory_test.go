package engine

import (
	"testing"
	"time"
)

func TestUserMemoryTurnStaysOffTheChatEventStream(t *testing.T) {
	chat := make(chan Event, 1)
	supervisor := NewSupervisor(func(event Event) {
		chat <- event
	})
	got := make(chan UserMemoryTurn, 1)
	supervisor.SetUserMemoryHandler(func(turn UserMemoryTurn) {
		got <- turn
	})
	supervisor.forwardUserMemoryTurn(bridgeEvent{
		Type:          "user_memory_turn",
		ID:            "coding-1",
		Phase:         "finish",
		UserText:      "以后都用中文回复我",
		AssistantText: "好",
	})
	select {
	case turn := <-got:
		if turn.SessionID != "coding-1" || turn.Phase != "finish" || turn.UserText != "以后都用中文回复我" {
			t.Fatalf("turn = %#v", turn)
		}
	case <-time.After(time.Second):
		t.Fatal("user memory turn was not delivered")
	}
	select {
	case event := <-chat:
		t.Fatalf("user memory turn became a chat event: %#v", event)
	case <-time.After(50 * time.Millisecond):
	}
}
