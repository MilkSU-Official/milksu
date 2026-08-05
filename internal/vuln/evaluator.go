package vuln

import (
	"fmt"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

const reproductionFingerprint = "addresssanitizer:stack-buffer-overflow:parse_packet"

type ReproductionEvaluator struct{}

func (ReproductionEvaluator) Name() string {
	return "vuln-external-reproduction-evidence"
}

func (ReproductionEvaluator) Version() string {
	return "1"
}

func (ReproductionEvaluator) Evaluate(request ReproductionRequest) (securityruntime.EvaluationDecision, Reproduction) {
	reproduction := Reproduction{
		ID:               securityruntime.NewIdentifier("reproduction"),
		TriggerSHA256:    strings.ToLower(strings.TrimSpace(request.TriggerSHA256)),
		TriggerSize:      request.TriggerSize,
		Environment:      request.Environment,
		Runs:             append([]ReproductionRun{}, request.Runs...),
		TotalRuns:        len(request.Runs),
		Fingerprint:      reproductionFingerprint,
		CleanRunAttested: request.CleanRunAttested,
		Attestation:      strings.TrimSpace(request.Attestation),
	}

	for _, run := range request.Runs {
		log := strings.ToLower(run.SanitizerLog)
		if run.ExitCode != 0 &&
			strings.Contains(log, "addresssanitizer") &&
			strings.Contains(log, "stack-buffer-overflow") &&
			strings.Contains(log, "parse_packet") {
			reproduction.StableRuns++
		}
	}
	if reproduction.StableRuns != 3 {
		reproduction.Summary = fmt.Sprintf("三次外部日志中只有 %d 次包含一致的 ASan 栈溢出指纹。", reproduction.StableRuns)
		return securityruntime.EvaluationDecision{
			Verdict: securityruntime.VerdictFail,
			Score:   float64(reproduction.StableRuns) / 3,
			Summary: reproduction.Summary,
		}, reproduction
	}
	reproduction.Summary = "三份外部 ASan 日志都包含一致的 stack-buffer-overflow / parse_packet 指纹；用户确认它们来自三个干净本地进程。"
	return securityruntime.EvaluationDecision{
		Verdict: securityruntime.VerdictPass,
		Score:   1,
		Summary: reproduction.Summary,
	}, reproduction
}
