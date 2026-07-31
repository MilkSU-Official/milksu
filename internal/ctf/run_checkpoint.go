package ctf

import (
	"bufio"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

const AgentRunSchemaVersion = "ctf-agent-run.milksu.dev/v1alpha1"

type AgentRunMetrics struct {
	EventCount       int            `json:"eventCount"`
	CompletedTurns   int            `json:"completedTurns"`
	ToolCalls        int            `json:"toolCalls"`
	ToolErrors       int            `json:"toolErrors"`
	ToolUsage        map[string]int `json:"toolUsage"`
	LastEventType    string         `json:"lastEventType,omitempty"`
	TrajectorySHA256 string         `json:"trajectorySha256,omitempty"`
}

type AgentRunCheckpoint struct {
	SchemaVersion          string          `json:"schemaVersion"`
	JobID                  string          `json:"jobId"`
	ConversationID         string          `json:"conversationId"`
	Status                 string          `json:"status"`
	ExitReason             string          `json:"exitReason,omitempty"`
	Model                  string          `json:"model,omitempty"`
	StartedAt              time.Time       `json:"startedAt"`
	UpdatedAt              time.Time       `json:"updatedAt"`
	Metrics                AgentRunMetrics `json:"metrics"`
	LastToolFingerprint    string          `json:"lastToolFingerprint,omitempty"`
	RepeatedToolUses       int             `json:"repeatedToolUses,omitempty"`
	LastFailureFingerprint string          `json:"lastFailureFingerprint,omitempty"`
	RepeatedFailures       int             `json:"repeatedFailures,omitempty"`
	LastAssistantSummary   string          `json:"lastAssistantSummary,omitempty"`
	NotesExcerpt           string          `json:"notesExcerpt,omitempty"`
	CandidateCount         int             `json:"candidateCount"`
	LatestCandidateSHA256  string          `json:"latestCandidateSha256,omitempty"`
	Progress               AgentProgress   `json:"progress"`
}

type AgentRunSnapshot struct {
	Status                 string
	ExitReason             string
	Model                  string
	LastToolFingerprint    string
	RepeatedToolUses       int
	LastFailureFingerprint string
	RepeatedFailures       int
	LastAssistantSummary   string
}

type trajectoryEvent struct {
	SessionID string `json:"sessionId"`
	Engine    string `json:"engine"`
	Type      string `json:"type"`
	ToolName  string `json:"toolName"`
	Text      string `json:"text"`
	Error     string `json:"error"`
	Timestamp string `json:"timestamp"`
}

func writeIfMissingAgentRunCheckpoint(
	workspacePath, jobID, conversationID string,
	now time.Time,
) error {
	checkpoint := AgentRunCheckpoint{
		SchemaVersion:  AgentRunSchemaVersion,
		JobID:          jobID,
		ConversationID: conversationID,
		Status:         "ready",
		StartedAt:      now,
		UpdatedAt:      now,
		Metrics: AgentRunMetrics{
			ToolUsage: map[string]int{},
		},
	}
	data, err := json.MarshalIndent(checkpoint, "", "  ")
	if err != nil {
		return fmt.Errorf("encode CTF Agent run checkpoint: %w", err)
	}
	return writeIfMissing(
		filepath.Join(workspacePath, "evidence", "run.json"),
		append(data, '\n'),
		0o600,
	)
}

func LoadAgentRunCheckpoint(workspacePath string) (AgentRunCheckpoint, error) {
	data, err := os.ReadFile(filepath.Join(workspacePath, "evidence", "run.json"))
	if err != nil {
		return AgentRunCheckpoint{}, fmt.Errorf("read CTF Agent run checkpoint: %w", err)
	}
	var checkpoint AgentRunCheckpoint
	if err := json.Unmarshal(data, &checkpoint); err != nil {
		return AgentRunCheckpoint{}, fmt.Errorf("decode CTF Agent run checkpoint: %w", err)
	}
	if checkpoint.SchemaVersion != AgentRunSchemaVersion ||
		checkpoint.JobID == "" ||
		checkpoint.ConversationID == "" ||
		checkpoint.Status == "" ||
		checkpoint.StartedAt.IsZero() ||
		checkpoint.UpdatedAt.IsZero() {
		return AgentRunCheckpoint{}, fmt.Errorf("invalid CTF Agent run checkpoint")
	}
	if checkpoint.Metrics.ToolUsage == nil {
		checkpoint.Metrics.ToolUsage = map[string]int{}
	}
	notes, notesErr := readOptionalFile(filepath.Join(workspacePath, "notes.md"), 256*1024)
	if notesErr != nil {
		return AgentRunCheckpoint{}, notesErr
	}
	strategyReview, strategyErr := readOptionalFile(
		filepath.Join(workspacePath, "work", "strategy-review.md"),
		256*1024,
	)
	if strategyErr != nil {
		return AgentRunCheckpoint{}, strategyErr
	}
	checkpoint.Progress = buildAgentProgress(notes, strategyReview, checkpoint)
	return checkpoint, nil
}

func PersistAgentRunCheckpoint(
	workspacePath string,
	handoff AgentWorkspaceHandoff,
	snapshot AgentRunSnapshot,
	now time.Time,
) (AgentRunCheckpoint, error) {
	checkpoint, err := LoadAgentRunCheckpoint(workspacePath)
	if err != nil {
		if !os.IsNotExist(rootCause(err)) {
			return AgentRunCheckpoint{}, err
		}
		if err := writeIfMissingAgentRunCheckpoint(
			workspacePath,
			handoff.JobID,
			handoff.ConversationID,
			now,
		); err != nil {
			return AgentRunCheckpoint{}, err
		}
		checkpoint, err = LoadAgentRunCheckpoint(workspacePath)
		if err != nil {
			return AgentRunCheckpoint{}, err
		}
	}
	if checkpoint.JobID != handoff.JobID ||
		checkpoint.ConversationID != handoff.ConversationID {
		return AgentRunCheckpoint{}, fmt.Errorf("CTF Agent run checkpoint does not match its workspace")
	}

	trajectory, err := readOptionalFile(
		filepath.Join(workspacePath, "evidence", "trajectory.jsonl"),
		2*1024*1024,
	)
	if err != nil {
		return AgentRunCheckpoint{}, err
	}
	metrics, err := AnalyzeAgentTrajectory(trajectory)
	if err != nil {
		return AgentRunCheckpoint{}, err
	}
	notes, err := readOptionalFile(filepath.Join(workspacePath, "notes.md"), 256*1024)
	if err != nil {
		return AgentRunCheckpoint{}, err
	}
	candidates, err := readOptionalFile(
		filepath.Join(workspacePath, "candidate-flags.txt"),
		64*1024,
	)
	if err != nil {
		return AgentRunCheckpoint{}, err
	}
	candidateCount, latestCandidateDigest := summarizeCandidates(candidates)
	strategyReview, err := readOptionalFile(
		filepath.Join(workspacePath, "work", "strategy-review.md"),
		256*1024,
	)
	if err != nil {
		return AgentRunCheckpoint{}, err
	}

	checkpoint.Status = defaultString(snapshot.Status, checkpoint.Status)
	checkpoint.ExitReason = snapshot.ExitReason
	checkpoint.Model = defaultString(snapshot.Model, checkpoint.Model)
	checkpoint.UpdatedAt = now
	checkpoint.Metrics = metrics
	checkpoint.LastToolFingerprint = snapshot.LastToolFingerprint
	checkpoint.RepeatedToolUses = snapshot.RepeatedToolUses
	checkpoint.LastFailureFingerprint = snapshot.LastFailureFingerprint
	checkpoint.RepeatedFailures = snapshot.RepeatedFailures
	checkpoint.LastAssistantSummary = truncateRunes(
		defaultString(snapshot.LastAssistantSummary, checkpoint.LastAssistantSummary),
		800,
	)
	checkpoint.NotesExcerpt = truncateRunes(strings.TrimSpace(string(notes)), 1600)
	checkpoint.CandidateCount = candidateCount
	checkpoint.LatestCandidateSHA256 = latestCandidateDigest
	checkpoint.Progress = buildAgentProgress(notes, strategyReview, checkpoint)

	data, err := json.MarshalIndent(checkpoint, "", "  ")
	if err != nil {
		return AgentRunCheckpoint{}, fmt.Errorf("encode CTF Agent run checkpoint: %w", err)
	}
	if err := atomicWrite(
		filepath.Join(workspacePath, "evidence", "run.json"),
		append(data, '\n'),
		0o600,
	); err != nil {
		return AgentRunCheckpoint{}, err
	}
	return checkpoint, nil
}

func AnalyzeAgentTrajectory(data []byte) (AgentRunMetrics, error) {
	metrics := AgentRunMetrics{ToolUsage: map[string]int{}}
	if len(data) == 0 {
		return metrics, nil
	}
	if len(data) > 2*1024*1024 {
		return AgentRunMetrics{}, fmt.Errorf("PI trajectory exceeds 2 MiB")
	}
	digest := sha256.Sum256(data)
	metrics.TrajectorySHA256 = hex.EncodeToString(digest[:])

	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 64*1024), 2*1024*1024)
	for scanner.Scan() {
		line := bytes.TrimSpace(scanner.Bytes())
		if len(line) == 0 {
			continue
		}
		var event trajectoryEvent
		if err := json.Unmarshal(line, &event); err != nil {
			return AgentRunMetrics{}, fmt.Errorf("decode PI trajectory event %d: %w", metrics.EventCount+1, err)
		}
		if strings.TrimSpace(event.Type) == "" {
			return AgentRunMetrics{}, fmt.Errorf("PI trajectory event %d has no type", metrics.EventCount+1)
		}
		metrics.EventCount++
		metrics.LastEventType = event.Type
		switch event.Type {
		case "assistant.completed":
			metrics.CompletedTurns++
		case "tool.started":
			metrics.ToolCalls++
			toolName := strings.TrimSpace(event.ToolName)
			if toolName == "" {
				toolName = "unknown"
			}
			metrics.ToolUsage[toolName]++
		case "tool.completed":
			if strings.TrimSpace(event.Error) != "" {
				metrics.ToolErrors++
			}
		}
	}
	if err := scanner.Err(); err != nil {
		return AgentRunMetrics{}, fmt.Errorf("scan PI trajectory: %w", err)
	}
	return metrics, nil
}

func summarizeCandidates(data []byte) (int, string) {
	count := 0
	latest := ""
	for _, line := range strings.Split(string(data), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") || len([]rune(line)) > 512 {
			continue
		}
		count++
		latest = line
	}
	if latest == "" {
		return count, ""
	}
	digest := sha256.Sum256([]byte(latest))
	return count, hex.EncodeToString(digest[:])
}

func readOptionalFile(path string, maxBytes int) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, fmt.Errorf("read CTF Agent workspace file: %w", err)
	}
	if len(data) > maxBytes {
		return nil, fmt.Errorf("CTF Agent workspace file exceeds %d bytes", maxBytes)
	}
	return data, nil
}

func defaultString(value, fallback string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallback
}

func truncateRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit])
}

func rootCause(err error) error {
	for {
		unwrapped, ok := err.(interface{ Unwrap() error })
		if !ok {
			return err
		}
		next := unwrapped.Unwrap()
		if next == nil {
			return err
		}
		err = next
	}
}
