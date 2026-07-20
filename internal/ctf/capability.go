package ctf

import (
	"context"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

const CapabilityName = "ctf.core"

type Runtime interface {
	GetJob(context.Context, string) (securityruntime.JobProjection, error)
	ReadArtifact(context.Context, securityruntime.Artifact) ([]byte, error)
}

type Capability struct {
	runtime Runtime
}

type CapabilityResult struct {
	Summary             string
	MediaType           string
	Complete            bool
	ExistingArtifactIDs []string
	Artifacts           []securityruntime.ArtifactDraft
	Candidate           bool
}

func NewCapability(runtime Runtime) *Capability {
	return &Capability{runtime: runtime}
}

func (c *Capability) EffectSpec(actionName string, input json.RawMessage) (securityruntime.EffectSpec, error) {
	switch actionName {
	case "ctf.inspect_material":
		var value struct {
			MaterialID string `json:"materialId"`
		}
		if err := json.Unmarshal(input, &value); err != nil || value.MaterialID == "" {
			return securityruntime.EffectSpec{}, fmt.Errorf("inspect_material requires materialId")
		}
		return securityruntime.EffectSpec{
			Class: "read_only", IdempotencyKey: "ctf.inspect:" + value.MaterialID,
			Cleanup: "none", Approval: "not-required: user-admitted material",
			ScopeCheck: "artifact must belong to the current Job",
		}, nil
	case "ctf.decode_hex":
		var value struct {
			ArtifactID string `json:"artifactId"`
		}
		if err := json.Unmarshal(input, &value); err != nil || value.ArtifactID == "" {
			return securityruntime.EffectSpec{}, fmt.Errorf("decode_hex requires artifactId")
		}
		return securityruntime.EffectSpec{
			Class: "local_file.create", IdempotencyKey: "ctf.decode-hex:" + value.ArtifactID,
			Cleanup: "retain with challenge evidence", Approval: "not-required: app-private artifact directory",
			ScopeCheck: "source artifact must belong to the current Job",
		}, nil
	case "ctf.submit_flag":
		var value struct {
			Candidate   string `json:"candidate"`
			Explanation string `json:"explanation"`
		}
		if err := json.Unmarshal(input, &value); err != nil || strings.TrimSpace(value.Candidate) == "" || strings.TrimSpace(value.Explanation) == "" {
			return securityruntime.EffectSpec{}, fmt.Errorf("submit_flag requires candidate and evidence explanation")
		}
		if len([]rune(value.Candidate)) > 512 || len([]rune(value.Explanation)) > 2000 {
			return securityruntime.EffectSpec{}, fmt.Errorf("submit_flag candidate or explanation is too long")
		}
		return securityruntime.EffectSpec{
			Class: "local_submission.record", IdempotencyKey: "ctf.submit:" + strings.TrimSpace(value.Candidate),
			Cleanup: "retain with judge evidence", Approval: "not-required: local judge only",
			ScopeCheck: "submission is evaluated only by this Job's local judge",
		}, nil
	case "ctf.coach_hint":
		var value struct {
			Hint     string `json:"hint"`
			Concept  string `json:"concept"`
			Question string `json:"question"`
			Level    int    `json:"level"`
		}
		if err := json.Unmarshal(input, &value); err != nil || strings.TrimSpace(value.Hint) == "" || strings.TrimSpace(value.Question) == "" || value.Level < 1 || value.Level > 3 {
			return securityruntime.EffectSpec{}, fmt.Errorf("coach_hint requires a hint, guiding question, and level 1-3")
		}
		return securityruntime.EffectSpec{
			Class: "learning.record", IdempotencyKey: fmt.Sprintf("ctf.hint:%d:%s", value.Level, strings.TrimSpace(value.Concept)),
			Cleanup: "retain with human outcome", Approval: "not-required: explanatory learning record",
			ScopeCheck: "hint may reference only evidence in the current Job",
		}, nil
	default:
		return securityruntime.EffectSpec{}, fmt.Errorf("unsupported CTF action %q", actionName)
	}
}

func (c *Capability) Execute(ctx context.Context, jobID string, action securityruntime.Action) (CapabilityResult, error) {
	projection, err := c.runtime.GetJob(ctx, jobID)
	if err != nil {
		return CapabilityResult{}, err
	}
	switch action.Name {
	case "ctf.inspect_material":
		return c.inspectMaterial(ctx, projection, action.Input)
	case "ctf.decode_hex":
		return c.decodeHex(ctx, projection, action.Input)
	case "ctf.submit_flag":
		return c.submitFlag(action.Input)
	case "ctf.coach_hint":
		return c.coachHint(action.Input)
	default:
		return CapabilityResult{}, fmt.Errorf("unsupported CTF action %q", action.Name)
	}
}

func (c *Capability) coachHint(input json.RawMessage) (CapabilityResult, error) {
	var value struct {
		Hint     string `json:"hint"`
		Concept  string `json:"concept"`
		Question string `json:"question"`
		Level    int    `json:"level"`
	}
	if err := json.Unmarshal(input, &value); err != nil {
		return CapabilityResult{}, err
	}
	value.Hint = strings.TrimSpace(value.Hint)
	value.Concept = strings.TrimSpace(value.Concept)
	value.Question = strings.TrimSpace(value.Question)
	if value.Hint == "" || value.Question == "" || value.Level < 1 || value.Level > 3 || len([]rune(value.Hint))+len([]rune(value.Question)) > 3000 {
		return CapabilityResult{}, fmt.Errorf("invalid coach hint")
	}
	data, _ := json.Marshal(value)
	return CapabilityResult{
		Summary:   fmt.Sprintf("第 %d 级提示（%s）：%s\n引导问题：%s", value.Level, value.Concept, value.Hint, value.Question),
		MediaType: "application/vnd.milksu.learning-hint+json", Complete: true,
		Artifacts: []securityruntime.ArtifactDraft{{MediaType: "application/json", Data: data}},
	}, nil
}

func (c *Capability) inspectMaterial(ctx context.Context, projection securityruntime.JobProjection, input json.RawMessage) (CapabilityResult, error) {
	var value struct {
		MaterialID string `json:"materialId"`
	}
	if err := json.Unmarshal(input, &value); err != nil {
		return CapabilityResult{}, fmt.Errorf("decode inspect input: %w", err)
	}
	artifact, ok := findArtifact(projection, value.MaterialID)
	if !ok || artifact.SourceActionID != "" {
		return CapabilityResult{}, fmt.Errorf("material is not an admitted Job artifact")
	}
	data, err := c.runtime.ReadArtifact(ctx, artifact)
	if err != nil {
		return CapabilityResult{}, err
	}
	summary := describeBytes(data)
	return CapabilityResult{
		Summary:   fmt.Sprintf("Material %s (%s, %d bytes):\n%s", artifact.ID, artifact.MediaType, len(data), summary),
		MediaType: "application/vnd.milksu.ctf-observation+json", Complete: true,
		ExistingArtifactIDs: []string{artifact.ID},
	}, nil
}

func (c *Capability) decodeHex(ctx context.Context, projection securityruntime.JobProjection, input json.RawMessage) (CapabilityResult, error) {
	var value struct {
		ArtifactID string `json:"artifactId"`
	}
	if err := json.Unmarshal(input, &value); err != nil {
		return CapabilityResult{}, fmt.Errorf("decode hex input: %w", err)
	}
	artifact, ok := findArtifact(projection, value.ArtifactID)
	if !ok {
		return CapabilityResult{}, fmt.Errorf("source artifact does not belong to the current Job")
	}
	data, err := c.runtime.ReadArtifact(ctx, artifact)
	if err != nil {
		return CapabilityResult{}, err
	}
	compact := strings.Map(func(value rune) rune {
		if value == ' ' || value == '\n' || value == '\r' || value == '\t' {
			return -1
		}
		return value
	}, string(data))
	if len(compact) == 0 || len(compact) > maxMaterialBytes*2 {
		return CapabilityResult{}, fmt.Errorf("hex input is empty or too large")
	}
	decoded, err := hex.DecodeString(compact)
	if err != nil {
		return CapabilityResult{}, fmt.Errorf("material is not valid hexadecimal: %w", err)
	}
	mediaType := "application/octet-stream"
	if utf8.Valid(decoded) {
		mediaType = "text/plain; charset=utf-8"
	}
	return CapabilityResult{
		Summary:   fmt.Sprintf("Hex decode produced %d bytes:\n%s", len(decoded), describeBytes(decoded)),
		MediaType: "application/vnd.milksu.ctf-observation+json", Complete: true,
		ExistingArtifactIDs: []string{artifact.ID},
		Artifacts:           []securityruntime.ArtifactDraft{{MediaType: mediaType, Data: decoded}},
	}, nil
}

func (c *Capability) submitFlag(input json.RawMessage) (CapabilityResult, error) {
	var value struct {
		Candidate   string `json:"candidate"`
		Explanation string `json:"explanation"`
	}
	if err := json.Unmarshal(input, &value); err != nil {
		return CapabilityResult{}, fmt.Errorf("decode flag submission: %w", err)
	}
	candidate := strings.TrimSpace(value.Candidate)
	explanation := strings.TrimSpace(value.Explanation)
	if candidate == "" || len([]rune(candidate)) > 512 || explanation == "" || len([]rune(explanation)) > 2000 {
		return CapabilityResult{}, fmt.Errorf("flag candidate or evidence explanation is empty or too long")
	}
	summary := "Flag candidate was committed for independent evaluation: " + explanation
	return CapabilityResult{
		Summary: summary, MediaType: "application/vnd.milksu.ctf-submission+json", Complete: true,
		Artifacts: []securityruntime.ArtifactDraft{{MediaType: "text/plain; charset=utf-8", Data: []byte(candidate)}},
		Candidate: true,
	}, nil
}

func findArtifact(projection securityruntime.JobProjection, id string) (securityruntime.Artifact, bool) {
	for _, artifact := range projection.Artifacts {
		if artifact.ID == id {
			return artifact, true
		}
	}
	return securityruntime.Artifact{}, false
}

func describeBytes(data []byte) string {
	const limit = 64 * 1024
	truncated := len(data) > limit
	if truncated {
		data = data[:limit]
	}
	var value string
	if utf8.Valid(data) {
		value = string(data)
	} else {
		value = hex.EncodeToString(data)
	}
	if truncated {
		value += "\n[truncated by M2-A material preview]"
	}
	return value
}
