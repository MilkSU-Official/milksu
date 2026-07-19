package securityruntime

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
)

const (
	walkingSkeletonExpected = "MILKSU{verifiable_runtime}"
	walkingSkeletonFixture  = "4d494c4b53557b76657269666961626c655f72756e74696d657d"
)

type FakeAgentEngine struct{}

func (FakeAgentEngine) Name() string  { return "fake-agent-engine" }
func (FakeAgentEngine) Model() string { return "deterministic-fixture-v1" }

func (FakeAgentEngine) Propose(_ context.Context, input EngineInput) (ActionProposal, error) {
	if input.Projection.Job.ID == "" || input.Attempt.ID == "" || input.Step.ID == "" {
		return ActionProposal{}, fmt.Errorf("fake engine requires a persisted job, attempt, and step")
	}
	payload, err := json.Marshal(map[string]string{"fixture": "walking-skeleton.hex"})
	if err != nil {
		return ActionProposal{}, err
	}
	return ActionProposal{
		Capability: "fixture-inspector",
		Name:       "fixture.inspect",
		Input:      payload,
		ExpectedEffect: EffectSpec{
			Class:          "local_file.create",
			IdempotencyKey: "walking-skeleton-result:" + input.Projection.Job.ID,
			Cleanup:        "retain with job evidence",
			Approval:       "not-required: app-private artifact directory",
			ScopeCheck:     "job-owned artifact path only",
		},
	}, nil
}

type FakeCapability struct{}

func (FakeCapability) Name() string { return "fixture-inspector" }

func (FakeCapability) Execute(ctx context.Context, action Action) (CapabilityResult, error) {
	if err := ctx.Err(); err != nil {
		return CapabilityResult{}, err
	}
	if action.Capability != "fixture-inspector" || action.Name != "fixture.inspect" {
		return CapabilityResult{}, fmt.Errorf("unsupported fake capability action")
	}
	decoded, err := hex.DecodeString(walkingSkeletonFixture)
	if err != nil {
		return CapabilityResult{}, fmt.Errorf("decode deterministic fixture: %w", err)
	}
	artifact, err := json.Marshal(map[string]string{
		"candidate": string(decoded),
		"source":    "fixture:walking-skeleton.hex",
	})
	if err != nil {
		return CapabilityResult{}, fmt.Errorf("encode deterministic result: %w", err)
	}
	return CapabilityResult{
		Summary:   "固定材料已解码，候选结果保存在原始 Artifact 中",
		MediaType: "application/vnd.milksu.observation+json",
		Complete:  true,
		Artifacts: []ArtifactDraft{{MediaType: "application/json", Data: artifact}},
	}, nil
}

type FakeEnvironment struct{}

func (FakeEnvironment) Name() string { return "fake-isolated-environment" }

func (FakeEnvironment) Prepare(_ context.Context, job Job, attempt Attempt) (EnvironmentLease, error) {
	return EnvironmentLease{
		ID:         "env:" + attempt.ID,
		Provider:   "fake",
		Target:     "fixture:" + job.ID,
		Resettable: true,
	}, nil
}

func (FakeEnvironment) Release(context.Context, EnvironmentLease) error { return nil }

type FakeEvaluator struct{}

func (FakeEvaluator) Name() string    { return "walking-skeleton-judge" }
func (FakeEvaluator) Version() string { return "1" }

func (FakeEvaluator) Evaluate(ctx context.Context, input EvaluationInput) (EvaluationDecision, error) {
	if len(input.Evidence.ArtifactIDs) != 1 {
		return EvaluationDecision{}, fmt.Errorf("walking skeleton judge requires one artifact")
	}
	artifactID := input.Evidence.ArtifactIDs[0]
	var artifact *Artifact
	for index := range input.Projection.Artifacts {
		if input.Projection.Artifacts[index].ID == artifactID {
			artifact = &input.Projection.Artifacts[index]
		}
	}
	if artifact == nil {
		return EvaluationDecision{}, fmt.Errorf("evidence artifact not found")
	}
	data, err := input.Reader.Read(ctx, *artifact)
	if err != nil {
		return EvaluationDecision{}, fmt.Errorf("read evidence artifact: %w", err)
	}
	var result struct {
		Candidate string `json:"candidate"`
		Source    string `json:"source"`
	}
	if err := json.Unmarshal(data, &result); err != nil {
		return EvaluationDecision{}, fmt.Errorf("decode evidence artifact: %w", err)
	}
	if result.Candidate != walkingSkeletonExpected || result.Source != "fixture:walking-skeleton.hex" {
		return EvaluationDecision{
			Verdict: VerdictFail,
			Score:   0,
			Summary: "Evaluator 读取 Artifact 后发现候选结果不匹配",
		}, nil
	}
	return EvaluationDecision{
		Verdict: VerdictPass,
		Score:   1,
		Summary: "Evaluator 独立读取并核对 Artifact，事实链通过",
	}, nil
}
