package engine

import (
	"os/exec"
	"sync"
	"testing"
	"time"
)

// eventCollector captures the events the Supervisor emits, including the ones
// reportInterruptedSessions publishes from its own goroutine.
type eventCollector struct {
	mu     sync.Mutex
	events []Event
}

func newEventCollector() *eventCollector {
	return &eventCollector{}
}

func (c *eventCollector) emit(event Event) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.events = append(c.events, event)
}

func (c *eventCollector) find(sessionID, eventType string) (Event, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	for _, event := range c.events {
		if event.SessionID == sessionID && event.Type == eventType {
			return event, true
		}
	}
	return Event{}, false
}

// awaitSessionError waits for the per-session notice that tells one conversation its
// Sidecar went away. Without it the renderer never clears the running marker, because
// engine.sidecar_stopped is a process receipt and carries no session.
func (c *eventCollector) awaitSessionError(t *testing.T, sessionID string) Event {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if event, found := c.find(sessionID, "engine.error"); found {
			return event
		}
		if time.Now().After(deadline) {
			t.Fatalf("session %s was never told its Sidecar stopped", sessionID)
		}
		time.Sleep(time.Millisecond)
	}
}

func retiringTestProcess(stdin *recordingStdin, workspace string) *childProcess {
	return &childProcess{
		command:   &exec.Cmd{},
		stdin:     stdin,
		workspace: workspace,
		kernel:    KernelPi,
	}
}

// A retired sidecar keeps running the turn it was retired with, so every control the
// user still has over that turn must reach it. Retirement removes the process from the
// kernel slot and from the parked set, so resolving the session by workspace alone sends
// stop, steering, approvals and compaction to the freshly spawned sidecar, which has
// never heard of the session. "Save settings, then Test connection" is enough to reach
// this: saving marks the process stale, and the probe spawns the replacement.
func TestRetiredSidecarStillReceivesTheControlOfItsOwnTurn(t *testing.T) {
	supervisor := NewSupervisor(func(Event) {})
	retiringStdin := &recordingStdin{}
	retiring := retiringTestProcess(retiringStdin, "/workspace/a")
	supervisor.process = retiring
	registerTestSession(supervisor, "session-a", KernelPi, "/workspace/a", true)

	supervisor.InvalidateCredentials("settings saved")
	supervisor.retireStaleProcessLocked(KernelPi, retiring)

	freshStdin := &recordingStdin{}
	supervisor.process = retiringTestProcess(freshStdin, "/workspace/probe")

	if err := supervisor.AbortMessage("session-a"); err != nil {
		t.Fatalf("AbortMessage: %v", err)
	}

	if commands := freshStdin.commands(t); len(commands) != 0 {
		t.Fatalf("the replacement sidecar does not own this session: %v", commands)
	}
	commands := retiringStdin.commands(t)
	if len(commands) != 1 {
		t.Fatalf("want one abort_session on the retired sidecar, got %v", commands)
	}
	if commands[0]["action"] != "abort_session" ||
		commands[0]["conversationId"] != "session-a" {
		t.Fatalf("unexpected command %v", commands[0])
	}
}

// A session that was never bound to a workspace runs on the live sidecar of its kernel,
// so retiring that sidecar carries the turn along with it.
func TestRetiredSidecarStillReceivesTheControlOfAnUnboundTurn(t *testing.T) {
	supervisor := NewSupervisor(func(Event) {})
	retiringStdin := &recordingStdin{}
	retiring := retiringTestProcess(retiringStdin, "/workspace/a")
	supervisor.process = retiring
	registerTestSession(supervisor, "session-unbound", KernelPi, "", true)

	supervisor.InvalidateCredentials("settings saved")
	supervisor.retireStaleProcessLocked(KernelPi, retiring)
	supervisor.process = retiringTestProcess(&recordingStdin{}, "/workspace/probe")

	if err := supervisor.AbortMessage("session-unbound"); err != nil {
		t.Fatalf("AbortMessage: %v", err)
	}

	commands := retiringStdin.commands(t)
	if len(commands) != 1 || commands[0]["conversationId"] != "session-unbound" {
		t.Fatalf("the retired sidecar must receive the abort, got %v", commands)
	}
}

// Once the turn it was retired with is over, the session belongs to the current sidecar
// again: a retired process must not capture the session forever.
func TestRetiredSidecarReleasesTheSessionAfterItsTurnEnds(t *testing.T) {
	supervisor := NewSupervisor(func(Event) {})
	retiringStdin := &recordingStdin{}
	retiring := retiringTestProcess(retiringStdin, "/workspace/a")
	supervisor.process = retiring
	registerTestSession(supervisor, "session-a", KernelPi, "/workspace/a", true)
	supervisor.InvalidateCredentials("settings saved")
	supervisor.retireStaleProcessLocked(KernelPi, retiring)

	freshStdin := &recordingStdin{}
	fresh := retiringTestProcess(freshStdin, "/workspace/a")
	supervisor.process = fresh
	delete(supervisor.busySessions, "session-a")

	supervisor.mu.Lock()
	got := supervisor.processForSessionLocked("session-a")
	supervisor.mu.Unlock()
	if got != fresh {
		t.Fatalf("a settled session must go back to the current sidecar, got %#v", got)
	}
}

// Retirement happens exactly when the same workspace gets a fresh sidecar, so asking
// "does this workspace have a turn in flight" keeps the old process alive for a turn
// that belongs to the new one. The reap must ask about the turns this process was
// retired with instead.
func TestRetiredSidecarIsNotPinnedByATurnOnTheFreshSidecar(t *testing.T) {
	supervisor := NewSupervisor(func(Event) {})
	retiring := testSidecarProcess("/workspace/a")
	supervisor.process = retiring
	supervisor.InvalidateCredentials("settings saved")
	supervisor.retireStaleProcessLocked(KernelPi, retiring)

	// A new conversation started in the same workspace, on the replacement sidecar.
	registerTestSession(supervisor, "session-new", KernelPi, "/workspace/a", true)

	supervisor.reapStaleProcessesLocked()

	if len(supervisor.retiring) != 0 {
		t.Fatal("a retired sidecar with no turn of its own must be reaped")
	}
	if !retiring.retired.Load() {
		t.Fatal("a reaped sidecar must be marked retired so its stop receipt is written")
	}
}

// Reaping a retired sidecar must leave the same trace as reaping a parked one: the
// process is marked retired so readEvents writes the sidecar.stopped receipt instead of
// dropping the exit, and any turn the grace window cut short is told individually.
// Otherwise the session stays busy forever, which also pins every parked sidecar of that
// workspace against idle reaping and eviction.
func TestRetiredSidecarPastGraceReportsTheTurnItCuts(t *testing.T) {
	collector := newEventCollector()
	supervisor := NewSupervisor(collector.emit)
	retiring := testSidecarProcess("/workspace/a")
	supervisor.process = retiring
	registerTestSession(supervisor, "session-a", KernelPi, "/workspace/a", true)
	supervisor.InvalidateCredentials("settings saved")
	supervisor.retireStaleProcessLocked(KernelPi, retiring)
	retiring.staleSince.Store(time.Now().Add(-staleSidecarGraceTimeout - time.Minute).UnixNano())

	supervisor.reapStaleProcessesLocked()

	if len(supervisor.retiring) != 0 {
		t.Fatal("a stale sidecar past its grace window must be reaped")
	}
	if !retiring.retired.Load() {
		t.Fatal("a reaped sidecar must be marked retired so its stop receipt is written")
	}
	if _, busy := supervisor.busySessions["session-a"]; busy {
		t.Fatal("a turn whose sidecar was stopped must not stay busy forever")
	}
	event := collector.awaitSessionError(t, "session-a")
	if event.Error != sidecarGoneError {
		t.Fatalf("unexpected notice %q", event.Error)
	}
}

// Clearing a credential stops the sidecars mid-turn on purpose. The conversations that
// lost their turn have to hear about it: engine.sidecar_stopped carries no session, and
// the renderer only clears a running marker on engine.error or engine.stopped.
func TestStopStaleSidecarsTellsTheTurnsItInterrupts(t *testing.T) {
	collector := newEventCollector()
	supervisor := NewSupervisor(collector.emit)
	active := testSidecarProcess("/workspace/a")
	supervisor.process = active
	registerTestSession(supervisor, "session-a", KernelPi, "/workspace/a", true)
	parked := parkTestProcess(supervisor, "/workspace/b", time.Now())
	registerTestSession(supervisor, "session-b", KernelPi, "/workspace/b", true)

	supervisor.InvalidateCredentials("credential cleared")
	if stopped := supervisor.StopStaleSidecars(); stopped != 2 {
		t.Fatalf("stopped = %d, want both stale sidecars", stopped)
	}

	if !active.retired.Load() || !parked.retired.Load() {
		t.Fatal("a revoked credential must stop every stale sidecar")
	}
	for _, id := range []string{"session-a", "session-b"} {
		if _, busy := supervisor.busySessions[id]; busy {
			t.Fatalf("session %s must not stay busy after its sidecar was stopped", id)
		}
		event := collector.awaitSessionError(t, id)
		if event.Error != sidecarGoneError {
			t.Fatalf("session %s got an unexpected notice %q", id, event.Error)
		}
	}
}

// The live sidecar of a kernel also serves the sessions that were never bound to a
// workspace, exactly as when it exits on its own. Dropping only the sessions of its own
// workspace leaves those conversations marked running with no process behind them.
func TestStopStaleSidecarsTellsUnboundSessionsToo(t *testing.T) {
	collector := newEventCollector()
	supervisor := NewSupervisor(collector.emit)
	active := testSidecarProcess("/workspace/a")
	supervisor.process = active
	registerTestSession(supervisor, "session-unbound", KernelPi, "", true)

	supervisor.InvalidateCredentials("credential cleared")
	supervisor.StopStaleSidecars()

	if _, busy := supervisor.busySessions["session-unbound"]; busy {
		t.Fatal("an unbound session served by the stopped sidecar must not stay busy")
	}
	collector.awaitSessionError(t, "session-unbound")
}

// A retired sidecar no longer owns its workspace: the replacement does. Stopping it on a
// revoked credential must therefore end the turns it was retired with, not every turn of
// a workspace that now belongs to a live process.
func TestStopStaleSidecarsEndsOnlyTheRetiredSidecarsOwnTurns(t *testing.T) {
	collector := newEventCollector()
	supervisor := NewSupervisor(collector.emit)
	retiring := testSidecarProcess("/workspace/a")
	supervisor.process = retiring
	registerTestSession(supervisor, "session-old", KernelPi, "/workspace/a", true)
	supervisor.InvalidateCredentials("settings saved")
	supervisor.retireStaleProcessLocked(KernelPi, retiring)

	fresh := testSidecarProcess("/workspace/a")
	supervisor.process = fresh
	registerTestSession(supervisor, "session-new", KernelPi, "/workspace/a", true)

	supervisor.StopStaleSidecars()

	if _, still := supervisor.sessions["session-new"]; !still {
		t.Fatal("a turn running on the live sidecar must survive a retired one being stopped")
	}
	if _, busy := supervisor.busySessions["session-new"]; !busy {
		t.Fatal("a turn running on the live sidecar must keep its running state")
	}
	if _, busy := supervisor.busySessions["session-old"]; busy {
		t.Fatal("the turn the retired sidecar carried must end with it")
	}
	collector.awaitSessionError(t, "session-old")
}
