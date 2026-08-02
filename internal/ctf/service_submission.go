package ctf

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func (s *Service) ContinueJob(ctx context.Context, jobID string) (Projection, error) {
	projection, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	if projection.Job.Role != PackageID || projection.Terminal() || projection.Outcome != nil {
		return Projection{}, fmt.Errorf("CTF challenge cannot be continued")
	}
	if len(projection.Evaluations) > 0 && projection.Evaluations[len(projection.Evaluations)-1].Verdict == securityruntime.VerdictNeedsReview {
		return Projection{}, fmt.Errorf("review the pending external submission before continuing")
	}
	if err := s.startRunner(jobID); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, jobID)
}

func (s *Service) PrepareExternalSubmission(
	ctx context.Context,
	jobID, candidate, explanation string,
	externalWrongCountBefore int,
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
		return Projection{}, fmt.Errorf("challenge does not accept an external platform submission")
	}
	candidate = strings.TrimSpace(candidate)
	explanation = strings.TrimSpace(explanation)
	if explanation == "" || len([]rune(explanation)) > 2000 ||
		externalWrongCountBefore < 0 || externalWrongCountBefore > 1_000_000 {
		return Projection{}, fmt.Errorf("external submission requires a candidate and evidence explanation")
	}
	if err := validateCandidateText(candidate); err != nil {
		return Projection{}, fmt.Errorf("external submission has an invalid candidate: %w", err)
	}
	projected, projectErr := Project(core)
	if projectErr != nil {
		return Projection{}, projectErr
	}
	if len(core.Evaluations) > 0 && core.Evaluations[len(core.Evaluations)-1].Verdict == securityruntime.VerdictNeedsReview {
		if len(projected.Submissions) > 0 && strings.TrimSpace(projected.Submissions[len(projected.Submissions)-1].Candidate) == candidate {
			return projected, nil
		}
		return Projection{}, fmt.Errorf("another external candidate is already awaiting platform review")
	}
	for _, submission := range projected.Submissions {
		if strings.TrimSpace(submission.Candidate) == candidate {
			if submission.Verdict == securityruntime.VerdictInconclusive {
				continue
			}
			return Projection{}, fmt.Errorf("candidate has already received an external platform verdict")
		}
	}
	s.mu.Lock()
	active := s.active[jobID] != nil
	s.mu.Unlock()
	if active {
		return Projection{}, fmt.Errorf("wait for the current Agent turn before submitting to the external platform")
	}
	for _, attempt := range core.Attempts {
		if attempt.Status == securityruntime.AttemptRunning {
			return Projection{}, fmt.Errorf("challenge already has a running attempt")
		}
	}

	now := time.Now().UTC()
	attempt := securityruntime.Attempt{
		ID: securityruntime.NewIdentifier("attempt"), JobID: jobID,
		Engine: "human-or-agent", Model: "external-candidate", Environment: challenge.ExternalPlatform,
		Evaluator: "external-platform@1", Status: securityruntime.AttemptRunning, StartedAt: now,
	}
	if attempt.Environment == "" {
		attempt.Environment = "user-authorized-platform"
	}
	if err := s.runtime.StartAttempt(ctx, attempt); err != nil {
		return Projection{}, err
	}
	step := securityruntime.Step{
		ID: securityruntime.NewIdentifier("step"), AttemptID: attempt.ID,
		Name: "external-platform-submission", Description: "保存候选、平台提交证据与权威判题结果",
		Status: securityruntime.StepRunning, StartedAt: now,
	}
	scope := securityruntime.EventScope{JobID: jobID, AttemptID: attempt.ID, StepID: step.ID}
	if err := s.runtime.StartStep(ctx, scope, step); err != nil {
		return Projection{}, err
	}
	input, _ := json.Marshal(struct {
		Candidate                string `json:"candidate"`
		Explanation              string `json:"explanation"`
		ExternalWrongCountBefore int    `json:"externalWrongCountBefore"`
	}{
		Candidate: candidate, Explanation: explanation,
		ExternalWrongCountBefore: externalWrongCountBefore,
	})
	action := securityruntime.Action{
		ID: securityruntime.NewIdentifier("action"), StepID: step.ID,
		Capability: CapabilityName, Name: "ctf.submit_flag", Input: input,
		Rationale: explanation,
		ExpectedEffect: securityruntime.EffectSpec{
			Class: "external_submission.prepare", IdempotencyKey: "ctf.external-submit:" + hashFlag(candidate),
			Cleanup:    "retain candidate with platform verdict evidence",
			Approval:   "user authorized the selected CTF platform or supplied an Agent Token",
			ScopeCheck: "submission is limited to the admitted external attempt",
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
		Summary:   "候选 Flag 已进入平台提交闸门；只有外部平台响应可以将其判为成功。",
		MediaType: "application/vnd.milksu.ctf-external-submission+json", Complete: true,
	}
	if err := s.runtime.CommitObservation(ctx, scope, observation); err != nil {
		return Projection{}, err
	}
	artifact, created, reused, err := s.runtime.CommitActionArtifact(ctx, scope, action.ID, "text/plain; charset=utf-8", []byte(candidate))
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
		Claim:          "候选 Flag 已保存并等待外部平台权威判定",
		ObservationIDs: []string{observation.ID}, ArtifactIDs: []string{artifact.ID},
		Provenance: "MilkSU external submission gate",
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
	evaluation := securityruntime.Evaluation{
		ID: securityruntime.NewIdentifier("evaluation"), Evaluator: "external-platform-gate", Version: "1",
		Verdict: securityruntime.VerdictNeedsReview, Score: 0.5,
		Summary:     "候选已保存；等待外部平台返回 Accepted 或 Rejected。",
		EvidenceIDs: []string{evidence.ID},
	}
	if err := s.runtime.RecordEvaluation(ctx, securityruntime.EventScope{JobID: jobID, AttemptID: attempt.ID}, evaluation); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.FinishAttempt(ctx, jobID, attempt.ID, securityruntime.AttemptCompleted, evaluation.Summary); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, jobID)
}

func (s *Service) ReviewSubmission(ctx context.Context, jobID string, accepted bool, summary string) (Projection, error) {
	return s.reviewSubmission(ctx, jobID, accepted, summary, true)
}

func (s *Service) RecordExternalVerdict(ctx context.Context, jobID string, accepted bool, summary string) (Projection, error) {
	return s.reviewSubmission(ctx, jobID, accepted, summary, false)
}

func (s *Service) FinishExternalChallenge(ctx context.Context, jobID, summary string) (Projection, error) {
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	challenge, err := challengeFromProjection(core)
	if err != nil {
		return Projection{}, err
	}
	if challenge.ExternalPlatform == "" {
		return Projection{}, fmt.Errorf("challenge is not linked to an external platform attempt")
	}
	if core.Terminal() {
		return s.GetJob(ctx, jobID)
	}
	s.mu.Lock()
	active := s.active[jobID] != nil
	s.mu.Unlock()
	if active {
		return Projection{}, fmt.Errorf("wait for the current Agent turn before finishing the external challenge")
	}
	for _, attempt := range core.Attempts {
		if attempt.Status == securityruntime.AttemptRunning {
			return Projection{}, fmt.Errorf("challenge already has a running attempt")
		}
	}
	summary = strings.TrimSpace(summary)
	if summary == "" {
		summary = "外部平台已结束本次题目，未记录成功结果。"
	}
	projection, err := s.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	if _, err := s.recordAttributedLearning(
		ctx,
		projection,
		LearningRecordRequest{
			Kind: "judge_observation", Content: summary, Concept: "外部平台终态",
		},
		LearningActorImported,
		assistanceForMode(challenge.CollaborationMode),
	); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.DecideOutcome(ctx, securityruntime.EventScope{JobID: jobID}, securityruntime.Outcome{
		Status: securityruntime.OutcomeFailed, Summary: summary,
	}); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.FinishJob(ctx, jobID, securityruntime.JobFailed, summary); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, jobID)
}

func (s *Service) reviewSubmission(ctx context.Context, jobID string, accepted bool, summary string, resume bool) (Projection, error) {
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	challenge, err := challengeFromProjection(core)
	if err != nil {
		return Projection{}, err
	}
	if challenge.Judge.Type != "external.manual" || core.Terminal() || len(core.Evaluations) == 0 || len(core.Evidence) == 0 {
		return Projection{}, fmt.Errorf("challenge has no external submission awaiting review")
	}
	latest := core.Evaluations[len(core.Evaluations)-1]
	if latest.Verdict != securityruntime.VerdictNeedsReview &&
		latest.Verdict != securityruntime.VerdictInconclusive {
		return Projection{}, fmt.Errorf("latest submission is not awaiting review")
	}
	verdict := securityruntime.VerdictFail
	score := 0.0
	if accepted {
		verdict = securityruntime.VerdictPass
		score = 1
	}
	summary = strings.TrimSpace(summary)
	if summary == "" {
		if accepted {
			summary = "用户根据已授权平台响应确认 Flag 正确。"
		} else {
			summary = "用户根据平台响应确认该候选未通过。"
		}
	}
	evaluator := "ctf-external-platform"
	if resume {
		evaluator = "ctf-external-user-review"
	}
	evaluation := securityruntime.Evaluation{
		ID: securityruntime.NewIdentifier("evaluation"), Evaluator: evaluator, Version: "1",
		Verdict: verdict, Score: score, Summary: summary,
		EvidenceIDs: []string{core.Evidence[len(core.Evidence)-1].ID},
	}
	scope := securityruntime.EventScope{JobID: jobID}
	if len(core.Attempts) > 0 {
		scope.AttemptID = core.Attempts[len(core.Attempts)-1].ID
	}
	if err := s.runtime.RecordEvaluation(ctx, scope, evaluation); err != nil {
		return Projection{}, err
	}
	if !accepted {
		if resume {
			if err := s.startRunner(jobID); err != nil {
				return Projection{}, err
			}
		}
		return s.GetJob(ctx, jobID)
	}
	outcome := securityruntime.Outcome{Status: securityruntime.OutcomeSucceeded, Summary: summary, EvaluationID: evaluation.ID}
	if err := s.runtime.DecideOutcome(ctx, scope, outcome); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.FinishJob(ctx, jobID, securityruntime.JobSucceeded, summary); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, jobID)
}
