package ctf

import (
	"encoding/json"
	"fmt"
	"sort"

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
	for _, fact := range core.RoleFacts {
		if fact.PackageID != PackageID || fact.SchemaVersion != SchemaVersion || fact.Kind != FactLearningRecorded {
			continue
		}
		var record LearningRecord
		if err := json.Unmarshal(fact.Data, &record); err != nil || record.ID == "" || record.Kind == "" || record.Content == "" {
			return Projection{}, fmt.Errorf("invalid CTF learning record")
		}
		learning = append(learning, record)
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
	for index, step := range core.Steps {
		experiment := ExperimentView{
			ID: step.ID, Number: index + 1, Status: step.Status,
			Observations: []securityruntime.Observation{}, ArtifactIDs: []string{},
		}
		if action, exists := actionsByStep[step.ID]; exists {
			value := action
			experiment.Action = &value
			experiment.Observations = append(experiment.Observations, observationsByAction[action.ID]...)
			experiment.ArtifactIDs = append(experiment.ArtifactIDs, artifactIDsByAction[action.ID]...)
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
			Candidate string `json:"candidate"`
		}
		_ = json.Unmarshal(action.Input, &input)
		submission := SubmissionView{Candidate: input.Candidate}
		if evaluationIndex < len(core.Evaluations) {
			evaluation := core.Evaluations[evaluationIndex]
			submission.Verdict = evaluation.Verdict
			submission.Summary = evaluation.Summary
			evaluationIndex++
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

	return Projection{
		ContractVersion: SchemaVersion,
		Job:             core.Job,
		Challenge: ChallengeView{
			ID: challenge.ID, Title: challenge.Title, Statement: challenge.Statement,
			Category: challenge.Category, CollaborationMode: challenge.CollaborationMode,
			TrackName: challenge.TrackName, HumanGoal: challenge.HumanGoal, Source: challenge.Source,
			Materials: append([]Material{}, challenge.Materials...), KnowledgePoints: append([]string{}, challenge.KnowledgePoints...),
			JudgeType: challenge.Judge.Type, JudgeVersion: challenge.Judge.Version,
			AdmittedAt: challenge.AdmittedAt,
		},
		Attempts:     append([]securityruntime.Attempt{}, core.Attempts...),
		Experiments:  experiments,
		Artifacts:    append([]securityruntime.Artifact{}, core.Artifacts...),
		Evidence:     append([]securityruntime.Evidence{}, core.Evidence...),
		Evaluations:  append([]securityruntime.Evaluation{}, core.Evaluations...),
		Submissions:  submissions,
		Learning:     learning,
		HumanOutcome: humanOutcome,
		Outcome:      core.Outcome,
		Events:       append([]securityruntime.Event{}, core.Events...),
	}, nil
}

func SummaryFrom(projection Projection) Summary {
	var verdict securityruntime.Verdict
	if len(projection.Evaluations) > 0 {
		verdict = projection.Evaluations[len(projection.Evaluations)-1].Verdict
	}
	return Summary{
		ID: projection.Job.ID, Title: projection.Job.Title, Category: projection.Challenge.Category,
		Status: projection.Job.Status, ExperimentCount: len(projection.Experiments),
		Verdict: verdict, UpdatedAt: projection.Job.UpdatedAt,
	}
}

func SortSummaries(values []Summary) {
	sort.Slice(values, func(i, j int) bool { return values[i].UpdatedAt.After(values[j].UpdatedAt) })
}
