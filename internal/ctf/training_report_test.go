package ctf

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func TestTrainingReportIsEvidenceBackedAndShareSafe(t *testing.T) {
	rawCandidate := "flag{private-candidate}"
	correct := true
	now := time.Now().UTC()
	projection := Projection{
		Job: securityruntime.Job{
			ID: "job_report", Status: securityruntime.JobSucceeded,
		},
		Challenge: ChallengeView{
			Title:             "Training fixture",
			TrackName:         "CTFshow",
			Category:          "web",
			CollaborationMode: "copilot",
			ExternalPlatform:  "ctfshow-web",
			Source:            ChallengeSource{URI: "https://ctf.show/challenges#12"},
			KnowledgePoints:   []string{"request parsing"},
		},
		Attempts:    []securityruntime.Attempt{{ID: "attempt_report"}},
		Experiments: []ExperimentView{{ID: "step_report"}},
		Evidence:    []securityruntime.Evidence{{ID: "evidence_report"}},
		Artifacts:   []securityruntime.Artifact{{ID: "artifact_report"}},
		AgentCandidates: []AgentCandidate{{
			Candidate: rawCandidate,
		}},
		AgentRuns: []AgentRunView{{
			SessionID: "ctf_tool_report",
			Metrics: AgentRunMetrics{
				CompletedTurns: 1,
				ToolCalls:      4,
				ToolErrors:     0,
			},
		}},
		Submissions: []SubmissionView{{
			Candidate: rawCandidate,
			Verdict:   securityruntime.VerdictPass,
			Summary:   "Judge accepted " + rawCandidate,
		}},
		JudgeReceipts: []ExternalJudgeReceipt{{
			Platform: "ctfshow-web", Status: "accepted", Correct: &correct,
			Summary: "Correct: " + rawCandidate, Reference: "https://ctf.show/challenges#12",
			RecordedAt: now,
		}},
		HumanOutcome: HumanOutcomeView{
			HintCount: 1, IndependentSteps: 2, ReflectionCount: 1,
		},
		Debrief: DebriefView{
			KeyObservations: []string{"Recovered " + rawCandidate + " from the verified material."},
			FailureBranches: []string{"The first parser assumption failed."},
		},
		Outcome: &securityruntime.Outcome{
			Status:  securityruntime.OutcomeSucceeded,
			Summary: "External Judge accepted " + rawCandidate,
		},
	}
	reportWorkspace := t.TempDir()
	if err := os.MkdirAll(
		filepath.Join(reportWorkspace, "work", "tool-requests"),
		0o700,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(reportWorkspace, "work", "tools"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(reportWorkspace, "work", "tool-requests", "001-parser.md"),
		[]byte("# Parser helper\n\nstatus: ready\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(reportWorkspace, "work", "tools", "parser.py"),
		[]byte("print('fixture')\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	handoff := AgentWorkspaceHandoff{
		JobID: "job_report", ConversationID: "ctf_report",
		WorkspacePath: reportWorkspace,
		Materials: []AgentWorkspaceMaterial{{
			Name: "fixture.zip", MediaType: "application/zip",
			SHA256: strings.Repeat("a", 64), Size: 123, Provenance: "test",
			Inspection: AgentMaterialInspection{
				DetectedType: "zip", ArchiveFormat: "zip", Warnings: []string{},
			},
		}},
		Run: AgentRunCheckpoint{
			CandidateCount: 1, LatestCandidateSHA256: strings.Repeat("b", 64),
		},
	}
	replay := AgentReplay{
		JobID: "job_report", ConversationID: "ctf_report",
		Metrics: AgentRunMetrics{
			CompletedTurns: 3, ToolCalls: 7, ToolErrors: 1,
			ToolUsage: map[string]int{"read": 2, "bash": 5},
		},
	}

	report, err := BuildTrainingReport(projection, handoff, replay, now)
	if err != nil {
		t.Fatal(err)
	}
	serialized, err := json.Marshal(report)
	if err != nil {
		t.Fatal(err)
	}
	if !report.Verified ||
		report.Stats.Candidates != 1 ||
		report.Stats.ToolCalls != 7 ||
		len(report.Materials) != 1 ||
		!strings.Contains(report.Markdown, "独立 Judge 验证：已验证") ||
		report.ToolWorkshop == nil ||
		report.ToolWorkshop.ToolCount != 1 ||
		report.ToolWorkshop.BuilderToolCalls != 4 ||
		!strings.Contains(report.Markdown, "自制工具交接") ||
		!strings.Contains(report.Markdown, handoff.Run.LatestCandidateSHA256) {
		t.Fatalf("unexpected training report: %#v", report)
	}
	if strings.Contains(string(serialized), rawCandidate) ||
		strings.Contains(report.Markdown, rawCandidate) {
		t.Fatal("shareable training report leaked the raw candidate")
	}
	if !strings.Contains(report.OutcomeSummary, "[candidate redacted]") ||
		!strings.Contains(report.KeyObservations[0], "[candidate redacted]") ||
		!strings.Contains(report.JudgeReceipts[0].Summary, "[candidate redacted]") {
		t.Fatalf("candidate-bearing evidence was not redacted: %#v", report)
	}

	exportWorkspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(exportWorkspace, "evidence"), 0o700); err != nil {
		t.Fatal(err)
	}
	exported, err := PersistTrainingReport(exportWorkspace, report)
	if err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{exported.JSONPath, exported.MarkdownPath} {
		info, err := os.Stat(path)
		if err != nil {
			t.Fatal(err)
		}
		if info.Mode().Perm() != 0o600 {
			t.Fatalf("training report permissions are too broad: %s", info.Mode().Perm())
		}
		data, err := os.ReadFile(path)
		if err != nil {
			t.Fatal(err)
		}
		if strings.Contains(string(data), rawCandidate) {
			t.Fatalf("persisted training report leaked the raw candidate: %s", path)
		}
	}
}

func TestTrainingReportRejectsMismatchedReplay(t *testing.T) {
	_, err := BuildTrainingReport(
		Projection{Job: securityruntime.Job{ID: "job_one"}},
		AgentWorkspaceHandoff{JobID: "job_one", ConversationID: "ctf_one"},
		AgentReplay{JobID: "job_two", ConversationID: "ctf_two"},
		time.Now().UTC(),
	)
	if err == nil {
		t.Fatal("training report accepted mismatched job evidence")
	}
}
