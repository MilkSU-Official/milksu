package ctf

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

const (
	judgeName    = "ctf-flag-judge"
	judgeVersion = "1"
)

type Judge struct {
	runtime Runtime
}

func NewJudge(runtime Runtime) *Judge {
	return &Judge{runtime: runtime}
}

func (j *Judge) Name() string    { return judgeName }
func (j *Judge) Version() string { return judgeVersion }

func (j *Judge) Evaluate(ctx context.Context, challenge Challenge, artifact securityruntime.Artifact) (securityruntime.EvaluationDecision, error) {
	if challenge.Judge.Version != judgeVersion {
		return securityruntime.EvaluationDecision{}, fmt.Errorf("unsupported CTF judge %s@%s", challenge.Judge.Type, challenge.Judge.Version)
	}
	data, err := j.runtime.ReadArtifact(ctx, artifact)
	if err != nil {
		return securityruntime.EvaluationDecision{}, fmt.Errorf("read candidate artifact: %w", err)
	}
	candidate := strings.TrimSpace(string(data))
	if challenge.Judge.Type == "external.manual" {
		if candidate == "" {
			return securityruntime.EvaluationDecision{}, fmt.Errorf("external judge candidate is empty")
		}
		return securityruntime.EvaluationDecision{
			Verdict: securityruntime.VerdictNeedsReview, Score: 0.5,
			Summary: "候选 Flag 已保存；等待外部平台适配器或用户记录权威 Judge 回执，MilkSU 不会替平台伪造成功。",
		}, nil
	}
	if challenge.Judge.Type != "flag.sha256" {
		return securityruntime.EvaluationDecision{}, fmt.Errorf("unsupported CTF judge %s@%s", challenge.Judge.Type, challenge.Judge.Version)
	}
	digest := sha256.Sum256([]byte(candidate))
	if hex.EncodeToString(digest[:]) != challenge.Judge.ExpectedFlagSHA256 {
		return securityruntime.EvaluationDecision{
			Verdict: securityruntime.VerdictFail,
			Score:   0,
			Summary: "本地判题器核对了候选 Flag：尚未匹配，请基于已有证据继续实验。",
		}, nil
	}
	return securityruntime.EvaluationDecision{
		Verdict: securityruntime.VerdictPass,
		Score:   1,
		Summary: "本地判题器独立核对候选 Flag，确认答案正确。",
	}, nil
}
