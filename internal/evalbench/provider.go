package evalbench

import (
	"context"
	"errors"
)

var ErrInvalidProviderResponse = errors.New("invalid provider response")

type InferenceRequest struct {
	Model           string
	SystemPrompt    string
	StaticPrompt    string
	MaxOutputTokens int
}

type TokenUsage struct {
	InputTokens          int64 `json:"inputTokens"`
	InputCacheHitTokens  int64 `json:"inputCacheHitTokens"`
	InputCacheMissTokens int64 `json:"inputCacheMissTokens"`
	OutputTokens         int64 `json:"outputTokens"`
}

type Completion struct {
	Answer       string
	FinishReason string
	Model        string
	Usage        TokenUsage
}

// ProviderHTTPStatusError preserves only the non-sensitive HTTP status. The
// response body is intentionally discarded so a provider or relay cannot
// smuggle credentials, prompts, or model output into run records.
type ProviderHTTPStatusError struct {
	StatusCode int
}

func (failure *ProviderHTTPStatusError) Error() string {
	return "provider returned a non-success HTTP status"
}

// OnceProvider has no tool surface and exposes exactly one bounded inference
// operation. The returned answer is data only; Runner hashes it and discards
// the plaintext without executing or persisting it.
type OnceProvider interface {
	ID() string
	CompleteOnce(context.Context, InferenceRequest) (Completion, error)
}
