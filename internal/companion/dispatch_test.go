package companion

import (
	"fmt"
	"strings"
	"testing"
)

type fakeCatalog struct {
	refs map[string]ConversationRef
}

func (f *fakeCatalog) Lookup(id string) (ConversationRef, error) {
	ref, ok := f.refs[id]
	if !ok {
		return ConversationRef{}, fmt.Errorf("missing")
	}
	return ref, nil
}

func (f *fakeCatalog) ListActive() ([]ConversationRef, error) {
	result := make([]ConversationRef, 0, len(f.refs))
	for _, ref := range f.refs {
		if !ref.Archived {
			result = append(result, ref)
		}
	}
	return result, nil
}

func (f *fakeCatalog) ListArchived() ([]ConversationRef, error) {
	result := make([]ConversationRef, 0)
	for _, ref := range f.refs {
		if ref.Archived {
			result = append(result, ref)
		}
	}
	return result, nil
}

func (f *fakeCatalog) Create(ref ConversationRef) (ConversationRef, error) {
	if ref.ID == "" {
		ref.ID = "created-1"
	}
	if f.refs == nil {
		f.refs = map[string]ConversationRef{}
	}
	f.refs[ref.ID] = ref
	return ref, nil
}

type fakeSpeaker struct {
	calls    int
	entries  []string
	produced bool
	err      error
}

func (f *fakeSpeaker) DeliverSpeak(conversationID, text string) (string, bool, error) {
	return f.deliver("queue", conversationID, text)
}

func (f *fakeSpeaker) DeliverSteer(conversationID, text string) (string, bool, error) {
	return f.deliver("steer", conversationID, text)
}

func (f *fakeSpeaker) deliver(mode, conversationID, text string) (string, bool, error) {
	f.calls++
	f.entries = append(f.entries, mode+"|"+conversationID+"|"+text)
	if f.err != nil {
		return "", false, f.err
	}
	if !f.produced {
		return "", false, nil
	}
	return "entry-" + conversationID, true, nil
}

type fakeControl struct {
	aborted []string
	steered []string
	err     error
}

func (f *fakeControl) Abort(conversationID string) error {
	f.aborted = append(f.aborted, conversationID)
	return f.err
}

func (f *fakeControl) Steer(conversationID, text string) error {
	f.steered = append(f.steered, conversationID+"|"+text)
	return f.err
}

func testDispatcher(catalog *fakeCatalog, speaker *fakeSpeaker) *Dispatcher {
	return NewDispatcher(catalog, speaker, NewBoard(), func() bool { return true })
}

func TestSpeakRejectsMissingAndArchivedTargets(t *testing.T) {
	catalog := &fakeCatalog{refs: map[string]ConversationRef{
		"live":     {ID: "live", Title: "Coding work"},
		"archived": {ID: "archived", Title: "Old job", Archived: true},
	}}
	speaker := &fakeSpeaker{produced: true}
	dispatcher := testDispatcher(catalog, speaker)

	missing := dispatcher.Speak(SpeakRequest{
		ConversationID: "nope",
		Text:           "hello",
		IdempotencyKey: "k-missing",
	})
	if missing.Accepted || missing.Delivered || !strings.Contains(missing.Error, "not found") {
		t.Fatalf("missing target: %#v", missing)
	}
	if speaker.calls != 0 {
		t.Fatal("missing target must not deliver")
	}

	archived := dispatcher.Speak(SpeakRequest{
		ConversationID: "archived",
		Text:           "hello",
		IdempotencyKey: "k-archived",
	})
	if archived.Accepted || archived.Delivered || archived.TargetTitle != "Old job" {
		t.Fatalf("archived target: %#v", archived)
	}
	if !strings.Contains(archived.Error, "archived") {
		t.Fatalf("archived reason: %#v", archived)
	}
}

func TestSpeakEchoesTargetTitleOnSuccess(t *testing.T) {
	catalog := &fakeCatalog{refs: map[string]ConversationRef{
		"live": {ID: "live", Title: "Coding work"},
	}}
	speaker := &fakeSpeaker{produced: true}
	dispatcher := testDispatcher(catalog, speaker)
	result := dispatcher.Speak(SpeakRequest{
		ConversationID: "live",
		Text:           "run the tests",
		IdempotencyKey: "k-ok",
	})
	if !result.Accepted || !result.Delivered || result.TargetTitle != "Coding work" || result.EntryID == "" {
		t.Fatalf("success: %#v", result)
	}
}

func TestSpeakIdempotencyDoesNotDeliverTwice(t *testing.T) {
	catalog := &fakeCatalog{refs: map[string]ConversationRef{
		"live": {ID: "live", Title: "Coding work"},
	}}
	speaker := &fakeSpeaker{produced: true}
	dispatcher := testDispatcher(catalog, speaker)
	first := dispatcher.Speak(SpeakRequest{
		ConversationID: "live",
		Text:           "run the tests",
		IdempotencyKey: "same-key",
	})
	second := dispatcher.Speak(SpeakRequest{
		ConversationID: "live",
		Text:           "run the tests again",
		IdempotencyKey: "same-key",
	})
	if speaker.calls != 1 {
		t.Fatalf("expected one delivery, got %d", speaker.calls)
	}
	if !second.IdempotentReplay || second.EntryID != first.EntryID || second.TargetTitle != first.TargetTitle {
		t.Fatalf("replay: first=%#v second=%#v", first, second)
	}
}

func TestSpeakSilentFailureRecordsBoard(t *testing.T) {
	catalog := &fakeCatalog{refs: map[string]ConversationRef{
		"live": {ID: "live", Title: "Coding work"},
	}}
	speaker := &fakeSpeaker{produced: false}
	board := NewBoard()
	dispatcher := NewDispatcher(catalog, speaker, board, func() bool { return true })
	result := dispatcher.Speak(SpeakRequest{
		ConversationID: "live",
		Text:           "run the tests",
		IdempotencyKey: "k-silent",
	})
	if !result.Accepted || result.Delivered {
		t.Fatalf("silent fail should accept but not deliver: %#v", result)
	}
	snapshot := board.Snapshot()
	found := false
	for _, session := range snapshot.Sessions {
		if session.ID == "live" && session.Status == "dispatch_failed" && session.LastError != "" {
			found = true
		}
	}
	if !found {
		t.Fatalf("board did not record silent failure: %#v", snapshot)
	}
}

func TestSteerAndStopRequireConfirmation(t *testing.T) {
	catalog := &fakeCatalog{refs: map[string]ConversationRef{
		"live": {ID: "live", Title: "Coding work"},
	}}
	speaker := &fakeSpeaker{produced: true}
	dispatcher := testDispatcher(catalog, speaker)
	steer := dispatcher.Speak(SpeakRequest{
		ConversationID: "live",
		Text:           "stop that",
		IdempotencyKey: "k-steer",
		Mode:           "steer",
	})
	if steer.Accepted || steer.Delivered || !steer.NeedsConfirmation || steer.TargetTitle != "Coding work" {
		t.Fatalf("steer: %#v", steer)
	}
	if speaker.calls != 0 {
		t.Fatal("steer without confirmation must not deliver")
	}
	stop := dispatcher.Stop(StopRequest{
		ConversationID: "live",
		IdempotencyKey: "k-stop",
	})
	if stop.Accepted || stop.Delivered || !stop.NeedsConfirmation {
		t.Fatalf("stop: %#v", stop)
	}
}

func TestConfirmedStopAndSteerUseSessionControl(t *testing.T) {
	catalog := &fakeCatalog{refs: map[string]ConversationRef{
		"live": {ID: "live", Title: "Coding work"},
	}}
	speaker := &fakeSpeaker{produced: true}
	control := &fakeControl{}
	dispatcher := testDispatcher(catalog, speaker)
	dispatcher.SetControl(control)
	steer := dispatcher.Speak(SpeakRequest{
		ConversationID: "live",
		Text:           "try another path",
		IdempotencyKey: "k-steer-ok",
		Mode:           "steer",
		Confirmed:      true,
	})
	if !steer.Accepted || !steer.Delivered || steer.TargetTitle != "Coding work" {
		t.Fatalf("confirmed steer: %#v", steer)
	}
	if speaker.calls != 1 || !strings.HasPrefix(speaker.entries[0], "steer|") {
		t.Fatalf("steer delivery: %#v", speaker.entries)
	}
	stop := dispatcher.Stop(StopRequest{
		ConversationID: "live",
		IdempotencyKey: "k-stop-ok",
		Confirmed:      true,
	})
	if !stop.Accepted || !stop.Delivered || stop.TargetTitle != "Coding work" {
		t.Fatalf("confirmed stop: %#v", stop)
	}
	if len(control.aborted) != 1 || control.aborted[0] != "live" {
		t.Fatalf("abort: %#v", control.aborted)
	}
}

func TestBoardCannotWriteRuntimeState(t *testing.T) {
	board := NewBoard()
	if _, err := board.Handle(map[string]any{"action": "mark_complete"}); err == nil {
		t.Fatal("board must reject runtime-state writes")
	}
	if _, err := board.Handle(map[string]any{"action": "set_session_state"}); err == nil {
		t.Fatal("board must reject runtime-state writes")
	}
}
