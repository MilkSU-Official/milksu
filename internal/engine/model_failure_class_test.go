package engine

import "testing"

// The picker's red mark may only appear for a model that really failed to answer. Anything the
// classifier is unsure about must mark nothing, so a wrong guess cannot turn a working model red.
func TestLooksLikeModelFailureOnlyMatchesRealModelFailures(t *testing.T) {
	for _, message := range []string{
		"502 status code (no body)",
		"Agent failed: 503 Service Unavailable",
		"429 Too Many Requests",
		"dial tcp 127.0.0.1:443: connect: connection refused",
		"fetch failed",
		"context deadline exceeded",
		"Model not found: custom-relay-deepseek/deepseek-flash",
		"当前服务找不到这个模型。",
		"both model sources are unavailable; add a personal API key",
		"401 Unauthorized",
	} {
		if !LooksLikeModelFailure(message) {
			t.Fatalf("a real model failure must be recognised: %q", message)
		}
	}

	for _, message := range []string{
		"",
		"Sidecar for this workspace stopped",
		"MilkSU blocked a write to a protected path",
		"edit failed: anchor not found",
		"the user denied this action",
		"tool.bash exited with code 1",
	} {
		if LooksLikeModelFailure(message) {
			t.Fatalf("a non-model failure must not mark a model red: %q", message)
		}
	}
}
