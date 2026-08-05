package evalbench

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDeepSeekProviderSendsOneNoToolJSONRequest(t *testing.T) {
	secret := "test-secret-never-print"
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost || request.URL.Path != "/chat/completions" {
			t.Fatalf("unexpected request target: %s %s", request.Method, request.URL.Path)
		}
		if request.Header.Get("Authorization") != "Bearer "+secret {
			t.Fatal("provider did not use the supplied credential")
		}
		body, err := io.ReadAll(request.Body)
		if err != nil {
			t.Fatal(err)
		}
		var payload map[string]any
		if err := json.Unmarshal(body, &payload); err != nil {
			t.Fatal(err)
		}
		if _, hasTools := payload["tools"]; hasTools {
			t.Fatalf("one-shot request unexpectedly included tools: %s", body)
		}
		if payload["tool_choice"] != "none" || payload["stream"] != false {
			t.Fatalf("request did not disable tools and streaming: %s", body)
		}
		response.Header().Set("Content-Type", "application/json")
		_, _ = response.Write([]byte(`{
		  "model": "deepseek-v4-flash",
		  "choices": [{
		    "finish_reason": "stop",
		    "message": {"content": "{\"answer\":\"MILK\"}", "tool_calls": []}
		  }],
		  "usage": {
		    "prompt_tokens": 30,
		    "prompt_cache_hit_tokens": 0,
		    "prompt_cache_miss_tokens": 30,
		    "completion_tokens": 4
		  }
		}`))
	}))
	defer server.Close()

	provider, err := NewDeepSeekProvider(secret, server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	completion, err := provider.CompleteOnce(context.Background(), InferenceRequest{
		Model: "deepseek-v4-flash", SystemPrompt: "Return json.",
		StaticPrompt: "Plain text question.", MaxOutputTokens: 64,
	})
	if err != nil {
		t.Fatal(err)
	}
	if completion.Answer != "MILK" || completion.Usage.OutputTokens != 4 {
		t.Fatalf("unexpected completion: %#v", completion)
	}
}

func TestDeepSeekProviderNeverReturnsCredentialOrErrorBody(t *testing.T) {
	secret := "test-secret-never-print"
	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		http.Error(response, "echo "+secret, http.StatusUnauthorized)
	}))
	defer server.Close()

	provider, err := NewDeepSeekProvider(secret, server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	_, err = provider.CompleteOnce(context.Background(), InferenceRequest{
		Model: "deepseek-v4-flash", SystemPrompt: "Return json.",
		StaticPrompt: "Plain text question.", MaxOutputTokens: 64,
	})
	if err == nil {
		t.Fatal("expected provider error")
	}
	if strings.Contains(err.Error(), secret) || strings.Contains(err.Error(), "echo") {
		t.Fatalf("provider error leaked credential or server body: %v", err)
	}
	var statusFailure *ProviderHTTPStatusError
	if !errors.As(err, &statusFailure) || statusFailure.StatusCode != http.StatusUnauthorized {
		t.Fatalf("provider error did not preserve the safe HTTP status: %v", err)
	}
}

func TestDeepSeekProviderRejectsToolCallsAndNonHTTPS(t *testing.T) {
	if _, err := NewDeepSeekProvider("secret", "http://api.example.test", nil); err == nil {
		t.Fatal("expected non-HTTPS Base URL rejection")
	}

	server := httptest.NewTLSServer(http.HandlerFunc(func(response http.ResponseWriter, _ *http.Request) {
		_, _ = response.Write([]byte(`{
		  "model": "deepseek-v4-flash",
		  "choices": [{
		    "finish_reason": "stop",
		    "message": {
		      "content": "{\"answer\":\"MILK\"}",
		      "tool_calls": [{"type":"function"}]
		    }
		  }],
		  "usage": {
		    "prompt_tokens": 1,
		    "prompt_cache_hit_tokens": 0,
		    "prompt_cache_miss_tokens": 1,
		    "completion_tokens": 1
		  }
		}`))
	}))
	defer server.Close()
	provider, err := NewDeepSeekProvider("secret", server.URL, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := provider.CompleteOnce(context.Background(), InferenceRequest{
		Model: "deepseek-v4-flash", SystemPrompt: "Return json.",
		StaticPrompt: "Plain text question.", MaxOutputTokens: 64,
	}); err == nil || !strings.Contains(err.Error(), "tool calls are forbidden") {
		t.Fatalf("expected tool call rejection, got %v", err)
	}
}
