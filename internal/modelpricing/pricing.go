// Package modelpricing estimates USD cost from pinned models.dev rates.
// Mirror of app/src/lib/knownModelPricing.ts — refresh together before release.
// Not a bill; product UI must say so.
package modelpricing

import (
	"math"
	"strings"
)

type Rate struct {
	Input     float64
	Output    float64
	CacheRead float64
	CacheWrite float64
	Reasoning float64
	HasReasoning bool
}

type Usage struct {
	InputTokens      int64
	OutputTokens     int64
	CacheReadTokens  int64
	CacheWriteTokens int64
	ReasoningTokens  int64
}

// Specific prefixes must precede broader family presets (same order as TS).
var knownRates = []struct {
	prefix string
	rate   Rate
}{
	{"deepseek-v4-pro", Rate{Input: 0.435, Output: 0.87, CacheRead: 0.003625, Reasoning: 0.87, HasReasoning: true}},
	{"deepseek-v4-flash", Rate{Input: 0.15, Output: 0.6, CacheRead: 0.003, Reasoning: 0.6, HasReasoning: true}},
	{"deepseek-flash", Rate{Input: 0.15, Output: 0.6, CacheRead: 0.003, Reasoning: 0.6, HasReasoning: true}},
	{"deepseek-", Rate{Input: 0.15, Output: 0.6, CacheRead: 0.003, Reasoning: 0.6, HasReasoning: true}},
	{"grok-4.7", Rate{Input: 2, Output: 6, CacheRead: 0.5}},
	{"grok-4.6", Rate{Input: 2, Output: 6, CacheRead: 0.5}},
	{"grok-4.5", Rate{Input: 2, Output: 6, CacheRead: 0.3}},
	{"grok-4.20", Rate{Input: 1.25, Output: 2.5, CacheRead: 0.2}},
	{"grok-4.3", Rate{Input: 1.25, Output: 2.5, CacheRead: 0.2}},
	{"grok-build-", Rate{Input: 1, Output: 2, CacheRead: 0.2}},
	{"grok-4", Rate{Input: 1.25, Output: 2.5, CacheRead: 0.2}},
	{"gpt-6", Rate{Input: 10, Output: 50, CacheRead: 1, CacheWrite: 12.5}},
	{"gpt-5.6", Rate{Input: 4, Output: 20, CacheRead: 0.4, CacheWrite: 5}},
	{"gpt-5.5-pro", Rate{Input: 30, Output: 180}},
	{"gpt-5.5", Rate{Input: 5, Output: 30, CacheRead: 0.5}},
	{"gpt-5.4-pro", Rate{Input: 30, Output: 180}},
	{"gpt-5.4-mini", Rate{Input: 0.75, Output: 4.5, CacheRead: 0.075}},
	{"gpt-5.4-nano", Rate{Input: 0.2, Output: 1.25, CacheRead: 0.02}},
	{"gpt-5.4", Rate{Input: 2.5, Output: 15, CacheRead: 0.25}},
	{"gpt-5.3-codex", Rate{Input: 1.75, Output: 14, CacheRead: 0.175}},
	{"gpt-5.3-chat", Rate{Input: 1.75, Output: 14, CacheRead: 0.175}},
	{"gpt-5.2-pro", Rate{Input: 21, Output: 168}},
	{"gpt-5.2", Rate{Input: 1.75, Output: 14, CacheRead: 0.175}},
	{"gpt-5-pro", Rate{Input: 15, Output: 120}},
	{"gpt-5-mini", Rate{Input: 0.25, Output: 2, CacheRead: 0.025}},
	{"gpt-5-nano", Rate{Input: 0.05, Output: 0.4, CacheRead: 0.005}},
	{"gpt-5", Rate{Input: 1.25, Output: 10, CacheRead: 0.125}},
	{"gpt-4.1-mini", Rate{Input: 0.4, Output: 1.6, CacheRead: 0.1}},
	{"gpt-4.1-nano", Rate{Input: 0.1, Output: 0.4, CacheRead: 0.025}},
	{"gpt-4.1", Rate{Input: 2, Output: 8, CacheRead: 0.5}},
	{"claude-fable-5-1", Rate{Input: 10, Output: 50, CacheRead: 0.25, CacheWrite: 12.5}},
	{"claude-fable-5", Rate{Input: 10, Output: 50, CacheRead: 1, CacheWrite: 12.5}},
	{"claude-opus-5", Rate{Input: 5, Output: 25, CacheRead: 0.5, CacheWrite: 6.25}},
	{"claude-sonnet-5", Rate{Input: 2, Output: 10, CacheRead: 0.2, CacheWrite: 2.5}},
	{"claude-sonnet-4.6", Rate{Input: 3, Output: 15, CacheRead: 0.3, CacheWrite: 3.75}},
	{"claude-sonnet-4-6", Rate{Input: 3, Output: 15, CacheRead: 0.3, CacheWrite: 3.75}},
	{"claude-sonnet-4.5", Rate{Input: 3, Output: 15, CacheRead: 0.3, CacheWrite: 3.75}},
	{"claude-opus-4.6", Rate{Input: 5, Output: 25, CacheRead: 0.5, CacheWrite: 6.25}},
	{"claude-opus-4-6", Rate{Input: 5, Output: 25, CacheRead: 0.5, CacheWrite: 6.25}},
	{"claude-opus-4.5", Rate{Input: 5, Output: 25, CacheRead: 0.5, CacheWrite: 6.25}},
	{"claude-haiku-4.5", Rate{Input: 1, Output: 5, CacheRead: 0.1, CacheWrite: 1.25}},
	{"claude-", Rate{Input: 3, Output: 15, CacheRead: 0.3, CacheWrite: 3.75}},
	{"gemini-3.8-flash", Rate{Input: 0.75, Output: 3.75, CacheRead: 0.075}},
	{"gemini-3", Rate{Input: 2, Output: 12, CacheRead: 0.2}},
	{"qwen3.8", Rate{Input: 0.15, Output: 0.6}},
	{"qwen3-coder", Rate{Input: 0.3, Output: 1.2}},
}

func canonicalModelKey(model string) string {
	key := strings.ToLower(strings.TrimSpace(model))
	if i := strings.LastIndex(key, "/"); i >= 0 {
		key = key[i+1:]
	}
	return key
}

func Lookup(model string) (Rate, bool) {
	key := canonicalModelKey(model)
	if key == "" {
		return Rate{}, false
	}
	for _, row := range knownRates {
		if key == row.prefix || strings.HasPrefix(key, row.prefix) {
			return row.rate, true
		}
	}
	return Rate{}, false
}

// EstimateUSD returns models.dev-based USD estimate. ok=false when unknown model.
func EstimateUSD(model string, usage Usage) (float64, bool) {
	rate, ok := Lookup(model)
	if !ok {
		return 0, false
	}
	perM := func(tokens int64, usd float64) float64 {
		if tokens <= 0 || usd == 0 {
			return 0
		}
		return (float64(tokens) / 1_000_000) * usd
	}
	input := nonNeg(usage.InputTokens)
	output := nonNeg(usage.OutputTokens)
	cacheRead := nonNeg(usage.CacheReadTokens)
	cacheWrite := nonNeg(usage.CacheWriteTokens)
	reasoning := nonNeg(usage.ReasoningTokens)
	chargeReasoning := reasoning > 0 && rate.HasReasoning && rate.Reasoning != rate.Output
	total := perM(input, rate.Input) +
		perM(output, rate.Output) +
		perM(cacheRead, rate.CacheRead) +
		perM(cacheWrite, rate.CacheWrite)
	if chargeReasoning {
		total += perM(reasoning, rate.Reasoning)
	}
	if math.IsNaN(total) || math.IsInf(total, 0) {
		return 0, false
	}
	return total, true
}

func nonNeg(v int64) int64 {
	if v < 0 {
		return 0
	}
	return v
}
