package evalbenchruntime

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/evalbench"
)

const runtimeEventBuffer = 4096
const runtimeTurnDeadlineGrace = 250 * time.Millisecond

type EngineRuntime struct {
	mu               sync.Mutex
	settings         config.AppSettings
	sidecarDirectory string
	supervisor       *engine.Supervisor
	events           chan engine.Event
	closed           bool
}

func NewEngineRuntime(settings config.AppSettings) *EngineRuntime {
	return NewEngineRuntimeAt(settings, "")
}

func NewEngineRuntimeAt(
	settings config.AppSettings,
	sidecarDirectory string,
) *EngineRuntime {
	runtime := &EngineRuntime{
		settings:         settings,
		sidecarDirectory: strings.TrimSpace(sidecarDirectory),
	}
	runtime.replaceSupervisor()
	return runtime
}

func (runtime *EngineRuntime) RunTurn(
	ctx context.Context,
	request evalbench.AgentRuntimeTurnRequest,
) (evalbench.AgentRuntimeTurnResult, error) {
	runtime.mu.Lock()
	if runtime.closed {
		runtime.mu.Unlock()
		return evalbench.AgentRuntimeTurnResult{}, errors.New("PI runtime is closed")
	}
	supervisor := runtime.supervisor
	events := runtime.events
	settings := runtime.settings
	runtime.mu.Unlock()

	if supervisor == nil || events == nil {
		return evalbench.AgentRuntimeTurnResult{}, errors.New("PI runtime is unavailable")
	}
	if timeout, ok := turnActivityTimeoutForContext(ctx, time.Now()); ok {
		if err := supervisor.SetTurnActivityTimeout(timeout); err != nil {
			return evalbench.AgentRuntimeTurnResult{}, err
		}
	}
	if err := supervisor.SendMessage(
		request.SessionID,
		request.Prompt,
		request.WorkspacePath,
		"",
		request.ExecutionMode,
		request.ApprovalPolicy,
		nil,
		"",
		nil,
		nil,
		nil,
		settings,
	); err != nil {
		return evalbench.AgentRuntimeTurnResult{}, err
	}
	return waitForTurn(ctx, supervisor, events, request.SessionID)
}

func turnActivityTimeoutForContext(
	ctx context.Context,
	now time.Time,
) (time.Duration, bool) {
	deadline, ok := ctx.Deadline()
	if !ok {
		return 0, false
	}
	remaining := deadline.Sub(now)
	if remaining <= 0 {
		return 0, false
	}
	return remaining + runtimeTurnDeadlineGrace, true
}

func (runtime *EngineRuntime) Restart(ctx context.Context) error {
	select {
	case <-ctx.Done():
		return ctx.Err()
	default:
	}
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if runtime.closed {
		return errors.New("PI runtime is closed")
	}
	if runtime.supervisor != nil {
		runtime.supervisor.Close()
	}
	runtime.replaceSupervisor()
	return nil
}

func (runtime *EngineRuntime) Close() {
	runtime.mu.Lock()
	defer runtime.mu.Unlock()
	if runtime.closed {
		return
	}
	runtime.closed = true
	if runtime.supervisor != nil {
		runtime.supervisor.Close()
		runtime.supervisor = nil
	}
	runtime.events = nil
}

func (runtime *EngineRuntime) replaceSupervisor() {
	events := make(chan engine.Event, runtimeEventBuffer)
	runtime.events = events
	runtime.supervisor = engine.NewSupervisorWithSidecarDirectory(
		func(event engine.Event) {
			events <- event
		},
		runtime.sidecarDirectory,
	)
}

func waitForTurn(
	ctx context.Context,
	supervisor *engine.Supervisor,
	events <-chan engine.Event,
	sessionID string,
) (evalbench.AgentRuntimeTurnResult, error) {
	result := evalbench.AgentRuntimeTurnResult{}
	toolIndexes := map[string]int{}
	var segment strings.Builder
	completed := false
	for {
		select {
		case <-ctx.Done():
			_ = supervisor.AbortMessage(sessionID)
			return result, ctx.Err()
		case event := <-events:
			if event.SessionID != "" && event.SessionID != sessionID {
				continue
			}
			switch event.Type {
			case "session.ready", "session.policy_updated":
				result.AvailableTools = append([]string(nil), event.Tools...)
				result.ExecutionMode = event.ExecutionMode
				result.ApprovalPolicy = event.ApprovalPolicy
				if event.Type == "session.ready" {
					result.SessionResumed = event.Resumed
				}
			case "assistant.delta":
				segment.WriteString(event.Text)
			case "assistant.segment_completed":
				segment.Reset()
			case "tool.started":
				toolIndexes[event.ToolCallID] = len(result.ToolCalls)
				result.ToolCalls = append(result.ToolCalls, evalbench.AgentRuntimeToolCall{
					Name: event.ToolName,
				})
			case "tool.completed":
				index, exists := toolIndexes[event.ToolCallID]
				if !exists {
					index = len(result.ToolCalls)
					result.ToolCalls = append(result.ToolCalls, evalbench.AgentRuntimeToolCall{
						Name: event.ToolName,
					})
				}
				if event.Error != "" {
					result.ToolCalls[index].Errored = true
				}
			case "assistant.completed":
				if event.Text != "" {
					result.AssistantText = event.Text
				} else {
					result.AssistantText = segment.String()
				}
				completed = true
			case "assistant.settled":
				if completed {
					return result, nil
				}
			case "approval.requested":
				_ = supervisor.RespondToolApproval(
					sessionID,
					event.RequestID,
					false,
				)
				return result, errors.New("safe runtime unexpectedly requested approval")
			case "engine.error", "engine.protocol_error", "engine.stopped":
				message := strings.TrimSpace(event.Error)
				if message == "" {
					message = strings.TrimSpace(event.Text)
				}
				if message == "" {
					message = event.Type
				}
				return result, fmt.Errorf("PI runtime event %s", message)
			}
		}
	}
}
