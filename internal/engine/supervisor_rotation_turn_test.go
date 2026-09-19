package engine

import (
	"testing"
	"time"
)

// busySessionOn binds a session with a turn in flight to a sidecar's workspace, which is how the
// supervisor knows that sidecar is serving a turn right now.
func busySessionOn(supervisor *Supervisor, sessionID, workspace string) {
	supervisor.mu.Lock()
	defer supervisor.mu.Unlock()
	supervisor.sessions[sessionID] = struct{}{}
	supervisor.sessionKernels[sessionID] = KernelPi
	supervisor.sessionWorkspaces[sessionID] = workspace
	supervisor.busySessions[sessionID] = struct{}{}
}

// The reap used to stop a retired sidecar once its grace ran out, even with a turn still streaming.
// A sidecar carrying a turn is never stopped for a rotation, however long it has been silent: a
// single `sleep 75` writes no output at all, so silence cannot tell working from abandoned.
func TestStaleReapNeverStopsAStreamingTurn(t *testing.T) {
	supervisor := NewSupervisor(nil)
	busy := testSidecarProcess("/workspace/a")
	busy.retired.Store(true)
	busy.stale.Store(true)
	// Silent for far longer than the grace window, with a turn still in flight.
	busy.staleSince.Store(time.Now().Add(-staleSidecarGraceTimeout - time.Hour).UnixNano())
	supervisor.retiring = []*childProcess{busy}
	busySessionOn(supervisor, "session-streaming", "/workspace/a")
	supervisor.mu.Lock()
	// Retirement records who it was carrying: that is what keeps this process alive now.
	busy.retiredTurns = map[string]struct{}{"session-streaming": {}}
	supervisor.mu.Unlock()

	supervisor.reapStaleProcessesLocked()
	if len(supervisor.retiring) != 1 || supervisor.retiring[0] != busy {
		t.Fatal("a sidecar carrying a turn must not be stopped, however long it has been silent")
	}

	// The turn is over: now it is reaped.
	supervisor.mu.Lock()
	delete(supervisor.busySessions, "session-streaming")
	supervisor.mu.Unlock()
	supervisor.reapStaleProcessesLocked()
	if len(supervisor.retiring) != 0 {
		t.Fatal("a retired sidecar whose turn ended must be reaped")
	}
}

// The ceiling is the backstop for a busy record that is wrong: a turn that never reports its end
// must not pin the process for the lifetime of the app. Past it the sidecar is retired anyway and
// the conversation that loses its turn is told.
func TestBusySidecarIsRetiredAtTheCeiling(t *testing.T) {
	collector := newEventCollector()
	supervisor := NewSupervisor(collector.emit)
	busy := testSidecarProcess("/workspace/a")
	busy.retired.Store(true)
	busy.stale.Store(true)
	busy.staleSince.Store(time.Now().Add(-staleSidecarBusyCeiling - time.Minute).UnixNano())
	supervisor.retiring = []*childProcess{busy}
	busySessionOn(supervisor, "session-stuck", "/workspace/a")
	supervisor.mu.Lock()
	busy.retiredTurns = map[string]struct{}{"session-stuck": {}}
	supervisor.mu.Unlock()

	supervisor.reapStaleProcessesLocked()

	if len(supervisor.retiring) != 0 {
		t.Fatal("a sidecar past the busy ceiling must be retired, or a wrong busy record pins it forever")
	}
	if !busy.retired.Load() {
		t.Fatal("a stopped sidecar must be marked retired so its stop receipt is written")
	}
	if _, stillBusy := supervisor.busySessions["session-stuck"]; stillBusy {
		t.Fatal("the conversation that lost its turn must not stay busy forever")
	}
	event := collector.awaitSessionError(t, "session-stuck")
	if event.Error != sidecarGoneError {
		t.Fatalf("unexpected notice %q", event.Error)
	}
}

// After a rotation the next dispatch must run on fresh credentials: the stale sidecar leaves
// rotation and the replacement serves the conversation.
func TestNextDispatchAfterRotationUsesTheFreshSidecar(t *testing.T) {
	supervisor := NewSupervisor(nil)
	stale := testSidecarProcess("/workspace/a")
	supervisor.process = stale
	supervisor.mu.Lock()
	supervisor.sessions["session-a"] = struct{}{}
	supervisor.sessionKernels["session-a"] = KernelPi
	supervisor.sessionWorkspaces["session-a"] = "/workspace/a"
	supervisor.mu.Unlock()

	// Idle rotation: it takes effect immediately.
	if marked := supervisor.InvalidateCredentials("settings saved"); marked != 1 {
		t.Fatalf("an idle sidecar must be marked at once, marked = %d", marked)
	}
	supervisor.retireStaleProcessLocked(KernelPi, stale)
	fresh := testSidecarProcess("/workspace/a")
	supervisor.mu.Lock()
	supervisor.process = fresh
	served := supervisor.processForSessionLocked("session-a")
	supervisor.mu.Unlock()
	if served != fresh {
		t.Fatalf("the fresh sidecar must serve the conversation after a rotation, got %#v", served)
	}
}

// The rotation contract still holds while another conversation is mid-turn: the busy sidecar is
// marked stale at once (so it can never serve new work on the replaced environment), it is retired
// lazily by the dispatch path, and the next turn in the same workspace lands on the replacement.
//
// The dispatch itself spawns a process, so this asserts the decision it takes instead: the reuse
// predicate at ensureKernelProcessLocked refuses a stale sidecar, and the retire step it performs
// takes that sidecar out of rotation while leaving conversation A's turn running.
func TestRotationWhileBusySendsTheNextTurnInThatWorkspaceToTheNewSidecar(t *testing.T) {
	supervisor := NewSupervisor(nil)
	old := testSidecarProcess("/workspace/a")
	supervisor.process = old
	// Conversation A is streaming a turn.
	busySessionOn(supervisor, "session-a", "/workspace/a")
	// Conversation B is idle in the same workspace and is about to start.
	supervisor.mu.Lock()
	supervisor.sessions["session-b"] = struct{}{}
	supervisor.sessionKernels["session-b"] = KernelPi
	supervisor.sessionWorkspaces["session-b"] = "/workspace/a"
	supervisor.mu.Unlock()

	if marked := supervisor.InvalidateCredentials("settings saved"); marked == 0 {
		t.Fatal("a rotation must mark the sidecar stale even while another conversation is mid-turn")
	}
	if !old.stale.Load() {
		t.Fatal("the mark must be immediate, or the next turn keeps the replaced credentials")
	}

	// This is the exact predicate ensureKernelProcessLocked reuses with: a stale sidecar is never
	// reused, so conversation B cannot start on the old environment.
	supervisor.mu.Lock()
	current := supervisor.processForKernelLocked(KernelPi)
	reusable := current != nil && current.workspace == "/workspace/a" && !current.stale.Load()
	supervisor.mu.Unlock()
	if reusable {
		t.Fatal("a stale sidecar must not be reused for the next turn")
	}

	// What the dispatch then does: take it out of rotation, so the workspace runs on a fresh one.
	supervisor.retireStaleProcessLocked(KernelPi, old)
	supervisor.mu.Lock()
	afterRetire := supervisor.processForKernelLocked(KernelPi)
	supervisor.mu.Unlock()
	if afterRetire != nil {
		t.Fatal("a retired sidecar must leave rotation")
	}

	fresh := testSidecarProcess("/workspace/a")
	supervisor.mu.Lock()
	supervisor.process = fresh
	served := supervisor.processForSessionLocked("session-b")
	supervisor.mu.Unlock()
	if served != fresh {
		t.Fatalf("the next turn in the same workspace must use the fresh sidecar, got %#v", served)
	}

	// Conversation A's answer is untouched: the retired sidecar keeps running until its turn ends.
	supervisor.reapStaleProcessesLocked()
	if len(supervisor.retiring) != 1 || supervisor.retiring[0] != old {
		t.Fatal("the sidecar carrying conversation A's turn must not be stopped")
	}
	if _, busy := supervisor.busySessions["session-a"]; !busy {
		t.Fatal("conversation A's turn must still be running")
	}
}
