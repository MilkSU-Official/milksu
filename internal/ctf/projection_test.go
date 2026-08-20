package ctf

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func TestSummaryExposesPendingExternalDecision(t *testing.T) {
	projection := Projection{
		Job: securityruntime.Job{
			ID: "job_pending_summary", Title: "Real challenge",
			Status: securityruntime.JobRunning, UpdatedAt: time.Now().UTC(),
		},
		Challenge: ChallengeView{
			Category: "misc", ExternalPlatform: "nssctf-web", ExternalAttemptID: 316,
		},
		AgentCandidates: []AgentCandidate{{
			Candidate: "NSSCTF{candidate}",
		}},
	}

	summary := SummaryFrom(projection)
	if !summary.PendingSubmission || summary.PendingJudge {
		t.Fatalf("unsubmitted Agent candidate did not surface in summary: %#v", summary)
	}
	if summary.ExternalPlatform != "nssctf-web" || summary.ExternalAttemptID != 316 {
		t.Fatalf("summary lost the external challenge identity: %#v", summary)
	}

	projection.Submissions = []SubmissionView{{
		Candidate: "NSSCTF{candidate}",
		Verdict:   securityruntime.VerdictNeedsReview,
	}}
	summary = SummaryFrom(projection)
	if summary.PendingSubmission || !summary.PendingJudge {
		t.Fatalf("external submission did not surface pending Judge state: %#v", summary)
	}

	projection.Submissions[0].Verdict = securityruntime.VerdictFail
	projection.AgentCandidates = append(projection.AgentCandidates, AgentCandidate{
		Candidate: "NSSCTF{revised}",
	})
	summary = SummaryFrom(projection)
	if !summary.PendingSubmission || summary.PendingJudge {
		t.Fatalf("revised Agent candidate did not become submittable: %#v", summary)
	}

	projection.Outcome = &securityruntime.Outcome{Status: securityruntime.OutcomeSucceeded}
	summary = SummaryFrom(projection)
	if summary.PendingSubmission || summary.PendingJudge {
		t.Fatalf("completed challenge retained pending state: %#v", summary)
	}
}

func TestBuildDebriefUsesRuntimeEvidence(t *testing.T) {
	core := securityruntime.JobProjection{
		Attempts: []securityruntime.Attempt{{
			Status: securityruntime.AttemptFailed,
			Reason: "model provider was unavailable",
		}},
		Evidence:  []securityruntime.Evidence{{ID: "evidence_1"}},
		Artifacts: []securityruntime.Artifact{{ID: "artifact_1"}},
		Outcome: &securityruntime.Outcome{
			Status:  securityruntime.OutcomeFailed,
			Summary: "candidate was not accepted",
		},
	}
	experiments := []ExperimentView{{
		Number: 1,
		Status: securityruntime.StepFailed,
		Action: &securityruntime.Action{
			Name:   "ctf.pi_agent_turn",
			Status: securityruntime.ActionFailed,
		},
		Observations: []securityruntime.Observation{
			{Summary: "ELF is dynamically linked", Complete: true},
			{Summary: "partial stream output", Complete: false},
		},
	}}
	submissions := []SubmissionView{{
		Candidate: "flag{candidate}",
		Verdict:   securityruntime.VerdictFail,
		Summary:   "NSSCTF rejected the candidate",
	}}
	humanOutcome := HumanOutcomeView{
		HintCount:        2,
		IndependentSteps: 1,
	}

	debrief := buildDebrief(
		core,
		Challenge{KnowledgePoints: []string{"逆向", "动态分析"}},
		experiments,
		submissions,
		humanOutcome,
	)

	if debrief.Status != "failed" || debrief.Summary != "candidate was not accepted" {
		t.Fatalf("unexpected status summary: %#v", debrief)
	}
	if len(debrief.KeyObservations) != 1 || debrief.KeyObservations[0] != "ELF is dynamically linked" {
		t.Fatalf("debrief did not select complete observations: %#v", debrief.KeyObservations)
	}
	if len(debrief.FailureBranches) == 0 || debrief.FailureBranches[len(debrief.FailureBranches)-1] != "Agent 尝试中断：model provider was unavailable" {
		t.Fatalf("debrief did not preserve failure reason: %#v", debrief.FailureBranches)
	}
	if len(debrief.Candidates) != 1 || debrief.Candidates[0].Verdict != securityruntime.VerdictFail {
		t.Fatalf("debrief did not preserve candidate verdict: %#v", debrief.Candidates)
	}
	if !debrief.NeedsReflection || debrief.HintCount != 2 || debrief.IndependentSteps != 1 {
		t.Fatalf("debrief learning metrics are wrong: %#v", debrief)
	}
	if debrief.EvidenceCount != 1 || debrief.ArtifactCount != 1 {
		t.Fatalf("debrief provenance counts are wrong: %#v", debrief)
	}
}

func TestProjectionExposesOnlyScopedNetworkCapabilities(t *testing.T) {
	grant, err := securitypolicy.NewGrant(
		"projection-test",
		"ctf learning",
		[]securitypolicy.Target{
			{Kind: securitypolicy.TargetOrigin, Value: "https://challenge.example"},
			{Kind: securitypolicy.TargetSocket, Value: "challenge.example:31337"},
		},
		time.Hour,
	)
	if err != nil {
		t.Fatal(err)
	}
	challenge := Challenge{
		ID:                "challenge_network_policy",
		Title:             "Scoped network",
		Statement:         "Use only the granted endpoints.",
		Category:          "pwn",
		CollaborationMode: "coach",
		Source:            ChallengeSource{Scope: grant},
		Judge: JudgeSpec{
			Type:               "flag.sha256",
			Version:            "1",
			ExpectedFlagSHA256: hashFlag("flag{fixture}"),
		},
		AdmittedAt: time.Now().UTC(),
	}
	data, err := json.Marshal(challenge)
	if err != nil {
		t.Fatal(err)
	}
	projection, err := Project(securityruntime.JobProjection{
		Job: securityruntime.Job{ID: "job_network_policy", Role: PackageID},
		RoleFacts: []securityruntime.RoleFact{{
			ID: "fact_network_policy", PackageID: PackageID, SchemaVersion: SchemaVersion,
			Kind: FactChallengeAdmitted, Data: data,
		}},
	})
	if err != nil {
		t.Fatal(err)
	}
	tools := projection.Challenge.AgentPolicy.AllowedTools
	if !containsString(tools, "ctf_capabilities") ||
		!containsString(tools, "ctf_http") ||
		!containsString(tools, "ctf_socket") ||
		!containsString(tools, "bash") {
		t.Fatalf("projection hid or widened scoped Coach tools: %#v", tools)
	}
}
