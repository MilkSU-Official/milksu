package ctf

import (
	"bufio"
	"bytes"
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

const (
	AgentReplaySchemaVersion = "ctf-agent-replay.milksu.dev/v1alpha1"
	maxAgentReplayEvents     = 1000
	maxAgentReplayTextRunes  = 4000
	maxAgentReplayErrorRunes = 2000
)

type AgentReplayEvent struct {
	Sequence  int    `json:"sequence"`
	Type      string `json:"type"`
	Timestamp string `json:"timestamp,omitempty"`
	Engine    string `json:"engine,omitempty"`
	ToolName  string `json:"toolName,omitempty"`
	Text      string `json:"text,omitempty"`
	Error     string `json:"error,omitempty"`
	Truncated bool   `json:"truncated,omitempty"`
}

type AgentReplay struct {
	SchemaVersion  string             `json:"schemaVersion"`
	JobID          string             `json:"jobId"`
	ConversationID string             `json:"conversationId"`
	Status         string             `json:"status"`
	ExitReason     string             `json:"exitReason,omitempty"`
	Metrics        AgentRunMetrics    `json:"metrics"`
	Events         []AgentReplayEvent `json:"events"`
	Truncated      bool               `json:"truncated"`
}

func ReadAgentReplay(workspacePath string) (AgentReplay, error) {
	checkpoint, err := LoadAgentRunCheckpoint(workspacePath)
	if err != nil {
		return AgentReplay{}, err
	}
	data, err := readOptionalFile(
		filepath.Join(workspacePath, "evidence", "trajectory.jsonl"),
		2*1024*1024,
	)
	if err != nil {
		return AgentReplay{}, err
	}
	metrics, err := AnalyzeAgentTrajectory(data)
	if err != nil {
		return AgentReplay{}, err
	}
	replay := AgentReplay{
		SchemaVersion:  AgentReplaySchemaVersion,
		JobID:          checkpoint.JobID,
		ConversationID: checkpoint.ConversationID,
		Status:         checkpoint.Status,
		ExitReason:     checkpoint.ExitReason,
		Metrics:        metrics,
		Events:         []AgentReplayEvent{},
	}
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
	sequence := 0
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		sequence++
		if len(replay.Events) >= maxAgentReplayEvents {
			replay.Truncated = true
			continue
		}
		var event trajectoryEvent
		if err := json.Unmarshal(line, &event); err != nil {
			return AgentReplay{}, fmt.Errorf("decode PI replay event %d: %w", sequence, err)
		}
		if strings.TrimSpace(event.Type) == "" {
			return AgentReplay{}, fmt.Errorf("PI replay event %d has no type", sequence)
		}
		if event.SessionID != "" && event.SessionID != checkpoint.ConversationID {
			return AgentReplay{}, fmt.Errorf("PI replay event %d belongs to another session", sequence)
		}
		text, textTruncated := truncateReplayText(event.Text, maxAgentReplayTextRunes)
		eventError, errorTruncated := truncateReplayText(event.Error, maxAgentReplayErrorRunes)
		replay.Events = append(replay.Events, AgentReplayEvent{
			Sequence:  sequence,
			Type:      event.Type,
			Timestamp: event.Timestamp,
			Engine:    event.Engine,
			ToolName:  event.ToolName,
			Text:      text,
			Error:     eventError,
			Truncated: textTruncated || errorTruncated,
		})
	}
	if err := scanner.Err(); err != nil {
		return AgentReplay{}, fmt.Errorf("scan PI replay: %w", err)
	}
	return replay, nil
}

func truncateReplayText(value string, maximum int) (string, bool) {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= maximum {
		return value, false
	}
	return string(runes[:maximum]), true
}
