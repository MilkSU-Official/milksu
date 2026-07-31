package ctf

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"mime"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

var (
	errUserCancelled = errors.New("CTF job cancelled by user")
	errAppShutdown   = errors.New("application shutdown")
)

const maxArtifactPreviewBytes = 128 * 1024

type ServiceOptions struct {
	Engine      securityruntime.AgentEngine
	Environment securityruntime.Environment
}

type activeRun struct {
	cancel context.CancelCauseFunc
	done   chan struct{}
}

type runState struct {
	attempt *securityruntime.Attempt
	step    *securityruntime.Step
	action  *securityruntime.Action
	lease   *securityruntime.EnvironmentLease
}

type Service struct {
	runtime     *securityruntime.Service
	engine      securityruntime.AgentEngine
	environment securityruntime.Environment
	capability  *Capability
	judge       *Judge

	mu     sync.Mutex
	active map[string]*activeRun
	closed bool
	wg     sync.WaitGroup
}

func NewService(runtime *securityruntime.Service, options ServiceOptions) (*Service, error) {
	if runtime == nil || options.Engine == nil {
		return nil, fmt.Errorf("CTF runtime and agent engine are required")
	}
	if options.Environment == nil {
		options.Environment = OfflineEnvironment{}
	}
	service := &Service{
		runtime: runtime, engine: options.Engine, environment: options.Environment,
		active: make(map[string]*activeRun),
	}
	service.capability = NewCapability(runtime)
	service.judge = NewJudge(runtime)
	return service, nil
}

func (s *Service) StartChallenge(ctx context.Context, request ChallengeRequest) (Projection, error) {
	admitted, err := validateRequest(request)
	if err != nil {
		return Projection{}, err
	}
	if err := s.checkOpen(); err != nil {
		return Projection{}, err
	}

	now := time.Now().UTC()
	job := securityruntime.Job{
		ID:                securityruntime.NewIdentifier("job"),
		Title:             admitted.title,
		Role:              PackageID,
		CollaborationMode: admitted.collaborationMode,
		Status:            securityruntime.JobQueued,
		CreatedAt:         now,
		UpdatedAt:         now,
	}
	if err := s.runtime.CreateJob(ctx, job); err != nil {
		return Projection{}, err
	}

	challenge := Challenge{
		ID:                securityruntime.NewIdentifier("challenge"),
		Title:             admitted.title,
		Statement:         admitted.statement,
		Category:          admitted.category,
		CollaborationMode: admitted.collaborationMode,
		ExternalPlatform:  admitted.externalPlatform,
		ExternalAttemptID: admitted.externalAttemptID,
		TrackName:         admitted.trackName,
		HumanGoal:         admitted.humanGoal,
		Source:            admitted.source,
		KnowledgePoints:   append([]string{}, admitted.knowledgePoints...),
		Materials:         []Material{},
		Judge:             JudgeSpec{Type: "external.manual", Version: s.judge.Version()},
		AdmittedAt:        now,
	}
	if admitted.expectedFlag != "" {
		challenge.Judge = JudgeSpec{Type: "flag.sha256", Version: s.judge.Version(), ExpectedFlagSHA256: hashFlag(admitted.expectedFlag)}
	}
	artifactIDs := make([]string, 0, len(admitted.materials))
	for _, material := range admitted.materials {
		artifact, _, artifactErr := s.runtime.AdmitArtifact(ctx, job.ID, material.provenance, material.mediaType, material.data)
		if artifactErr != nil {
			return Projection{}, fmt.Errorf("admit material %q: %w", material.name, artifactErr)
		}
		artifactIDs = append(artifactIDs, artifact.ID)
		challenge.Materials = append(challenge.Materials, Material{
			ArtifactID: artifact.ID, Name: material.name, MediaType: material.mediaType,
			SHA256: artifact.SHA256, Size: artifact.Size, Provenance: material.provenance,
		})
	}
	data, err := json.Marshal(challenge)
	if err != nil {
		return Projection{}, fmt.Errorf("encode admitted challenge: %w", err)
	}
	fact := securityruntime.RoleFact{
		ID: securityruntime.NewIdentifier("fact"), PackageID: PackageID, SchemaVersion: SchemaVersion,
		Kind: FactChallengeAdmitted, ArtifactIDs: artifactIDs, Data: data,
	}
	if err := s.runtime.CommitRoleFact(ctx, securityruntime.EventScope{JobID: job.ID}, fact); err != nil {
		return Projection{}, err
	}
	if !admitted.deferAgent {
		if err := s.startRunner(job.ID); err != nil {
			return Projection{}, err
		}
	}
	return s.GetJob(ctx, job.ID)
}

func (s *Service) StartSampleChallenge(ctx context.Context) (Projection, error) {
	const expected = "MILKSU{typed_security_loop}"
	encoded := hex.EncodeToString([]byte(expected))
	return s.StartChallenge(ctx, ChallengeRequest{
		Title:             "Hex 入门：找回 MilkSU Flag",
		Statement:         "附件是一段十六进制文本。请检查材料、恢复原文，并把得到的 Flag 交给本地判题器。",
		Category:          "misc",
		CollaborationMode: "delegate",
		TrackName:         "CTF 基础训练",
		HumanGoal:         "理解十六进制编码，并能用证据向 Judge 说明答案来源。",
		SourceKind:        "file",
		ExpectedFlag:      expected,
		KnowledgePoints:   []string{"十六进制编码", "证据驱动的逐步验证", "模型与判题器职责分离"},
		Materials: []MaterialRequest{{
			Name: "challenge.hex", MediaType: "text/plain; charset=utf-8",
			DataBase64: base64.StdEncoding.EncodeToString([]byte(encoded)),
			Provenance: "builtin:m2a-hex-sample",
		}},
	})
}

func (s *Service) GetJob(ctx context.Context, jobID string) (Projection, error) {
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	return Project(core)
}

func (s *Service) GetArtifactPreview(ctx context.Context, jobID, artifactID string) (ArtifactPreview, error) {
	projection, err := s.GetJob(ctx, jobID)
	if err != nil {
		return ArtifactPreview{}, err
	}
	var artifact *securityruntime.Artifact
	for index := range projection.Artifacts {
		if projection.Artifacts[index].ID == artifactID {
			artifact = &projection.Artifacts[index]
			break
		}
	}
	if artifact == nil {
		return ArtifactPreview{}, fmt.Errorf("artifact does not belong to CTF job")
	}
	data, err := s.runtime.ReadArtifact(ctx, *artifact)
	if err != nil {
		return ArtifactPreview{}, err
	}
	return buildArtifactPreview(*artifact, data), nil
}

func buildArtifactPreview(artifact securityruntime.Artifact, data []byte) ArtifactPreview {
	result := ArtifactPreview{Artifact: artifact}
	mediaType, _, err := mime.ParseMediaType(artifact.MediaType)
	if err != nil || !isTextPreviewMediaType(mediaType) {
		result.Reason = "仅展示元数据；二进制制品不会在 MilkSU 内渲染或执行。"
		return result
	}
	if !utf8.Valid(data) {
		result.Reason = "制品声明为文本，但内容不是有效 UTF-8；为避免误解，仅展示元数据。"
		return result
	}
	preview := data
	if len(preview) > maxArtifactPreviewBytes {
		preview = preview[:maxArtifactPreviewBytes]
		for len(preview) > 0 && !utf8.Valid(preview) {
			preview = preview[:len(preview)-1]
		}
		result.Truncated = true
	}
	result.Previewable = true
	result.Content = string(bytes.ToValidUTF8(preview, []byte("\uFFFD")))
	return result
}

func isTextPreviewMediaType(mediaType string) bool {
	mediaType = strings.ToLower(strings.TrimSpace(mediaType))
	return strings.HasPrefix(mediaType, "text/") ||
		mediaType == "application/json" ||
		mediaType == "application/x-ndjson" ||
		mediaType == "application/xml" ||
		strings.HasSuffix(mediaType, "+json") ||
		strings.HasSuffix(mediaType, "+xml")
}

func (s *Service) ListJobs(ctx context.Context) ([]Summary, error) {
	values, err := s.runtime.ListJobs(ctx)
	if err != nil {
		return nil, err
	}
	result := make([]Summary, 0)
	for _, value := range values {
		if value.Role != PackageID {
			continue
		}
		projection, projectionErr := s.GetJob(ctx, value.ID)
		if projectionErr != nil {
			return nil, projectionErr
		}
		result = append(result, SummaryFrom(projection))
	}
	SortSummaries(result)
	return result, nil
}

func (s *Service) CancelJob(ctx context.Context, jobID string) error {
	projection, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return err
	}
	if projection.Job.Role != PackageID {
		return fmt.Errorf("job is not a CTF challenge")
	}
	if projection.Terminal() || projection.Outcome != nil {
		return nil
	}
	if err := s.runtime.RequestCancellation(ctx, jobID, errUserCancelled.Error()); err != nil {
		return err
	}
	s.mu.Lock()
	run := s.active[jobID]
	s.mu.Unlock()
	if run != nil {
		run.cancel(errUserCancelled)
		return nil
	}
	return s.finishCancellation(jobID, stateFromProjection(projection))
}

func (s *Service) RecordLearning(ctx context.Context, jobID string, request LearningRecordRequest) (Projection, error) {
	projection, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	if projection.Job.Role != PackageID {
		return Projection{}, fmt.Errorf("job is not a CTF challenge")
	}
	kind := strings.ToLower(strings.TrimSpace(request.Kind))
	if kind != "hint" && kind != "reflection" && kind != "independent_step" && kind != "goal" {
		return Projection{}, fmt.Errorf("unsupported learning record kind")
	}
	content := strings.TrimSpace(request.Content)
	if content == "" || len([]rune(content)) > 4000 {
		return Projection{}, fmt.Errorf("learning record content is required and must be at most 4000 characters")
	}
	concept := strings.TrimSpace(request.Concept)
	if len([]rune(concept)) > 160 || request.Level < 0 || request.Level > 3 {
		return Projection{}, fmt.Errorf("learning concept or hint level is invalid")
	}
	record := LearningRecord{
		ID: securityruntime.NewIdentifier("learning"), Kind: kind, Content: content,
		Concept: concept, Level: request.Level, CreatedAt: time.Now().UTC(),
	}
	data, err := json.Marshal(record)
	if err != nil {
		return Projection{}, err
	}
	fact := securityruntime.RoleFact{
		ID: securityruntime.NewIdentifier("fact"), PackageID: PackageID, SchemaVersion: SchemaVersion,
		Kind: FactLearningRecorded, Data: data,
	}
	if err := s.runtime.CommitRoleFact(ctx, securityruntime.EventScope{JobID: jobID}, fact); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, jobID)
}

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
	if _, err := s.RecordLearning(ctx, jobID, LearningRecordRequest{
		Kind: "independent_step", Content: summary, Concept: "外部平台终态",
	}); err != nil {
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
	if latest.Verdict != securityruntime.VerdictNeedsReview {
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

func (s *Service) Recover(ctx context.Context) error {
	values, err := s.runtime.ListJobs(ctx)
	if err != nil {
		return err
	}
	for _, value := range values {
		if value.Role != PackageID {
			continue
		}
		projection, projectionErr := s.runtime.GetJob(ctx, value.ID)
		if projectionErr != nil {
			return projectionErr
		}
		if projection.Terminal() {
			continue
		}
		// A queued Job with no Attempt is intentionally deferred (for example,
		// the user built a browser workspace before configuring a model). It is
		// not interrupted work and must wait for an explicit ContinueJob call.
		if projection.Job.Status == securityruntime.JobQueued && len(projection.Attempts) == 0 {
			continue
		}
		if challenge, challengeErr := challengeFromProjection(projection); challengeErr == nil && challenge.Judge.Type == "external.manual" && len(projection.Evaluations) > 0 && projection.Evaluations[len(projection.Evaluations)-1].Verdict == securityruntime.VerdictNeedsReview {
			continue
		}
		if challenge, challengeErr := challengeFromProjection(projection); challengeErr == nil && challenge.CollaborationMode == "coach" && len(projection.Attempts) > 0 && projection.Attempts[len(projection.Attempts)-1].Status == securityruntime.AttemptCompleted {
			continue
		}
		if projection.Outcome != nil {
			if err := s.completeCommittedOutcome(projection); err != nil {
				return err
			}
			continue
		}
		state := stateFromProjection(projection)
		if projection.Job.Status == securityruntime.JobCancelling {
			if err := s.finishCancellation(projection.Job.ID, state); err != nil {
				return err
			}
			continue
		}
		previousAttemptID := ""
		if state.attempt != nil {
			previousAttemptID = state.attempt.ID
			if state.attempt.Status == securityruntime.AttemptRunning {
				if err := s.interruptRun(projection.Job.ID, state, "previous process ended before the attempt reached a terminal event"); err != nil {
					return err
				}
			}
		}
		if err := s.runtime.RecordRecovery(ctx, projection.Job.ID, previousAttemptID); err != nil {
			return err
		}
		if err := s.startRunner(projection.Job.ID); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) Wait(ctx context.Context, jobID string) error {
	s.mu.Lock()
	run := s.active[jobID]
	s.mu.Unlock()
	if run == nil {
		return nil
	}
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-run.done:
		return nil
	}
}

func (s *Service) startRunner(jobID string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("CTF service is closed")
	}
	if _, exists := s.active[jobID]; exists {
		return nil
	}
	ctx, cancel := context.WithCancelCause(context.Background())
	run := &activeRun{cancel: cancel, done: make(chan struct{})}
	s.active[jobID] = run
	s.wg.Add(1)
	go func() {
		defer s.wg.Done()
		state, runErr := s.runJob(ctx, jobID)
		if runErr != nil {
			_ = s.finalizeRunError(jobID, state, context.Cause(ctx), runErr)
		}
		s.mu.Lock()
		delete(s.active, jobID)
		close(run.done)
		s.mu.Unlock()
	}()
	return nil
}

func (s *Service) runJob(ctx context.Context, jobID string) (state runState, resultErr error) {
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return state, err
	}
	challenge, err := challengeFromProjection(core)
	if err != nil {
		return state, err
	}
	attempt := securityruntime.Attempt{
		ID: securityruntime.NewIdentifier("attempt"), JobID: jobID,
		Engine: s.engine.Name(), Model: s.engine.Model(), Environment: s.environment.Name(),
		Evaluator: s.judge.Name() + "@" + s.judge.Version(),
		Status:    securityruntime.AttemptRunning, StartedAt: time.Now().UTC(),
	}
	if err := s.runtime.StartAttempt(ctx, attempt); err != nil {
		return state, err
	}
	state.attempt = &attempt
	defer func() {
		if lifecycle, ok := s.engine.(securityruntime.AgentAttemptLifecycle); ok {
			closeCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			_ = lifecycle.CloseAttempt(closeCtx, attempt.ID)
		}
	}()

	lease, err := s.environment.Prepare(ctx, core.Job, attempt)
	if err != nil {
		return state, fmt.Errorf("prepare CTF environment: %w", err)
	}
	state.lease = &lease
	if err := s.runtime.RecordEnvironment(ctx, securityruntime.EventScope{JobID: jobID, AttemptID: attempt.ID}, lease, true); err != nil {
		return state, err
	}

	for {
		if err := ctx.Err(); err != nil {
			return state, err
		}
		core, err = s.runtime.GetJob(ctx, jobID)
		if err != nil {
			return state, err
		}
		if len(core.Steps) >= maxExperiments {
			return state, s.finishBudgetExhausted(jobID, attempt, lease)
		}

		step := securityruntime.Step{
			ID: securityruntime.NewIdentifier("step"), AttemptID: attempt.ID,
			Name:        fmt.Sprintf("ctf-experiment-%d", len(core.Steps)+1),
			Description: "模型提出一个受控动作，MilkSU 记录观察、证据与独立判定",
			Status:      securityruntime.StepRunning, StartedAt: time.Now().UTC(),
		}
		scope := securityruntime.EventScope{JobID: jobID, AttemptID: attempt.ID, StepID: step.ID}
		if err := s.runtime.StartStep(ctx, scope, step); err != nil {
			return state, err
		}
		state.step = &step
		engineInput, err := buildAgentInput(core, challenge, attempt, step)
		if err != nil {
			return state, err
		}
		proposalCtx, cancel := context.WithTimeout(ctx, proposalTimeout)
		proposal, err := s.engine.Propose(proposalCtx, engineInput)
		cancel()
		if err != nil {
			return state, fmt.Errorf("CTF engine propose: %w", err)
		}
		if proposal.Capability != CapabilityName {
			return state, fmt.Errorf("engine proposed unavailable capability %q", proposal.Capability)
		}
		if challenge.CollaborationMode == "coach" &&
			proposal.Name != "ctf.inspect_material" &&
			proposal.Name != "ctf.decode_hex" &&
			proposal.Name != "ctf.decode_text" &&
			proposal.Name != "ctf.coach_hint" {
			return state, fmt.Errorf("coach mode denied solution/submission action %q", proposal.Name)
		}
		proposal.Rationale = strings.TrimSpace(proposal.Rationale)
		if proposal.Rationale == "" || len([]rune(proposal.Rationale)) > 2000 {
			return state, fmt.Errorf("engine proposal requires a rationale of at most 2000 characters")
		}
		effectSpec, err := s.capability.EffectSpec(proposal.Name, proposal.Input)
		if err != nil {
			return state, fmt.Errorf("validate CTF proposal: %w", err)
		}
		action := securityruntime.Action{
			ID: securityruntime.NewIdentifier("action"), StepID: step.ID,
			Capability: CapabilityName, Name: proposal.Name, Input: proposal.Input,
			Rationale: proposal.Rationale, ExpectedEffect: effectSpec,
			Status: securityruntime.ActionProposed,
		}
		if err := s.runtime.ProposeAction(ctx, scope, action); err != nil {
			return state, err
		}
		state.action = &action
		if err := s.runtime.SetActionStatus(ctx, scope, action.ID, securityruntime.ActionRunning, ""); err != nil {
			return state, err
		}

		result, err := s.capability.Execute(ctx, jobID, action)
		if err != nil {
			return state, fmt.Errorf("execute CTF capability: %w", err)
		}
		observation := securityruntime.Observation{
			ID: securityruntime.NewIdentifier("observation"), ActionID: action.ID,
			Summary: result.Summary, MediaType: result.MediaType, Complete: result.Complete,
		}
		if err := s.commit(func(commitCtx context.Context) error {
			return s.runtime.CommitObservation(commitCtx, scope, observation)
		}); err != nil {
			return state, err
		}

		artifactIDs := append([]string{}, result.ExistingArtifactIDs...)
		var candidateArtifact *securityruntime.Artifact
		for _, draft := range result.Artifacts {
			artifactCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			artifact, created, reused, artifactErr := s.runtime.CommitActionArtifact(artifactCtx, scope, action.ID, draft.MediaType, draft.Data)
			cancel()
			if artifactErr != nil {
				return state, artifactErr
			}
			artifactIDs = appendUnique(artifactIDs, artifact.ID)
			stateName := "committed"
			if reused || !created {
				stateName = "reused"
			}
			effect := securityruntime.Effect{
				ID: securityruntime.NewIdentifier("effect"), ActionID: action.ID,
				Class: effectSpec.Class, IdempotencyKey: effectSpec.IdempotencyKey,
				State: stateName, Cleanup: effectSpec.Cleanup, ArtifactID: artifact.ID,
			}
			if err := s.commit(func(commitCtx context.Context) error {
				return s.runtime.CommitEffect(commitCtx, scope, effect, stateName == "reused")
			}); err != nil {
				return state, err
			}
			if result.Candidate {
				value := artifact
				candidateArtifact = &value
			}
		}
		if len(result.Artifacts) == 0 {
			if len(artifactIDs) == 0 {
				return state, fmt.Errorf("CTF capability result has no evidence artifact")
			}
			effect := securityruntime.Effect{
				ID: securityruntime.NewIdentifier("effect"), ActionID: action.ID,
				Class: effectSpec.Class, IdempotencyKey: effectSpec.IdempotencyKey,
				State: "reused", Cleanup: effectSpec.Cleanup, ArtifactID: artifactIDs[0],
			}
			if err := s.commit(func(commitCtx context.Context) error {
				return s.runtime.CommitEffect(commitCtx, scope, effect, true)
			}); err != nil {
				return state, err
			}
		}
		evidence := securityruntime.Evidence{
			ID:             securityruntime.NewIdentifier("evidence"),
			Claim:          "CTF 实验产生了可回放的观察与材料引用",
			ObservationIDs: []string{observation.ID}, ArtifactIDs: artifactIDs,
			Provenance: "MilkSU CTF capability committed under typed policy",
		}
		if err := s.commit(func(commitCtx context.Context) error {
			return s.runtime.LinkEvidence(commitCtx, scope, evidence)
		}); err != nil {
			return state, err
		}
		if err := s.commit(func(commitCtx context.Context) error {
			return s.runtime.SetActionStatus(commitCtx, scope, action.ID, securityruntime.ActionCompleted, "")
		}); err != nil {
			return state, err
		}
		if err := s.commit(func(commitCtx context.Context) error {
			return s.runtime.FinishStep(commitCtx, scope, securityruntime.StepCompleted, "")
		}); err != nil {
			return state, err
		}
		if action.Name == "ctf.coach_hint" {
			if err := s.recordAgentHint(jobID, action.Input); err != nil {
				return state, err
			}
			if challenge.CollaborationMode == "coach" {
				if err := s.runtime.FinishAttempt(ctx, jobID, attempt.ID, securityruntime.AttemptCompleted, "coach returned one graded hint and waits for the learner"); err != nil {
					return state, err
				}
				if err := s.releaseEnvironment(jobID, attempt.ID, lease); err != nil {
					return state, err
				}
				state.lease = nil
				return state, nil
			}
		}
		state.action = nil
		state.step = nil

		if candidateArtifact == nil {
			continue
		}
		core, err = s.runtime.GetJob(ctx, jobID)
		if err != nil {
			return state, err
		}
		decision, err := s.judge.Evaluate(ctx, challenge, *candidateArtifact)
		if err != nil {
			return state, fmt.Errorf("evaluate flag candidate: %w", err)
		}
		evaluation := securityruntime.Evaluation{
			ID: securityruntime.NewIdentifier("evaluation"), Evaluator: s.judge.Name(), Version: s.judge.Version(),
			Verdict: decision.Verdict, Score: decision.Score, Summary: decision.Summary,
			EvidenceIDs: []string{evidence.ID},
		}
		if err := s.runtime.RecordEvaluation(ctx, securityruntime.EventScope{JobID: jobID, AttemptID: attempt.ID}, evaluation); err != nil {
			return state, err
		}
		if decision.Verdict != securityruntime.VerdictPass {
			if decision.Verdict == securityruntime.VerdictNeedsReview {
				if err := s.runtime.FinishAttempt(ctx, jobID, attempt.ID, securityruntime.AttemptCompleted, decision.Summary); err != nil {
					return state, err
				}
				if err := s.releaseEnvironment(jobID, attempt.ID, lease); err != nil {
					return state, err
				}
				state.lease = nil
				return state, nil
			}
			continue
		}
		outcome := securityruntime.Outcome{
			Status: securityruntime.OutcomeSucceeded, Summary: decision.Summary, EvaluationID: evaluation.ID,
		}
		if err := s.runtime.DecideOutcome(ctx, securityruntime.EventScope{JobID: jobID, AttemptID: attempt.ID}, outcome); err != nil {
			return state, err
		}
		if err := s.runtime.FinishAttempt(ctx, jobID, attempt.ID, securityruntime.AttemptCompleted, ""); err != nil {
			return state, err
		}
		if err := s.releaseEnvironment(jobID, attempt.ID, lease); err != nil {
			return state, err
		}
		state.lease = nil
		if err := s.runtime.FinishJob(ctx, jobID, securityruntime.JobSucceeded, decision.Summary); err != nil {
			return state, err
		}
		return state, nil
	}
}

func (s *Service) recordAgentHint(jobID string, input json.RawMessage) error {
	var value struct {
		Hint    string `json:"hint"`
		Concept string `json:"concept"`
		Level   int    `json:"level"`
	}
	if err := json.Unmarshal(input, &value); err != nil {
		return err
	}
	_, err := s.RecordLearning(context.Background(), jobID, LearningRecordRequest{
		Kind: "hint", Content: value.Hint, Concept: value.Concept, Level: value.Level,
	})
	return err
}

func (s *Service) finishBudgetExhausted(jobID string, attempt securityruntime.Attempt, lease securityruntime.EnvironmentLease) error {
	summary := fmt.Sprintf("已达到 M2-A 的 %d 次受控实验上限，任务暂未解出。", maxExperiments)
	if err := s.commit(func(ctx context.Context) error {
		return s.runtime.DecideOutcome(ctx, securityruntime.EventScope{JobID: jobID, AttemptID: attempt.ID}, securityruntime.Outcome{Status: securityruntime.OutcomeFailed, Summary: summary})
	}); err != nil {
		return err
	}
	if err := s.commit(func(ctx context.Context) error {
		return s.runtime.FinishAttempt(ctx, jobID, attempt.ID, securityruntime.AttemptCompleted, summary)
	}); err != nil {
		return err
	}
	if err := s.releaseEnvironment(jobID, attempt.ID, lease); err != nil {
		return err
	}
	return s.commit(func(ctx context.Context) error {
		return s.runtime.FinishJob(ctx, jobID, securityruntime.JobFailed, summary)
	})
}

func (s *Service) finalizeRunError(jobID string, state runState, cause, runErr error) error {
	if state.lease != nil && state.attempt != nil {
		_ = s.releaseEnvironment(jobID, state.attempt.ID, *state.lease)
	}
	projection, projectionErr := s.runtime.GetJob(context.Background(), jobID)
	if projectionErr == nil && projection.Outcome != nil {
		return s.completeCommittedOutcome(projection)
	}
	if errors.Is(cause, errUserCancelled) || errors.Is(runErr, errUserCancelled) {
		return s.finishCancellation(jobID, state)
	}
	if errors.Is(cause, errAppShutdown) || errors.Is(runErr, context.Canceled) {
		if state.attempt == nil {
			return nil
		}
		return s.interruptRun(jobID, state, "application stopped; CTF job remains recoverable")
	}
	reason := runErr.Error()
	if state.action != nil && state.step != nil && state.attempt != nil {
		_ = s.commit(func(ctx context.Context) error {
			return s.runtime.SetActionStatus(ctx, securityruntime.EventScope{JobID: jobID, AttemptID: state.attempt.ID, StepID: state.step.ID}, state.action.ID, securityruntime.ActionFailed, reason)
		})
	}
	if state.step != nil && state.attempt != nil {
		_ = s.commit(func(ctx context.Context) error {
			return s.runtime.FinishStep(ctx, securityruntime.EventScope{JobID: jobID, AttemptID: state.attempt.ID, StepID: state.step.ID}, securityruntime.StepFailed, reason)
		})
	}
	if state.attempt != nil {
		_ = s.commit(func(ctx context.Context) error {
			return s.runtime.FinishAttempt(ctx, jobID, state.attempt.ID, securityruntime.AttemptFailed, reason)
		})
	}
	_ = s.commit(func(ctx context.Context) error {
		return s.runtime.DecideOutcome(ctx, securityruntime.EventScope{JobID: jobID}, securityruntime.Outcome{Status: securityruntime.OutcomeFailed, Summary: reason})
	})
	return s.commit(func(ctx context.Context) error {
		return s.runtime.FinishJob(ctx, jobID, securityruntime.JobFailed, reason)
	})
}

func (s *Service) interruptRun(jobID string, state runState, reason string) error {
	if state.action != nil && state.action.Status != securityruntime.ActionCompleted && state.action.Status != securityruntime.ActionFailed && state.step != nil && state.attempt != nil {
		if err := s.commit(func(ctx context.Context) error {
			return s.runtime.SetActionStatus(ctx, securityruntime.EventScope{JobID: jobID, AttemptID: state.attempt.ID, StepID: state.step.ID}, state.action.ID, securityruntime.ActionFailed, reason)
		}); err != nil {
			return err
		}
	}
	if state.step != nil && state.step.Status == securityruntime.StepRunning && state.attempt != nil {
		if err := s.commit(func(ctx context.Context) error {
			return s.runtime.FinishStep(ctx, securityruntime.EventScope{JobID: jobID, AttemptID: state.attempt.ID, StepID: state.step.ID}, securityruntime.StepFailed, reason)
		}); err != nil {
			return err
		}
	}
	if state.attempt != nil && state.attempt.Status == securityruntime.AttemptRunning {
		return s.commit(func(ctx context.Context) error {
			return s.runtime.FinishAttempt(ctx, jobID, state.attempt.ID, securityruntime.AttemptInterrupted, reason)
		})
	}
	return nil
}

func (s *Service) finishCancellation(jobID string, state runState) error {
	if state.action != nil && state.action.Status != securityruntime.ActionCompleted && state.action.Status != securityruntime.ActionFailed && state.step != nil && state.attempt != nil {
		if err := s.commit(func(ctx context.Context) error {
			return s.runtime.SetActionStatus(ctx, securityruntime.EventScope{JobID: jobID, AttemptID: state.attempt.ID, StepID: state.step.ID}, state.action.ID, securityruntime.ActionFailed, errUserCancelled.Error())
		}); err != nil {
			return err
		}
	}
	if state.step != nil && state.step.Status == securityruntime.StepRunning && state.attempt != nil {
		if err := s.commit(func(ctx context.Context) error {
			return s.runtime.FinishStep(ctx, securityruntime.EventScope{JobID: jobID, AttemptID: state.attempt.ID, StepID: state.step.ID}, securityruntime.StepFailed, errUserCancelled.Error())
		}); err != nil {
			return err
		}
	}
	if state.attempt != nil && state.attempt.Status == securityruntime.AttemptRunning {
		if err := s.commit(func(ctx context.Context) error {
			return s.runtime.FinishAttempt(ctx, jobID, state.attempt.ID, securityruntime.AttemptInterrupted, errUserCancelled.Error())
		}); err != nil {
			return err
		}
	}
	if err := s.commit(func(ctx context.Context) error {
		return s.runtime.DecideOutcome(ctx, securityruntime.EventScope{JobID: jobID}, securityruntime.Outcome{Status: securityruntime.OutcomeCancelled, Summary: "CTF 任务已由用户取消。"})
	}); err != nil {
		return err
	}
	return s.commit(func(ctx context.Context) error {
		return s.runtime.FinishJob(ctx, jobID, securityruntime.JobCancelled, errUserCancelled.Error())
	})
}

func (s *Service) completeCommittedOutcome(projection securityruntime.JobProjection) error {
	state := stateFromProjection(projection)
	if state.attempt != nil && state.attempt.Status == securityruntime.AttemptRunning {
		status := securityruntime.AttemptCompleted
		if projection.Outcome.Status == securityruntime.OutcomeCancelled {
			status = securityruntime.AttemptInterrupted
		}
		if err := s.commit(func(ctx context.Context) error {
			return s.runtime.FinishAttempt(ctx, projection.Job.ID, state.attempt.ID, status, "recovery finalized an already committed outcome")
		}); err != nil {
			return err
		}
	}
	status := securityruntime.JobFailed
	if projection.Outcome.Status == securityruntime.OutcomeSucceeded {
		status = securityruntime.JobSucceeded
	} else if projection.Outcome.Status == securityruntime.OutcomeCancelled {
		status = securityruntime.JobCancelled
	}
	return s.commit(func(ctx context.Context) error {
		return s.runtime.FinishJob(ctx, projection.Job.ID, status, "recovery finalized an already committed outcome")
	})
}

func (s *Service) releaseEnvironment(jobID, attemptID string, lease securityruntime.EnvironmentLease) error {
	releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := s.environment.Release(releaseCtx, lease); err != nil {
		return fmt.Errorf("release CTF environment: %w", err)
	}
	return s.commit(func(ctx context.Context) error {
		return s.runtime.RecordEnvironment(ctx, securityruntime.EventScope{JobID: jobID, AttemptID: attemptID}, lease, false)
	})
}

func (s *Service) checkOpen() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("CTF service is closed")
	}
	return nil
}

func (s *Service) commit(action func(context.Context) error) error {
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	return action(ctx)
}

func (s *Service) Close() error {
	s.mu.Lock()
	if s.closed {
		s.mu.Unlock()
		return nil
	}
	s.closed = true
	runs := make([]*activeRun, 0, len(s.active))
	for _, run := range s.active {
		runs = append(runs, run)
	}
	s.mu.Unlock()
	for _, run := range runs {
		run.cancel(errAppShutdown)
	}
	s.wg.Wait()
	return nil
}

func challengeFromProjection(projection securityruntime.JobProjection) (Challenge, error) {
	for _, fact := range projection.RoleFacts {
		if fact.PackageID == PackageID && fact.Kind == FactChallengeAdmitted {
			return decodeChallengeFact(fact)
		}
	}
	return Challenge{}, fmt.Errorf("CTF challenge fact is missing")
}

func stateFromProjection(projection securityruntime.JobProjection) runState {
	state := runState{}
	if len(projection.Attempts) > 0 {
		attempt := projection.Attempts[len(projection.Attempts)-1]
		state.attempt = &attempt
	}
	if state.attempt != nil {
		for index := len(projection.Steps) - 1; index >= 0; index-- {
			if projection.Steps[index].AttemptID == state.attempt.ID {
				step := projection.Steps[index]
				state.step = &step
				break
			}
		}
	}
	if state.step != nil {
		for index := len(projection.Actions) - 1; index >= 0; index-- {
			if projection.Actions[index].StepID == state.step.ID {
				action := projection.Actions[index]
				state.action = &action
				break
			}
		}
	}
	return state
}

func hashFlag(value string) string {
	digest := sha256.Sum256([]byte(value))
	return hex.EncodeToString(digest[:])
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
