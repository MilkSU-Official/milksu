package ctf

import (
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func Project(core securityruntime.JobProjection) (Projection, error) {
	if core.Job.Role != PackageID {
		return Projection{}, fmt.Errorf("job is not a CTF challenge")
	}
	var challenge Challenge
	found := false
	for _, fact := range core.RoleFacts {
		if fact.Kind != FactChallengeAdmitted {
			continue
		}
		if found {
			return Projection{}, fmt.Errorf("job has more than one admitted challenge")
		}
		value, err := decodeChallengeFact(fact)
		if err != nil {
			return Projection{}, err
		}
		challenge = value
		found = true
	}
	if !found {
		return Projection{}, fmt.Errorf("job has no admitted challenge")
	}
	learning := make([]LearningRecord, 0)
	agentCandidates := make([]AgentCandidate, 0)
	judgeReceipts := make([]ExternalJudgeReceipt, 0)
	for _, fact := range core.RoleFacts {
		if fact.PackageID != PackageID || fact.SchemaVersion != SchemaVersion {
			continue
		}
		switch fact.Kind {
		case FactLearningRecorded:
			var record LearningRecord
			if err := json.Unmarshal(fact.Data, &record); err != nil || record.ID == "" || record.Kind == "" || record.Content == "" {
				return Projection{}, fmt.Errorf("invalid CTF learning record")
			}
			learning = append(learning, record)
		case FactJudgeReceipt:
			var receipt ExternalJudgeReceipt
			if err := json.Unmarshal(fact.Data, &receipt); err != nil || receipt.ID == "" || receipt.Platform == "" || receipt.Status == "" || receipt.Summary == "" {
				return Projection{}, fmt.Errorf("invalid CTF Judge receipt")
			}
			judgeReceipts = append(judgeReceipts, receipt)
		case FactAgentCandidate:
			var candidate AgentCandidate
			if err := json.Unmarshal(fact.Data, &candidate); err != nil ||
				candidate.ID == "" ||
				candidate.SessionID == "" ||
				candidate.Candidate == "" ||
				candidate.Explanation == "" ||
				candidate.ArtifactID == "" ||
				candidate.CreatedAt.IsZero() {
				return Projection{}, fmt.Errorf("invalid PI Agent candidate")
			}
			if candidate.Assessment.Status == "" {
				candidate.Assessment = assessCandidate(candidate.Candidate, challenge.ExternalPlatform)
			} else if candidate.Assessment.Status != "plausible" &&
				candidate.Assessment.Status != "unusual" {
				return Projection{}, fmt.Errorf("invalid PI Agent candidate assessment")
			}
			if candidate.Assessment.Warnings == nil {
				candidate.Assessment.Warnings = []string{}
			}
			agentCandidates = append(agentCandidates, candidate)
		}
	}

	actionsByStep := make(map[string]securityruntime.Action, len(core.Actions))
	observationsByAction := make(map[string][]securityruntime.Observation)
	artifactIDsByAction := make(map[string][]string)
	for _, action := range core.Actions {
		actionsByStep[action.StepID] = action
	}
	for _, observation := range core.Observations {
		observationsByAction[observation.ActionID] = append(observationsByAction[observation.ActionID], observation)
	}
	for _, artifact := range core.Artifacts {
		if artifact.SourceActionID != "" {
			artifactIDsByAction[artifact.SourceActionID] = append(artifactIDsByAction[artifact.SourceActionID], artifact.ID)
		}
	}
	// Read-only actions intentionally reuse admitted artifacts, and recovery may
	// reuse an artifact committed by an earlier action. Effect is therefore the
	// authoritative action-to-artifact link; SourceActionID only records where a
	// new artifact identity was first committed.
	for _, effect := range core.Effects {
		if effect.ArtifactID != "" {
			artifactIDsByAction[effect.ActionID] = appendUnique(artifactIDsByAction[effect.ActionID], effect.ArtifactID)
		}
	}

	experiments := make([]ExperimentView, 0, len(core.Steps))
	agentRuns := make([]AgentRunView, 0)
	attemptsByID := make(map[string]securityruntime.Attempt, len(core.Attempts))
	for _, attempt := range core.Attempts {
		attemptsByID[attempt.ID] = attempt
	}
	for index, step := range core.Steps {
		experiment := ExperimentView{
			ID: step.ID, AttemptID: step.AttemptID, Number: index + 1, Status: step.Status,
			StartedAt: step.StartedAt, FinishedAt: step.FinishedAt,
			Observations: []securityruntime.Observation{}, ArtifactIDs: []string{},
		}
		if action, exists := actionsByStep[step.ID]; exists {
			value := action
			experiment.Action = &value
			experiment.Observations = append(experiment.Observations, observationsByAction[action.ID]...)
			experiment.ArtifactIDs = append(experiment.ArtifactIDs, artifactIDsByAction[action.ID]...)
			if action.Name == "ctf.pi_agent_turn" {
				var input struct {
					SessionID string          `json:"sessionId"`
					Model     string          `json:"model"`
					Metrics   AgentRunMetrics `json:"metrics"`
				}
				if len(action.Input) > 0 {
					_ = json.Unmarshal(action.Input, &input)
				}
				if input.Metrics.ToolUsage == nil {
					input.Metrics.ToolUsage = map[string]int{}
				}
				attempt := attemptsByID[step.AttemptID]
				model := strings.TrimSpace(input.Model)
				if model == "" {
					model = strings.TrimSpace(attempt.Model)
				}
				summary := ""
				if observations := observationsByAction[action.ID]; len(observations) > 0 {
					summary = strings.TrimSpace(observations[len(observations)-1].Summary)
				}
				trajectoryArtifactID := ""
				if artifactIDs := artifactIDsByAction[action.ID]; len(artifactIDs) > 0 {
					trajectoryArtifactID = artifactIDs[len(artifactIDs)-1]
				}
				agentRuns = append(agentRuns, AgentRunView{
					AttemptID: step.AttemptID, SessionID: strings.TrimSpace(input.SessionID),
					Model: model, Summary: summary, Metrics: input.Metrics,
					TrajectoryArtifactID: trajectoryArtifactID,
					StartedAt:            step.StartedAt, FinishedAt: step.FinishedAt,
				})
			}
		}
		experiments = append(experiments, experiment)
	}

	submissions := make([]SubmissionView, 0)
	evaluationIndex := 0
	for _, action := range core.Actions {
		if action.Name != "ctf.submit_flag" {
			continue
		}
		var input struct {
			Candidate                string `json:"candidate"`
			ExternalWrongCountBefore *int   `json:"externalWrongCountBefore"`
		}
		_ = json.Unmarshal(action.Input, &input)
		submission := SubmissionView{
			Candidate:                input.Candidate,
			ExternalWrongCountBefore: input.ExternalWrongCountBefore,
		}
		if evaluationIndex < len(core.Evaluations) {
			evaluation := core.Evaluations[evaluationIndex]
			evaluationIndex++
			for evaluationIndex < len(core.Evaluations) &&
				evaluationsShareEvidence(evaluation, core.Evaluations[evaluationIndex]) {
				evaluation = core.Evaluations[evaluationIndex]
				evaluationIndex++
			}
			submission.Verdict = evaluation.Verdict
			submission.Summary = evaluation.Summary
		}
		submissions = append(submissions, submission)
	}

	humanOutcome := HumanOutcomeView{
		Goal: challenge.HumanGoal, KnowledgePoints: append([]string{}, challenge.KnowledgePoints...),
		Summary: "尚未记录学习复盘。",
	}
	for _, record := range learning {
		switch record.Kind {
		case "hint":
			humanOutcome.HintCount++
		case "reflection":
			humanOutcome.ReflectionCount++
		case "independent_step":
			humanOutcome.IndependentSteps++
		}
	}
	if humanOutcome.ReflectionCount > 0 {
		humanOutcome.Summary = fmt.Sprintf("已完成 %d 次复盘，记录 %d 个独立步骤，使用 %d 条提示。", humanOutcome.ReflectionCount, humanOutcome.IndependentSteps, humanOutcome.HintCount)
	}
	debrief := buildDebrief(core, challenge, experiments, submissions, humanOutcome)

	return Projection{
		ContractVersion: SchemaVersion,
		Job:             core.Job,
		Challenge: ChallengeView{
			ID: challenge.ID, Title: challenge.Title, Statement: challenge.Statement,
			Category: challenge.Category, CollaborationMode: challenge.CollaborationMode,
			ExternalPlatform: challenge.ExternalPlatform, ExternalAttemptID: challenge.ExternalAttemptID,
			TrackName: challenge.TrackName, HumanGoal: challenge.HumanGoal, Source: challenge.Source,
			Materials: append([]Material{}, challenge.Materials...), KnowledgePoints: append([]string{}, challenge.KnowledgePoints...),
			AgentPolicy: agentCollaborationPolicyForChallenge(
				challenge.CollaborationMode,
				challenge.Source,
			),
			JudgeType: challenge.Judge.Type, JudgeVersion: challenge.Judge.Version,
			AdmittedAt: challenge.AdmittedAt,
		},
		Attempts:        append([]securityruntime.Attempt{}, core.Attempts...),
		Experiments:     experiments,
		Artifacts:       append([]securityruntime.Artifact{}, core.Artifacts...),
		Evidence:        append([]securityruntime.Evidence{}, core.Evidence...),
		Evaluations:     append([]securityruntime.Evaluation{}, core.Evaluations...),
		AgentRuns:       agentRuns,
		AgentCandidates: agentCandidates,
		Submissions:     submissions,
		JudgeReceipts:   judgeReceipts,
		Learning:        learning,
		HumanOutcome:    humanOutcome,
		Debrief:         debrief,
		Outcome:         core.Outcome,
		Events:          append([]securityruntime.Event{}, core.Events...),
	}, nil
}

func buildDebrief(
	core securityruntime.JobProjection,
	challenge Challenge,
	experiments []ExperimentView,
	submissions []SubmissionView,
	humanOutcome HumanOutcomeView,
) DebriefView {
	result := DebriefView{
		Status:                "in_progress",
		Summary:               fmt.Sprintf("已记录 %d 次实验、%d 条证据和 %d 个产物。", len(experiments), len(core.Evidence), len(core.Artifacts)),
		KeyObservations:       []string{},
		FailureBranches:       []string{},
		Candidates:            []DebriefCandidate{},
		KnowledgePoints:       append([]string{}, challenge.KnowledgePoints...),
		HintCount:             humanOutcome.HintCount,
		ReflectionCount:       humanOutcome.ReflectionCount,
		IndependentSteps:      humanOutcome.IndependentSteps,
		EvidenceCount:         len(core.Evidence),
		ArtifactCount:         len(core.Artifacts),
		RecommendedNextAction: "选择一个最小、可证伪的假设，执行一次实验并保存证据。",
	}
	if core.Outcome != nil {
		result.Status = string(core.Outcome.Status)
		result.Summary = strings.TrimSpace(core.Outcome.Summary)
		if result.Summary == "" {
			result.Summary = fmt.Sprintf("本题已以 %s 状态结束。", core.Outcome.Status)
		}
		result.NeedsReflection = humanOutcome.ReflectionCount == 0
		switch core.Outcome.Status {
		case securityruntime.OutcomeSucceeded:
			result.RecommendedNextAction = "记录关键转折、根因和可复现命令，再从能力画像的薄弱维度选择下一题。"
		case securityruntime.OutcomeFailed, securityruntime.OutcomeCancelled:
			result.RecommendedNextAction = "选择信息增益最高的失败分支，说明缺少哪条证据，再决定重试或换题。"
		}
	}

	for _, experiment := range experiments {
		for _, observation := range experiment.Observations {
			summary := strings.TrimSpace(observation.Summary)
			if observation.Complete && summary != "" {
				result.KeyObservations = appendTextUnique(result.KeyObservations, summary, 5)
			}
		}
		if experiment.Status == securityruntime.StepFailed {
			failure := fmt.Sprintf("实验 %d 失败", experiment.Number)
			if experiment.Action != nil && strings.TrimSpace(experiment.Action.Name) != "" {
				failure += "：" + strings.TrimSpace(experiment.Action.Name)
			}
			result.FailureBranches = appendTextUnique(result.FailureBranches, failure, 5)
		}
		if experiment.Action != nil && experiment.Action.Status == securityruntime.ActionFailed {
			failure := "动作失败：" + strings.TrimSpace(experiment.Action.Name)
			result.FailureBranches = appendTextUnique(result.FailureBranches, failure, 5)
		}
	}
	for _, attempt := range core.Attempts {
		if attempt.Status != securityruntime.AttemptFailed && attempt.Status != securityruntime.AttemptInterrupted {
			continue
		}
		reason := strings.TrimSpace(attempt.Reason)
		if reason == "" {
			reason = string(attempt.Status)
		}
		result.FailureBranches = appendTextUnique(result.FailureBranches, "Agent 尝试中断："+reason, 5)
	}
	for _, submission := range submissions {
		result.Candidates = append(result.Candidates, DebriefCandidate{
			Candidate: submission.Candidate,
			Verdict:   submission.Verdict,
			Summary:   submission.Summary,
		})
	}
	if core.Outcome == nil && len(result.Candidates) > 0 {
		result.RecommendedNextAction = "核对候选答案的证据链，然后只通过平台 Judge 提交验证。"
	}
	return result
}

func appendTextUnique(values []string, candidate string, limit int) []string {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" || len(values) >= limit {
		return values
	}
	for _, value := range values {
		if value == candidate {
			return values
		}
	}
	return append(values, candidate)
}

func evaluationsShareEvidence(left securityruntime.Evaluation, right securityruntime.Evaluation) bool {
	for _, leftID := range left.EvidenceIDs {
		for _, rightID := range right.EvidenceIDs {
			if leftID == rightID {
				return true
			}
		}
	}
	return false
}

func SummaryFrom(projection Projection) Summary {
	var verdict securityruntime.Verdict
	if len(projection.Evaluations) > 0 {
		verdict = projection.Evaluations[len(projection.Evaluations)-1].Verdict
	}
	pendingSubmission, pendingJudge := pendingExternalDecision(projection)
	return Summary{
		ID: projection.Job.ID, Title: projection.Job.Title, Category: projection.Challenge.Category,
		ExternalPlatform:  projection.Challenge.ExternalPlatform,
		ExternalAttemptID: projection.Challenge.ExternalAttemptID,
		Status:            projection.Job.Status, ExperimentCount: len(projection.Experiments),
		Verdict: verdict, PendingSubmission: pendingSubmission, PendingJudge: pendingJudge,
		UpdatedAt: projection.Job.UpdatedAt,
	}
}

func pendingExternalDecision(projection Projection) (bool, bool) {
	if projection.Outcome != nil {
		return false, false
	}
	var latestCandidate string
	if len(projection.AgentCandidates) > 0 {
		latestCandidate = projection.AgentCandidates[len(projection.AgentCandidates)-1].Candidate
	}
	if len(projection.Submissions) == 0 {
		return strings.TrimSpace(latestCandidate) != "", false
	}
	latestSubmission := projection.Submissions[len(projection.Submissions)-1]
	if strings.TrimSpace(latestCandidate) != "" &&
		latestCandidate != latestSubmission.Candidate {
		return true, false
	}
	switch latestSubmission.Verdict {
	case securityruntime.VerdictNeedsReview:
		return false, true
	case securityruntime.VerdictInconclusive:
		return true, false
	default:
		return false, false
	}
}

func SortSummaries(values []Summary) {
	sort.Slice(values, func(i, j int) bool { return values[i].UpdatedAt.After(values[j].UpdatedAt) })
}
