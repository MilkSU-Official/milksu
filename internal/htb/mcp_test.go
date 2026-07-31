package htb

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestProbeNegotiatesSessionAndListsTools(t *testing.T) {
	const token = "htb-test-token"
	toolPage := 0
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method != http.MethodPost {
			t.Fatalf("unexpected method %s", request.Method)
		}
		if request.Header.Get("Authorization") != "Bearer "+token {
			t.Fatalf("missing bearer token")
		}
		var message struct {
			ID     int64           `json:"id"`
			Method string          `json:"method"`
			Params json.RawMessage `json:"params"`
		}
		if err := json.NewDecoder(request.Body).Decode(&message); err != nil {
			t.Fatalf("decode request: %v", err)
		}
		if request.Header.Get("Mcp-Method") != message.Method {
			t.Fatalf("Mcp-Method did not mirror request body")
		}
		switch message.Method {
		case "initialize":
			if request.Header.Get("MCP-Protocol-Version") != "" {
				t.Fatal("initialize must precede protocol negotiation")
			}
			writer.Header().Set("Content-Type", "application/json")
			writer.Header().Set("Mcp-Session-Id", "session-123")
			fmt.Fprintf(writer, `{
				"jsonrpc":"2.0",
				"id":%d,
				"result":{
					"protocolVersion":"2025-11-25",
					"capabilities":{"tools":{"listChanged":true}},
					"serverInfo":{"name":"htb-ctf","title":"HTB CTF","version":"1.0"}
				}
			}`, message.ID)
		case "notifications/initialized":
			assertNegotiatedHeaders(t, request)
			writer.WriteHeader(http.StatusAccepted)
		case "tools/list":
			assertNegotiatedHeaders(t, request)
			writer.Header().Set("Content-Type", "application/json")
			toolPage++
			if toolPage == 1 {
				fmt.Fprintf(writer, `{
					"jsonrpc":"2.0",
					"id":%d,
					"result":{
						"tools":[{
							"name":"events_list",
							"description":"List CTF events",
							"inputSchema":{"type":"object"}
						}],
						"nextCursor":"page-2"
					}
				}`, message.ID)
				return
			}
			if !strings.Contains(string(message.Params), "page-2") {
				t.Fatalf("missing tools cursor: %s", message.Params)
			}
			fmt.Fprintf(writer, `{
				"jsonrpc":"2.0",
				"id":%d,
				"result":{
					"tools":[{
						"name":"flag_submit",
						"description":"Submit a challenge flag",
						"inputSchema":{"type":"object","required":["flag"]}
					}]
				}
			}`, message.ID)
		default:
			t.Fatalf("unexpected MCP method %q", message.Method)
		}
	}))
	defer server.Close()

	client, err := newClient(server.URL, token, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	probe, err := client.Probe(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if probe.ProtocolVersion != "2025-11-25" ||
		probe.Server.Name != "htb-ctf" ||
		len(probe.ToolNames) != 2 ||
		probe.ToolNames[0] != "events_list" ||
		probe.ToolNames[1] != "flag_submit" ||
		len(probe.MappedOperations) != 0 {
		t.Fatalf("unexpected probe result: %#v", probe)
	}
}

func assertNegotiatedHeaders(t *testing.T, request *http.Request) {
	t.Helper()
	if request.Header.Get("MCP-Protocol-Version") != "2025-11-25" {
		t.Fatalf("missing negotiated protocol header")
	}
	if request.Header.Get("Mcp-Session-Id") != "session-123" {
		t.Fatalf("missing MCP session header")
	}
}

func TestProbeAcceptsSSEResponses(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		var message struct {
			ID     int64  `json:"id"`
			Method string `json:"method"`
		}
		if err := json.NewDecoder(request.Body).Decode(&message); err != nil {
			t.Fatal(err)
		}
		switch message.Method {
		case "initialize":
			writer.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprintf(writer, "event: message\n")
			fmt.Fprintf(writer, "data: {\"jsonrpc\":\"2.0\",\"method\":\"notifications/message\",\"params\":{}}\n\n")
			fmt.Fprintf(writer, "event: message\n")
			fmt.Fprintf(
				writer,
				"data: {\"jsonrpc\":\"2.0\",\"id\":%d,\"result\":{\"protocolVersion\":\"2025-06-18\",\"capabilities\":{\"tools\":{}},\"serverInfo\":{\"name\":\"htb\",\"version\":\"1\"}}}\n\n",
				message.ID,
			)
		case "notifications/initialized":
			writer.WriteHeader(http.StatusAccepted)
		case "tools/list":
			writer.Header().Set("Content-Type", "text/event-stream")
			fmt.Fprintf(
				writer,
				"data: {\"jsonrpc\":\"2.0\",\"id\":%d,\"result\":{\"tools\":[{\"name\":\"events_list\",\"inputSchema\":{\"type\":\"object\"}}]}}\n\n",
				message.ID,
			)
		default:
			t.Fatalf("unexpected method %q", message.Method)
		}
	}))
	defer server.Close()

	client, err := newClient(server.URL, "token", server.Client())
	if err != nil {
		t.Fatal(err)
	}
	probe, err := client.Probe(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if probe.ProtocolVersion != "2025-06-18" ||
		len(probe.ToolNames) != 1 ||
		probe.ToolNames[0] != "events_list" {
		t.Fatalf("unexpected SSE probe: %#v", probe)
	}
}

func TestProbeRejectsUnsupportedProtocolAndDoesNotLeakToken(t *testing.T) {
	const token = "secret-token-that-must-not-leak"
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		writer.Header().Set("Content-Type", "application/json")
		fmt.Fprint(writer, `{
			"jsonrpc":"2.0",
			"id":1,
			"result":{
				"protocolVersion":"2099-01-01",
				"capabilities":{"tools":{}},
				"serverInfo":{"name":"unexpected","version":"1"}
			}
		}`)
	}))
	defer server.Close()

	client, err := newClient(server.URL, token, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	_, err = client.Probe(context.Background())
	if err == nil || !strings.Contains(err.Error(), "unsupported protocol") {
		t.Fatalf("expected unsupported protocol error, got %v", err)
	}
	if strings.Contains(err.Error(), token) {
		t.Fatal("HTB token leaked through error")
	}
}

func TestProbeBoundsRemoteResponseAndHTTPFailures(t *testing.T) {
	for name, handler := range map[string]http.HandlerFunc{
		"oversized": func(writer http.ResponseWriter, request *http.Request) {
			writer.Header().Set("Content-Type", "application/json")
			writer.WriteHeader(http.StatusOK)
			_, _ = writer.Write([]byte(strings.Repeat("x", maxResponseBytes+1)))
		},
		"http-error": func(writer http.ResponseWriter, request *http.Request) {
			http.Error(writer, "token=server-echo-should-not-surface", http.StatusUnauthorized)
		},
	} {
		t.Run(name, func(t *testing.T) {
			server := httptest.NewServer(handler)
			defer server.Close()
			client, err := newClient(server.URL, "secret-token", &http.Client{
				Timeout: 2 * time.Second,
			})
			if err != nil {
				t.Fatal(err)
			}
			_, err = client.Probe(context.Background())
			if err == nil {
				t.Fatal("expected bounded transport error")
			}
			if strings.Contains(err.Error(), "secret-token") ||
				strings.Contains(err.Error(), "server-echo") {
				t.Fatalf("transport error leaked sensitive text: %v", err)
			}
		})
	}
}

func TestNewClientRejectsMalformedTokens(t *testing.T) {
	for _, token := range []string{"", " token", "token ", "token\nheader"} {
		if _, err := NewClient(token); err == nil {
			t.Fatalf("expected token %q to be rejected", token)
		}
	}
}
