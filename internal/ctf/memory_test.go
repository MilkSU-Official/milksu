package ctf

import (
	"context"
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
	if memory.Kind != "technique" || memory.Confidence != 1 {
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
		!strings.Contains(content, "先确认字节序") {
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
		!strings.Contains(content, "先确认字节序") {
		t.Fatalf("memory context contract is incomplete: %s", content)
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
