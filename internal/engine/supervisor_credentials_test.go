package engine

import (
	"testing"
	"time"
)

// A credential change reaches the sidecar through its spawn environment, so the next
// turn must run on a fresh process. Marking instead of stopping is what keeps a turn
// that is already streaming - and a model probe in flight during the account sync -
// from being killed, which is what made "Test connection" report a failure.
func TestInvalidateCredentialsMarksSidecarsWithoutStoppingThem(t *testing.T) {
	supervisor := NewSupervisor(nil)
	active := testSidecarProcess("/workspace/a")
	parked := parkTestProcess(supervisor, "/workspace/b", time.Now())
	supervisor.process = active

	marked := supervisor.InvalidateCredentials("settings saved")

	if marked != 2 {
		t.Fatalf("marked = %d, want 2", marked)
	}
	if !active.stale.Load() || !parked.stale.Load() {
		t.Fatal("every live sidecar must be marked stale")
	}
	if active.retired.Load() || parked.retired.Load() {
		t.Fatal("a credential change must not retire a sidecar that may still be streaming")
	}
	if supervisor.process != active {
		t.Fatal("the active sidecar must keep serving the turn it already started")
	}
	if active.staleReason != "settings saved" {
		t.Fatalf("staleReason = %q, want the rotation cause", active.staleReason)
	}
	if again := supervisor.InvalidateCredentials("settings saved"); again != 0 {
		t.Fatalf("already stale sidecars must not be counted twice, got %d", again)
	}
}

// A stale sidecar must never serve new work: not the parked lookup, not a new command.
func TestStaleSidecarIsNotReused(t *testing.T) {
	supervisor := NewSupervisor(nil)
	parked := parkTestProcess(supervisor, "/workspace/a", time.Now())
	supervisor.sessions["session-a"] = struct{}{}
	supervisor.sessionKernels["session-a"] = KernelPi
	supervisor.sessionWorkspaces["session-a"] = "/workspace/a"

	supervisor.InvalidateCredentials("settings saved")
	fresh := testSidecarProcess("/workspace/a")
	supervisor.process = fresh
	if got := supervisor.processForSessionLocked("session-a"); got != fresh {
		t.Fatalf("a fresh sidecar must serve the session ahead of a stale one, got %#v", got)
	}

	supervisor.process = nil
	if got := supervisor.processForSessionLocked("session-a"); got != nil {
		t.Fatalf("a stale sidecar must not serve a session, got %#v", got)
	}
	if !parked.stale.Load() {
		t.Fatal("the parked sidecar must have been marked stale")
	}
}

// A stale sidecar leaves the active slot but keeps running until its turn is over.
//
// Silence on stdout is not evidence that the turn ended: a foreground bash can run for
// minutes without writing a line, so the reap asks whether the turns this process was
// retired with have settled, the same question the parked pool asks about its workspace.
func TestRetiredStaleSidecarIsReapedOnceItsTurnEnds(t *testing.T) {
	supervisor := NewSupervisor(nil)
	process := testSidecarProcess("/workspace/a")
	supervisor.process = process
	registerTestSession(supervisor, "session-a", KernelPi, "/workspace/a", true)
	supervisor.InvalidateCredentials("settings saved")

	supervisor.retireStaleProcessLocked(KernelPi, process)

	if supervisor.process != nil {
		t.Fatal("a retired sidecar must leave the active slot")
	}
	if len(supervisor.retiring) != 1 || supervisor.retiring[0] != process {
		t.Fatal("a retired sidecar must be tracked for reaping")
	}

	supervisor.reapStaleProcessesLocked()
	if len(supervisor.retiring) != 1 {
		t.Fatal("a retired sidecar whose turn is still running must be kept, even while silent")
	}

	supervisor.busySessions = make(map[string]struct{})
	supervisor.reapStaleProcessesLocked()
	if len(supervisor.retiring) != 0 {
		t.Fatal("a retired sidecar whose turn ended must be reaped")
	}
}

// The grace window bounds how long a stale sidecar may hold its turn.
func TestRetiredStaleSidecarIsReapedAfterGrace(t *testing.T) {
	supervisor := NewSupervisor(nil)
	process := testSidecarProcess("/workspace/a")
	supervisor.process = process
	supervisor.InvalidateCredentials("settings saved")
	supervisor.retireStaleProcessLocked(KernelPi, process)

	process.staleSince.Store(time.Now().Add(-staleSidecarGraceTimeout - time.Minute).UnixNano())
	supervisor.reapStaleProcessesLocked()

	if len(supervisor.retiring) != 0 {
		t.Fatal("a stale sidecar past its grace window must be reaped")
	}
}

// Clearing a credential revokes it: every sidecar still holding it is stopped at once,
// including one that is mid-turn, because there is nothing left for it to run with. A
// sidecar that is not stale is left alone.
func TestStopStaleSidecarsStopsEveryStaleOne(t *testing.T) {
	supervisor := NewSupervisor(nil)
	idle := parkTestProcess(supervisor, "/workspace/idle", time.Now())
	busy := parkTestProcess(supervisor, "/workspace/busy", time.Now())
	fresh := parkTestProcess(supervisor, "/workspace/fresh", time.Now())
	supervisor.InvalidateCredentials("credential cleared")
	fresh.stale.Store(false)
	registerTestSession(supervisor, "session-busy", KernelPi, "/workspace/busy", true)

	stopped := supervisor.StopStaleSidecars()

	if stopped != 2 {
		t.Fatalf("stopped = %d, want both stale sidecars", stopped)
	}
	if !idle.retired.Load() || !busy.retired.Load() {
		t.Fatal("a revoked credential must stop every stale sidecar, mid-turn or not")
	}
	if fresh.retired.Load() {
		t.Fatal("a sidecar that is not stale must keep running")
	}
	if _, still := supervisor.parked[sidecarWorkspaceKey(KernelPi, "/workspace/fresh")]; !still {
		t.Fatal("a sidecar that is not stale must stay parked")
	}
}
