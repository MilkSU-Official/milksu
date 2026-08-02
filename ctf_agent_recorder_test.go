package main

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"path/filepath"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

type recorderArtifactReader map[string][]byte

func (r recorderArtifactReader) ReadArtifact(
	_ context.Context,
	artifact securityruntime.Artifact,
) ([]byte, error) {
	return append([]byte{}, r[artifact.ID]...), nil
}

func TestCTFAgentSessionPreservesAssistantSummaryAcrossToolEvents(t *testing.T) {
	session := &ctfAgentSession{status: "ready"}
	session.applyEvent(engine.Event{
		Type: "assistant.completed",
		Text: "已确认题面入口，下一步检查附件。",
	})
	session.applyEvent(engine.Event{
		Type: "tool.started", ToolName: "read", Text: "materials/challenge.txt",
	})
	session.applyEvent(engine.Event{
		Type: "tool.completed", ToolName: "read", Text: "untrusted tool output",
	})
	if session.lastAssistantSummary != "已确认题面入口，下一步检查附件。" {
		t.Fatalf("tool output overwrote assistant summary: %#v", session)
	}
	if session.status != "running" || session.exitReason != "" {
		t.Fatalf("tool event did not transition the run to running: %#v", session)
	}
}

func TestEndpointRequestToolEventProjectsOnlyAValidatedPendingProposal(t *testing.T) {
	valid := map[string]any{
		"kind":        "ctf_endpoint_request",
		"protocol":    "https",
		"endpoint":    "https://challenge.example.test:8443",
		"source":      "题目页面显示的实例入口",
		"purpose":     "读取 HTTP 基线",
		"requestedBy": "agent",
		"status":      "pending_user_approval",
	}
	data, err := json.Marshal(valid)
	if err != nil {
		t.Fatal(err)
	}
	request, requested, err := endpointRequestFromToolEvent(engine.Event{
		Type: "tool.completed", ToolName: "ctf_request_endpoint", Text: string(data),
	})
	if err != nil {
		t.Fatal(err)
	}
	if !requested ||
		request.Protocol != ctf.EndpointProtocolHTTPS ||
		request.Endpoint != "https://challenge.example.test:8443" ||
		request.Source != "题目页面显示的实例入口" ||
		request.Purpose != "读取 HTTP 基线" {
		t.Fatalf("valid request tool result was not projected: %+v requested=%t", request, requested)
	}
	for _, event := range []engine.Event{
		{Type: "tool.started", ToolName: "ctf_request_endpoint", Text: string(data)},
		{Type: "tool.completed", ToolName: "ctf_request_endpoint", Text: string(data), Error: "rejected"},
		{Type: "tool.completed", ToolName: "read", Text: string(data)},
	} {
		if _, requested, err := endpointRequestFromToolEvent(event); err != nil || requested {
			t.Fatalf("non-success Endpoint event created a request: event=%+v requested=%t err=%v", event, requested, err)
		}
	}
	valid["requestedBy"] = "user"
	data, _ = json.Marshal(valid)
	if _, requested, err := endpointRequestFromToolEvent(engine.Event{
		Type: "tool.completed", ToolName: "ctf_request_endpoint", Text: string(data),
	}); err == nil || requested {
		t.Fatalf("forged requester was accepted: requested=%t err=%v", requested, err)
	}
}

func TestCTFAgentSessionKeepsToolSegmentRunning(t *testing.T) {
	session := &ctfAgentSession{status: "running"}
	session.applyEvent(engine.Event{
		Type: "assistant.segment_completed",
		Text: "先执行格式校验。",
	})
	if session.status != "running" ||
		session.exitReason != "" ||
		session.lastAssistantSummary != "先执行格式校验。" {
		t.Fatalf("tool-bound assistant segment ended the turn: %#v", session)
	}
}

func TestCTFAgentSessionPreservesFailureAfterSessionDestroyed(t *testing.T) {
	session := &ctfAgentSession{status: "running"}
	session.applyEvent(engine.Event{Type: "engine.error", Error: "provider unavailable"})
	session.applyEvent(engine.Event{Type: "session.destroyed"})
	if session.status != "failed" || session.exitReason != "engine-error" {
		t.Fatalf("session destruction downgraded a failed run: %#v", session)
	}
}

func TestCTFAgentSessionDetectsRepeatedCallsAndFailures(t *testing.T) {
	t.Run("same tool call", func(t *testing.T) {
		session := &ctfAgentSession{status: "running"}
		for attempt := 1; attempt <= 3; attempt++ {
			reason := session.applyEvent(engine.Event{
				Type: "tool.started", ToolName: "bash", Text: "same input",
			})
			if attempt < 3 && reason != "" {
				t.Fatalf("loop detected too early at attempt %d", attempt)
			}
			if attempt == 3 && reason != "same-tool-call-repeated" {
				t.Fatalf("third repeated tool call was not stopped: %q", reason)
			}
		}
		if session.status != "paused" ||
			session.exitReason != "same-tool-call-repeated" {
			t.Fatalf("repeated call did not preserve its exit reason: %#v", session)
		}
		session.applyEvent(engine.Event{Type: "session.destroyed"})
		if session.exitReason != "same-tool-call-repeated" {
			t.Fatalf("session destruction hid the loop reason: %#v", session)
		}
	})

	t.Run("same tool failure", func(t *testing.T) {
		session := &ctfAgentSession{status: "running"}
		for attempt := 1; attempt <= 3; attempt++ {
			reason := session.applyEvent(engine.Event{
				Type: "tool.completed", ToolName: "read", Error: "permission denied",
			})
			if attempt < 3 && reason != "" {
				t.Fatalf("failure loop detected too early at attempt %d", attempt)
			}
			if attempt == 3 && reason != "same-tool-failure-repeated" {
				t.Fatalf("third repeated failure was not stopped: %q", reason)
			}
		}
		if session.repeatedToolFailures != 3 ||
			session.exitReason != "same-tool-failure-repeated" {
			t.Fatalf("repeated failure state is incomplete: %#v", session)
		}
	})
}

func TestCTFAgentRecorderRestoresCheckpointAfterApplicationRestart(t *testing.T) {
	materialData := []byte("fixture")
	digest := sha256.Sum256(materialData)
	digestText := hex.EncodeToString(digest[:])
	artifact := securityruntime.Artifact{
		ID:        "artifact_restart",
		JobID:     "job_restart",
		SHA256:    digestText,
		MediaType: "text/plain",
		Size:      int64(len(materialData)),
	}
	projection := ctf.Projection{
		Job: securityruntime.Job{ID: "job_restart"},
		Challenge: ctf.ChallengeView{
			ID:                "challenge_restart",
			Title:             "Restart fixture",
			Statement:         "Resume this challenge.",
			Category:          "misc",
			CollaborationMode: "copilot",
			Materials: []ctf.Material{{
				ArtifactID: artifact.ID,
				Name:       "fixture.txt",
				MediaType:  artifact.MediaType,
				SHA256:     digestText,
				Size:       artifact.Size,
				Provenance: "test",
			}},
		},
		Artifacts: []securityruntime.Artifact{artifact},
	}
	root := filepath.Join(t.TempDir(), "ctf-workspaces")
	handoff, err := ctf.PrepareAgentWorkspace(
		context.Background(),
		root,
		projection,
		recorderArtifactReader{artifact.ID: materialData},
	)
	if err != nil {
		t.Fatal(err)
	}
	_, err = ctf.PersistAgentRunCheckpoint(
		handoff.WorkspacePath,
		handoff,
		ctf.AgentRunSnapshot{
			Status:                 "paused",
			ExitReason:             "same-tool-failure-repeated",
			Model:                  "deepseek/deepseek-v4-flash",
			LastToolFingerprint:    "tool-fingerprint",
			RepeatedToolUses:       2,
			LastFailureFingerprint: "failure-fingerprint",
			RepeatedFailures:       3,
			LastAssistantSummary:   "先前回合已经验证附件哈希。",
		},
		time.Now().UTC(),
	)
	if err != nil {
		t.Fatal(err)
	}

	// A new recorder represents the next native application process. It has no
	// in-memory session and must recover solely from the user-data workspace.
	restarted := newCTFAgentRecorder(root, nil, nil)
	session, err := restarted.resolveSession(handoff.ConversationID, handoff.WorkspacePath)
	if err != nil {
		t.Fatal(err)
	}
	if session == nil ||
		session.status != "paused" ||
		session.exitReason != "same-tool-failure-repeated" ||
		session.repeatedToolFailures != 3 ||
		session.lastAssistantSummary != "先前回合已经验证附件哈希。" {
		t.Fatalf("restart did not restore the durable CTF Agent state: %#v", session)
	}
	if session.handoff.Prompt == handoff.Prompt ||
		session.handoff.Run.ExitReason != "same-tool-failure-repeated" {
		t.Fatalf("restart did not return the resume handoff: %#v", session.handoff)
	}
	toolHandoff, err := ctf.LoadAgentToolBuilderHandoff(handoff.WorkspacePath)
	if err != nil {
		t.Fatal(err)
	}
	toolSession, err := restarted.resolveSession(
		toolHandoff.ConversationID,
		toolHandoff.WorkspacePath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if toolSession == nil ||
		toolSession.handoff.Role != ctf.AgentWorkspaceRoleToolBuilder ||
		toolSession.handoff.ConversationID == handoff.ConversationID ||
		toolSession.status != "ready" ||
		toolSession.exitReason != "" ||
		toolSession.lastFailure != "" {
		t.Fatalf("tool-builder session was not recovered independently: %#v", toolSession)
	}
	strategistHandoff, err := ctf.LoadAgentStrategistHandoff(handoff.WorkspacePath)
	if err != nil {
		t.Fatal(err)
	}
	strategistSession, err := restarted.resolveSession(
		strategistHandoff.ConversationID,
		strategistHandoff.WorkspacePath,
	)
	if err != nil {
		t.Fatal(err)
	}
	if strategistSession == nil ||
		strategistSession.handoff.Role != ctf.AgentWorkspaceRoleStrategist ||
		strategistSession.handoff.ConversationID == handoff.ConversationID ||
		strategistSession.handoff.ConversationID == toolHandoff.ConversationID ||
		strategistSession.status != "ready" ||
		strategistSession.exitReason != "" ||
		strategistSession.lastFailure != "" {
		t.Fatalf("strategist session was not recovered independently: %#v", strategistSession)
	}
}
