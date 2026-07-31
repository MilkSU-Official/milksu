package nssctf

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestArenaClientStateMachineAndCredentialBoundary(t *testing.T) {
	const token = "nss_agent_test-secret"
	requests := make([]string, 0, 5)
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer "+token {
			t.Fatalf("missing Arena bearer credential: %q", request.Header.Get("Authorization"))
		}
		if request.Header.Get("Cookie") != "" {
			t.Fatal("Arena adapter must not accept or forward browser cookies")
		}
		requests = append(requests, request.Method+" "+request.URL.Path)
		writer.Header().Set("Content-Type", "application/json")
		switch request.URL.Path {
		case "/skill/agent/arena/current/":
			_, _ = writer.Write([]byte(`{"code":200,"data":{"agent":{"id":1,"name":"MilkSU","rating":1200},"attempt":null,"reused":false}}`))
		case "/skill/agent/arena/next/":
			_, _ = writer.Write([]byte(`{"code":200,"data":{"agent":{"id":1,"name":"MilkSU","rating":1200},"attempt":{"id":100,"state":0,"state_label":"active","remaining_seconds":3500,"max_wrong_count":20,"problem":{"id":200,"title":"example","type":1,"type_label":"Web","content":"find flag","tag":["web"],"container_enabled":true,"rating":1500}},"reused":false}}`))
		case "/skill/agent/arena/attempt/100/":
			_, _ = writer.Write([]byte(`{"code":200,"data":{"attempt":{"id":100,"state_label":"active","problem":{"id":200,"title":"example"}}}}`))
		case "/skill/agent/arena/attempt/100/submit/":
			var payload struct {
				Flag string `json:"flag"`
			}
			if err := json.NewDecoder(request.Body).Decode(&payload); err != nil || payload.Flag != "NSSCTF{candidate}" {
				t.Fatalf("unexpected submit payload: %#v %v", payload, err)
			}
			_, _ = writer.Write([]byte(`{"code":200,"data":{"correct":false,"remaining_wrong_attempts":19,"attempt":{"id":100,"state_label":"active","wrong_count":1,"problem":{"id":200,"title":"example"}}}}`))
		case "/skill/agent/arena/attempt/100/abandon/":
			_, _ = writer.Write([]byte(`{"code":200,"data":{"attempt":{"id":100,"state_label":"abandoned","problem":{"id":200,"title":"example"}}}}`))
		default:
			http.NotFound(writer, request)
		}
	}))
	defer server.Close()

	client := NewArenaClient(ArenaClientOptions{BaseURL: server.URL, HTTPClient: server.Client()})
	current, err := client.Current(context.Background(), token)
	if err != nil || current.Attempt != nil {
		t.Fatalf("current: %#v %v", current, err)
	}
	next, err := client.Next(context.Background(), token)
	if err != nil || next.Attempt == nil || next.Attempt.Problem.TypeLabel != "Web" {
		t.Fatalf("next: %#v %v", next, err)
	}
	if _, err := client.Attempt(context.Background(), token, 100); err != nil {
		t.Fatal(err)
	}
	submitted, err := client.Submit(context.Background(), token, 100, "NSSCTF{candidate}")
	if err != nil || submitted.Correct == nil || *submitted.Correct {
		t.Fatalf("submit: %#v %v", submitted, err)
	}
	abandoned, err := client.Abandon(context.Background(), token, 100)
	if err != nil || abandoned.Attempt == nil || abandoned.Attempt.StateLabel != "abandoned" {
		t.Fatalf("abandon: %#v %v", abandoned, err)
	}
	if len(requests) != 5 {
		t.Fatalf("unexpected state-machine requests: %#v", requests)
	}
}

func TestArenaClientRejectsMissingOrMalformedTokensWithoutLeakingThem(t *testing.T) {
	client := NewArenaClient(ArenaClientOptions{})
	for _, token := range []string{"", "plain-token", "nss_agent_bad\nvalue"} {
		if _, err := client.Current(context.Background(), token); err == nil {
			t.Fatalf("expected token %q to be rejected", token)
		}
	}

	const token = "nss_agent_must-not-leak"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		_, _ = writer.Write([]byte(`{"code":403,"message":"token nss_agent_must-not-leak rejected"}`))
	}))
	defer server.Close()
	client = NewArenaClient(ArenaClientOptions{BaseURL: server.URL, HTTPClient: server.Client()})
	_, err := client.Current(context.Background(), token)
	if err == nil || strings.Contains(err.Error(), token) || !strings.Contains(err.Error(), "[redacted]") {
		t.Fatalf("Arena error leaked token or lost redaction: %v", err)
	}
}

func TestReconcilePendingSubmissionUsesAuthoritativeAttemptState(t *testing.T) {
	active := ArenaResponse{Attempt: &ArenaAttempt{
		ID: 100, StateLabel: "active", WrongCount: 3, MaxWrongCount: 20,
	}}
	if _, resolved, err := ReconcilePendingSubmission(active, 100, 3); err != nil || resolved {
		t.Fatalf("unchanged active attempt was treated as resolved: resolved=%t err=%v", resolved, err)
	}

	rejected := active
	rejected.Attempt = &ArenaAttempt{
		ID: 100, StateLabel: "active", WrongCount: 4, MaxWrongCount: 20,
	}
	rejected, resolved, err := ReconcilePendingSubmission(rejected, 100, 3)
	if err != nil || !resolved || rejected.Correct == nil || *rejected.Correct ||
		rejected.RemainingWrongAttempts == nil || *rejected.RemainingWrongAttempts != 16 {
		t.Fatalf("wrong-count advance was not reconciled: %#v resolved=%t err=%v", rejected, resolved, err)
	}

	solved := ArenaResponse{Attempt: &ArenaAttempt{
		ID: 100, StateLabel: "solved", WrongCount: 4, MaxWrongCount: 20,
	}}
	solved, resolved, err = ReconcilePendingSubmission(solved, 100, 4)
	if err != nil || !resolved || solved.Correct == nil || !*solved.Correct {
		t.Fatalf("solved attempt was not reconciled: %#v resolved=%t err=%v", solved, resolved, err)
	}
}
