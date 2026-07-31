package ctf

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestReadAgentReplayReturnsBoundedStructuredEvents(t *testing.T) {
	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, "evidence"), 0o700); err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	if err := writeIfMissingAgentRunCheckpoint(
		workspace,
		"job_replay",
		"ctf_replay",
		now,
	); err != nil {
		t.Fatal(err)
	}
	longOutput := strings.Repeat("观察", maxAgentReplayTextRunes+10)
	trajectory := strings.Join([]string{
		`{"sessionId":"ctf_replay","engine":"pi","type":"tool.started","toolName":"read","text":"materials/challenge.txt","timestamp":"2026-07-31T10:00:00Z"}`,
		`{"sessionId":"ctf_replay","engine":"pi","type":"tool.completed","toolName":"read","text":"` + longOutput + `","timestamp":"2026-07-31T10:00:01Z"}`,
		`{"sessionId":"ctf_replay","engine":"pi","type":"assistant.completed","text":"完成一轮检查。","timestamp":"2026-07-31T10:00:02Z"}`,
	}, "\n") + "\n"
	if err := os.WriteFile(
		filepath.Join(workspace, "evidence", "trajectory.jsonl"),
		[]byte(trajectory),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	handoff := AgentWorkspaceHandoff{
		JobID: "job_replay", ConversationID: "ctf_replay", WorkspacePath: workspace,
	}
	if _, err := PersistAgentRunCheckpoint(
		workspace,
		handoff,
		AgentRunSnapshot{Status: "awaiting-user", ExitReason: "turn-complete"},
		now.Add(time.Minute),
	); err != nil {
		t.Fatal(err)
	}

	replay, err := ReadAgentReplay(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if replay.SchemaVersion != AgentReplaySchemaVersion ||
		replay.JobID != "job_replay" ||
		replay.Status != "awaiting-user" ||
		replay.ExitReason != "turn-complete" ||
		len(replay.Events) != 3 ||
		replay.Metrics.ToolCalls != 1 ||
		replay.Metrics.CompletedTurns != 1 {
		t.Fatalf("unexpected replay: %#v", replay)
	}
	if !replay.Events[1].Truncated ||
		len([]rune(replay.Events[1].Text)) != maxAgentReplayTextRunes ||
		replay.Events[0].Sequence != 1 ||
		replay.Events[2].Text != "完成一轮检查。" {
		t.Fatalf("replay event content was not bounded or ordered: %#v", replay.Events)
	}
}

func TestReadAgentReplayRejectsAnotherSessionTrajectory(t *testing.T) {
	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, "evidence"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := writeIfMissingAgentRunCheckpoint(
		workspace,
		"job_replay",
		"ctf_expected",
		time.Now().UTC(),
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(workspace, "evidence", "trajectory.jsonl"),
		[]byte(`{"sessionId":"ctf_other","type":"assistant.completed"}`+"\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if _, err := ReadAgentReplay(workspace); err == nil {
		t.Fatal("trajectory from another PI session was accepted")
	}
}
