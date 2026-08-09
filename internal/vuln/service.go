package vuln

import (
	"context"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

const (
	packetParserSource = "vuln/packet-parser/parser.c"
	packetParserReadme = "vuln/packet-parser/README.md"
)

type Service struct {
	runtime   *securityruntime.Service
	fixtures  fs.FS
	evaluator ReproductionEvaluator

	mu     sync.Mutex
	closed bool
}

func NewService(runtime *securityruntime.Service) (*Service, error) {
	if runtime == nil {
		return nil, fmt.Errorf("vulnerability runtime is required")
	}
	return &Service{runtime: runtime}, nil
}

func (s *Service) StartPacketParserFixture(ctx context.Context) (Projection, error) {
	if err := s.checkOpen(); err != nil {
		return Projection{}, err
	}
	if s.fixtures == nil {
		return Projection{}, fmt.Errorf("packet-parser is a developer fixture and is not available in the product runtime")
	}
	source, err := fs.ReadFile(s.fixtures, packetParserSource)
	if err != nil {
		return Projection{}, fmt.Errorf("read packet-parser source: %w", err)
	}
	readme, err := fs.ReadFile(s.fixtures, packetParserReadme)
	if err != nil {
		return Projection{}, fmt.Errorf("read packet-parser readme: %w", err)
	}
	attackSurface, hypothesis, rootCause, err := analyzePacketParser(string(source))
	if err != nil {
		return Projection{}, err
	}

	now := time.Now().UTC()
	job := securityruntime.Job{
		ID: securityruntime.NewIdentifier("job"), Title: "packet-parser · local-v1",
		Role: PackageID, CollaborationMode: "copilot", Status: securityruntime.JobQueued,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := s.runtime.CreateJob(ctx, job); err != nil {
		return Projection{}, err
	}
	sourceArtifact, _, err := s.runtime.AdmitArtifact(ctx, job.ID, "builtin:"+packetParserSource, "text/x-c; charset=utf-8", source)
	if err != nil {
		return Projection{}, err
	}
	readmeArtifact, _, err := s.runtime.AdmitArtifact(ctx, job.ID, "builtin:"+packetParserReadme, "text/markdown; charset=utf-8", readme)
	if err != nil {
		return Projection{}, err
	}
	grant, err := securitypolicy.NewGrant(
		"builtin:vuln/packet-parser",
		"authorized local vulnerability research learning",
		[]securitypolicy.Target{{Kind: securitypolicy.TargetLab, Value: "packet-parser@local-v1"}},
		24*time.Hour,
	)
	if err != nil {
		return Projection{}, err
	}
	target := Target{
		ID: securityruntime.NewIdentifier("target"), Name: "packet-parser", Version: "local-v1",
		Component: "parse_packet(const uint8_t*, size_t)", Fixture: "builtin local fixture",
		CollaborationMode: "copilot", Scope: grant, SourceArtifactID: sourceArtifact.ID,
		ReadmeArtifactID: readmeArtifact.ID, AdmittedAt: now,
	}
	targetFact, err := marshalRoleFact(FactTargetAdmitted, target, []string{sourceArtifact.ID, readmeArtifact.ID}, nil)
	if err != nil {
		return Projection{}, err
	}
	if err := s.runtime.CommitRoleFact(ctx, securityruntime.EventScope{JobID: job.ID}, targetFact); err != nil {
		return Projection{}, err
	}

	attempt := securityruntime.Attempt{
		ID: securityruntime.NewIdentifier("attempt"), JobID: job.ID,
		Engine: "milksu-deterministic-source-review", Model: "none",
		Environment: "builtin-local-fixture", Evaluator: s.evaluator.Name() + "@" + s.evaluator.Version(),
		Status: securityruntime.AttemptRunning, StartedAt: time.Now().UTC(),
	}
	if err := s.runtime.StartAttempt(ctx, attempt); err != nil {
		return Projection{}, err
	}
	lease := securityruntime.EnvironmentLease{
		ID: securityruntime.NewIdentifier("lease"), Provider: "builtin-fixture",
		Target: "packet-parser@local-v1", Resettable: true,
	}
	attemptScope := securityruntime.EventScope{JobID: job.ID, AttemptID: attempt.ID}
	if err := s.runtime.RecordEnvironment(ctx, attemptScope, lease, true); err != nil {
		return Projection{}, err
	}
	step := securityruntime.Step{
		ID: securityruntime.NewIdentifier("step"), AttemptID: attempt.ID,
		Name: "inspect-fixed-source", Description: "读取固定本地源码并记录攻击面、候选根因与下一步复现要求",
		Status: securityruntime.StepRunning, StartedAt: time.Now().UTC(),
	}
	scope := securityruntime.EventScope{JobID: job.ID, AttemptID: attempt.ID, StepID: step.ID}
	if err := s.runtime.StartStep(ctx, scope, step); err != nil {
		return Projection{}, err
	}
	action := securityruntime.Action{
		ID: securityruntime.NewIdentifier("action"), StepID: step.ID,
		Capability: "vuln.source-review", Name: "vuln.inspect_source",
		Input:     json.RawMessage(fmt.Sprintf(`{"artifactId":%q}`, sourceArtifact.ID)),
		Rationale: "先保存并检查版本固定的源码证据，再提出可被外部复现证据区分的假设。",
		ExpectedEffect: securityruntime.EffectSpec{
			Class: "read_local", IdempotencyKey: "vuln:inspect:" + sourceArtifact.SHA256,
			Cleanup: "none; read-only fixture inspection", Approval: "granted by builtin local fixture scope",
			ScopeCheck: "exact lab target packet-parser@local-v1",
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
		Summary:   "固定源码显示 2 字节长度字段直接控制对 16 字节栈缓冲区的 memcpy 长度；函数内未见等价上界检查。",
		MediaType: "application/vnd.milksu.source-review+json", Complete: true,
	}
	if err := s.runtime.CommitObservation(ctx, scope, observation); err != nil {
		return Projection{}, err
	}
	effect := securityruntime.Effect{
		ID: securityruntime.NewIdentifier("effect"), ActionID: action.ID,
		Class: action.ExpectedEffect.Class, IdempotencyKey: action.ExpectedEffect.IdempotencyKey,
		State: "reused", Cleanup: action.ExpectedEffect.Cleanup, ArtifactID: sourceArtifact.ID,
	}
	if err := s.runtime.CommitEffect(ctx, scope, effect, true); err != nil {
		return Projection{}, err
	}
	evidence := securityruntime.Evidence{
		ID:             securityruntime.NewIdentifier("evidence"),
		Claim:          "本地固定版本源码包含未校验的长度字段到栈缓冲区复制路径",
		ObservationIDs: []string{observation.ID}, ArtifactIDs: []string{sourceArtifact.ID},
		Provenance: "builtin fixture source reviewed by deterministic MilkSU source inspector",
	}
	if err := s.runtime.LinkEvidence(ctx, scope, evidence); err != nil {
		return Projection{}, err
	}
	attackSurface.EvidenceIDs = []string{evidence.ID}
	hypothesis.EvidenceIDs = []string{evidence.ID}
	rootCause.EvidenceIDs = []string{evidence.ID}
	for kind, value := range map[string]any{
		FactAttackSurfaceRecorded: attackSurface,
		FactHypothesisRecorded:    hypothesis,
		FactRootCauseRecorded:     rootCause,
	} {
		fact, factErr := marshalRoleFact(kind, value, []string{sourceArtifact.ID}, []string{evidence.ID})
		if factErr != nil {
			return Projection{}, factErr
		}
		fact.AttemptID = attempt.ID
		fact.StepID = step.ID
		if factErr = s.runtime.CommitRoleFact(ctx, scope, fact); factErr != nil {
			return Projection{}, factErr
		}
	}
	if err := s.runtime.SetActionStatus(ctx, scope, action.ID, securityruntime.ActionCompleted, ""); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.FinishStep(ctx, scope, securityruntime.StepCompleted, ""); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.FinishAttempt(ctx, job.ID, attempt.ID, securityruntime.AttemptCompleted, "静态根因候选已保存，等待外部复现证据"); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.RecordEnvironment(ctx, attemptScope, lease, false); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, job.ID)
}

func (s *Service) EnsureCVETrackingWorkspace(ctx context.Context, request TrackingWorkspaceRequest) (Projection, error) {
	if err := s.checkOpen(); err != nil {
		return Projection{}, err
	}
	cveID := strings.ToUpper(strings.TrimSpace(request.CVEID))
	if !cveIDPattern.MatchString(cveID) {
		return Projection{}, fmt.Errorf("CVE tracking workspace requires a CVE-YYYY-NNNN id")
	}
	title := strings.TrimSpace(request.Title)
	if title == "" {
		title = cveID + " vulnerability learning"
	}
	if len([]rune(title)) > 180 {
		return Projection{}, fmt.Errorf("CVE tracking title must stay within 180 characters")
	}
	summary := strings.TrimSpace(request.Summary)
	if len([]rune(summary)) > 1200 {
		return Projection{}, fmt.Errorf("CVE tracking summary must stay within 1200 characters")
	}
	referenceHref := strings.TrimSpace(request.ReferenceHref)
	if referenceHref != "" {
		parsed, err := url.Parse(referenceHref)
		if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil {
			return Projection{}, fmt.Errorf("CVE tracking reference must be an http(s) URL without credentials")
		}
	}

	values, err := s.runtime.ListJobs(ctx)
	if err != nil {
		return Projection{}, err
	}
	for _, value := range values {
		if value.Role != PackageID {
			continue
		}
		projection, projectionErr := s.GetJob(ctx, value.ID)
		if projectionErr != nil {
			return Projection{}, projectionErr
		}
		if strings.EqualFold(projection.Target.Name, cveID) && projection.Target.Fixture == "cve-tracking" {
			return projection, nil
		}
	}

	now := time.Now().UTC()
	job := securityruntime.Job{
		ID: securityruntime.NewIdentifier("job"), Title: cveID + " · tracking",
		Role: PackageID, CollaborationMode: "copilot", Status: securityruntime.JobQueued,
		CreatedAt: now, UpdatedAt: now,
	}
	if err := s.runtime.CreateJob(ctx, job); err != nil {
		return Projection{}, err
	}
	scopeTarget := securitypolicy.Target{Kind: securitypolicy.TargetLab, Value: "cve-tracking:" + cveID}
	if referenceHref != "" {
		scopeTarget = securitypolicy.Target{Kind: securitypolicy.TargetOrigin, Value: referenceHref}
	}
	scopeTarget, err = securitypolicy.NormalizeTarget(scopeTarget)
	if err != nil {
		return Projection{}, err
	}
	grant, err := securitypolicy.NewGrant(
		"user-confirmed:cve-tracking",
		"authorized CVE learning note tracking",
		[]securitypolicy.Target{scopeTarget},
		30*24*time.Hour,
	)
	if err != nil {
		return Projection{}, err
	}
	target := Target{
		ID: securityruntime.NewIdentifier("target"), Name: cveID, Version: "tracking",
		Component: title, Fixture: "cve-tracking", CollaborationMode: "copilot",
		Scope: grant, AdmittedAt: now,
	}
	if summary != "" {
		target.Component = title + " · " + firstLine(summary, 160)
	}
	targetFact, err := marshalRoleFact(FactTargetAdmitted, target, nil, nil)
	if err != nil {
		return Projection{}, err
	}
	if err := s.runtime.CommitRoleFact(ctx, securityruntime.EventScope{JobID: job.ID}, targetFact); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, job.ID)
}

func (s *Service) SubmitReproductionEvidence(ctx context.Context, jobID string, request ReproductionRequest) (Projection, error) {
	if err := validateReproductionRequest(request); err != nil {
		return Projection{}, err
	}
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	if core.Job.Role != PackageID || core.Terminal() || core.Outcome != nil {
		return Projection{}, fmt.Errorf("vulnerability research job cannot accept reproduction evidence")
	}
	target, err := targetFromProjection(core)
	if err != nil {
		return Projection{}, err
	}
	request.TriggerSHA256 = strings.ToLower(strings.TrimSpace(request.TriggerSHA256))
	request.Attestation = strings.TrimSpace(request.Attestation)

	attempt := securityruntime.Attempt{
		ID: securityruntime.NewIdentifier("attempt"), JobID: jobID,
		Engine: "user-evidence-intake", Model: "none", Environment: "external-clean-processes",
		Evaluator: s.evaluator.Name() + "@" + s.evaluator.Version(),
		Status:    securityruntime.AttemptRunning, StartedAt: time.Now().UTC(),
	}
	if err := s.runtime.StartAttempt(ctx, attempt); err != nil {
		return Projection{}, err
	}
	lease := securityruntime.EnvironmentLease{
		ID: securityruntime.NewIdentifier("lease"), Provider: "external-attested",
		Target: target.Name + "@" + target.Version, Resettable: false,
	}
	attemptScope := securityruntime.EventScope{JobID: jobID, AttemptID: attempt.ID}
	if err := s.runtime.RecordEnvironment(ctx, attemptScope, lease, true); err != nil {
		return Projection{}, err
	}
	step := securityruntime.Step{
		ID: securityruntime.NewIdentifier("step"), AttemptID: attempt.ID,
		Name:        "review-reproduction-evidence",
		Description: "保存三次外部 Sanitizer 日志、环境指纹和触发样本哈希，并由确定性评估器核验一致性",
		Status:      securityruntime.StepRunning, StartedAt: time.Now().UTC(),
	}
	scope := securityruntime.EventScope{JobID: jobID, AttemptID: attempt.ID, StepID: step.ID}
	if err := s.runtime.StartStep(ctx, scope, step); err != nil {
		return Projection{}, err
	}
	action := securityruntime.Action{
		ID: securityruntime.NewIdentifier("action"), StepID: step.ID,
		Capability: "vuln.evidence-intake", Name: "vuln.import_reproduction_logs",
		Input:     json.RawMessage(fmt.Sprintf(`{"triggerSha256":%q,"triggerSize":%d,"runCount":3}`, request.TriggerSHA256, request.TriggerSize)),
		Rationale: "复现输入不进入 MilkSU；只保存用户主动提供的哈希、三次日志与干净进程确认。",
		ExpectedEffect: securityruntime.EffectSpec{
			Class: "local_artifact_write", IdempotencyKey: "vuln:reproduction:" + request.TriggerSHA256,
			Cleanup:    "content-addressed artifact retained with the research workspace",
			Approval:   "explicit desktop submission by local user",
			ScopeCheck: "evidence metadata is bound to packet-parser@local-v1",
		},
		Status: securityruntime.ActionProposed,
	}
	if err := s.runtime.ProposeAction(ctx, scope, action); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.SetActionStatus(ctx, scope, action.ID, securityruntime.ActionRunning, ""); err != nil {
		return Projection{}, err
	}
	pack, err := json.MarshalIndent(request, "", "  ")
	if err != nil {
		return Projection{}, err
	}
	artifact, created, reused, err := s.runtime.CommitActionArtifact(ctx, scope, action.ID, "application/vnd.milksu.vuln-reproduction+json", pack)
	if err != nil {
		return Projection{}, err
	}
	state := "committed"
	if reused || !created {
		state = "reused"
	}
	effect := securityruntime.Effect{
		ID: securityruntime.NewIdentifier("effect"), ActionID: action.ID,
		Class: action.ExpectedEffect.Class, IdempotencyKey: action.ExpectedEffect.IdempotencyKey,
		State: state, Cleanup: action.ExpectedEffect.Cleanup, ArtifactID: artifact.ID,
	}
	if err := s.runtime.CommitEffect(ctx, scope, effect, state == "reused"); err != nil {
		return Projection{}, err
	}
	observation := securityruntime.Observation{
		ID: securityruntime.NewIdentifier("observation"), ActionID: action.ID,
		Summary:   "已接收三个外部 Sanitizer 运行日志、环境指纹、触发样本 SHA-256 与用户干净进程确认；未接收或执行触发样本。",
		MediaType: "application/vnd.milksu.vuln-reproduction+json", Complete: true,
	}
	if err := s.runtime.CommitObservation(ctx, scope, observation); err != nil {
		return Projection{}, err
	}
	evidence := securityruntime.Evidence{
		ID:             securityruntime.NewIdentifier("evidence"),
		Claim:          "外部复现证据包包含三个独立运行记录与同一 Sanitizer 指纹",
		ObservationIDs: []string{observation.ID}, ArtifactIDs: []string{artifact.ID},
		Provenance: "user-imported local reproduction evidence; trigger bytes were not admitted or executed",
	}
	if err := s.runtime.LinkEvidence(ctx, scope, evidence); err != nil {
		return Projection{}, err
	}
	decision, reproduction := s.evaluator.Evaluate(request)
	reproduction.RecordedAt = time.Now().UTC()
	reproduction.EvidenceIDs = []string{evidence.ID}
	reproduction.ArtifactIDs = []string{artifact.ID}
	reproductionFact, err := marshalRoleFact(FactReproductionRecorded, reproduction, []string{artifact.ID}, []string{evidence.ID})
	if err != nil {
		return Projection{}, err
	}
	reproductionFact.AttemptID = attempt.ID
	reproductionFact.StepID = step.ID
	if err := s.runtime.CommitRoleFact(ctx, scope, reproductionFact); err != nil {
		return Projection{}, err
	}
	hypothesis, err := latestHypothesis(core)
	if err == nil {
		hypothesis.Status = "verified_by_external_reproduction_evidence"
		hypothesis.NextExperiment = "在不查看原始样本内容的前提下，设计一个长度边界变体并记录预期结果。"
		hypothesis.RecordedAt = time.Now().UTC()
		hypothesis.EvidenceIDs = appendUnique(hypothesis.EvidenceIDs, evidence.ID)
		hypothesisFact, factErr := marshalRoleFact(FactHypothesisRecorded, hypothesis, []string{artifact.ID}, hypothesis.EvidenceIDs)
		if factErr != nil {
			return Projection{}, factErr
		}
		hypothesisFact.AttemptID = attempt.ID
		hypothesisFact.StepID = step.ID
		if factErr = s.runtime.CommitRoleFact(ctx, scope, hypothesisFact); factErr != nil {
			return Projection{}, factErr
		}
	}
	if err := s.runtime.SetActionStatus(ctx, scope, action.ID, securityruntime.ActionCompleted, ""); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.FinishStep(ctx, scope, securityruntime.StepCompleted, ""); err != nil {
		return Projection{}, err
	}
	evaluation := securityruntime.Evaluation{
		ID: securityruntime.NewIdentifier("evaluation"), Evaluator: s.evaluator.Name(),
		Version: s.evaluator.Version(), Verdict: decision.Verdict, Score: decision.Score,
		Summary: decision.Summary, EvidenceIDs: []string{evidence.ID},
	}
	if err := s.runtime.RecordEvaluation(ctx, attemptScope, evaluation); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.FinishAttempt(ctx, jobID, attempt.ID, securityruntime.AttemptCompleted, decision.Summary); err != nil {
		return Projection{}, err
	}
	if err := s.runtime.RecordEnvironment(ctx, attemptScope, lease, false); err != nil {
		return Projection{}, err
	}
	if decision.Verdict == securityruntime.VerdictPass {
		outcome := securityruntime.Outcome{
			Status: securityruntime.OutcomeSucceeded, Summary: decision.Summary, EvaluationID: evaluation.ID,
		}
		if err := s.runtime.DecideOutcome(ctx, attemptScope, outcome); err != nil {
			return Projection{}, err
		}
		if err := s.runtime.FinishJob(ctx, jobID, securityruntime.JobSucceeded, decision.Summary); err != nil {
			return Projection{}, err
		}
	}
	return s.GetJob(ctx, jobID)
}

func (s *Service) RecordLearning(ctx context.Context, jobID string, request LearningRecordRequest) (Projection, error) {
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	if core.Job.Role != PackageID {
		return Projection{}, fmt.Errorf("job is not a vulnerability research workspace")
	}
	kind := strings.ToLower(strings.TrimSpace(request.Kind))
	if kind != "reflection" && kind != "independent_step" && kind != "variant" {
		return Projection{}, fmt.Errorf("unsupported vulnerability learning record kind")
	}
	content := strings.TrimSpace(request.Content)
	concept := strings.TrimSpace(request.Concept)
	if content == "" || len([]rune(content)) > 4000 || len([]rune(concept)) > 160 {
		return Projection{}, fmt.Errorf("learning content is required and must stay within the local record limits")
	}
	record := LearningRecord{
		ID: securityruntime.NewIdentifier("learning"), Kind: kind, Content: content,
		Concept: concept, CreatedAt: time.Now().UTC(),
	}
	fact, err := marshalRoleFact(FactLearningRecorded, record, nil, nil)
	if err != nil {
		return Projection{}, err
	}
	if err := s.runtime.CommitRoleFact(ctx, securityruntime.EventScope{JobID: jobID}, fact); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, jobID)
}

func (s *Service) RecordAssetVerification(ctx context.Context, jobID string, request AssetVerificationRequest) (Projection, error) {
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	if core.Job.Role != PackageID {
		return Projection{}, fmt.Errorf("job is not a vulnerability research workspace")
	}
	normalized, err := normalizeAssetVerificationRequest(request)
	if err != nil {
		return Projection{}, err
	}
	record := AssetVerification{
		ID:          securityruntime.NewIdentifier("asset"),
		Name:        normalized.Name,
		Address:     normalized.Address,
		Environment: normalized.Environment,
		Status:      normalized.Status,
		Summary:     normalized.Summary,
		RecordedAt:  time.Now().UTC(),
	}
	fact, err := marshalRoleFact(FactAssetVerificationRecorded, record, nil, nil)
	if err != nil {
		return Projection{}, err
	}
	if err := s.runtime.CommitRoleFact(ctx, securityruntime.EventScope{JobID: jobID}, fact); err != nil {
		return Projection{}, err
	}
	return s.GetJob(ctx, jobID)
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

func (s *Service) GetJob(ctx context.Context, jobID string) (Projection, error) {
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return Projection{}, err
	}
	return Project(core)
}

func (s *Service) CancelJob(ctx context.Context, jobID string) error {
	core, err := s.runtime.GetJob(ctx, jobID)
	if err != nil {
		return err
	}
	if core.Job.Role != PackageID {
		return fmt.Errorf("job is not a vulnerability research workspace")
	}
	if core.Terminal() || core.Outcome != nil {
		return nil
	}
	if err := s.runtime.RequestCancellation(ctx, jobID, "vulnerability research cancelled by user"); err != nil {
		return err
	}
	outcome := securityruntime.Outcome{Status: securityruntime.OutcomeCancelled, Summary: "漏洞研究任务已由用户取消。"}
	if err := s.runtime.DecideOutcome(ctx, securityruntime.EventScope{JobID: jobID}, outcome); err != nil {
		return err
	}
	return s.runtime.FinishJob(ctx, jobID, securityruntime.JobCancelled, outcome.Summary)
}

func (s *Service) Recover(ctx context.Context) error {
	values, err := s.runtime.ListJobs(ctx)
	if err != nil {
		return err
	}
	for _, value := range values {
		if value.Role != PackageID || value.Status == securityruntime.JobSucceeded ||
			value.Status == securityruntime.JobFailed || value.Status == securityruntime.JobCancelled {
			continue
		}
		core, projectionErr := s.runtime.GetJob(ctx, value.ID)
		if projectionErr != nil {
			return projectionErr
		}
		state := stateFromProjection(core)
		if state.action != nil && state.action.Status != securityruntime.ActionCompleted && state.step != nil && state.attempt != nil {
			if err := s.runtime.SetActionStatus(ctx, securityruntime.EventScope{JobID: value.ID, AttemptID: state.attempt.ID, StepID: state.step.ID}, state.action.ID, securityruntime.ActionFailed, "application stopped during evidence recording"); err != nil {
				return err
			}
		}
		if state.step != nil && state.step.Status == securityruntime.StepRunning && state.attempt != nil {
			if err := s.runtime.FinishStep(ctx, securityruntime.EventScope{JobID: value.ID, AttemptID: state.attempt.ID, StepID: state.step.ID}, securityruntime.StepFailed, "application stopped during evidence recording"); err != nil {
				return err
			}
		}
		if state.attempt != nil && state.attempt.Status == securityruntime.AttemptRunning {
			if err := s.runtime.FinishAttempt(ctx, value.ID, state.attempt.ID, securityruntime.AttemptInterrupted, "application stopped; research facts remain recoverable"); err != nil {
				return err
			}
			if err := s.runtime.RecordRecovery(ctx, value.ID, state.attempt.ID); err != nil {
				return err
			}
		}
	}
	return nil
}

func (s *Service) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.closed = true
	return nil
}

func (s *Service) checkOpen() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.closed {
		return fmt.Errorf("vulnerability research service is closed")
	}
	return nil
}

func analyzePacketParser(source string) (AttackSurface, Hypothesis, RootCause, error) {
	lines := strings.Split(source, "\n")
	bufferLine := 0
	copyLine := 0
	for index, line := range lines {
		if strings.Contains(line, "char name[16]") {
			bufferLine = index + 1
		}
		if strings.Contains(line, "memcpy(name, data + 2, declared)") {
			copyLine = index + 1
		}
	}
	if bufferLine == 0 || copyLine == 0 || bufferLine >= copyLine {
		return AttackSurface{}, Hypothesis{}, RootCause{}, fmt.Errorf("packet-parser fixture no longer matches the reviewed static-analysis contract")
	}
	prefix := strings.Join(lines[:copyLine-1], "\n")
	if strings.Contains(prefix, "declared > sizeof(name)") || strings.Contains(prefix, "declared <= sizeof(name)") {
		return AttackSurface{}, Hypothesis{}, RootCause{}, fmt.Errorf("packet-parser fixture now contains a bounds check; update the M3 fixture contract")
	}
	now := time.Now().UTC()
	attackSurface := AttackSurface{
		ID: securityruntime.NewIdentifier("surface"), EntryPoint: "main → parse_packet",
		Input: "用户提供的本地 packet sample", DataFlow: "前 2 字节 → declared → memcpy 长度",
		Sink: "memcpy(name, data + 2, declared)", SourceLine: copyLine,
		Summary:    "本地文件的长度字段到达固定大小栈缓冲区复制操作。",
		RecordedAt: now,
	}
	hypothesis := Hypothesis{
		ID:             securityruntime.NewIdentifier("hypothesis"),
		Statement:      "未验证 payload_len <= sizeof(name) 可能造成栈缓冲区越界写。",
		Status:         "supported_by_static_evidence",
		Rationale:      "name 只有 16 字节，而 declared 由输入前两个字节控制并直接作为 memcpy 长度。",
		NextExperiment: "导入三个干净本地进程产生的 Sanitizer 日志与同一触发样本哈希。",
		RecordedAt:     now,
	}
	rootCause := RootCause{
		ID:              securityruntime.NewIdentifier("rootcause"),
		Summary:         "长度字段缺少目标缓冲区上界校验。",
		TechnicalDetail: "parse_packet 在确认输入至少含 declared+2 字节后，把 declared 直接作为复制长度；这只验证源数据长度，没有验证 16 字节目标 name 的容量。",
		Impact:          "固定本地 fixture 中存在输入可控的越界写路径；不从该 fixture 推断任何外部产品影响。",
		Exploitability:  "未评估。M3 只保存根因与外部复现证据，不开发利用链。",
		SourceLine:      copyLine, Status: "static_cause_identified", RecordedAt: now,
	}
	return attackSurface, hypothesis, rootCause, nil
}

func targetFromProjection(core securityruntime.JobProjection) (Target, error) {
	for _, fact := range core.RoleFacts {
		if fact.PackageID != PackageID || fact.SchemaVersion != SchemaVersion || fact.Kind != FactTargetAdmitted {
			continue
		}
		var target Target
		if err := json.Unmarshal(fact.Data, &target); err != nil || target.ID == "" {
			return Target{}, fmt.Errorf("invalid admitted vulnerability target")
		}
		return target, nil
	}
	return Target{}, fmt.Errorf("vulnerability target fact is missing")
}

func firstLine(value string, maxRunes int) string {
	value = strings.TrimSpace(value)
	if value == "" || maxRunes <= 0 {
		return ""
	}
	for _, delimiter := range []string{"\r\n", "\n", "\r"} {
		if before, _, ok := strings.Cut(value, delimiter); ok {
			value = strings.TrimSpace(before)
			break
		}
	}
	runes := []rune(value)
	if len(runes) <= maxRunes {
		return value
	}
	return string(runes[:maxRunes]) + "…"
}

func latestHypothesis(core securityruntime.JobProjection) (Hypothesis, error) {
	for index := len(core.RoleFacts) - 1; index >= 0; index-- {
		fact := core.RoleFacts[index]
		if fact.PackageID != PackageID || fact.SchemaVersion != SchemaVersion || fact.Kind != FactHypothesisRecorded {
			continue
		}
		var value Hypothesis
		if err := json.Unmarshal(fact.Data, &value); err != nil || value.ID == "" {
			return Hypothesis{}, fmt.Errorf("invalid vulnerability hypothesis")
		}
		return value, nil
	}
	return Hypothesis{}, fmt.Errorf("vulnerability hypothesis fact is missing")
}

type projectedState struct {
	attempt *securityruntime.Attempt
	step    *securityruntime.Step
	action  *securityruntime.Action
}

func stateFromProjection(projection securityruntime.JobProjection) projectedState {
	state := projectedState{}
	if len(projection.Attempts) > 0 {
		value := projection.Attempts[len(projection.Attempts)-1]
		state.attempt = &value
	}
	if state.attempt != nil {
		for index := len(projection.Steps) - 1; index >= 0; index-- {
			if projection.Steps[index].AttemptID == state.attempt.ID {
				value := projection.Steps[index]
				state.step = &value
				break
			}
		}
	}
	if state.step != nil {
		for index := len(projection.Actions) - 1; index >= 0; index-- {
			if projection.Actions[index].StepID == state.step.ID {
				value := projection.Actions[index]
				state.action = &value
				break
			}
		}
	}
	return state
}
