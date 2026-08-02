package ctf

import "strings"

func validLearningActor(value LearningActor) bool {
	switch value {
	case LearningActorUser, LearningActorAgent, LearningActorShared, LearningActorImported:
		return true
	default:
		return false
	}
}

func validLearningAssistance(value LearningAssistance) bool {
	switch value {
	case LearningAssistanceNone,
		LearningAssistanceHint,
		LearningAssistanceCopilot,
		LearningAssistanceDelegated:
		return true
	default:
		return false
	}
}

// normalizeLearningAttribution upgrades append-only legacy learning facts
// conservatively at projection time. Missing provenance can remain useful as
// task history, but it can never become evidence that the user performed a
// step independently.
func normalizeLearningAttribution(
	record LearningRecord,
	collaborationMode string,
) (LearningRecord, bool) {
	if record.Actor == "" && record.Assistance == "" {
		record.Actor = LearningActorImported
		record.Assistance = assistanceForMode(collaborationMode)
		if record.Kind == "hint" {
			record.Assistance = LearningAssistanceHint
		}
		return record, true
	}
	if !validLearningActor(record.Actor) ||
		!validLearningAssistance(record.Assistance) {
		return LearningRecord{}, false
	}
	return record, true
}

func assistanceForMode(collaborationMode string) LearningAssistance {
	switch strings.ToLower(strings.TrimSpace(collaborationMode)) {
	case "coach":
		return LearningAssistanceNone
	case "copilot":
		return LearningAssistanceCopilot
	case "delegate":
		return LearningAssistanceDelegated
	default:
		return LearningAssistanceDelegated
	}
}

func userLearningAssistance(
	collaborationMode string,
	kind string,
	existing []LearningRecord,
) LearningAssistance {
	if kind == "hint" {
		return LearningAssistanceHint
	}
	assistance := assistanceForMode(collaborationMode)
	if assistance != LearningAssistanceNone {
		return assistance
	}
	for _, record := range existing {
		if record.Kind == "hint" {
			return LearningAssistanceHint
		}
	}
	return LearningAssistanceNone
}

func contributionForLearning(
	collaborationMode string,
	learning []LearningRecord,
) TrainingContributionView {
	contribution := TrainingContributionView{
		PrimaryActor: LearningActorImported,
		Assistance:   assistanceForMode(collaborationMode),
	}
	for _, record := range learning {
		switch record.Actor {
		case LearningActorUser:
			contribution.UserRecords++
		case LearningActorAgent:
			contribution.AgentRecords++
		case LearningActorShared:
			contribution.SharedRecords++
		default:
			contribution.ImportedRecords++
		}
		if record.Kind == "hint" &&
			contribution.Assistance == LearningAssistanceNone {
			contribution.Assistance = LearningAssistanceHint
		}
		if record.Kind == "independent_step" &&
			record.Actor == LearningActorUser {
			if record.Assistance == LearningAssistanceNone {
				contribution.UserIndependentSteps++
			} else {
				contribution.UserAssistedSteps++
			}
		}
	}
	switch strings.ToLower(strings.TrimSpace(collaborationMode)) {
	case "coach":
		if contribution.UserIndependentSteps > 0 ||
			contribution.UserAssistedSteps > 0 {
			contribution.PrimaryActor = LearningActorUser
		}
	case "copilot":
		if contribution.UserIndependentSteps > 0 ||
			contribution.UserAssistedSteps > 0 ||
			contribution.SharedRecords > 0 {
			contribution.PrimaryActor = LearningActorShared
			contribution.Assistance = LearningAssistanceCopilot
		}
	case "delegate":
		contribution.Assistance = LearningAssistanceDelegated
	}
	return contribution
}

func contributionForProjection(
	collaborationMode string,
	learning []LearningRecord,
	hasAgentEvidence bool,
) TrainingContributionView {
	contribution := contributionForLearning(collaborationMode, learning)
	if strings.EqualFold(strings.TrimSpace(collaborationMode), "delegate") &&
		hasAgentEvidence {
		contribution.PrimaryActor = LearningActorAgent
		contribution.Assistance = LearningAssistanceDelegated
	}
	return contribution
}
