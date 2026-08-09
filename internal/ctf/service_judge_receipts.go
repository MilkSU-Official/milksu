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
