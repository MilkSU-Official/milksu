package ctf

import "testing"

func TestLegacyLearningAttributionRemainsImported(t *testing.T) {
	record, valid := normalizeLearningAttribution(
		LearningRecord{Kind: "independent_step", Content: "legacy summary"},
		"coach",
	)
	if !valid {
		t.Fatal("legacy learning record was rejected")
	}
	if record.Actor != LearningActorImported ||
		record.Assistance != LearningAssistanceNone {
		t.Fatalf("legacy record gained invented user attribution: %+v", record)
	}
	contribution := contributionForLearning("coach", []LearningRecord{record})
	if contribution.PrimaryActor != LearningActorImported ||
		contribution.UserIndependentSteps != 0 ||
		contribution.UserAssistedSteps != 0 {
		t.Fatalf("legacy record became user ability evidence: %+v", contribution)
	}
}

func TestContributionRequiresExplicitUserStep(t *testing.T) {
	withoutStep := contributionForLearning("coach", []LearningRecord{{
		Kind:       "reflection",
		Actor:      LearningActorUser,
		Assistance: LearningAssistanceNone,
		Content:    "I understand the solution.",
	}})
	if withoutStep.PrimaryActor != LearningActorImported {
		t.Fatalf("reflection alone was treated as proof of solution contribution: %+v", withoutStep)
	}

	independent := contributionForLearning("coach", []LearningRecord{{
		Kind:       "independent_step",
		Actor:      LearningActorUser,
		Assistance: LearningAssistanceNone,
		Content:    "I reproduced the byte transform.",
	}})
	if independent.PrimaryActor != LearningActorUser ||
		independent.Assistance != LearningAssistanceNone ||
		independent.UserIndependentSteps != 1 ||
		independent.UserAssistedSteps != 0 {
		t.Fatalf("explicit independent step was not attributed to the user: %+v", independent)
	}
}

func TestContributionSeparatesHintCopilotAndDelegate(t *testing.T) {
	hint := contributionForLearning("coach", []LearningRecord{
		{
			Kind:       "hint",
			Actor:      LearningActorAgent,
			Assistance: LearningAssistanceHint,
			Content:    "Inspect the header.",
		},
		{
			Kind:       "independent_step",
			Actor:      LearningActorUser,
			Assistance: LearningAssistanceHint,
			Content:    "I parsed the header after the hint.",
		},
	})
	if hint.PrimaryActor != LearningActorUser ||
		hint.Assistance != LearningAssistanceHint ||
		hint.UserIndependentSteps != 0 ||
		hint.UserAssistedSteps != 1 {
		t.Fatalf("hint-assisted work was mislabeled: %+v", hint)
	}

	copilot := contributionForLearning("copilot", []LearningRecord{{
		Kind:       "independent_step",
		Actor:      LearningActorUser,
		Assistance: LearningAssistanceCopilot,
		Content:    "I verified the shared hypothesis.",
	}})
	if copilot.PrimaryActor != LearningActorShared ||
		copilot.Assistance != LearningAssistanceCopilot ||
		copilot.UserAssistedSteps != 1 {
		t.Fatalf("copilot contribution was mislabeled: %+v", copilot)
	}

	delegate := contributionForLearning("delegate", nil)
	if delegate.PrimaryActor != LearningActorImported ||
		delegate.Assistance != LearningAssistanceDelegated ||
		delegate.UserIndependentSteps != 0 {
		t.Fatalf("delegate mode without Agent evidence invented a contributor: %+v", delegate)
	}
	delegate = contributionForProjection("delegate", nil, true)
	if delegate.PrimaryActor != LearningActorAgent ||
		delegate.Assistance != LearningAssistanceDelegated {
		t.Fatalf("evidence-backed delegated work was not attributed to the Agent: %+v", delegate)
	}
}

func TestInvalidTypedAttributionIsRejectedInsteadOfGuessed(t *testing.T) {
	if _, valid := normalizeLearningAttribution(LearningRecord{
		Kind:       "reflection",
		Actor:      LearningActor("model-guessed"),
		Assistance: LearningAssistanceNone,
		Content:    "guess",
	}, "coach"); valid {
		t.Fatal("unknown typed actor was normalized into a user fact")
	}
}
