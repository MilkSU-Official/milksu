package modelcatalog

import "strings"

// Official lab facts come from https://models.dev/ (api.json). Keep this table
// in sync with sidecar/pi/known-context-window.cjs and
// app/src/lib/knownContextWindow.ts. Specific series must precede broader
// family presets so an omitted or placeholder catalog value stays safe.
// Checked against models.dev official labs on 2026-09-22.

const (
	placeholderContextWindow = 128_000
	placeholderMaxTokens8k   = 8_192
	placeholderMaxTokens16k  = 16_384
	placeholderMaxTokens32k  = 32_768
)

type knownLimit struct {
	key       string
	window    int
	maxTokens int
}

var knownModelLimits = []knownLimit{
	{key: "grok-4.7", window: 500_000, maxTokens: 500_000},
	{key: "grok-4.6", window: 500_000, maxTokens: 500_000},
	{key: "grok-4.5", window: 500_000, maxTokens: 500_000},
	{key: "grok-4.20", window: 1_000_000, maxTokens: 30_000},
	{key: "grok-4.3", window: 1_000_000, maxTokens: 30_000},
	{key: "grok-4", window: 1_000_000, maxTokens: 30_000},
	{key: "grok-build-", window: 256_000, maxTokens: 256_000},
	{key: "grok-", window: 128_000, maxTokens: 0},
	{key: "gpt-6", window: 1_050_000, maxTokens: 128_000},
	{key: "gpt-5.6", window: 1_050_000, maxTokens: 128_000},
	{key: "gpt-5.5", window: 1_050_000, maxTokens: 128_000},
	{key: "gpt-5.4-mini", window: 400_000, maxTokens: 128_000},
	{key: "gpt-5.4-nano", window: 400_000, maxTokens: 128_000},
	{key: "gpt-5.4", window: 1_050_000, maxTokens: 128_000},
	{key: "gpt-5.3-chat", window: 128_000, maxTokens: 16_384},
	{key: "gpt-5.3-codex-spark", window: 128_000, maxTokens: 32_000},
	{key: "gpt-5.3-codex", window: 400_000, maxTokens: 128_000},
	{key: "gpt-5.2-chat", window: 128_000, maxTokens: 16_384},
	{key: "gpt-5.2-codex", window: 400_000, maxTokens: 128_000},
	{key: "gpt-5.2-pro", window: 400_000, maxTokens: 128_000},
	{key: "gpt-5.2", window: 400_000, maxTokens: 128_000},
	{key: "gpt-5-pro", window: 400_000, maxTokens: 272_000},
	{key: "gpt-5", window: 400_000, maxTokens: 128_000},
	{key: "gpt-4.1", window: 1_047_576, maxTokens: 32_768},
	{key: "gpt-4o", window: 128_000, maxTokens: 16_384},
	{key: "gpt-", window: 128_000, maxTokens: 0},
	{key: "claude-fable-5", window: 1_000_000, maxTokens: 128_000},
	{key: "claude-mythos-5", window: 1_000_000, maxTokens: 128_000},
	{key: "claude-mythos-preview", window: 1_000_000, maxTokens: 128_000},
	{key: "claude-opus-5", window: 1_000_000, maxTokens: 128_000},
	{key: "claude-sonnet-5", window: 1_000_000, maxTokens: 128_000},
	{key: "claude-sonnet-4.6", window: 1_000_000, maxTokens: 128_000},
	{key: "claude-sonnet-4-6", window: 1_000_000, maxTokens: 128_000},
	{key: "claude-sonnet-4.5", window: 1_000_000, maxTokens: 64_000},
	{key: "claude-sonnet-4-5", window: 1_000_000, maxTokens: 64_000},
	{key: "claude-opus-4.8", window: 1_000_000, maxTokens: 128_000},
	{key: "claude-opus-4-8", window: 1_000_000, maxTokens: 128_000},
	{key: "claude-opus-4.7", window: 1_000_000, maxTokens: 128_000},
	{key: "claude-opus-4-7", window: 1_000_000, maxTokens: 128_000},
	{key: "claude-opus-4.6", window: 1_000_000, maxTokens: 128_000},
	{key: "claude-opus-4-6", window: 1_000_000, maxTokens: 128_000},
	{key: "claude-opus-4.5", window: 200_000, maxTokens: 64_000},
	{key: "claude-opus-4-5", window: 200_000, maxTokens: 64_000},
	{key: "claude-haiku-4.5", window: 200_000, maxTokens: 64_000},
	{key: "claude-haiku-4-5", window: 200_000, maxTokens: 64_000},
	{key: "claude-", window: 200_000, maxTokens: 64_000},
	{key: "deepseek-v4-flash", window: 1_000_000, maxTokens: 384_000},
	{key: "deepseek-v4", window: 1_000_000, maxTokens: 384_000},
	{key: "deepseek-flash", window: 1_000_000, maxTokens: 384_000},
	{key: "deepseek-", window: 1_000_000, maxTokens: 384_000},
	{key: "gemini-3.1-flash-image", window: 65_536, maxTokens: 65_536},
	{key: "gemini-3.1-flash-lite-image", window: 65_536, maxTokens: 65_536},
	{key: "gemini-3.1-flash-live", window: 131_072, maxTokens: 65_536},
	{key: "gemini-3-pro-image", window: 131_072, maxTokens: 32_768},
	{key: "gemini-3", window: 1_048_576, maxTokens: 65_536},
	{key: "gemini-2.5", window: 1_048_576, maxTokens: 65_536},
	{key: "gemini-", window: 1_048_576, maxTokens: 65_536},
	{key: "qwen3.8", window: 1_000_000, maxTokens: 131_072},
	{key: "qwen3.7", window: 1_000_000, maxTokens: 65_536},
	{key: "qwen3.6-plus", window: 1_000_000, maxTokens: 65_536},
	{key: "qwen3.6-flash", window: 1_000_000, maxTokens: 65_536},
	{key: "qwen3.6-27b", window: 262_144, maxTokens: 65_536},
	{key: "qwen3.6-35b", window: 262_144, maxTokens: 65_536},
	{key: "qwen3-coder-plus", window: 1_048_576, maxTokens: 65_536},
	{key: "qwen3-coder-480b", window: 262_144, maxTokens: 65_536},
	{key: "qwen3-coder-30b", window: 262_144, maxTokens: 65_536},
	{key: "qwen3-coder", window: 1_000_000, maxTokens: 65_536},
}

func lookupKnownLimit(id string) (knownLimit, bool) {
	key := canonicalModelKey(id)
	if key == "" {
		return knownLimit{}, false
	}
	for _, entry := range knownModelLimits {
		if key == entry.key || strings.HasPrefix(key, entry.key) {
			return entry, true
		}
	}
	return knownLimit{}, false
}

func knownContextWindow(id string) int {
	entry, ok := lookupKnownLimit(id)
	if !ok {
		return 0
	}
	return entry.window
}

func knownMaxTokens(id string) int {
	entry, ok := lookupKnownLimit(id)
	if !ok {
		return 0
	}
	return entry.maxTokens
}

// resolveModelContextWindow prefers an explicit catalog value unless it is the
// old 128k placeholder. Known model series fill in when TokenFlux omits length.
func resolveModelContextWindow(id string, catalogWindow int) int {
	known := knownContextWindow(id)
	if catalogWindow > 0 && catalogWindow != placeholderContextWindow {
		return catalogWindow
	}
	if known > 0 {
		return known
	}
	if catalogWindow > 0 {
		return catalogWindow
	}
	return 0
}

func isPlaceholderMaxTokens(value int) bool {
	return value == placeholderMaxTokens8k ||
		value == placeholderMaxTokens16k ||
		value == placeholderMaxTokens32k
}

func resolveModelMaxTokens(id string, catalogMax int) int {
	known := knownMaxTokens(id)
	if catalogMax > 0 && !isPlaceholderMaxTokens(catalogMax) {
		return catalogMax
	}
	if known > 0 {
		return known
	}
	if catalogMax > 0 {
		return catalogMax
	}
	return 0
}

func canonicalModelKey(id string) string {
	value := strings.ToLower(strings.TrimSpace(id))
	if value == "" {
		return ""
	}
	if index := strings.LastIndex(value, "/"); index >= 0 {
		value = value[index+1:]
	}
	return value
}
