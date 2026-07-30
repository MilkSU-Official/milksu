package vuln

import (
	"encoding/json"
	"fmt"
	"sort"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func Project(core securityruntime.JobProjection) (Projection, error) {
	if core.Job.Role != PackageID {
		return Projection{}, fmt.Errorf("job is not a vulnerability research workspace")
	}

	var target Target
	var attackSurface *AttackSurface
	var reproduction *Reproduction
	var rootCause *RootCause
	hypotheses := make([]Hypothesis, 0)
	learning := make([]LearningRecord, 0)
	for _, fact := range core.RoleFacts {
		if fact.PackageID != PackageID || fact.SchemaVersion != SchemaVersion {
			continue
		}
		switch fact.Kind {
		case FactTargetAdmitted:
			if target.ID != "" {
				return Projection{}, fmt.Errorf("job has more than one admitted target")
			}
			if err := json.Unmarshal(fact.Data, &target); err != nil || target.ID == "" || target.Scope.ID == "" {
				return Projection{}, fmt.Errorf("invalid admitted vulnerability target")
			}
		case FactAttackSurfaceRecorded:
			var value AttackSurface
			if err := json.Unmarshal(fact.Data, &value); err != nil || value.ID == "" {
				return Projection{}, fmt.Errorf("invalid attack surface fact")
			}
			attackSurface = &value
		case FactHypothesisRecorded:
			var value Hypothesis
			if err := json.Unmarshal(fact.Data, &value); err != nil || value.ID == "" || value.Statement == "" {
				return Projection{}, fmt.Errorf("invalid hypothesis fact")
			}
			replaced := false
			for index := range hypotheses {
				if hypotheses[index].ID == value.ID {
					hypotheses[index] = value
					replaced = true
					break
				}
			}
			if !replaced {
				hypotheses = append(hypotheses, value)
			}
		case FactReproductionRecorded:
			var value Reproduction
			if err := json.Unmarshal(fact.Data, &value); err != nil || value.ID == "" {
				return Projection{}, fmt.Errorf("invalid reproduction fact")
			}
			reproduction = &value
		case FactRootCauseRecorded:
			var value RootCause
			if err := json.Unmarshal(fact.Data, &value); err != nil || value.ID == "" {
				return Projection{}, fmt.Errorf("invalid root cause fact")
			}
			rootCause = &value
		case FactLearningRecorded:
			var value LearningRecord
			if err := json.Unmarshal(fact.Data, &value); err != nil || value.ID == "" || value.Kind == "" || value.Content == "" {
				return Projection{}, fmt.Errorf("invalid vulnerability learning fact")
			}
			learning = append(learning, value)
		}
	}
	if target.ID == "" {
		return Projection{}, fmt.Errorf("job has no admitted vulnerability target")
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
	for _, effect := range core.Effects {
		if effect.ArtifactID != "" {
			artifactIDsByAction[effect.ActionID] = appendUnique(artifactIDsByAction[effect.ActionID], effect.ArtifactID)
		}
	}

	experiments := make([]ExperimentView, 0, len(core.Steps))
	for index, step := range core.Steps {
		experiment := ExperimentView{
			ID: step.ID, Number: index + 1, Name: step.Name, Description: step.Description,
			Status: step.Status, Observations: []securityruntime.Observation{}, ArtifactIDs: []string{},
		}
		if action, exists := actionsByStep[step.ID]; exists {
			value := action
			experiment.Action = &value
			experiment.Observations = append(experiment.Observations, observationsByAction[action.ID]...)
			experiment.ArtifactIDs = append(experiment.ArtifactIDs, artifactIDsByAction[action.ID]...)
		}
		experiments = append(experiments, experiment)
	}

	humanOutcome := HumanOutcomeView{
		Goal:    "能解释长度字段为什么越过目标缓冲区，并独立完成一个变体实验。",
		Summary: "尚未记录学习复盘。",
	}
	for _, record := range learning {
		switch record.Kind {
		case "reflection":
			humanOutcome.ReflectionCount++
		case "independent_step":
			humanOutcome.IndependentSteps++
		case "variant":
			humanOutcome.VariantCount++
		}
	}
	if len(learning) > 0 {
		humanOutcome.Summary = fmt.Sprintf(
			"已记录 %d 次复盘、%d 个独立步骤和 %d 个变体实验。",
			humanOutcome.ReflectionCount,
			humanOutcome.IndependentSteps,
			humanOutcome.VariantCount,
		)
	}

	return Projection{
		ContractVersion: SchemaVersion,
		Job:             core.Job,
		Target:          target,
		AttackSurface:   attackSurface,
		Hypotheses:      hypotheses,
		Experiments:     experiments,
		Reproduction:    reproduction,
		RootCause:       rootCause,
		Artifacts:       append([]securityruntime.Artifact{}, core.Artifacts...),
		Evidence:        append([]securityruntime.Evidence{}, core.Evidence...),
		Evaluations:     append([]securityruntime.Evaluation{}, core.Evaluations...),
		Learning:        learning,
		HumanOutcome:    humanOutcome,
		Outcome:         core.Outcome,
		Events:          append([]securityruntime.Event{}, core.Events...),
	}, nil
}

func SummaryFrom(projection Projection) Summary {
	var verdict securityruntime.Verdict
	if len(projection.Evaluations) > 0 {
		verdict = projection.Evaluations[len(projection.Evaluations)-1].Verdict
	}
	reproductionState := "awaiting_evidence"
	if projection.Reproduction != nil {
		reproductionState = fmt.Sprintf("%d/%d", projection.Reproduction.StableRuns, projection.Reproduction.TotalRuns)
	}
	return Summary{
		ID: projection.Job.ID, Title: projection.Job.Title, Version: projection.Target.Version,
		Status: projection.Job.Status, HypothesisCount: len(projection.Hypotheses),
		ReproductionState: reproductionState, Verdict: verdict, UpdatedAt: projection.Job.UpdatedAt,
	}
}

func SortSummaries(values []Summary) {
	sort.Slice(values, func(i, j int) bool { return values[i].UpdatedAt.After(values[j].UpdatedAt) })
}

func appendUnique(values []string, value string) []string {
	for _, existing := range values {
		if existing == value {
			return values
		}
	}
	return append(values, value)
}
