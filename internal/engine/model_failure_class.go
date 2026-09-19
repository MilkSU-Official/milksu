package engine

import (
	"regexp"
	"strings"
)

// modelFailurePatterns are the failures that mean "this model could not answer": the provider
// refused, the service was unreachable, the model is gone, or the credentials are rejected.
// Everything else (a sidecar crash, a policy block, a tool error) is NOT a model failure and must
// never mark a model red - the picker only reports what was really observed.
var modelFailurePatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\b408\b|\b429\b|\b5\d\d\b`),
	regexp.MustCompile(`(?i)rate.?limit|too many requests|throttl`),
	regexp.MustCompile(`(?i)service unavailable|temporar(?:il)?y unavailable|overloaded|capacity`),
	regexp.MustCompile(`(?i)timeout|timed out|context deadline exceeded`),
	regexp.MustCompile(`(?i)ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|fetch failed|connection refused|dial tcp|no such host`),
	regexp.MustCompile(`(?i)connection error|network is unreachable|tls handshake`),
	regexp.MustCompile(`(?i)model not found|model_not_found|not supported by any configured account|找不到这个模型|does not exist|unknown model`),
	regexp.MustCompile(`(?i)\b401\b|\b403\b|unauthori[sz]ed|invalid api key|authentication failed|余额不足|额度|quota`),
	regexp.MustCompile(`(?i)both model sources are unavailable|model source.{0,40}unavailable`),
}

// LooksLikeModelFailure reports whether an engine error is a real model-call failure. The picker's
// red mark depends on this, so it stays conservative: an unrecognised error marks nothing.
func LooksLikeModelFailure(message string) bool {
	text := strings.TrimSpace(message)
	if text == "" {
		return false
	}
	for _, pattern := range modelFailurePatterns {
		if pattern.MatchString(text) {
			return true
		}
	}
	return false
}
