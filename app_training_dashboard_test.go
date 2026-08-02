package main

import (
	"reflect"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/ctfshow"
	"github.com/MilkSU-Official/milksu/internal/nssctf"
	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func TestRealTrainingSignalRejectsLocalSamples(t *testing.T) {
	_, eligible := realTrainingSignal(ctf.Projection{
		Challenge: ctf.ChallengeView{
			Category: "misc",
			Source:   securityruntimeSource("file", ""),
		},
	})
	if eligible {
		t.Fatal("local sample must not affect the real-training ability profile")
	}
}

func TestNSSCTFArenaSourceTargetsAcceptsOnlyExactRemoteEndpoints(t *testing.T) {
	targets := nssctfArenaSourceTargets([]string{
		"https://arena.example.test:18443/challenge",
		"https://arena.example.test:18443/duplicate-path",
		"tcp://pwn.example.test:31337",
		"pwn.example.test:31337",
		"ssh://player@ssh.example.test:2222",
		"file:///tmp/not-authorized",
		"not-an-endpoint",
	})
	if len(targets) != 3 {
		t.Fatalf("unexpected Arena targets: %#v", targets)
	}
	expected := []securitypolicy.Target{
		{Kind: securitypolicy.TargetOrigin, Value: "https://arena.example.test:18443"},
		{Kind: securitypolicy.TargetSocket, Value: "pwn.example.test:31337"},
		{Kind: securitypolicy.TargetSocket, Value: "ssh.example.test:2222"},
	}
	for index := range expected {
		if targets[index] != expected[index] {
			t.Fatalf("unexpected Arena target %d: got %#v want %#v", index, targets[index], expected[index])
		}
	}
}

func TestRealTrainingSignalPreservesPlatformEvidenceWithoutCountingRuntimeRestarts(t *testing.T) {
	projection := ctf.Projection{
		Challenge: ctf.ChallengeView{
			Category:          "Web",
			CollaborationMode: "coach",
			ExternalPlatform:  "nssctf-web",
			Source:            securityruntimeSource("url", "https://www.nssctf.cn/problem/316"),
			KnowledgePoints:   []string{"SQL injection"},
		},
		Attempts: []securityruntime.Attempt{
			{ID: "runtime_attempt_1"},
			{ID: "runtime_attempt_2"},
		},
		HumanOutcome: ctf.HumanOutcomeView{
			HintCount:        2,
			IndependentSteps: 3,
			Contribution: ctf.TrainingContributionView{
				PrimaryActor:         ctf.LearningActorUser,
				Assistance:           ctf.LearningAssistanceNone,
				UserIndependentSteps: 3,
			},
		},
		Outcome: &securityruntime.Outcome{Status: securityruntime.OutcomeSucceeded},
		JudgeReceipts: []ctf.ExternalJudgeReceipt{{
			Platform: "nssctf-web",
			Correct:  boolPointer(true),
		}},
	}
	signal, eligible := realTrainingSignal(projection)
	if !eligible {
		t.Fatal("real platform training must be eligible")
	}
	if signal.ProblemID != 316 ||
		signal.Platform != "nssctf-web" ||
		signal.Category != "Web" ||
		signal.State != nssctf.TrainingStateSucceeded ||
		signal.Attempts != 1 ||
		signal.Hints != 2 ||
		signal.IndependentSteps != 3 ||
		signal.Actor != nssctf.TrainingActorUser ||
		signal.Assistance != nssctf.TrainingAssistanceNone ||
		signal.Verification != nssctf.TrainingVerificationPlatformJudge ||
		!signal.Succeeded ||
		len(signal.Tags) != 1 ||
		signal.Tags[0] != "SQL injection" {
		t.Fatalf("unexpected real training signal: %#v", signal)
	}
}

func TestRealTrainingSignalKeepsDelegateSuccessOutOfUserAbility(t *testing.T) {
	signal, eligible := realTrainingSignal(ctf.Projection{
		Challenge: ctf.ChallengeView{
			Category:          "Pwn",
			CollaborationMode: "delegate",
			ExternalPlatform:  "ctfshow-web",
			ExternalAttemptID: 91,
		},
		HumanOutcome: ctf.HumanOutcomeView{
			Contribution: ctf.TrainingContributionView{
				PrimaryActor: ctf.LearningActorAgent,
				Assistance:   ctf.LearningAssistanceDelegated,
			},
		},
		Outcome: &securityruntime.Outcome{Status: securityruntime.OutcomeSucceeded},
	})
	if !eligible ||
		!signal.Succeeded ||
		signal.Actor != nssctf.TrainingActorAgent ||
		signal.Assistance != nssctf.TrainingAssistanceDelegated ||
		signal.IndependentSteps != 0 ||
		signal.UserAssistedSteps != 0 {
		t.Fatalf("delegate success was converted into user ability evidence: %#v", signal)
	}
}

func TestRealTrainingSignalDistinguishesUserConfirmationFromJudgeReceipt(t *testing.T) {
	signal, eligible := realTrainingSignal(ctf.Projection{
		Challenge: ctf.ChallengeView{
			Category:         "Misc",
			ExternalPlatform: "nssctf-web",
			Source:           securityruntimeSource("url", "https://www.nssctf.cn/problem/317"),
		},
		Outcome: &securityruntime.Outcome{Status: securityruntime.OutcomeSucceeded},
		JudgeReceipts: []ctf.ExternalJudgeReceipt{{
			Platform: "another-platform",
			Correct:  boolPointer(true),
		}},
	})
	if !eligible ||
		!signal.Succeeded ||
		signal.Verification != nssctf.TrainingVerificationUserConfirmed {
		t.Fatalf("unmatched receipt was treated as platform authority: %#v", signal)
	}
}

func boolPointer(value bool) *bool {
	return &value
}

func TestRealTrainingSignalKeepsCrossPlatformTrainingOutOfNSSCTFProblemProgress(t *testing.T) {
	signal, eligible := realTrainingSignal(ctf.Projection{
		Challenge: ctf.ChallengeView{
			Category:          "Pwn",
			ExternalPlatform:  "ctfshow-web",
			ExternalAttemptID: 42,
			Source:            securityruntimeSource("url", "https://ctf.show/challenges#42"),
			KnowledgePoints:   []string{"heap"},
		},
	})
	if !eligible {
		t.Fatal("CTFshow training must contribute to the cross-platform ability profile")
	}
	if signal.ProblemID != 0 || signal.Platform != "ctfshow-web" {
		t.Fatalf("cross-platform signal polluted NSSCTF problem identity: %#v", signal)
	}
	if signal.State != nssctf.TrainingStateActive {
		t.Fatalf("unfinished cross-platform training must remain active: %#v", signal)
	}
}

func TestRealTrainingSignalPreservesFailedLifecycleForReview(t *testing.T) {
	signal, eligible := realTrainingSignal(ctf.Projection{
		Job: securityruntime.Job{Status: securityruntime.JobFailed},
		Challenge: ctf.ChallengeView{
			Category:         "Crypto",
			ExternalPlatform: "nssctf-web",
			Source:           securityruntimeSource("url", "https://www.nssctf.cn/problem/99"),
		},
		Outcome: &securityruntime.Outcome{Status: securityruntime.OutcomeFailed},
	})
	if !eligible || signal.State != nssctf.TrainingStateFailed || signal.Succeeded {
		t.Fatalf("failed platform training lost its review lifecycle: %#v", signal)
	}
}

func TestCatalogTrainingProgressMapsOnlyVisibleNSSCTFProblems(t *testing.T) {
	problems := []nssctf.CatalogProblem{
		{PlatformID: 316},
		{PlatformID: 317},
		{PlatformID: 42},
		{PlatformID: 401},
	}
	signals := []nssctf.TrainingSignal{
		{ProblemID: 316, Platform: "nssctf-web"},
		{ProblemID: 317, Platform: "nssctf-web", Succeeded: true},
		{ProblemID: 317, Platform: "nssctf-agent-arena"},
		{ProblemID: 42, Platform: "ctfshow-web", Succeeded: true},
		{ProblemID: 999, Platform: "nssctf-web", Succeeded: true},
		{ProblemID: 0, Platform: "nssctf-web", Succeeded: true},
	}

	attempted, completed := catalogTrainingProgress(problems, signals)
	if !reflect.DeepEqual(attempted, []int{316, 317}) {
		t.Fatalf("unexpected attempted problem IDs: %#v", attempted)
	}
	if !reflect.DeepEqual(completed, []int{317}) {
		t.Fatalf("unexpected completed problem IDs: %#v", completed)
	}
}

func TestCTFShowTrainingProgressMapsOnlyVisibleCTFShowProblems(t *testing.T) {
	problems := []ctfshow.CatalogProblem{
		{PlatformID: 12},
		{PlatformID: 42},
		{PlatformID: 99},
	}
	projections := []ctf.Projection{
		{
			Challenge: ctf.ChallengeView{
				ExternalPlatform:  "ctfshow-web",
				ExternalAttemptID: 12,
			},
		},
		{
			Challenge: ctf.ChallengeView{
				ExternalPlatform:  "ctfshow-web",
				ExternalAttemptID: 42,
			},
			Outcome: &securityruntime.Outcome{Status: securityruntime.OutcomeSucceeded},
		},
		{
			Challenge: ctf.ChallengeView{
				ExternalPlatform:  "ctfshow-web",
				ExternalAttemptID: 42,
			},
			Outcome: &securityruntime.Outcome{Status: securityruntime.OutcomeFailed},
		},
		{
			Challenge: ctf.ChallengeView{
				ExternalPlatform:  "nssctf-web",
				ExternalAttemptID: 99,
			},
			Outcome: &securityruntime.Outcome{Status: securityruntime.OutcomeSucceeded},
		},
		{
			Challenge: ctf.ChallengeView{ExternalAttemptID: 12},
			Outcome:   &securityruntime.Outcome{Status: securityruntime.OutcomeSucceeded},
		},
	}

	attempted, completed := ctfshowTrainingProgress(problems, projections)
	if !reflect.DeepEqual(attempted, []int{12, 42}) {
		t.Fatalf("unexpected attempted CTFshow problem IDs: %#v", attempted)
	}
	if !reflect.DeepEqual(completed, []int{42}) {
		t.Fatalf("unexpected completed CTFshow problem IDs: %#v", completed)
	}
}

func securityruntimeSource(kind, uri string) ctf.ChallengeSource {
	return ctf.ChallengeSource{
		Kind: kind,
		URI:  uri,
	}
}
