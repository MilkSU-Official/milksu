package ctf

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestAnalyzeAgentTrajectoryBuildsReplayMetrics(t *testing.T) {
	trajectory := []byte(
		"{\"type\":\"tool.started\",\"toolName\":\"read\",\"timestamp\":\"2026-07-31T10:00:00Z\"}\n" +
			"{\"type\":\"tool.completed\",\"toolName\":\"read\",\"timestamp\":\"2026-07-31T10:00:01Z\"}\n" +
			"{\"type\":\"tool.started\",\"toolName\":\"bash\",\"timestamp\":\"2026-07-31T10:00:02Z\"}\n" +
			"{\"type\":\"tool.completed\",\"toolName\":\"bash\",\"error\":\"exit 1\",\"timestamp\":\"2026-07-31T10:00:03Z\"}\n" +
			"{\"type\":\"assistant.completed\",\"timestamp\":\"2026-07-31T10:00:04Z\"}\n",
	)
	metrics, err := AnalyzeAgentTrajectory(trajectory)
	if err != nil {
		t.Fatal(err)
	}
	digest := sha256.Sum256(trajectory)
	if metrics.EventCount != 5 ||
		metrics.CompletedTurns != 1 ||
		metrics.ToolCalls != 2 ||
		metrics.ToolErrors != 1 ||
		metrics.ToolUsage["read"] != 1 ||
		metrics.ToolUsage["bash"] != 1 ||
		metrics.LastEventType != "assistant.completed" ||
		metrics.TrajectorySHA256 != hex.EncodeToString(digest[:]) {
		t.Fatalf("unexpected trajectory metrics: %#v", metrics)
	}
}

func TestPersistAgentRunCheckpointSurvivesRestartWithoutStoringCandidate(t *testing.T) {
	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, "evidence"), 0o700); err != nil {
		t.Fatal(err)
	}
	trajectory := []byte(
		"{\"type\":\"tool.started\",\"toolName\":\"read\"}\n" +
			"{\"type\":\"assistant.completed\"}\n",
	)
	if err := os.WriteFile(
		filepath.Join(workspace, "evidence", "trajectory.jsonl"),
		trajectory,
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(workspace, "notes.md"),
		[]byte("已确认附件哈希，下一步检查编码。"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	const candidate = "NSSCTF{checkpoint_secret}"
	if err := os.WriteFile(
		filepath.Join(workspace, "candidate-flags.txt"),
		[]byte("# candidates\n"+candidate+"\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	handoff := AgentWorkspaceHandoff{
		JobID:          "job_checkpoint",
		ConversationID: "ctf_checkpoint",
		WorkspacePath:  workspace,
	}
	startedAt := time.Date(2026, 7, 31, 10, 0, 0, 0, time.UTC)
	if err := writeIfMissingAgentRunCheckpoint(
		workspace,
		handoff.JobID,
		handoff.ConversationID,
		startedAt,
	); err != nil {
		t.Fatal(err)
	}
	updatedAt := startedAt.Add(2 * time.Minute)
	checkpoint, err := PersistAgentRunCheckpoint(
		workspace,
		handoff,
		AgentRunSnapshot{
			Status:               "awaiting-user",
			ExitReason:           "turn-complete",
			Model:                "deepseek/deepseek-chat",
			LastAssistantSummary: "已完成第一轮分析。",
		},
		updatedAt,
	)
	if err != nil {
		t.Fatal(err)
	}
	if checkpoint.StartedAt != startedAt ||
		checkpoint.UpdatedAt != updatedAt ||
		checkpoint.Metrics.CompletedTurns != 1 ||
		checkpoint.Metrics.ToolCalls != 1 ||
		checkpoint.CandidateCount != 1 ||
		checkpoint.LatestCandidateSHA256 == "" ||
		!strings.Contains(checkpoint.NotesExcerpt, "附件哈希") ||
		checkpoint.Progress.SchemaVersion != AgentProgressSchemaVersion {
		t.Fatalf("unexpected persisted checkpoint: %#v", checkpoint)
	}
	data, err := os.ReadFile(filepath.Join(workspace, "evidence", "run.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), candidate) {
		t.Fatal("run checkpoint stored the raw candidate")
	}
	loaded, err := LoadAgentRunCheckpoint(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.Metrics.TrajectorySHA256 != checkpoint.Metrics.TrajectorySHA256 ||
		loaded.ExitReason != "turn-complete" {
		t.Fatalf("checkpoint did not survive reload: %#v", loaded)
	}
}

func TestAnalyzeAgentTrajectoryRejectsMalformedEvents(t *testing.T) {
	if _, err := AnalyzeAgentTrajectory([]byte("{\"toolName\":\"read\"}\n")); err == nil {
		t.Fatal("expected missing event type to be rejected")
	}
	if _, err := AnalyzeAgentTrajectory([]byte("{not-json}\n")); err == nil {
		t.Fatal("expected malformed trajectory to be rejected")
	}
}
