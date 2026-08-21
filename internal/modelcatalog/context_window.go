package modelcatalog

import "strings"

// resolveModelContextWindow prefers an explicit catalog value unless it is the
// old 128k placeholder. Known model series fill in when TokenFlux omits length.
func resolveModelContextWindow(id string, catalogWindow int) int {
	known := knownContextWindow(id)
	if catalogWindow > 0 && catalogWindow != 128_000 {
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

func knownContextWindow(id string) int {
	key := canonicalModelKey(id)
	if key == "" {
		return 0
	}
	for _, entry := range knownContextWindows {
		if key == entry.key || strings.HasPrefix(key, entry.key) {
			return entry.window
		}
	}
	return 0
}

type knownWindow struct {
	key    string
	window int
}

// Keep in sync with sidecar/pi/known-context-window.cjs and
// app/src/lib/knownContextWindow.ts. Numbers match the bundled TokenFlux fallback.
var knownContextWindows = []knownWindow{
	{key: "grok-4.6", window: 500_000},
	{key: "grok-4.5", window: 500_000},
	{key: "grok-4.3", window: 1_000_000},
	{key: "gpt-5.6", window: 1_050_000},
	{key: "gpt-5.2-codex", window: 400_000},
	{key: "claude-sonnet-4.6", window: 1_000_000},
	{key: "deepseek-v4-flash", window: 1_048_576},
	{key: "deepseek-v4", window: 1_048_576},
	{key: "gemini-3.1", window: 1_048_576},
	{key: "gemini-3", window: 1_048_576},
	{key: "qwen3-coder-plus", window: 1_000_000},
	{key: "qwen3-coder", window: 1_000_000},
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
