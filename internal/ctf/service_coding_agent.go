package ctf

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func (s *Service) RecordCodingAgentTurn(
	ctx context.Context,
	jobID, sessionID, model, summary string,
	trajectory []byte,
) (Projection, error) {
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	if core.Job.Role != PackageID || core.Terminal() || core.Outcome != nil {
		return Projection{}, fmt.Errorf("CTF challenge cannot record another Coding Agent turn")
	}
	sessionID = strings.TrimSpace(sessionID)
	model = strings.TrimSpace(model)
	summary = strings.TrimSpace(summary)
	if sessionID == "" || len(sessionID) > 128 || model == "" || len([]rune(model)) > 160 {
		return Projection{}, fmt.Errorf("invalid Coding Agent session identity")
	}
	if summary == "" {
		summary = "PI Coding Agent completed a turn and preserved its tool trajectory."
	}
	if len([]rune(summary)) > 4000 {
		summary = string([]rune(summary)[:4000])
	}
	if len(trajectory) == 0 || len(trajectory) > 2*1024*1024 {
		return Projection{}, fmt.Errorf("Coding Agent trajectory must be between 1 byte and 2 MiB")
	}
	metrics, err := AnalyzeAgentTrajectory(trajectory)
	if err != nil {
		return Projection{}, fmt.Errorf("analyze Coding Agent trajectory: %w", err)
	}
	for _, attempt := range core.Attempts {
		if attempt.Status == securityruntime.AttemptRunning {
			return Projection{}, fmt.Errorf("challenge already has a running attempt")
		}
	}

	now := time.Now().UTC()
	attempt := securityruntime.Attempt{
		ID: securityruntime.NewIdentifier("attempt"), JobID: jobID,
		Engine: "pi", Model: model, Environment: "milksu-ctf-workspace",
		Evaluator: "ctf-candidate-gate@1", Status: securityruntime.AttemptRunning, StartedAt: now,
	}
	if err := s.runtime.StartAttempt(ctx, attempt); err != nil {
		return Projection{}, err
	}
	step := securityruntime.Step{
		ID: securityruntime.NewIdentifier("step"), AttemptID: attempt.ID,
		Name: "pi-coding-agent-turn", Description: "保存 PI 工具轨迹与本轮结论",
		Status: securityruntime.StepRunning, StartedAt: now,
	}
	scope := securityruntime.EventScope{JobID: jobID, AttemptID: attempt.ID, StepID: step.ID}
	if err := s.runtime.StartStep(ctx, scope, step); err != nil {
		return Projection{}, err
	}
	input, _ := json.Marshal(struct {
		SessionID string          `json:"sessionId"`
		Model     string          `json:"model"`
		Metrics   AgentRunMetrics `json:"metrics"`
	}{SessionID: sessionID, Model: model, Metrics: metrics})
	trajectoryDigest := sha256.Sum256(trajectory)
	action := securityruntime.Action{
		ID: securityruntime.NewIdentifier("action"), StepID: step.ID,
		Capability: "pi-coding-agent", Name: "ctf.pi_agent_turn", Input: input,
		Rationale: "在 MilkSU 创建的单题工作区中运行通用 Coding Agent，并把工具轨迹回流到任务事实。",
		ExpectedEffect: securityruntime.EffectSpec{
			Class:          "ctf.agent_trajectory",
			IdempotencyKey: "ctf.pi-turn:" + hex.EncodeToString(trajectoryDigest[:]),
			Cleanup:        "retain the trajectory for replay and review",
			Approval:       "user started PI from the admitted CTF workspace",
			ScopeCheck:     "workspace is bound to the admitted CTF job",
		},
		Status: securityruntime.ActionProposed,
	}
	if err := s.runtime.ProposeAction(ctx, scope, action); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.SetActionStatus(ctx, scope, action.ID, securityruntime.ActionRunning, ""); err != nil {
		return Projection{}, err
	}
	observation := securityruntime.Observation{
		ID: securityruntime.NewIdentifier("observation"), ActionID: action.ID,
		Summary: fmt.Sprintf(
			"%s\n\n运行指标：累计 %d 回合 · %d 次工具调用 · %d 次工具错误。",
			summary,
			metrics.CompletedTurns,
			metrics.ToolCalls,
			metrics.ToolErrors,
		),
		MediaType: "text/markdown; charset=utf-8", Complete: true,
	}
	if err := s.runtime.CommitObservation(ctx, scope, observation); err != nil {
		return Projection{}, err
	}
	artifact, created, reused, err := s.runtime.CommitActionArtifact(
		ctx,
		scope,
		action.ID,
		"application/x-ndjson; profile=\"milksu-pi-trajectory\"",
		trajectory,
	)
	if err != nil {
		return Projection{}, err
	}
	effectState := "committed"
	if reused || !created {
		effectState = "reused"
	}
	effect := securityruntime.Effect{
		ID: securityruntime.NewIdentifier("effect"), ActionID: action.ID,
		Class: action.ExpectedEffect.Class, IdempotencyKey: action.ExpectedEffect.IdempotencyKey,
		State: effectState, Cleanup: action.ExpectedEffect.Cleanup, ArtifactID: artifact.ID,
	}
	if err := s.runtime.CommitEffect(ctx, scope, effect, effectState == "reused"); err != nil {
		return Projection{}, err
	}
	evidence := securityruntime.Evidence{
		ID:             securityruntime.NewIdentifier("evidence"),
		Claim:          "PI Coding Agent 的本轮工具轨迹已保存，可用于复现候选来源",
		ObservationIDs: []string{observation.ID}, ArtifactIDs: []string{artifact.ID},
		Provenance: "MilkSU PI Coding Agent workspace",
	}
	if err := s.runtime.LinkEvidence(ctx, scope, evidence); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.SetActionStatus(ctx, scope, action.ID, securityruntime.ActionCompleted, ""); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.FinishStep(ctx, scope, securityruntime.StepCompleted, ""); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.FinishAttempt(
		ctx,
		jobID,
		attempt.ID,
		securityruntime.AttemptCompleted,
		"PI Coding Agent turn recorded.",
	); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, jobID)
}

func (s *Service) RecordCodingAgentCandidate(
	ctx context.Context,
	jobID, sessionID, candidate, explanation string,
) (Projection, error) {
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	challenge, err := challengeFromProjection(core)
	if err != nil {
		return Projection{}, err
	}
	if core.Terminal() || core.Outcome != nil {
		return Projection{}, fmt.Errorf("CTF challenge cannot accept another Agent candidate")
	}
	sessionID = strings.TrimSpace(sessionID)
	candidate = strings.TrimSpace(candidate)
	explanation = strings.TrimSpace(explanation)
	if sessionID == "" || len(sessionID) > 128 ||
		explanation == "" || len([]rune(explanation)) > 2000 {
		return Projection{}, fmt.Errorf("invalid PI Agent candidate")
	}
	if err := validateCandidateText(candidate); err != nil {
		return Projection{}, fmt.Errorf("invalid PI Agent candidate: %w", err)
	}
	projected, err := Project(core)
	if err != nil {
		return Projection{}, err
	}
	for _, existing := range projected.AgentCandidates {
		if existing.Candidate == candidate {
			return projected, nil
		}
	}
	artifact, _, err := s.runtime.AdmitArtifact(
		ctx,
		jobID,
		"pi-agent-candidate:"+sessionID,
		"text/plain; charset=utf-8",
		[]byte(candidate),
	)
	if err != nil {
		return Projection{}, err
	}
	record := AgentCandidate{
		ID: securityruntime.NewIdentifier("agent_candidate"), SessionID: sessionID,
		Candidate: candidate, Explanation: explanation, ArtifactID: artifact.ID,
		Assessment: assessCandidate(candidate, challenge.ExternalPlatform),
		CreatedAt:  time.Now().UTC(),
	}
	data, err := json.Marshal(record)
	if err != nil {
		return Projection{}, err
	}
	fact := securityruntime.RoleFact{
		ID: securityruntime.NewIdentifier("fact"), PackageID: PackageID, SchemaVersion: SchemaVersion,
		Kind: FactAgentCandidate, ArtifactIDs: []string{artifact.ID}, Data: data,
	}
	if err := s.runtime.CommitRoleFact(ctx, securityruntime.EventScope{JobID: jobID}, fact); err != nil {
		return Projection{}, err
	}
	if challenge.Judge.Type == "external.manual" {
		return s.GetJob(ctx, jobID)
	}
	// A local candidate is still recorded as a fact. The existing typed CTF
	// runner remains responsible for invoking local Judge evaluation until a
	// generic local candidate gate is introduced.
	return s.GetJob(ctx, jobID)
}
