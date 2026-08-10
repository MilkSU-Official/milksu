package codingterminal

import (
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestInteractiveTerminalIsConversationScopedAndStripsProviderKey(t *testing.T) {
	t.Setenv("SHELL", "/bin/sh")
	t.Setenv("HOME", t.TempDir())
	t.Setenv("DEEPSEEK_API_KEY", "must-not-reach-terminal")
	events := make(chan Event, 64)
	manager := NewManager(func(event Event) {
		events <- event
	})
	t.Cleanup(manager.Close)

	workspace := t.TempDir()
	resolvedWorkspace, err := filepath.EvalSymlinks(workspace)
	if err != nil {
		t.Fatal(err)
	}
	started, err := manager.Start("conversation-one", workspace, 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	if started.Status != StatusRunning ||
		started.ConversationID != "conversation-one" ||
		started.Workspace != resolvedWorkspace ||
		started.PID <= 0 {
		t.Fatalf("unexpected terminal session: %#v", started)
	}
	if err := manager.Write(
		"conversation-one",
		started.ID,
		"test -z \"$DEEPSEEK_API_KEY\" && printf 'MILKSU_PTY_OK\\n'\n",
	); err != nil {
		t.Fatal(err)
	}
	waitForTerminalEvent(t, events, func(event Event) bool {
		return event.Type == "terminal.output" &&
			event.TerminalID == started.ID &&
			strings.Contains(event.Data, "MILKSU_PTY_OK")
	})

	resized, err := manager.Resize(
		"conversation-one",
		started.ID,
		132,
		40,
	)
	if err != nil {
		t.Fatal(err)
	}
	if resized.Columns != 132 || resized.Rows != 40 {
		t.Fatalf("terminal size was not retained: %#v", resized)
	}
	if isolated, err := manager.List("conversation-two"); err != nil {
		t.Fatal(err)
	} else if len(isolated) != 0 {
		t.Fatalf("terminal leaked across conversations: %#v", isolated)
	}
	if err := manager.Write("conversation-two", started.ID, "pwd\n"); err == nil {
		t.Fatal("expected cross-conversation terminal write to be rejected")
	}

	if err := manager.Write("conversation-one", started.ID, "exit\n"); err != nil {
		t.Fatal(err)
	}
	exited := waitForTerminalEvent(t, events, func(event Event) bool {
		return event.Type == "terminal.exited" &&
			event.TerminalID == started.ID
	})
	if exited.Session == nil ||
		exited.Session.Status != StatusExited ||
		exited.Session.ExitCode == nil ||
		*exited.Session.ExitCode != 0 {
		t.Fatalf("unexpected terminal exit event: %#v", exited)
	}
}

func TestInteractiveTerminalCanBeStopped(t *testing.T) {
	t.Setenv("SHELL", "/bin/sh")
	t.Setenv("HOME", t.TempDir())
	events := make(chan Event, 64)
	manager := NewManager(func(event Event) {
		events <- event
	})
	t.Cleanup(manager.Close)

	started, err := manager.Start("conversation-stop", t.TempDir(), 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Stop("conversation-stop", started.ID); err != nil {
		t.Fatal(err)
	}
	exited := waitForTerminalEvent(t, events, func(event Event) bool {
		return event.Type == "terminal.exited" &&
			event.TerminalID == started.ID
	})
	if exited.Session == nil || exited.Session.Status != StatusStopped {
		t.Fatalf("unexpected stopped terminal: %#v", exited)
	}
}

func TestListReturnsTerminalTabsInStableCreationOrder(t *testing.T) {
	manager := NewManager(nil)
	manager.sessions = map[string]*terminalSession{
		"term-newest": {
			view: Session{
				ID:             "term-newest",
				ConversationID: "conversation-order",
				StartedAt:      30,
			},
		},
		"term-oldest": {
			view: Session{
				ID:             "term-oldest",
				ConversationID: "conversation-order",
				StartedAt:      10,
			},
		},
		"term-middle": {
			view: Session{
				ID:             "term-middle",
				ConversationID: "conversation-order",
				StartedAt:      20,
			},
		},
		"term-other-conversation": {
			view: Session{
				ID:             "term-other-conversation",
				ConversationID: "conversation-other",
				StartedAt:      5,
			},
		},
	}

	sessions, err := manager.List("conversation-order")
	if err != nil {
		t.Fatal(err)
	}
	if len(sessions) != 3 {
		t.Fatalf("unexpected terminal count: %#v", sessions)
	}
	for index, expected := range []string{
		"term-oldest",
		"term-middle",
		"term-newest",
	} {
		if sessions[index].ID != expected {
			t.Fatalf("terminal tabs are not in creation order: %#v", sessions)
		}
	}
}

func TestTerminalCreationTimestampsAreStrictlyMonotonic(t *testing.T) {
	manager := NewManager(nil)
	manager.mu.Lock()
	first := manager.nextStartedAtLocked()
	second := manager.nextStartedAtLocked()
	manager.mu.Unlock()
	if second <= first {
		t.Fatalf("terminal creation order is not stable: first=%d second=%d", first, second)
	}
}

func TestManagerCloseEndsRunningTerminalsWithoutReconnect(t *testing.T) {
	t.Setenv("SHELL", "/bin/sh")
	t.Setenv("HOME", t.TempDir())
	events := make(chan Event, 64)
	manager := NewManager(func(event Event) {
		events <- event
	})

	started, err := manager.Start("conversation-close", t.TempDir(), 80, 24)
	if err != nil {
		t.Fatal(err)
	}
	manager.Close()
	exited := waitForTerminalEvent(t, events, func(event Event) bool {
		return event.Type == "terminal.exited" &&
			event.TerminalID == started.ID
	})
	if exited.Session == nil ||
		exited.Session.Status != StatusStopped ||
		exited.Session.EndedAt == nil {
		t.Fatalf("closed manager did not make the old PTY visibly stopped: %#v", exited)
	}
	if _, err := manager.Start("conversation-close", t.TempDir(), 80, 24); err == nil ||
		!strings.Contains(err.Error(), "closed") {
		t.Fatalf("closed manager unexpectedly started a reconnectable PTY: %v", err)
	}
}

func TestTerminalEnvironmentKeepsDeveloperEnvironmentWithoutModelCredentials(t *testing.T) {
	environment := terminalEnvironment([]string{
		"PATH=/custom/bin",
		"SSH_AUTH_SOCK=/private/tmp/agent.sock",
		"OPENAI_API_KEY=provider-secret",
		"TERM=dumb",
		"COLORTERM=false",
	})
	joined := strings.Join(environment, "\n")
	for _, expected := range []string{
		"PATH=/custom/bin",
		"SSH_AUTH_SOCK=/private/tmp/agent.sock",
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"MILKSU_TERMINAL=1",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("terminal environment is missing %q: %s", expected, joined)
		}
	}
	if strings.Contains(joined, "OPENAI_API_KEY") {
		t.Fatalf("provider credential leaked into terminal environment: %s", joined)
	}
}

func waitForTerminalEvent(
	t *testing.T,
	events <-chan Event,
	matches func(Event) bool,
) Event {
	t.Helper()
	timer := time.NewTimer(5 * time.Second)
	defer timer.Stop()
	for {
		select {
		case event := <-events:
			if matches(event) {
				return event
			}
		case <-timer.C:
			t.Fatal("timed out waiting for Coding terminal event")
		}
	}
}
