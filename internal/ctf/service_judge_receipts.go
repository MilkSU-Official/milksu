package ctf

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func (s *Service) RecordExternalJudgeReceipt(
	ctx context.Context,
	jobID string,
	request ExternalJudgeReceiptRequest,
) (Projection, error) {
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	challenge, err := challengeFromProjection(core)
	if err != nil {
		return Projection{}, err
	}
	if challenge.Judge.Type != "external.manual" || core.Terminal() || core.Outcome != nil {
		return Projection{}, fmt.Errorf("challenge does not accept an external Judge receipt")
	}
	platform := strings.ToLower(strings.TrimSpace(request.Platform))
	status := strings.ToLower(strings.TrimSpace(request.Status))
	summary := strings.TrimSpace(request.Summary)
	reference := strings.TrimSpace(request.Reference)
	if platform == "" || platform != challenge.ExternalPlatform ||
		(status != "accepted" && status != "rejected" && status != "ambiguous" && status != "error") ||
		summary == "" || len([]rune(summary)) > 2000 || reference == "" || len([]rune(reference)) > 1000 {
		return Projection{}, fmt.Errorf("invalid external Judge receipt")
	}
	if (status == "accepted" && (request.Correct == nil || !*request.Correct)) ||
		(status == "rejected" && (request.Correct == nil || *request.Correct)) ||
		((status == "ambiguous" || status == "error") && request.Correct != nil) {
		return Projection{}, fmt.Errorf("external Judge receipt status and verdict disagree")
	}
	receipt := ExternalJudgeReceipt{
		ID: securityruntime.NewIdentifier("judge_receipt"), Platform: platform, Status: status,
		Correct: request.Correct, Summary: summary, Reference: reference, RecordedAt: time.Now().UTC(),
	}
	data, err := json.Marshal(receipt)
	if err != nil {
		return Projection{}, err
	}
	fact := securityruntime.RoleFact{
		ID: securityruntime.NewIdentifier("fact"), PackageID: PackageID, SchemaVersion: SchemaVersion,
		Kind: FactJudgeReceipt, Data: data,
	}
	if err := s.runtime.CommitRoleFact(ctx, securityruntime.EventScope{JobID: jobID}, fact); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, jobID)
}

// RecordAuthorityReceipt commits a typed, evidence-backed verdict from an
// application-owned local authority. It is intentionally limited to admitted
// local-lab challenges so it cannot replace an external platform Judge.
func (s *Service) RecordAuthorityReceipt(
	ctx context.Context,
	jobID string,
	request AuthorityReceiptRequest,
) (Projection, error) {
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	challenge, err := challengeFromProjection(core)
	if err != nil {
		return Projection{}, err
	}
	if core.Terminal() {
		return s.GetJob(ctx, jobID)
	}
	if challenge.Source.Kind != "local-lab" || challenge.Judge.Type != "external.manual" {
		return Projection{}, fmt.Errorf("challenge does not accept a managed-lab authority receipt")
	}
	evaluator := strings.ToLower(strings.TrimSpace(request.Evaluator))
	version := strings.TrimSpace(request.Version)
	summary := strings.TrimSpace(request.Summary)
	reference := strings.TrimSpace(request.Reference)
	if evaluator != "milksu-managed-lab" ||
		version == "" || len(version) > 64 ||
		summary == "" || len([]rune(summary)) > 2000 ||
		!strings.HasPrefix(reference, "managed-lab://") || len(reference) > 1000 {
		return Projection{}, fmt.Errorf("invalid managed-lab authority receipt")
	}
	s.mu.Lock()
	active := s.active[jobID] != nil
	s.mu.Unlock()
	if active {
		return Projection{}, fmt.Errorf("wait for the current Agent turn before checking lab completion")
	}
	for _, attempt := range core.Attempts {
		if attempt.Status == securityruntime.AttemptRunning {
			return Projection{}, fmt.Errorf("challenge already has a running attempt")
		}
	}

	now := time.Now().UTC()
	attempt := securityruntime.Attempt{
		ID: securityruntime.NewIdentifier("attempt"), JobID: jobID,
		Engine: "managed-lab", Model: "application-oracle", Environment: challenge.Source.URI,
		Evaluator: evaluator + "@" + version, Status: securityruntime.AttemptRunning, StartedAt: now,
	}
	if err := s.runtime.StartAttempt(ctx, attempt); err != nil {
		return Projection{}, err
	}
	step := securityruntime.Step{
		ID: securityruntime.NewIdentifier("step"), AttemptID: attempt.ID,
		Name:        "managed-lab-authority-check",
		Description: "向当前 LabPackage 的只读完成判定器查询挑战状态",
		Status:      securityruntime.StepRunning, StartedAt: now,
	}
	scope := securityruntime.EventScope{JobID: jobID, AttemptID: attempt.ID, StepID: step.ID}
	if err := s.runtime.StartStep(ctx, scope, step); err != nil {
		return Projection{}, err
	}
	input, _ := json.Marshal(request)
	action := securityruntime.Action{
		ID: securityruntime.NewIdentifier("action"), StepID: step.ID,
		Capability: CapabilityName, Name: "ctf.verify_managed_lab", Input: input,
		Rationale: "读取当前隔离靶场的应用内完成状态，不提交候选或修改环境。",
		ExpectedEffect: securityruntime.EffectSpec{
			Class:          "managed_lab.authority_check",
			IdempotencyKey: "ctf.managed-lab-check:" + attempt.ID,
			Approval:       "用户启动了当前 MilkSU 托管靶场",
			ScopeCheck:     "authority reference must match the admitted local-lab instance",
			Cleanup:        "read-only check; no cleanup required",
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
		Summary: summary, MediaType: "application/vnd.milksu.managed-lab-receipt+json", Complete: true,
	}
	if err := s.runtime.CommitObservation(ctx, scope, observation); err != nil {
		return Projection{}, err
	}
	artifact, _, _, err := s.runtime.CommitActionArtifact(
		ctx,
		scope,
		action.ID,
		"application/vnd.milksu.managed-lab-receipt+json",
		input,
	)
	if err != nil {
		return Projection{}, err
	}
	evidence := securityruntime.Evidence{
		ID:             securityruntime.NewIdentifier("evidence"),
		Claim:          "MilkSU 托管靶场的应用内判定器返回完成状态",
		ObservationIDs: []string{observation.ID}, ArtifactIDs: []string{artifact.ID},
		Provenance: evaluator + "@" + version,
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

	correct := request.Accepted
	receipt := ExternalJudgeReceipt{
		ID:       securityruntime.NewIdentifier("judge_receipt"),
		Platform: evaluator, Status: "rejected", Correct: &correct,
		Summary: summary, Reference: reference, RecordedAt: now,
	}
	verdict := securityruntime.VerdictFail
	score := 0.0
	if request.Accepted {
		receipt.Status = "accepted"
		verdict = securityruntime.VerdictPass
		score = 1
	}
	data, err := json.Marshal(receipt)
	if err != nil {
		return Projection{}, err
	}
	if err := s.runtime.CommitRoleFact(ctx, securityruntime.EventScope{JobID: jobID}, securityruntime.RoleFact{
		ID: securityruntime.NewIdentifier("fact"), PackageID: PackageID, SchemaVersion: SchemaVersion,
		Kind: FactJudgeReceipt, Data: data,
	}); err != nil {
		return Projection{}, err
	}
	evaluation := securityruntime.Evaluation{
		ID: securityruntime.NewIdentifier("evaluation"), Evaluator: evaluator, Version: version,
		Verdict: verdict, Score: score, Summary: summary, EvidenceIDs: []string{evidence.ID},
	}
	if err := s.runtime.RecordEvaluation(ctx, securityruntime.EventScope{
		JobID: jobID, AttemptID: attempt.ID,
	}, evaluation); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.FinishAttempt(ctx, jobID, attempt.ID, securityruntime.AttemptCompleted, summary); err != nil {
		return Projection{}, err
	}
	if !request.Accepted {
		return s.GetJob(ctx, jobID)
	}
	if err := s.runtime.DecideOutcome(ctx, securityruntime.EventScope{
		JobID: jobID, AttemptID: attempt.ID,
	}, securityruntime.Outcome{
		Status: securityruntime.OutcomeSucceeded, Summary: summary, EvaluationID: evaluation.ID,
	}); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.FinishJob(ctx, jobID, securityruntime.JobSucceeded, summary); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, jobID)
}

func (s *Service) RecordExternalInconclusive(
	ctx context.Context,
	jobID string,
	summary string,
) (Projection, error) {
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	challenge, err := challengeFromProjection(core)
	if err != nil {
		return Projection{}, err
	}
	if challenge.Judge.Type != "external.manual" || core.Terminal() ||
		len(core.Evaluations) == 0 || len(core.Evidence) == 0 {
		return Projection{}, fmt.Errorf("challenge has no external submission awaiting an inconclusive result")
	}
	latest := core.Evaluations[len(core.Evaluations)-1]
	if latest.Verdict != securityruntime.VerdictNeedsReview {
		return Projection{}, fmt.Errorf("latest submission is not awaiting an external result")
	}
	summary = strings.TrimSpace(summary)
	if summary == "" {
		summary = "外部 Judge 没有返回可确认的结果；保留回执并允许受控重试。"
	}
	if len([]rune(summary)) > 2000 {
		return Projection{}, fmt.Errorf("external inconclusive summary must be at most 2000 characters")
	}
	evaluation := securityruntime.Evaluation{
		ID: securityruntime.NewIdentifier("evaluation"), Evaluator: "ctf-external-platform", Version: "1",
		Verdict: securityruntime.VerdictInconclusive, Score: 0,
		Summary: summary, EvidenceIDs: append([]string{}, latest.EvidenceIDs...),
	}
	scope := securityruntime.EventScope{JobID: jobID}
	if len(core.Attempts) > 0 {
		scope.AttemptID = core.Attempts[len(core.Attempts)-1].ID
	}
	if err := s.runtime.RecordEvaluation(ctx, scope, evaluation); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, jobID)
}
