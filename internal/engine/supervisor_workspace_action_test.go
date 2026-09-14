package engine

import (
	"bytes"
	"encoding/json"
	"strings"
	"sync"
	"testing"
)

// recordingStdin stands in for a Sidecar's stdin so a test can read the commands the
// Supervisor wrote back to it.
type recordingStdin struct {
	mu     sync.Mutex
	buffer bytes.Buffer
}

func (w *recordingStdin) Write(data []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.buffer.Write(data)
}

func (w *recordingStdin) Close() error { return nil }

func (w *recordingStdin) commands(t *testing.T) []map[string]any {
	t.Helper()
	w.mu.Lock()
	defer w.mu.Unlock()
	var commands []map[string]any
	for _, line := range strings.Split(strings.TrimSpace(w.buffer.String()), "\n") {
		if strings.TrimSpace(line) == "" {
			continue
		}
		var command map[string]any
		if err := json.Unmarshal([]byte(line), &command); err != nil {
			t.Fatalf("sidecar received a line that is not a command: %v", err)
		}
		commands = append(commands, command)
	}
	return commands
}

// TestWorkspaceActionAnswersASidecarThatLeftRotation covers the answer path for a host
// action that takes long enough to outlive its Sidecar's turn as the live process for
// its kernel. Preparing a writer worktree is minutes of work, and the Sidecar stays
// blocked on the answer for all of it, while switching workspaces parks that process
// and a credential change retires it. Both keep the process running, so dropping the
// answer would strand a turn that is still alive and waiting.
func TestWorkspaceActionAnswersASidecarThatLeftRotation(t *testing.T) {
	for _, testCase := range []struct {
		name string
		// displace moves the process while the action is running, as the Supervisor
		// would if the user switched workspace or replaced a credential meanwhile.
		displace func(supervisor *Supervisor, process *childProcess)
		answered bool
	}{
		{
			name:     "still the live sidecar",
			displace: func(*Supervisor, *childProcess) {},
			answered: true,
		},
		{
			name: "parked because the user opened another workspace",
			displace: func(supervisor *Supervisor, process *childProcess) {
				supervisor.process = nil
				supervisor.parked[sidecarWorkspaceKey(KernelPi, process.workspace)] = process
			},
			answered: true,
		},
		{
			name: "retiring because the credentials were replaced",
			displace: func(supervisor *Supervisor, process *childProcess) {
				supervisor.process = nil
				process.stale.Store(true)
				supervisor.retiring = append(supervisor.retiring, process)
			},
			answered: true,
		},
		{
			name: "stopped while the action ran",
			displace: func(supervisor *Supervisor, _ *childProcess) {
				supervisor.process = nil
			},
			answered: false,
		},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			supervisor := NewSupervisor(func(Event) {})
			stdin := &recordingStdin{}
			process := &childProcess{
				stdin:     stdin,
				workspace: "/workspace/project",
				kernel:    KernelPi,
			}
			supervisor.process = process
			supervisor.sessionKernels["conversation"] = KernelPi
			supervisor.sessionWorkspaces["conversation"] = process.workspace
			supervisor.SetWorkspaceActionHandler(func(string, string, string) (string, error) {
				supervisor.mu.Lock()
				defer supervisor.mu.Unlock()
				testCase.displace(supervisor, process)
				return `{"worktree":"/workspace/project/writer-1"}`, nil
			})

			supervisor.handleWorkspaceAction(bridgeEvent{
				ID:        "conversation",
				Action:    "prepare_coding_worktree",
				RequestID: "request-1",
			})

			commands := stdin.commands(t)
			if !testCase.answered {
				if len(commands) != 0 {
					t.Fatalf("a stopped sidecar was written to: %v", commands)
				}
				return
			}
			if len(commands) != 1 {
				t.Fatalf("want one workspace_action_response, got %v", commands)
			}
			answer := commands[0]
			if answer["action"] != "workspace_action_response" {
				t.Fatalf("unexpected command %v", answer)
			}
			if answer["requestId"] != "request-1" {
				t.Fatalf("answer %v does not carry the request it settles", answer)
			}
			if answer["ok"] != true {
				t.Fatalf("answer reports a failure the handler did not return: %v", answer)
			}
		})
	}
}

// TestProductEventFollowsTheTurnItBelongsTo covers the progress a host-side preparation
// reports while the model waits on it. That preparation outlives the turn whenever the
// user stops it or the Sidecar's wait times out, and its late completion must not put
// the conversation back into a running state that nothing left alive will end.
func TestProductEventFollowsTheTurnItBelongsTo(t *testing.T) {
	var mu sync.Mutex
	var emitted []Event
	supervisor := NewSupervisor(func(event Event) {
		mu.Lock()
		defer mu.Unlock()
		emitted = append(emitted, event)
	})
	supervisor.busySessions["running"] = struct{}{}

	supervisor.EmitProductEvent(Event{SessionID: "running", Type: "tool.started"})
	supervisor.EmitProductEvent(Event{SessionID: "settled", Type: "tool.completed"})
	supervisor.EmitProductEvent(Event{Engine: KernelPi, Type: "engine.stopped"})

	mu.Lock()
	defer mu.Unlock()
	if len(emitted) != 2 {
		t.Fatalf("want the running session and the session-less event, got %v", emitted)
	}
	if emitted[0].SessionID != "running" {
		t.Fatalf("the running turn lost its progress event: %v", emitted[0])
	}
	if emitted[1].Type != "engine.stopped" {
		t.Fatalf("a session-less product event was dropped: %v", emitted[1])
	}
}
