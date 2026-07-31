package ctf

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

type workspaceArtifactReader map[string][]byte

func (r workspaceArtifactReader) ReadArtifact(_ context.Context, artifact securityruntime.Artifact) ([]byte, error) {
	return append([]byte{}, r[artifact.ID]...), nil
}

func TestPrepareAgentWorkspaceExportsVerifiedMaterialsAndPreservesNotes(t *testing.T) {
	data := []byte("68656c6c6f")
	digestBytes := sha256.Sum256(data)
	digest := hex.EncodeToString(digestBytes[:])
	artifact := securityruntime.Artifact{
		ID: "artifact_fixture", JobID: "job_fixture", Source: "test",
		SHA256: digest, MediaType: "text/plain", Size: int64(len(data)),
		RelativePath: "job_fixture/" + digest,
	}
	projection := Projection{
		Job: securityruntime.Job{ID: "job_fixture", Title: "Fixture"},
		Challenge: ChallengeView{
			ID: "challenge_fixture", Title: "Decode me", Statement: "Recover the flag.",
			Category: "crypto", CollaborationMode: "copilot", TrackName: "Test track",
			HumanGoal: "Explain the encoding.", KnowledgePoints: []string{"hex"},
			Source: ChallengeSource{Kind: "url", URI: "https://example.test/problem/1"},
			Materials: []Material{{
				ArtifactID: artifact.ID, Name: "challenge.txt", MediaType: artifact.MediaType,
				SHA256: digest, Size: artifact.Size, Provenance: "fixture",
			}},
		},
		Artifacts: []securityruntime.Artifact{artifact},
	}

	handoff, err := PrepareAgentWorkspace(
		context.Background(),
		filepath.Join(t.TempDir(), "workspaces"),
		projection,
		workspaceArtifactReader{artifact.ID: data},
	)
	if err != nil {
		t.Fatal(err)
	}
	if handoff.ConversationID == "" ||
		handoff.Role != AgentWorkspaceRoleSolver ||
		handoff.WorkspacePath == "" ||
		handoff.Policy.Mode != "copilot" ||
		handoff.Budget.MaxTurns != 36 ||
		len(handoff.Materials) != 1 ||
		handoff.Materials[0].Inspection.DetectedType != "text" {
		t.Fatalf("unexpected handoff: %#v", handoff)
	}
	loaded, err := LoadAgentWorkspaceHandoff(handoff.WorkspacePath)
	if err != nil {
		t.Fatal(err)
	}
	if loaded.JobID != handoff.JobID ||
		loaded.ConversationID != handoff.ConversationID ||
		len(loaded.Materials) != 1 ||
		loaded.Materials[0].Inspection.DetectedType != "text" {
		t.Fatalf("workspace handoff did not round trip: %#v", loaded)
	}
	if !strings.Contains(handoff.Prompt, "当前是搭档模式") ||
		!strings.Contains(loaded.Prompt, "当前是搭档模式") {
		t.Fatalf("collaboration prompt did not round trip: %#v", loaded)
	}
	exported, err := os.ReadFile(filepath.Join(handoff.WorkspacePath, "materials", "challenge.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if string(exported) != string(data) {
		t.Fatalf("unexpected exported material: %q", exported)
	}
	if info, err := os.Stat(filepath.Join(handoff.WorkspacePath, ".git")); err != nil || !info.IsDir() {
		t.Fatalf("CTF workspace is missing the Pi discovery boundary: info=%v err=%v", info, err)
	}
	manifestData, err := os.ReadFile(filepath.Join(handoff.WorkspacePath, "challenge.json"))
	if err != nil {
		t.Fatal(err)
	}
	var manifest AgentWorkspaceManifest
	if err := json.Unmarshal(manifestData, &manifest); err != nil {
		t.Fatal(err)
	}
	if manifest.SchemaVersion != AgentWorkspaceSchemaVersion ||
		len(manifest.Materials) != 1 ||
		manifest.Policy.Mode != "copilot" ||
		!containsString(manifest.Policy.AllowedTools, "bash") ||
		!containsString(manifest.Policy.AllowedTools, "ctf_capabilities") ||
		!containsString(manifest.Policy.AllowedTools, "ctf_decode") ||
		!containsString(manifest.Policy.AllowedTools, "ctf_triage") ||
		!containsString(manifest.Policy.AllowedTools, "ctf_inspect") ||
		!manifest.Policy.Execution.WorkspaceOnly ||
		manifest.Policy.Execution.DefaultCommandTimeoutSeconds != 120 ||
		manifest.Policy.Execution.MaxCommandTimeoutSeconds != 300 ||
		manifest.Policy.Execution.MaxToolEventOutputBytes != 60_000 ||
		manifest.Materials[0].RelativePath != "materials/challenge.txt" ||
		manifest.Materials[0].Inspection.DetectedType != "text" ||
		manifest.Materials[0].Inspection.ReviewRequired {
		t.Fatalf("unexpected manifest: %#v", manifest)
	}
	checkpoint, err := LoadAgentRunCheckpoint(handoff.WorkspacePath)
	if err != nil {
		t.Fatal(err)
	}
	if checkpoint.JobID != projection.Job.ID ||
		checkpoint.ConversationID != handoff.ConversationID ||
		checkpoint.Status != "ready" {
		t.Fatalf("unexpected initial run checkpoint: %#v", checkpoint)
	}
	instructions, err := os.ReadFile(filepath.Join(handoff.WorkspacePath, "AGENTS.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(instructions), "Crypto 路由") ||
		!strings.Contains(string(instructions), "协作契约：搭档") ||
		!strings.Contains(string(instructions), "work/tool-requests/") ||
		!strings.Contains(string(instructions), "不要直接向 NSSCTF") {
		t.Fatalf("workspace instructions are incomplete: %s", instructions)
	}
	task, err := os.ReadFile(filepath.Join(handoff.WorkspacePath, "TASK.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(task), "精确授权目标") ||
		!strings.Contains(string(task), `"materials/challenge.txt"`) ||
		!strings.Contains(string(task), "材料清单") {
		t.Fatalf("task brief does not expose the normalized workspace inventory: %s", task)
	}
	tooling, err := os.ReadFile(filepath.Join(handoff.WorkspacePath, "TOOLING.md"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(tooling), "输入输出契约") ||
		!strings.Contains(string(tooling), "work/tools/") {
		t.Fatalf("tool-builder handoff contract is incomplete: %s", tooling)
	}
	toolHandoff, err := LoadAgentToolBuilderHandoff(handoff.WorkspacePath)
	if err != nil {
		t.Fatal(err)
	}
	if toolHandoff.Role != AgentWorkspaceRoleToolBuilder ||
		toolHandoff.ConversationID == handoff.ConversationID ||
		!strings.HasPrefix(toolHandoff.ConversationID, "ctf_tool_") ||
		!strings.Contains(toolHandoff.Prompt, "不负责猜 Flag") ||
		!strings.Contains(toolHandoff.Prompt, "必须实际运行本地测试") ||
		!containsString(toolHandoff.Policy.AllowedTools, "bash") ||
		toolHandoff.Budget.MaxTurns != 12 {
		t.Fatalf("unexpected tool-builder handoff: %#v", toolHandoff)
	}
	strategistHandoff, err := LoadAgentStrategistHandoff(handoff.WorkspacePath)
	if err != nil {
		t.Fatal(err)
	}
	if strategistHandoff.Role != AgentWorkspaceRoleStrategist ||
		strategistHandoff.ConversationID == handoff.ConversationID ||
		strategistHandoff.ConversationID == toolHandoff.ConversationID ||
		!strings.HasPrefix(strategistHandoff.ConversationID, "ctf_strategy_") ||
		!strings.Contains(strategistHandoff.Prompt, "独立策略 Agent") ||
		!strings.Contains(strategistHandoff.Prompt, "work/strategy-review.md") ||
		strategistHandoff.Policy.Mode != handoff.Policy.Mode ||
		containsString(strategistHandoff.Policy.AllowedTools, "bash") ||
		containsString(strategistHandoff.Policy.AllowedTools, "edit") ||
		!containsString(strategistHandoff.Policy.AllowedTools, "write") ||
		strategistHandoff.Budget.MaxTurns != 6 {
		t.Fatalf("unexpected strategist handoff: %#v", strategistHandoff)
	}

	notesPath := filepath.Join(handoff.WorkspacePath, "notes.md")
	if err := os.WriteFile(notesPath, []byte("keep my work"), 0o600); err != nil {
		t.Fatal(err)
	}
	if _, err := PrepareAgentWorkspace(
		context.Background(),
		filepath.Join(filepath.Dir(handoff.WorkspacePath)),
		projection,
		workspaceArtifactReader{artifact.ID: data},
	); err != nil {
		t.Fatal(err)
	}
	notes, err := os.ReadFile(notesPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(notes) != "keep my work" {
		t.Fatalf("workspace refresh overwrote notes: %q", notes)
	}
}

func TestAgentCollaborationPoliciesChangeBehaviorAndBudget(t *testing.T) {
	testCases := map[string]struct {
		label      string
		autonomy   string
		maxTurns   int
		maxMinutes int
		promptText string
	}{
		"coach":    {"教练", "guided", 48, 60, "最小必要提示"},
		"copilot":  {"搭档", "joint", 36, 50, "共同列出假设"},
		"delegate": {"代理", "independent", 24, 45, "自主读取材料"},
	}
	seenBudgets := map[AgentWorkspaceBudget]string{}
	for mode, testCase := range testCases {
		t.Run(mode, func(t *testing.T) {
			policy := agentCollaborationPolicy(mode)
			if policy.Label != testCase.label ||
				policy.Autonomy != testCase.autonomy ||
				policy.Budget.MaxTurns != testCase.maxTurns ||
				policy.Budget.MaxWallMinutes != testCase.maxMinutes ||
				!strings.Contains(policy.StartBehavior, testCase.promptText) {
				t.Fatalf("unexpected %s policy: %#v", mode, policy)
			}
			if previous, exists := seenBudgets[policy.Budget]; exists {
				t.Fatalf("%s and %s unexpectedly share the same runtime budget", previous, mode)
			}
			seenBudgets[policy.Budget] = mode
			prompt := initialAgentPrompt(policy, false, AgentProgress{})
			instructions := agentWorkspaceInstructions("misc", policy)
			if !strings.Contains(prompt, policy.Label) ||
				!strings.Contains(instructions, policy.CandidateRule) ||
				!strings.Contains(instructions, "evidence/run.json") ||
				!policy.Execution.WorkspaceOnly ||
				policy.Execution.DefaultCommandTimeoutSeconds <= 0 ||
				policy.Execution.MaxCommandTimeoutSeconds < policy.Execution.DefaultCommandTimeoutSeconds ||
				len(policy.AllowedTools) == 0 {
				t.Fatalf("%s policy was not embedded into the Agent contract", mode)
			}
			if !containsString(policy.AllowedTools, "ctf_inspect") {
				t.Fatalf("%s should have deterministic CTF inspection", mode)
			}
			if !containsString(policy.AllowedTools, "ctf_capabilities") {
				t.Fatalf("%s should expose deterministic tool availability", mode)
			}
			if !containsString(policy.AllowedTools, "ctf_decode") {
				t.Fatalf("%s should expose deterministic one-step decoding", mode)
			}
			if !containsString(policy.AllowedTools, "ctf_triage") {
				t.Fatalf("%s should have deterministic batch triage", mode)
			}
			if mode == "coach" && containsString(policy.AllowedTools, "bash") {
				t.Fatal("coach mode unexpectedly permits shell execution")
			}
			if mode != "coach" && !containsString(policy.AllowedTools, "bash") {
				t.Fatalf("%s mode unexpectedly lacks shell execution", mode)
			}
		})
	}
}

func TestAgentPolicyAddsOnlyExplicitlyScopedNetworkTools(t *testing.T) {
	local := agentCollaborationPolicyForChallenge("coach", ChallengeSource{
		Scope: securitypolicy.ScopeGrant{
			Targets: []securitypolicy.Target{{
				Kind:  securitypolicy.TargetDirectory,
				Value: "/tmp/fixture",
			}},
		},
	})
	if containsString(local.AllowedTools, "ctf_http") ||
		containsString(local.AllowedTools, "ctf_socket") {
		t.Fatalf("local-only challenge gained network tools: %#v", local.AllowedTools)
	}

	networked := agentCollaborationPolicyForChallenge("coach", ChallengeSource{
		Scope: securitypolicy.ScopeGrant{
			Targets: []securitypolicy.Target{
				{Kind: securitypolicy.TargetOrigin, Value: "https://challenge.example"},
				{Kind: securitypolicy.TargetSocket, Value: "challenge.example:31337"},
			},
		},
	})
	if !containsString(networked.AllowedTools, "ctf_http") ||
		!containsString(networked.AllowedTools, "ctf_socket") ||
		containsString(networked.AllowedTools, "bash") {
		t.Fatalf("scoped Coach tools are incorrect: %#v", networked.AllowedTools)
	}
}

func TestInitialAgentPromptIncludesOptionalRunCheckpointWhenResuming(t *testing.T) {
	prompt := initialAgentPrompt(
		agentCollaborationPolicy("copilot"),
		true,
		AgentProgress{NeedsReplan: true},
	)
	if !strings.Contains(prompt, "evidence/run.json（若存在）") ||
		!strings.Contains(prompt, "work/strategy-review.md（若存在）") {
		t.Fatalf("resume prompt does not expose the durable run checkpoint: %q", prompt)
	}
}

func TestPrepareAgentWorkspaceReturnsResumePromptAfterCheckpointProgress(t *testing.T) {
	root := filepath.Join(t.TempDir(), "workspaces")
	projection := Projection{
		Job: securityruntime.Job{ID: "job_resume", Title: "Resume"},
		Challenge: ChallengeView{
			ID:                "challenge_resume",
			Title:             "Resume challenge",
			Statement:         "Continue from the last verified observation.",
			Category:          "misc",
			CollaborationMode: "copilot",
		},
	}
	initial, err := PrepareAgentWorkspace(
		context.Background(),
		root,
		projection,
		workspaceArtifactReader{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(initial.Prompt, "请继续解决") {
		t.Fatalf("new workspace unexpectedly received a resume prompt: %q", initial.Prompt)
	}
	if _, err := PersistAgentRunCheckpoint(
		initial.WorkspacePath,
		initial,
		AgentRunSnapshot{
			Status:               "paused",
			ExitReason:           "same-tool-failure-repeated",
			LastAssistantSummary: "已确认第一层编码，下一步需要更换失败的解析方法。",
		},
		time.Now().UTC(),
	); err != nil {
		t.Fatal(err)
	}
	resumed, err := PrepareAgentWorkspace(
		context.Background(),
		root,
		projection,
		workspaceArtifactReader{},
	)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(resumed.Prompt, "请继续解决") ||
		!strings.Contains(resumed.Prompt, "evidence/run.json（若存在）") ||
		resumed.Run.ExitReason != "same-tool-failure-repeated" {
		t.Fatalf("existing checkpoint did not produce a recovery handoff: %#v", resumed)
	}
}

func TestPrepareAgentWorkspaceContainsMaliciousMaterialNames(t *testing.T) {
	data := []byte("fixture")
	digestBytes := sha256.Sum256(data)
	digest := hex.EncodeToString(digestBytes[:])
	artifact := securityruntime.Artifact{
		ID: "artifact_fixture", JobID: "job_fixture", SHA256: digest,
		MediaType: "application/octet-stream", Size: int64(len(data)),
	}
	projection := Projection{
		Job: securityruntime.Job{ID: "job_fixture"},
		Challenge: ChallengeView{
			ID: "challenge_fixture", Title: "Fixture", Statement: "Statement",
			Materials: []Material{{
				ArtifactID: artifact.ID, Name: "../../outside", SHA256: digest, Size: int64(len(data)),
			}},
		},
		Artifacts: []securityruntime.Artifact{artifact},
	}
	root := t.TempDir()
	handoff, err := PrepareAgentWorkspace(
		context.Background(), root, projection, workspaceArtifactReader{artifact.ID: data},
	)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(handoff.WorkspacePath, "materials", "material-01.bin")); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(root, "outside")); !os.IsNotExist(err) {
		t.Fatalf("material escaped workspace: %v", err)
	}
}

func TestReadAgentWorkspaceResultUsesExplicitCandidateFile(t *testing.T) {
	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, "evidence"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(workspace, "evidence", "trajectory.jsonl"),
		[]byte("{\"type\":\"assistant.completed\"}\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(workspace, "candidate-flags.txt"),
		[]byte("# ignored\nflag{first}\n\nflag{latest}\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(workspace, "notes.md"), []byte("evidence"), 0o600); err != nil {
		t.Fatal(err)
	}
	result, err := ReadAgentWorkspaceResult(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if result.Candidate != "flag{latest}" || result.Notes != "evidence" {
		t.Fatalf("unexpected workspace result: %#v", result)
	}
}

func TestReadAgentStrategistWorkspaceResultUsesReviewWithoutCandidate(t *testing.T) {
	workspace := t.TempDir()
	if err := os.MkdirAll(filepath.Join(workspace, "evidence"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(workspace, "work"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(workspace, "evidence", "strategist-trajectory.jsonl"),
		[]byte("{\"type\":\"assistant.completed\"}\n"),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(
		filepath.Join(workspace, "work", "strategy-review.md"),
		[]byte("# Review\n\nVerify one new hypothesis."),
		0o600,
	); err != nil {
		t.Fatal(err)
	}
	result, err := ReadAgentStrategistWorkspaceResult(workspace)
	if err != nil {
		t.Fatal(err)
	}
	if result.Candidate != "" ||
		result.Notes != "# Review\n\nVerify one new hypothesis." ||
		len(result.Trajectory) == 0 {
		t.Fatalf("unexpected strategist workspace result: %#v", result)
	}
}

func containsString(values []string, target string) bool {
	for _, value := range values {
		if value == target {
			return true
		}
	}
	return false
}
