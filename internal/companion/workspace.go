package companion

import (
	"encoding/json"
	"fmt"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/engine"
)

func (r *Runtime) handleWorkspace(input map[string]any) (any, error) {
	if r == nil || r.workspace == nil {
		return nil, fmt.Errorf("companion workspace is not configured")
	}
	action := strings.TrimSpace(stringValue(input["action"]))
	if action == "" {
		return nil, fmt.Errorf("workspace action is required")
	}
	if action == "compact_context" {
		return nil, fmt.Errorf("compact_context stays on that conversation's milksu_workspace")
	}
	conversationID := strings.TrimSpace(stringValue(input["conversationId"]))
	encoded, err := json.Marshal(input)
	if err != nil {
		return nil, err
	}
	raw, err := r.workspace(conversationID, action, string(encoded))
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(raw) == "" {
		return map[string]any{"ok": true}, nil
	}
	var parsed any
	if err := json.Unmarshal([]byte(raw), &parsed); err != nil {
		return raw, nil
	}
	return parsed, nil
}

func (r *Runtime) workspaceHost(requestID string, input map[string]any) (bool, any, error) {
	result, err := r.handleWorkspace(input)
	if err != nil {
		return false, nil, err
	}
	parsed, _ := result.(map[string]any)
	if parsed == nil || !boolValue(parsed["needsConfirmation"]) {
		return false, result, nil
	}
	parked := map[string]any{}
	for key, value := range input {
		parked[key] = value
	}
	if token := strings.TrimSpace(stringValue(parsed["confirmationToken"])); token != "" {
		parked["confirmationToken"] = token
	}
	summary := strings.TrimSpace(stringValue(parsed["summary"]))
	if strings.TrimSpace(stringValue(parked["text"])) == "" {
		parked["text"] = summary
	}
	r.parkConfirm(requestID, parked, summary)
	payload := map[string]any{}
	for key, value := range parked {
		if key == "confirmationToken" {
			continue
		}
		payload[key] = value
	}
	payload["hostRequestId"] = requestID
	encoded, _ := json.Marshal(payload)
	r.emitEvent(engine.Event{
		Type:      "companion.confirm",
		RequestID: requestID,
		Input:     string(encoded),
		Notice:    summary,
	})
	return true, nil, nil
}
