package ctf

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
	"github.com/MilkSU-Official/milksu/internal/sqlitemigrate"
)

func TestTrainingMemoryDatabaseUsesNumberedMigration(t *testing.T) {
	root := t.TempDir()
	databasePath := filepath.Join(root, "memory.sqlite3")
	store, err := NewMemoryStore(
		databasePath,
		filepath.Join(root, "memories"),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()

	var (
		version   int
		name      string
		appliedAt string
	)
	if err := store.database.QueryRow(
		`SELECT version, name, applied_at FROM schema_migrations`,
	).Scan(&version, &name, &appliedAt); err != nil {
		t.Fatalf("query CTF memory migration history: %v", err)
	}
	if version != SupportedCTFMemoryDatabaseVersion ||
		name != ctfMemoryV1MigrationName ||
		strings.TrimSpace(appliedAt) == "" {
		t.Fatalf(
			"migration history = (%d, %q, %q), want (%d, %q, non-empty)",
			version,
			name,
			appliedAt,
			SupportedCTFMemoryDatabaseVersion,
			ctfMemoryV1MigrationName,
		)
	}
	info, err := os.Stat(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("CTF memory database mode = %o, want 600", info.Mode().Perm())
	}
}

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
		memory.Actor != LearningActorUser ||
		memory.Assistance != LearningAssistanceNone ||
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
	unreflected.Learning = nil
	if _, err := store.SaveFromProjection(
		context.Background(),
		unreflected,
		"",
		time.Now(),
	); err == nil || !strings.Contains(err.Error(), "完成一次复盘") {
		t.Fatalf("unreflected training memory was accepted or returned an unclear error: %v", err)
	}

	agentReflected := memoryFixtureProjection()
	for index := range agentReflected.Learning {
		if agentReflected.Learning[index].Kind == "reflection" {
			agentReflected.Learning[index].Actor = LearningActorAgent
			agentReflected.Learning[index].Assistance = LearningAssistanceDelegated
		}
	}
	if _, err := store.SaveFromProjection(
		context.Background(),
		agentReflected,
		"",
		time.Now(),
	); err == nil || !strings.Contains(err.Error(), "用自己的话") {
		t.Fatalf("agent-authored reflection unlocked learner memory: %v", err)
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
	assertCTFMemoryV1History(t, store.database)
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
	assertCTFMemoryV1History(t, reopened.database)
}

func TestTrainingMemoryAdoptsCurrentPreMigratorRowsWithoutDowngrade(t *testing.T) {
	root := t.TempDir()
	databasePath := filepath.Join(root, "memory.sqlite3")
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`
CREATE TABLE ctf_memories (
	id TEXT PRIMARY KEY,
	schema_version TEXT NOT NULL,
	kind TEXT NOT NULL,
	verification TEXT NOT NULL DEFAULT 'legacy-untyped',
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
	id, schema_version, kind, verification, title, summary, category, tags_json,
	source_job_id, source_session_id, evidence_refs_json, confidence,
	path, created_at, updated_at
) VALUES (
	'ctfmem_verified', 'ctf-memory.milksu.dev/v1alpha2', 'technique',
	'judge-verified', '[crypto] verified', 'verified summary', 'crypto', '[]',
	'job_verified', '', '["job:job_verified"]', 1.0,
	'/tmp/verified-memory.md', '2026-07-31T00:00:00Z', '2026-07-31T00:00:00Z'
)
`); err != nil {
		database.Close()
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := NewMemoryStore(
		databasePath,
		filepath.Join(root, "memories"),
	)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	memories, err := store.Recall(context.Background(), "crypto", "", 5)
	if err != nil {
		t.Fatal(err)
	}
	if len(memories) != 1 ||
		memories[0].Verification != TrainingMemoryJudgeVerified ||
		memories[0].Confidence != 1 {
		t.Fatalf("current pre-migrator memory was downgraded: %#v", memories)
	}
	assertCTFMemoryV1History(t, store.database)
}

func TestTrainingMemoryRejectsNewerDatabaseWithoutMutation(t *testing.T) {
	root := t.TempDir()
	databasePath := filepath.Join(root, "memory.sqlite3")
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`
CREATE TABLE schema_migrations (
	version INTEGER PRIMARY KEY,
	name TEXT NOT NULL,
	applied_at TEXT NOT NULL
);
INSERT INTO schema_migrations(version, name, applied_at)
VALUES
	(1, 'create CTF memory store', '2026-01-01T00:00:00Z'),
	(2, 'future memory schema', '2026-01-02T00:00:00Z');
CREATE TABLE future_marker (
	id INTEGER PRIMARY KEY,
	value TEXT NOT NULL
);
INSERT INTO future_marker(value) VALUES ('must remain byte-for-byte unchanged');
`); err != nil {
		database.Close()
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}
	before, err := os.ReadFile(databasePath)
	if err != nil {
		t.Fatal(err)
	}

	store, err := NewMemoryStore(
		databasePath,
		filepath.Join(root, "memories"),
	)
	if store != nil {
		store.Close()
		t.Fatal("newer CTF memory database returned a store")
	}
	if !errors.Is(err, sqlitemigrate.ErrDatabaseTooNew) {
		t.Fatalf("newer CTF memory database error = %v, want ErrDatabaseTooNew", err)
	}
	after, err := os.ReadFile(databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if !bytes.Equal(after, before) {
		t.Fatal("newer CTF memory database bytes changed after rejection")
	}
	for _, suffix := range []string{"-wal", "-shm"} {
		if _, statErr := os.Stat(databasePath + suffix); !os.IsNotExist(statErr) {
			t.Fatalf("newer database rejection left %s sidecar: %v", suffix, statErr)
		}
	}
}

func TestTrainingMemoryMigrationFailureRollsBackLegacyUpgrade(t *testing.T) {
	root := t.TempDir()
	databasePath := filepath.Join(root, "memory.sqlite3")
	database, err := sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec(`
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
	'ctfmem_rollback', 'ctf-memory.milksu.dev/v1alpha1', 'technique',
	'[misc] rollback', 'rollback fixture', 'misc', '[]',
	'job_rollback', '', '["job:job_rollback"]', 1.0,
	'/tmp/rollback-memory.md', '2026-07-31T00:00:00Z', '2026-07-31T00:00:00Z'
);
CREATE TRIGGER reject_memory_update
BEFORE UPDATE ON ctf_memories
BEGIN
	SELECT RAISE(ABORT, 'fixture rejects confidence update');
END;
`); err != nil {
		database.Close()
		t.Fatal(err)
	}
	if err := database.Close(); err != nil {
		t.Fatal(err)
	}

	store, err := NewMemoryStore(
		databasePath,
		filepath.Join(root, "memories"),
	)
	if store != nil {
		store.Close()
		t.Fatal("failed CTF memory migration returned a store")
	}
	if err == nil || !strings.Contains(err.Error(), "fixture rejects confidence update") {
		t.Fatalf("migration failure = %v, want fixture trigger rejection", err)
	}

	database, err = sql.Open("sqlite", databasePath)
	if err != nil {
		t.Fatal(err)
	}
	defer database.Close()
	if columns := ctfMemoryColumnNames(t, database); memoryColumnsContain(columns, "verification") {
		t.Fatalf("failed migration left verification column behind: %v", columns)
	}
	var historyTables int
	if err := database.QueryRow(
		`SELECT count(*) FROM sqlite_master WHERE type='table' AND name='schema_migrations'`,
	).Scan(&historyTables); err != nil {
		t.Fatal(err)
	}
	if historyTables != 0 {
		t.Fatalf("failed migration left %d schema_migrations tables, want 0", historyTables)
	}
	var confidence float64
	if err := database.QueryRow(
		`SELECT confidence FROM ctf_memories WHERE id='ctfmem_rollback'`,
	).Scan(&confidence); err != nil {
		t.Fatal(err)
	}
	if confidence != 1 {
		t.Fatalf("failed migration changed legacy confidence to %v, want 1", confidence)
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
	relevant.Learning = append(relevant.Learning, LearningRecord{
		ID:         "learn_hint_width",
		Kind:       "hint",
		Actor:      LearningActorAgent,
		Assistance: LearningAssistanceHint,
		Content:    "先看长度字段宽度，再决定解析方式。",
		Concept:    "length field",
		Level:      1,
	})
	relevant.JudgeReceipts = []ExternalJudgeReceipt{{
		ID:        "judge_memory",
		Platform:  "nssctf",
		Status:    "accepted",
		Correct:   boolPointer(true),
		Summary:   "Accepted",
		Reference: "judge-receipt-memory",
	}}
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
	if memories[0].Recall == nil ||
		memories[0].Recall.Score <= 0 ||
		len(memories[0].Recall.Reasons) == 0 {
		t.Fatalf("challenge-aware recall did not include a useful explanation: %#v", memories[0])
	}
	for _, want := range []string{"judge", "hint", "step", "failure"} {
		if !recallEvidenceContains(memories[0].Recall.Evidence, want) {
			t.Fatalf("challenge-aware recall evidence missing %q: %#v", want, memories[0].Recall.Evidence)
		}
	}
	workspace := t.TempDir()
	if err := WriteAgentMemoryContext(workspace, memories[:1]); err != nil {
		t.Fatal(err)
	}
	contextData, err := os.ReadFile(filepath.Join(workspace, "MEMORY.md"))
	if err != nil {
		t.Fatal(err)
	}
	contextText := string(contextData)
	for _, want := range []string{"推荐原因", "Judge 回执", "提示记录", "用户步骤", "失败分支"} {
		if !strings.Contains(contextText, want) {
			t.Fatalf("agent memory context missing %q: %s", want, contextText)
		}
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
			ID:                "challenge_memory",
			Title:             "Endian parser",
			Category:          "pwn",
			CollaborationMode: "coach",
			KnowledgePoints:   []string{"endianness", "length field"},
		},
		AgentCandidates: []AgentCandidate{{
			Candidate: "NSSCTF{secret-candidate}",
		}},
		Submissions: []SubmissionView{{
			Candidate: "NSSCTF{secret-candidate}",
		}},
		Learning: []LearningRecord{
			{
				ID:         "learn_step_endian",
				Kind:       "independent_step",
				Actor:      LearningActorUser,
				Assistance: LearningAssistanceNone,
				Content:    "我先确认了字节序，再推导长度字段。",
			},
			{
				ID:         "learn_reflection_endian",
				Kind:       "reflection",
				Actor:      LearningActorUser,
				Assistance: LearningAssistanceNone,
				Content:    "下次我会先确认字节序，再推长度字段；不要保存 sk-abcdefghijklmnop。",
			},
		},
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

func recallEvidenceContains(evidence []TrainingMemoryEvidenceLink, kind string) bool {
	for _, item := range evidence {
		if item.Kind == kind {
			return true
		}
	}
	return false
}

func boolPointer(value bool) *bool {
	return &value
}

func assertCTFMemoryV1History(t *testing.T, database *sql.DB) {
	t.Helper()
	var (
		version int
		name    string
		count   int
	)
	if err := database.QueryRow(
		`SELECT count(*), min(version), min(name) FROM schema_migrations`,
	).Scan(&count, &version, &name); err != nil {
		t.Fatalf("query CTF memory migration history: %v", err)
	}
	if count != 1 ||
		version != SupportedCTFMemoryDatabaseVersion ||
		name != ctfMemoryV1MigrationName {
		t.Fatalf(
			"CTF memory migration history = count %d, version %d, name %q; want 1, %d, %q",
			count,
			version,
			name,
			SupportedCTFMemoryDatabaseVersion,
			ctfMemoryV1MigrationName,
		)
	}
}

func ctfMemoryColumnNames(t *testing.T, database *sql.DB) []string {
	t.Helper()
	rows, err := database.Query(`PRAGMA table_info(ctf_memories)`)
	if err != nil {
		t.Fatal(err)
	}
	defer rows.Close()
	var columns []string
	for rows.Next() {
		var (
			position     int
			name         string
			columnType   string
			notNull      int
			defaultValue sql.NullString
			primaryKey   int
		)
		if err := rows.Scan(
			&position,
			&name,
			&columnType,
			&notNull,
			&defaultValue,
			&primaryKey,
		); err != nil {
			t.Fatal(err)
		}
		columns = append(columns, name)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return columns
}

func memoryColumnsContain(values []string, want string) bool {
	for _, value := range values {
		if value == want {
			return true
		}
	}
	return false
}
