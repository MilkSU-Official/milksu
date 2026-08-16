package engine

import (
	"fmt"
	"strings"
	"time"
)

const backgroundSessionRecoveryTimeout = 20 * time.Second

func hasRunningBackgroundTask(tasks []BackgroundTask) bool {
	for _, task := range tasks {
		if task.Status == "running" {
			return true
		}
	}
	return false
}

// recoverBackgroundTaskSession binds the reviewed Pi extensions to durable
// task metadata after a Sidecar/App restart. It deliberately creates no model
// turn and restores no MCP, browser, or Computer Use capability.
func (s *Supervisor) recoverBackgroundTaskSession(
	sessionID,
	workspace string,
	policy CodingPolicy,
) (bool, error) {
	events := make(chan Event, 4)
	s.addRecoveryWaiter(sessionID, events)
	defer s.removeRecoveryWaiter(sessionID, events)

	s.mu.Lock()
	if s.process == nil || s.process.workspace != workspace {
		s.mu.Unlock()
		return false, fmt.Errorf("Coding workspace changed while background tasks were recovering")
	}
	if _, exists := s.sessions[sessionID]; exists {
		failure := s.recoveryFailures[sessionID]
		s.mu.Unlock()
		if failure != "" {
			return false, fmt.Errorf("%s", failure)
		}
		return false, nil
	}
	delete(s.recoveryFailures, sessionID)
	err := writeCommand(s.process.stdin, map[string]any{
		"action":          "create_session",
		"conversationId":  sessionID,
		"executionMode":   policy.ExecutionMode,
		"approvalPolicy":  policy.ApprovalPolicy,
		"recoveryPurpose": "background-tasks",
	})
	if err == nil {
		// Reserve the session before releasing the process lock so concurrent
		// refreshes cannot enqueue duplicate recovery commands. A bridge error
		// removes this optimistic entry in readEvents.
		s.sessions[sessionID] = struct{}{}
	}
	s.mu.Unlock()
	if err != nil {
		return false, fmt.Errorf("recover background task session: %w", err)
	}

	timer := time.NewTimer(backgroundSessionRecoveryTimeout)
	defer timer.Stop()
	for {
		select {
		case event := <-events:
			switch event.Type {
			case "session.ready":
				return true, nil
			case "engine.error", "session.destroyed", "engine.stopped", "engine.protocol_error":
				return false, fmt.Errorf(
					"recover background task session: %s",
					probeFailureMessage(event),
				)
			}
		case <-timer.C:
			failure := fmt.Sprintf(
				"recover background task session timed out after %s",
				backgroundSessionRecoveryTimeout,
			)
			s.mu.Lock()
			if _, exists := s.sessions[sessionID]; exists {
				s.recoveryFailures[sessionID] = failure
			}
			s.mu.Unlock()
			return false, fmt.Errorf("%s", failure)
		}
	}
}

func (s *Supervisor) addRecoveryWaiter(sessionID string, waiter chan Event) {
	sessionID = strings.TrimSpace(sessionID)
	s.probeMu.Lock()
	defer s.probeMu.Unlock()
	if s.recoveryWaiters[sessionID] == nil {
		s.recoveryWaiters[sessionID] = make(map[chan Event]struct{})
	}
	s.recoveryWaiters[sessionID][waiter] = struct{}{}
}

func (s *Supervisor) removeRecoveryWaiter(sessionID string, waiter chan Event) {
	sessionID = strings.TrimSpace(sessionID)
	s.probeMu.Lock()
	defer s.probeMu.Unlock()
	waiters := s.recoveryWaiters[sessionID]
	delete(waiters, waiter)
	if len(waiters) == 0 {
		delete(s.recoveryWaiters, sessionID)
	}
}
