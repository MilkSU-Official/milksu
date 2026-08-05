package evalbench

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"unicode/utf8"
)

const (
	DefaultDeepSeekBaseURL       = "https://api.deepseek.com"
	maximumProviderResponseBytes = 1 << 20
	maximumStaticAnswerBytes     = 2 << 10
)

type DeepSeekProvider struct {
	apiKey  string
	baseURL string
	client  *http.Client
}

func NewDeepSeekProvider(apiKey, baseURL string, client *http.Client) (*DeepSeekProvider, error) {
	apiKey = strings.TrimSpace(apiKey)
	if apiKey == "" || strings.ContainsAny(apiKey, "\x00\r\n") {
		return nil, errors.New("DeepSeek credential is missing or invalid")
	}
	baseURL = strings.TrimSpace(baseURL)
	if baseURL == "" {
		baseURL = DefaultDeepSeekBaseURL
	}
	parsed, err := url.Parse(baseURL)
	if err != nil {
		return nil, fmt.Errorf("parse DeepSeek Base URL: %w", err)
	}
	if parsed.Scheme != "https" || parsed.Host == "" || parsed.User != nil ||
		parsed.RawQuery != "" || parsed.Fragment != "" {
		return nil, errors.New("DeepSeek Base URL must be an HTTPS URL without credentials, query, or fragment")
	}
	if client == nil {
		client = http.DefaultClient
	}
	privateClient := *client
	privateClient.CheckRedirect = func(_ *http.Request, _ []*http.Request) error {
		return http.ErrUseLastResponse
	}
	return &DeepSeekProvider{
		apiKey:  apiKey,
		baseURL: strings.TrimRight(parsed.String(), "/"),
		client:  &privateClient,
	}, nil
}

func (*DeepSeekProvider) ID() string {
	return "deepseek"
}

func (provider *DeepSeekProvider) CompleteOnce(
	ctx context.Context,
	request InferenceRequest,
) (Completion, error) {
	if strings.TrimSpace(request.Model) == "" {
		return Completion{}, errors.New("DeepSeek model is required")
	}
	if request.SystemPrompt == "" || request.StaticPrompt == "" {
		return Completion{}, errors.New("bounded system and static prompts are required")
	}
	if request.MaxOutputTokens < 1 || request.MaxOutputTokens > 512 {
		return Completion{}, errors.New("DeepSeek output token limit must be between 1 and 512")
	}

	body, err := json.Marshal(deepSeekRequest{
		Model: request.Model,
		Messages: []deepSeekMessage{
			{Role: "system", Content: request.SystemPrompt},
			{Role: "user", Content: request.StaticPrompt},
		},
		MaxTokens:   request.MaxOutputTokens,
		Stream:      false,
		Temperature: 0,
		ToolChoice:  "none",
		Thinking: deepSeekThinking{
			Type: "disabled",
		},
		ResponseFormat: deepSeekResponseFormat{
			Type: "json_object",
		},
	})
	if err != nil {
		return Completion{}, fmt.Errorf("encode DeepSeek request: %w", err)
	}
	httpRequest, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		provider.baseURL+"/chat/completions",
		bytes.NewReader(body),
	)
	if err != nil {
		return Completion{}, fmt.Errorf("create DeepSeek request: %w", err)
	}
	httpRequest.Header.Set("Authorization", "Bearer "+provider.apiKey)
	httpRequest.Header.Set("Content-Type", "application/json")
	httpRequest.Header.Set("Accept", "application/json")

	response, err := provider.client.Do(httpRequest)
	if err != nil {
		return Completion{}, errors.New("DeepSeek request failed")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, maximumProviderResponseBytes))
		return Completion{}, &ProviderHTTPStatusError{StatusCode: response.StatusCode}
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maximumProviderResponseBytes+1))
	if err != nil {
		return Completion{}, errors.New("read DeepSeek response")
	}
	if len(data) > maximumProviderResponseBytes {
		return Completion{}, fmt.Errorf("%w: DeepSeek response is too large", ErrInvalidProviderResponse)
	}

	var decoded deepSeekResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		return Completion{}, fmt.Errorf("%w: response is not valid JSON", ErrInvalidProviderResponse)
	}
	if len(decoded.Choices) != 1 {
		return Completion{}, fmt.Errorf("%w: expected exactly one choice", ErrInvalidProviderResponse)
	}
	choice := decoded.Choices[0]
	if len(bytes.TrimSpace(choice.Message.ToolCalls)) > 0 &&
		!bytes.Equal(bytes.TrimSpace(choice.Message.ToolCalls), []byte("null")) &&
		!bytes.Equal(bytes.TrimSpace(choice.Message.ToolCalls), []byte("[]")) {
		return Completion{}, fmt.Errorf("%w: tool calls are forbidden", ErrInvalidProviderResponse)
	}
	if choice.FinishReason != "stop" {
		return Completion{}, &FinishReasonError{Reason: choice.FinishReason}
	}
	answer, err := decodeStaticAnswer(choice.Message.Content)
	if err != nil {
		return Completion{}, err
	}
	usage := TokenUsage{
		InputTokens:          decoded.Usage.PromptTokens,
		InputCacheHitTokens:  decoded.Usage.PromptCacheHitTokens,
		InputCacheMissTokens: decoded.Usage.PromptCacheMissTokens,
		OutputTokens:         decoded.Usage.CompletionTokens,
	}
	if err := validateTokenUsage(usage); err != nil {
		return Completion{}, fmt.Errorf("%w: %v", ErrInvalidProviderResponse, err)
	}
	return Completion{
		Answer:       answer,
		FinishReason: choice.FinishReason,
		Model:        decoded.Model,
		Usage:        usage,
	}, nil
}

type FinishReasonError struct {
	Reason string
}

func (failure *FinishReasonError) Error() string {
	return "DeepSeek completion did not finish normally"
}

type deepSeekRequest struct {
	Model          string                 `json:"model"`
	Messages       []deepSeekMessage      `json:"messages"`
	MaxTokens      int                    `json:"max_tokens"`
	Stream         bool                   `json:"stream"`
	Temperature    float64                `json:"temperature"`
	ToolChoice     string                 `json:"tool_choice"`
	Thinking       deepSeekThinking       `json:"thinking"`
	ResponseFormat deepSeekResponseFormat `json:"response_format"`
}

type deepSeekMessage struct {
	Role    string `json:"role"`
	Content string `json:"content"`
}

type deepSeekThinking struct {
	Type string `json:"type"`
}

type deepSeekResponseFormat struct {
	Type string `json:"type"`
}

type deepSeekResponse struct {
	Model   string `json:"model"`
	Choices []struct {
		FinishReason string `json:"finish_reason"`
		Message      struct {
			Content   string          `json:"content"`
			ToolCalls json.RawMessage `json:"tool_calls"`
		} `json:"message"`
	} `json:"choices"`
	Usage struct {
		PromptTokens          int64 `json:"prompt_tokens"`
		PromptCacheHitTokens  int64 `json:"prompt_cache_hit_tokens"`
		PromptCacheMissTokens int64 `json:"prompt_cache_miss_tokens"`
		CompletionTokens      int64 `json:"completion_tokens"`
	} `json:"usage"`
}

func decodeStaticAnswer(content string) (string, error) {
	if content == "" || len(content) > maximumStaticAnswerBytes || !utf8.ValidString(content) {
		return "", fmt.Errorf("%w: answer envelope is empty, too large, or invalid UTF-8", ErrInvalidProviderResponse)
	}
	var envelope struct {
		Answer string `json:"answer"`
	}
	if err := decodeStrictJSON([]byte(content), &envelope); err != nil {
		return "", fmt.Errorf("%w: answer envelope is invalid", ErrInvalidProviderResponse)
	}
	if len(envelope.Answer) > maximumStaticAnswerBytes ||
		!utf8.ValidString(envelope.Answer) ||
		strings.ContainsRune(envelope.Answer, '\x00') {
		return "", fmt.Errorf("%w: answer is too large or invalid", ErrInvalidProviderResponse)
	}
	if normalizeStaticAnswer(envelope.Answer) == "" {
		return "", fmt.Errorf("%w: answer is empty", ErrInvalidProviderResponse)
	}
	return envelope.Answer, nil
}

func validateTokenUsage(usage TokenUsage) error {
	if usage.InputTokens < 0 || usage.InputCacheHitTokens < 0 ||
		usage.InputCacheMissTokens < 0 || usage.OutputTokens < 0 {
		return errors.New("token usage cannot be negative")
	}
	if usage.InputCacheHitTokens+usage.InputCacheMissTokens > usage.InputTokens {
		return errors.New("cache token usage exceeds input token usage")
	}
	return nil
}
