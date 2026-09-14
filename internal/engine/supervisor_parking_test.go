package engine

import (
	"fmt"
	"io"
	"os/exec"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

// nopWriteCloser stands in for the sidecar stdin pipe inside unit tests.
type nopWriteCloser struct{}

func (nopWriteCloser) Write(payload []byte) (int, error) { return len(payload), nil }
func (nopWriteCloser) Close() error                      { return nil }

func testSidecarProcess(workspace string) *childProcess {
	return &childProcess{
		command:   &exec.Cmd{},
		stdin:     nopWriteCloser{},
		workspace: workspace,
	}
}

func parkTestProcess(supervisor *Supervisor, workspace string, parkedAt time.Time) *childProcess {
	return parkTestProcessForKernel(supervisor, KernelPi, workspace, parkedAt)
}

func parkTestProcessForKernel(
	supervisor *Supervisor,
	kernel, workspace string,
	parkedAt time.Time,
) *childProcess {
	process := testSidecarProcess(workspace)
	key := sidecarWorkspaceKey(kernel, workspace)
	supervisor.parked[key] = process
	supervisor.parkedAt[key] = parkedAt
	return process
}

// registerTestSession binds a session to a kernel and workspace, optionally marking its
// turn as still running.
func registerTestSession(supervisor *Supervisor, id, kernel, workspace string, running bool) {
	supervisor.sessions[id] = struct{}{}
	supervisor.sessionKernels[id] = kernel
	supervisor.sessionWorkspaces[id] = workspace
	if running {
		supervisor.busySessions[id] = struct{}{}
	}
}

func TestParkingKeepsTheWorkspaceSidecarAlive(t *testing.T) {
	supervisor := NewSupervisor(nil)
	process := testSidecarProcess("/workspace/a")
	supervisor.process = process

	supervisor.parkCurrentLocked(KernelPi, process)

	if supervisor.process != nil {
		t.Fatal("parking must clear the active slot for the kernel")
	}
	if supervisor.parked[sidecarWorkspaceKey(KernelPi, "/workspace/a")] != process {
		t.Fatal("parking must retain the process for its workspace")
	}
	if process.retired.Load() {
		t.Fatal("parking must not retire the process, its turn may still be running")
	}
}

func TestParkedSidecarServesSessionsOfItsOwnWorkspace(t *testing.T) {
	supervisor := NewSupervisor(nil)
	parked := parkTestProcess(supervisor, "/workspace/a", time.Now())
	active := testSidecarProcess("/workspace/b")
	supervisor.process = active

	supervisor.sessions["session-a"] = struct{}{}
	supervisor.sessionKernels["session-a"] = KernelPi
	supervisor.sessionWorkspaces["session-a"] = "/workspace/a"

	if got := supervisor.processForSessionLocked("session-a"); got != parked {
		t.Fatalf("session of a parked workspace must reach the parked sidecar, got %#v", got)
	}
	if got := supervisor.processForSessionLocked("session-unbound"); got != active {
		t.Fatalf("unbound session must fall back to the active sidecar, got %#v", got)
	}
}

func TestParkedSidecarWorkspaceIsForgottenWithTheProcess(t *testing.T) {
	supervisor := NewSupervisor(nil)
	stale := parkTestProcess(supervisor, "/workspace/stale", time.Now().Add(-2*sidecarIdleTimeout))
	fresh := parkTestProcess(supervisor, "/workspace/fresh", time.Now())

	supervisor.reapParkedLocked(KernelPi)

	if !stale.retired.Load() {
		t.Fatal("an idle parked sidecar must be retired")
	}
	if _, exists := supervisor.parked[sidecarWorkspaceKey(KernelPi, "/workspace/stale")]; exists {
		t.Fatal("reaped sidecar must leave the parked set")
	}
	if fresh.retired.Load() {
		t.Fatal("a recently used parked sidecar must stay alive")
	}
	if len(supervisor.parked) != 1 {
		t.Fatalf("expected one parked sidecar, got %d", len(supervisor.parked))
	}
}

func TestParkedSidecarsAreBounded(t *testing.T) {
	supervisor := NewSupervisor(nil)
	oldest := time.Now().Add(-time.Hour)
	var firstKey string
	for index := 0; index <= maxParkedSidecars; index++ {
		workspace := fmt.Sprintf("/workspace/%d", index)
		parkTestProcess(supervisor, workspace, oldest.Add(time.Duration(index)*time.Minute))
		if index == 0 {
			firstKey = sidecarWorkspaceKey(KernelPi, workspace)
		}
	}

	supervisor.evictParkedOverLimitLocked(KernelPi)

	if len(supervisor.parked) != maxParkedSidecars {
		t.Fatalf("parked set must be bounded at %d, got %d", maxParkedSidecars, len(supervisor.parked))
	}
	if _, exists := supervisor.parked[firstKey]; exists {
		t.Fatal("the least recently parked sidecar must be evicted first")
	}
}

func TestDroppingOneWorkspaceKeepsOtherSessions(t *testing.T) {
	supervisor := NewSupervisor(nil)
	for _, session := range []struct {
		id        string
		workspace string
	}{
		{"session-a", "/workspace/a"},
		{"session-b", "/workspace/b"},
	} {
		supervisor.sessions[session.id] = struct{}{}
		supervisor.sessionKernels[session.id] = KernelPi
		supervisor.sessionWorkspaces[session.id] = session.workspace
	}

	supervisor.dropWorkspaceSessionsLocked(KernelPi, "/workspace/a")

	if _, exists := supervisor.sessions["session-a"]; exists {
		t.Fatal("sessions of the dropped workspace must be forgotten")
	}
	if _, exists := supervisor.sessions["session-b"]; !exists {
		t.Fatal("sessions of other workspaces must survive")
	}
}

func TestCloseStopsParkedSidecars(t *testing.T) {
	supervisor := NewSupervisor(nil)
	parked := parkTestProcess(supervisor, "/workspace/a", time.Now())
	active := testSidecarProcess("/workspace/b")
	supervisor.process = active

	supervisor.Close()

	if !parked.retired.Load() {
		t.Fatal("closing the supervisor must retire parked sidecars")
	}
	if !active.retired.Load() {
		t.Fatal("closing the supervisor must retire the active sidecar")
	}
	if len(supervisor.parked) != 0 {
		t.Fatalf("parked set must be empty after Close, got %d", len(supervisor.parked))
	}
}

func TestWorkspaceKeysSeparateKernels(t *testing.T) {
	pi := sidecarWorkspaceKey(KernelPi, "/workspace/a")
	dsh := sidecarWorkspaceKey(KernelDSH, "/workspace/a")
	if pi == dsh {
		t.Fatal("kernels must not share a workspace key")
	}
	if !strings.HasPrefix(pi, NormalizeKernel(KernelPi)) {
		t.Fatalf("unexpected key shape: %q", pi)
	}
}

func TestRuntimeStatusCountsParkedSidecars(t *testing.T) {
	supervisor := NewSupervisor(nil)
	parkTestProcess(supervisor, "/workspace/a", time.Now())

	status := supervisor.Status()
	if !status.Running {
		t.Fatal("a parked sidecar is still a running sidecar")
	}
}

// A foreground tool call can run for many minutes without emitting a single event, so
// parked time on its own cannot tell an abandoned workspace from a working one. Reaping
// such a sidecar is the exact loss parking exists to prevent.
func TestParkedSidecarRunningATurnIsNeverReaped(t *testing.T) {
	supervisor := NewSupervisor(nil)
	working := parkTestProcess(supervisor, "/workspace/working", time.Now().Add(-4*sidecarIdleTimeout))
	idle := parkTestProcess(supervisor, "/workspace/idle", time.Now().Add(-4*sidecarIdleTimeout))
	registerTestSession(supervisor, "session-working", KernelPi, "/workspace/working", true)
	registerTestSession(supervisor, "session-idle", KernelPi, "/workspace/idle", false)

	supervisor.reapParkedLocked(KernelPi)

	if working.retired.Load() {
		t.Fatal("a parked sidecar with a turn in flight must not be reaped")
	}
	if !idle.retired.Load() {
		t.Fatal("a parked sidecar with no turn in flight must still be reaped")
	}
	if _, exists := supervisor.sessions["session-working"]; !exists {
		t.Fatal("the running session must keep its Supervisor record")
	}
}

func TestSettledTurnLetsTheSidecarBeReaped(t *testing.T) {
	supervisor := NewSupervisor(nil)
	parked := parkTestProcess(supervisor, "/workspace/a", time.Now().Add(-2*sidecarIdleTimeout))
	registerTestSession(supervisor, "session-a", KernelPi, "/workspace/a", true)

	supervisor.observeTurnLifecycle(
		bridgeEvent{ID: "session-a"},
		Event{SessionID: "session-a", Type: "assistant.settled"},
	)
	supervisor.reapParkedLocked(KernelPi)

	if !parked.retired.Load() {
		t.Fatal("a settled turn must release the sidecar for reaping")
	}
}

func TestEvictionPrefersASidecarWithNoTurnInFlight(t *testing.T) {
	supervisor := NewSupervisor(nil)
	oldest := time.Now().Add(-time.Hour)
	var busiest *childProcess
	for index := 0; index <= maxParkedSidecars; index++ {
		workspace := fmt.Sprintf("/workspace/%d", index)
		process := parkTestProcess(supervisor, workspace, oldest.Add(time.Duration(index)*time.Minute))
		// The least recently parked one is the one still working.
		registerTestSession(supervisor, "session-"+workspace, KernelPi, workspace, index == 0)
		if index == 0 {
			busiest = process
		}
	}

	supervisor.evictParkedOverLimitLocked(KernelPi)

	if busiest.retired.Load() {
		t.Fatal("eviction must not stop the sidecar that is still running a turn")
	}
	if supervisor.parkedCountLocked(KernelPi) != maxParkedSidecars {
		t.Fatalf("parked set must be trimmed to %d, got %d",
			maxParkedSidecars, supervisor.parkedCountLocked(KernelPi))
	}
}

// A turn that never reports completion must not let parked processes grow without bound.
func TestHardLimitEvictsEvenABusySidecar(t *testing.T) {
	supervisor := NewSupervisor(nil)
	oldest := time.Now().Add(-time.Hour)
	for index := 0; index <= maxParkedSidecarsHardLimit; index++ {
		workspace := fmt.Sprintf("/workspace/%d", index)
		parkTestProcess(supervisor, workspace, oldest.Add(time.Duration(index)*time.Minute))
		registerTestSession(supervisor, "session-"+workspace, KernelPi, workspace, true)
	}

	supervisor.evictParkedOverLimitLocked(KernelPi)

	if supervisor.parkedCountLocked(KernelPi) > maxParkedSidecarsHardLimit {
		t.Fatalf("the hard limit must bound the parked set, got %d",
			supervisor.parkedCountLocked(KernelPi))
	}
}

func TestEvictionCountsEachKernelSeparately(t *testing.T) {
	supervisor := NewSupervisor(nil)
	now := time.Now()
	for index := 0; index < maxParkedSidecars; index++ {
		parkTestProcessForKernel(
			supervisor,
			KernelDSH,
			fmt.Sprintf("/workspace/dsh-%d", index),
			now.Add(-time.Hour+time.Duration(index)*time.Minute),
		)
	}
	newestPi := parkTestProcessForKernel(supervisor, KernelPi, "/workspace/pi", now)

	supervisor.evictParkedOverLimitLocked(KernelPi)

	if newestPi.retired.Load() {
		t.Fatal("a full DeepSeek Harness parked set must not evict a Pi sidecar")
	}
	if supervisor.parkedCountLocked(KernelDSH) != maxParkedSidecars {
		t.Fatalf("the other kernel must keep its sidecars, got %d",
			supervisor.parkedCountLocked(KernelDSH))
	}
}

func TestForkedSessionInheritsTheParentWorkspace(t *testing.T) {
	supervisor := NewSupervisor(nil)
	parked := parkTestProcess(supervisor, "/workspace/a", time.Now())
	supervisor.process = testSidecarProcess("/workspace/b")
	registerTestSession(supervisor, "session-a", KernelPi, "/workspace/a", false)

	supervisor.rememberForkedSessionLocked("session-a", "session-fork")

	if got := supervisor.sessionWorkspaces["session-fork"]; got != "/workspace/a" {
		t.Fatalf("fork workspace = %q, want /workspace/a", got)
	}
	if got := supervisor.processForSessionLocked("session-fork"); got != parked {
		t.Fatal("a fork must reach the same sidecar as its parent, not the active one")
	}
}

// A session that was never bound to a workspace belongs to no parked process. Dropping
// one workspace must not forget it, or the conversations of other workspaces lose their
// Supervisor record while their sidecar is still alive.
func TestDroppingOneWorkspaceKeepsUnboundSessions(t *testing.T) {
	supervisor := NewSupervisor(nil)
	registerTestSession(supervisor, "session-a", KernelPi, "/workspace/a", false)
	supervisor.sessions["session-unbound"] = struct{}{}
	supervisor.sessionKernels["session-unbound"] = KernelPi

	supervisor.dropWorkspaceSessionsLocked(KernelPi, "/workspace/a")

	if _, exists := supervisor.sessions["session-a"]; exists {
		t.Fatal("sessions of the dropped workspace must be forgotten")
	}
	if _, exists := supervisor.sessions["session-unbound"]; !exists {
		t.Fatal("an unbound session must not be forgotten with one workspace")
	}
}

func TestDroppingAWorkspaceReportsOnlyItsRunningSessions(t *testing.T) {
	supervisor := NewSupervisor(nil)
	registerTestSession(supervisor, "session-running", KernelPi, "/workspace/a", true)
	registerTestSession(supervisor, "session-idle", KernelPi, "/workspace/a", false)
	registerTestSession(supervisor, "session-other", KernelPi, "/workspace/b", true)

	interrupted := supervisor.dropWorkspaceSessionsLocked(KernelPi, "/workspace/a")

	if len(interrupted) != 1 || interrupted[0] != "session-running" {
		t.Fatalf("interrupted sessions = %#v, want only session-running", interrupted)
	}
	if _, exists := supervisor.sessions["session-other"]; !exists {
		t.Fatal("a running session of another workspace must be untouched")
	}
}

// The active sidecar dying takes the sessions that have no other process, but a session
// bound to a parked workspace still has its own live sidecar.
func TestActiveSidecarExitKeepsParkedWorkspaceSessions(t *testing.T) {
	supervisor := NewSupervisor(nil)
	parkTestProcess(supervisor, "/workspace/parked", time.Now())
	registerTestSession(supervisor, "session-parked", KernelPi, "/workspace/parked", true)
	registerTestSession(supervisor, "session-active", KernelPi, "/workspace/active", true)
	supervisor.sessions["session-unbound"] = struct{}{}
	supervisor.sessionKernels["session-unbound"] = KernelPi

	interrupted := supervisor.dropActiveSessionsLocked(KernelPi, "/workspace/active")

	if _, exists := supervisor.sessions["session-parked"]; !exists {
		t.Fatal("a session served by a parked sidecar must survive the active one exiting")
	}
	if _, exists := supervisor.sessions["session-active"]; exists {
		t.Fatal("sessions of the exited active workspace must be forgotten")
	}
	if _, exists := supervisor.sessions["session-unbound"]; exists {
		t.Fatal("unbound sessions belong to the active sidecar")
	}
	if len(interrupted) != 1 || interrupted[0] != "session-active" {
		t.Fatalf("interrupted sessions = %#v, want only session-active", interrupted)
	}
}

// startEndedSidecar spawns a process that exits immediately, so readEvents runs its whole
// exit path without needing a packaged sidecar.
func startEndedSidecar(t *testing.T, workspace string) (*childProcess, io.Reader) {
	t.Helper()
	command := exec.Command("/bin/sh", "-c", "exit 0")
	stdin, err := command.StdinPipe()
	if err != nil {
		t.Fatalf("open stdin: %v", err)
	}
	stdout, err := command.StdoutPipe()
	if err != nil {
		t.Fatalf("open stdout: %v", err)
	}
	if err := command.Start(); err != nil {
		t.Fatalf("start process: %v", err)
	}
	return &childProcess{
		command:   command,
		stdin:     stdin,
		workspace: workspace,
		stderr:    newSidecarStderrBuffer(),
	}, stdout
}

func collectingSupervisor() (*Supervisor, func() []string) {
	var mu sync.Mutex
	var types []string
	supervisor := NewSupervisor(func(event Event) {
		mu.Lock()
		defer mu.Unlock()
		types = append(types, event.Type)
	})
	return supervisor, func() []string {
		mu.Lock()
		defer mu.Unlock()
		return append([]string(nil), types...)
	}
}

func containsEvent(events []string, name string) bool {
	for _, event := range events {
		if event == name {
			return true
		}
	}
	return false
}

// engine.stopped ends every control waiter and every running conversation in the
// renderer. Retiring one parked workspace sidecar must therefore report only the process
// lifecycle receipt, or idle reaping becomes the very interruption parking prevents.
func TestRetiredParkedSidecarReportsLifecycleOnly(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses /bin/sh to end a process deterministically")
	}
	supervisor, events := collectingSupervisor()
	process, stdout := startEndedSidecar(t, "/workspace/a")
	key := sidecarWorkspaceKey(KernelPi, "/workspace/a")
	supervisor.parked[key] = process
	supervisor.parkedAt[key] = time.Now()
	process.retired.Store(true)

	supervisor.readEvents(KernelPi, process, stdout)

	recorded := events()
	if !containsEvent(recorded, engineSidecarStoppedEvent) {
		t.Fatalf("a retired sidecar must report %s, got %#v", engineSidecarStoppedEvent, recorded)
	}
	if containsEvent(recorded, "engine.stopped") {
		t.Fatalf("a retired parked sidecar must not broadcast engine.stopped, got %#v", recorded)
	}
}

func TestActiveSidecarExitStillBroadcastsEngineStopped(t *testing.T) {
	if runtime.GOOS == "windows" {
		t.Skip("uses /bin/sh to end a process deterministically")
	}
	supervisor, events := collectingSupervisor()
	process, stdout := startEndedSidecar(t, "/workspace/a")
	supervisor.process = process

	supervisor.readEvents(KernelPi, process, stdout)

	recorded := events()
	if !containsEvent(recorded, "engine.stopped") {
		t.Fatalf("the active sidecar dying must still broadcast engine.stopped, got %#v", recorded)
	}
	if !containsEvent(recorded, engineSidecarStoppedEvent) {
		t.Fatalf("the active sidecar dying must also report %s, got %#v",
			engineSidecarStoppedEvent, recorded)
	}
}
