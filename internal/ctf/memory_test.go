package ctf

import (
	"context"
	"database/sql"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func TestTrainingMemoryPersistsApprovedSynthesisWithoutCandidateSecrets(t *testing.T) {
	root := t.TempDir()
	store, err := NewMemoryStore(
		filepath.Join(root, "memory.sqlite3"),
		filepath.Join(root, "memories"),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	now := time.Date(2026, 7, 31, 15, 30, 0, 0, time.UTC)
	projection := memoryFixtureProjection()

	memory, err := store.SaveFromProjection(
		context.Background(),
		projection,
		"ctf_fixture",
		now,
	)
	if err != nil {
		t.Fatal(err)
	}
	if memory.Kind != "technique" ||
		memory.Verification != TrainingMemoryJudgeVerified ||
		memory.Confidence != 1 {
		t.Fatalf("unexpected verified memory classification: %#v", memory)
	}
	data, err := os.ReadFile(memory.Path)
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	if strings.Contains(content, "NSSCTF{secret-candidate}") ||
		strings.Contains(content, "sk-abcdefghijklmnop") {
		t.Fatalf("candidate or credential secret leaked into durable memory: %s", content)
	}
	if !strings.Contains(content, "[candidate redacted]") ||
		!strings.Contains(content, "先确认字节序") ||
		!strings.Contains(content, "Judge 或确定性评测已验证") {
		t.Fatalf("memory synthesis lost evidence or redaction: %s", content)
	}

	memories, err := store.Recall(context.Background(), "pwn", "长度字段", 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(memories) != 1 || memories[0].ID != memory.ID {
		t.Fatalf("saved memory was not recalled: %#v", memories)
	}
}

func TestTrainingMemoryRequiresEvidenceAndCanBeArchived(t *testing.T) {
	root := t.TempDir()
	store, err := NewMemoryStore(
		filepath.Join(root, "memory.sqlite3"),
		filepath.Join(root, "memories"),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	empty := memoryFixtureProjection()
	empty.Debrief.KeyObservations = nil
	empty.Debrief.FailureBranches = nil
	empty.Learning = nil
	empty.HumanOutcome.ReflectionCount = 0
	if _, err := store.SaveFromProjection(
		context.Background(),
		empty,
		"",
		time.Now(),
	); err == nil {
		t.Fatal("evidence-free memory was accepted")
	}

	inProgress := memoryFixtureProjection()
	inProgress.Debrief.Status = "in_progress"
	if _, err := store.SaveFromProjection(
		context.Background(),
		inProgress,
		"",
		time.Now(),
	); err == nil || !strings.Contains(err.Error(), "题目尚未结束") {
		t.Fatalf("in-progress training memory was accepted or returned an unclear error: %v", err)
	}

	unreflected := memoryFixtureProjection()
	unreflected.HumanOutcome.ReflectionCount = 0
	unreflected.Debrief.ReflectionCount = 0
	if _, err := store.SaveFromProjection(
		context.Background(),
		unreflected,
		"",
		time.Now(),
	); err == nil || !strings.Contains(err.Error(), "完成一次复盘") {
		t.Fatalf("unreflected training memory was accepted or returned an unclear error: %v", err)
	}

	memory, err := store.SaveFromProjection(
		context.Background(),
		memoryFixtureProjection(),
		"",
		time.Now(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if err := store.Archive(
		context.Background(),
		memory.ID,
		"被新的验证结果取代",
		time.Now(),
	); err != nil {
		t.Fatal(err)
	}
	memories, err := store.Recall(context.Background(), "pwn", "", 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(memories) != 0 {
		t.Fatalf("archived memory remained active: %#v", memories)
	}
}

func TestWriteAgentMemoryContextMarksMemoryAsPriorNotAuthority(t *testing.T) {
	workspace := t.TempDir()
	err := WriteAgentMemoryContext(workspace, []TrainingMemory{{
		ID:            "ctfmem_fixture",
		Title:         "[pwn] endian fixture",
		Summary:       "先确认字节序，再构造解析器输入。",
		Kind:          "technique",
		Verification:  TrainingMemoryUserConfirmed,
		Tags:          []string{"endianness", "parser"},
		SourceJobID:   "job_memory",
		Confidence:    1,
		SchemaVersion: TrainingMemorySchemaVersion,
	}})
	if err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(workspace, "MEMORY.md"))
	if err != nil {
		t.Fatal(err)
	}
	content := string(data)
	if !strings.Contains(content, "不是当前题目的事实") ||
		!strings.Contains(content, "先确认字节序") ||
		!strings.Contains(content, "尚无机器可读回执") {
		t.Fatalf("memory context contract is incomplete: %s", content)
	}
}

func TestTrainingMemoryVerificationTracksEvidenceAuthority(t *testing.T) {
	root := t.TempDir()
	store, err := NewMemoryStore(
		filepath.Join(root, "memory.sqlite3"),
		filepath.Join(root, "memories"),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	userConfirmed := memoryFixtureProjection()
	userConfirmed.Job.ID = "job_user_confirmed"
	userConfirmed.Challenge.JudgeType = "external.manual"
	userMemory, err := store.SaveFromProjection(
		context.Background(),
		userConfirmed,
		"ctf_user_confirmed",
		time.Now(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if userMemory.Verification != TrainingMemoryUserConfirmed ||
		userMemory.Confidence != 0.8 {
		t.Fatalf("manual platform confirmation was overstated: %#v", userMemory)
	}

	correct := true
	judgeVerified := memoryFixtureProjection()
	judgeVerified.Job.ID = "job_judge_verified"
	judgeVerified.Challenge.JudgeType = "external.manual"
	judgeVerified.JudgeReceipts = []ExternalJudgeReceipt{{
		Platform:  "nssctf-web",
		Status:    "accepted",
		Correct:   &correct,
		Reference: "judge-receipt-fixture",
	}}
	judgeMemory, err := store.SaveFromProjection(
		context.Background(),
		judgeVerified,
		"ctf_judge_verified",
		time.Now(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if judgeMemory.Verification != TrainingMemoryJudgeVerified ||
		judgeMemory.Confidence != 1 {
		t.Fatalf("machine-readable Judge receipt was not preserved: %#v", judgeMemory)
	}

	failed := memoryFixtureProjection()
	failed.Job.ID = "job_failure_observed"
	failed.Debrief.Status = "failed"
	failureMemory, err := store.SaveFromProjection(
		context.Background(),
		failed,
		"ctf_failure_observed",
		time.Now(),
	)
	if err != nil {
		t.Fatal(err)
	}
	if failureMemory.Kind != "failure-lesson" ||
		failureMemory.Verification != TrainingMemoryFailureObserved ||
		failureMemory.Confidence != 0.7 {
		t.Fatalf("failed training memory lost its evidence class: %#v", failureMemory)
	}
}

func TestTrainingMemoryMigratesLegacyRowsConservatively(t *testing.T) {
	root := t.TempDir()
	databasePath := filepath.Join(root, "memory.sqlite3")
	legacy, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	_, err = legacy.Exec(`
CREATE TABLE ctf_memories (
	id TEXT PRIMARY KEY,
	schema_version TEXT NOT NULL,
	kind TEXT NOT NULL,
	title TEXT NOT NULL,
	summary TEXT NOT NULL,
	category TEXT NOT NULL,
	tags_json TEXT NOT NULL,
	source_job_id TEXT NOT NULL UNIQUE,
	source_session_id TEXT,
	evidence_refs_json TEXT NOT NULL,
	confidence REAL NOT NULL,
	path TEXT NOT NULL,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	archived_at TEXT,
	archived_reason TEXT
);
INSERT INTO ctf_memories (
	id, schema_version, kind, title, summary, category, tags_json,
	source_job_id, source_session_id, evidence_refs_json, confidence,
	path, created_at, updated_at
) VALUES (
	'ctfmem_legacy', 'ctf-memory.milksu.dev/v1alpha1', 'technique',
	'[misc] legacy', 'legacy summary', 'misc', '[]',
	'job_legacy', '', '["job:job_legacy"]', 1.0,
	'/tmp/legacy-memory.md', '2026-07-31T00:00:00Z', '2026-07-31T00:00:00Z'
)
`)
	if err != nil {
		legacy.Close()
		t.Fatal(err)
	}
	if err := legacy.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := NewMemoryStore(
		databasePath,
		filepath.Join(root, "memories"),
	)
	if err != nil {
		t.Fatal(err)
	}
	memories, err := store.Recall(context.Background(), "misc", "", 5)
	if err != nil {
		store.Close()
		t.Fatal(err)
	}
	if len(memories) != 1 ||
		memories[0].Verification != TrainingMemoryLegacyUntyped ||
		memories[0].Confidence != 0.6 {
		store.Close()
		t.Fatalf("legacy memory retained unjustified authority: %#v", memories)
	}
	if err := store.Close(); err != nil {
		t.Fatal(err)
	}

	reopened, err := NewMemoryStore(
		databasePath,
		filepath.Join(root, "memories"),
	)
	if err != nil {
		t.Fatalf("verification migration was not idempotent: %v", err)
	}
	defer reopened.Close()
	recalled, err := reopened.Recall(context.Background(), "misc", "", 5)
	if err != nil || len(recalled) != 1 ||
		recalled[0].Verification != TrainingMemoryLegacyUntyped ||
		recalled[0].Confidence != 0.6 {
		t.Fatalf("migrated legacy memory changed after reopen: memories=%#v err=%v", recalled, err)
	}
}

func TestRecallForChallengeRanksRelevantMemoryAndExcludesCurrentJob(t *testing.T) {
	root := t.TempDir()
	store, err := NewMemoryStore(
		filepath.Join(root, "memory.sqlite3"),
		filepath.Join(root, "memories"),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	relevant := memoryFixtureProjection()
	relevant.Job.ID = "job_relevant"
	relevant.Challenge.Title = "Packet length parser"
	relevant.Challenge.KnowledgePoints = []string{"endianness", "length field"}
	relevant.Debrief.Status = "failed"
	if _, err := store.SaveFromProjection(
		context.Background(),
		relevant,
		"ctf_relevant",
		time.Now().Add(-time.Hour),
	); err != nil {
		t.Fatal(err)
	}
	unrelated := memoryFixtureProjection()
	unrelated.Job.ID = "job_unrelated"
	unrelated.Challenge.Title = "Heap allocator"
	unrelated.Challenge.KnowledgePoints = []string{"heap", "allocator"}
	unrelated.Debrief.Summary = "整理堆分配器观察。"
	unrelated.Debrief.KeyObservations = []string{"先检查 chunk 布局。"}
	if _, err := store.SaveFromProjection(
		context.Background(),
		unrelated,
		"ctf_unrelated",
		time.Now(),
	); err != nil {
		t.Fatal(err)
	}

	memories, err := store.RecallForChallenge(
		context.Background(),
		TrainingMemoryRecallContext{
			Category:        "pwn",
			Title:           "Little-endian packet",
			KnowledgePoints: []string{"endianness", "length field"},
			SourceJobID:     "job_current",
		},
		5,
	)
	if err != nil {
		t.Fatal(err)
	}
	if len(memories) != 2 || memories[0].SourceJobID != "job_relevant" {
		t.Fatalf("challenge-aware recall did not rank relevant prior first: %#v", memories)
	}

	excluded, err := store.RecallForChallenge(
		context.Background(),
		TrainingMemoryRecallContext{
			Category:    "pwn",
			SourceJobID: "job_relevant",
		},
		5,
	)
	if err != nil {
		t.Fatal(err)
	}
	for _, memory := range excluded {
		if memory.SourceJobID == "job_relevant" {
			t.Fatalf("current job recalled its own synthesis: %#v", excluded)
		}
	}
}

func memoryFixtureProjection() Projection {
	return Projection{
		Job: securityruntime.Job{ID: "job_memory"},
		Challenge: ChallengeView{
			ID:              "challenge_memory",
			Title:           "Endian parser",
			Category:        "pwn",
			KnowledgePoints: []string{"endianness", "length field"},
		},
		AgentCandidates: []AgentCandidate{{
			Candidate: "NSSCTF{secret-candidate}",
		}},
		Submissions: []SubmissionView{{
			Candidate: "NSSCTF{secret-candidate}",
		}},
		Learning: []LearningRecord{{
			Kind:    "reflection",
			Content: "下次我会先确认字节序，再推长度字段；不要保存 sk-abcdefghijklmnop。",
		}},
		HumanOutcome: HumanOutcomeView{
			ReflectionCount: 1,
			Summary:         "完成一次复盘。",
		},
		Debrief: DebriefView{
			Status:  "succeeded",
			Summary: "Accepted 后确认 NSSCTF{secret-candidate} 来自小端长度字段。",
			KeyObservations: []string{
				"先确认字节序，长度字段才可复现。",
			},
			FailureBranches: []string{
				"把 NSSCTF{secret-candidate} 当大端解析会偏移。",
			},
		},
	}
}
