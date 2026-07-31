package htb

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestListEventsAndRetrieveCTFUseOfficialWhitelistedTools(t *testing.T) {
	const token = "htb-test-token"
	calls := []string{}
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Header.Get("Authorization") != "Bearer "+token {
			t.Fatal("HTB bearer token was not sent")
		}
		var message struct {
			ID     int64  `json:"id"`
			Method string `json:"method"`
			Params struct {
				Name      string         `json:"name"`
				Arguments map[string]any `json:"arguments"`
			} `json:"params"`
		}
		if err := json.NewDecoder(request.Body).Decode(&message); err != nil {
			t.Fatal(err)
		}
		writer.Header().Set("Content-Type", "application/json")
		switch message.Method {
		case "initialize":
			writer.Header().Set("Mcp-Session-Id", "session-htb-catalog")
			fmt.Fprintf(writer, `{
				"jsonrpc":"2.0","id":%d,
				"result":{
					"protocolVersion":"2025-11-25",
					"capabilities":{"tools":{}},
					"serverInfo":{"name":"htb-ctf","title":"HTB CTF","version":"1"}
				}
			}`, message.ID)
		case "notifications/initialized":
			writer.WriteHeader(http.StatusAccepted)
		case "tools/list":
			fmt.Fprintf(writer, `{
				"jsonrpc":"2.0","id":%d,
				"result":{"tools":[
					{
						"name":"list_ctf_events",
						"inputSchema":{"type":"object","properties":{}}
					},
					{
						"name":"retrieve_ctf",
						"inputSchema":{
							"type":"object",
							"properties":{"ctf_id":{"type":"integer"}},
							"required":["ctf_id"]
						}
					},
					{
						"name":"start_container",
						"inputSchema":{
							"type":"object",
							"properties":{"challenge_id":{"type":"integer"}},
							"required":["challenge_id"]
						}
					},
					{
						"name":"get_download_link",
						"inputSchema":{
							"type":"object",
							"properties":{"challenge_id":{"type":"integer"}},
							"required":["challenge_id"]
						}
					},
					{
						"name":"submit_flag",
						"inputSchema":{
							"type":"object",
							"properties":{
								"challenge_id":{"type":"integer"},
								"flag":{"type":"string"}
							},
							"required":["challenge_id","flag"]
						}
					}
				]}
			}`, message.ID)
		case "tools/call":
			calls = append(calls, message.Params.Name)
			switch message.Params.Name {
			case ToolListCTFEvents:
				fmt.Fprintf(writer, `{
					"jsonrpc":"2.0","id":%d,
					"result":{"content":[{"type":"text","text":"[{\"id\":77,\"name\":\"CTF Try Out\",\"status\":\"ongoing\",\"canPlay\":true,\"hasJoined\":true,\"mcp_access_mode\":\"both\"}]"}]}
				}`, message.ID)
			case ToolRetrieveCTF:
				if message.Params.Arguments["ctf_id"] != float64(77) {
					t.Fatalf("retrieve_ctf used unexpected arguments: %#v", message.Params.Arguments)
				}
				fmt.Fprintf(writer, `{
					"jsonrpc":"2.0","id":%d,
					"result":{"structuredContent":{
						"id":77,
						"name":"CTF Try Out",
						"status":"ongoing",
						"challenges":[{
							"id":901,
							"name":"Warmup",
							"challenge_category_id":1,
							"difficulty":"Easy",
							"points":100,
							"solved":false,
							"docker":true,
							"has_attachment":true,
							"description":"Practice challenge"
						}]
					}}
				}`, message.ID)
			case ToolStartContainer:
				fmt.Fprintf(writer, `{
					"jsonrpc":"2.0","id":%d,
					"result":{"structuredContent":{
						"challenge_id":901,
						"status":"running",
						"host":"10.20.30.40",
						"port":31337,
						"expires_at":"2026-08-01T00:00:00Z"
					}}
				}`, message.ID)
			case ToolGetDownloadLink:
				fmt.Fprintf(writer, `{
					"jsonrpc":"2.0","id":%d,
					"result":{"structuredContent":{
						"challenge_id":901,
						"url":"https://cdn.hackthebox.com/warmup.zip",
						"expires_at":"2026-08-01T00:00:00Z"
					}}
				}`, message.ID)
			case ToolSubmitFlag:
				if message.Params.Arguments["flag"] != "HTB{fixture}" {
					t.Fatalf("submit_flag used unexpected candidate")
				}
				fmt.Fprintf(writer, `{
					"jsonrpc":"2.0","id":%d,
					"result":{"structuredContent":{
						"challenge_id":901,
						"correct":true,
						"status":"correct",
						"message":"Correct flag HTB{fixture}",
						"submission_id":"submission-1"
					}}
				}`, message.ID)
			default:
				t.Fatalf("unexpected HTB tool %q", message.Params.Name)
			}
		default:
			t.Fatalf("unexpected MCP method %q", message.Method)
		}
	}))
	defer server.Close()

	client, err := newClient(server.URL, token, server.Client())
	if err != nil {
		t.Fatal(err)
	}
	events, err := client.ListEvents(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(events) != 1 || events[0].ID != 77 || events[0].Name != "CTF Try Out" ||
		!events[0].CanPlay || !events[0].HasJoined || events[0].MCPAccessMode != "both" {
		t.Fatalf("unexpected normalized HTB events: %#v", events)
	}

	details, err := client.RetrieveCTF(context.Background(), 77)
	if err != nil {
		t.Fatal(err)
	}
	if details.ID != 77 || details.Name != "CTF Try Out" || len(details.Challenges) != 1 {
		t.Fatalf("unexpected HTB CTF details: %#v", details)
	}
	challenge := details.Challenges[0]
	if challenge.ID != 901 || challenge.Name != "Warmup" ||
		challenge.Category != "1" || challenge.Difficulty != "Easy" ||
		!challenge.HasContainer || !challenge.HasDownload {
		t.Fatalf("unexpected normalized HTB challenge: %#v", challenge)
	}
	if len(calls) != 2 || calls[0] != ToolListCTFEvents || calls[1] != ToolRetrieveCTF {
		t.Fatalf("unexpected HTB catalog tool call sequence: %#v", calls)
	}

	container, err := client.StartContainer(context.Background(), 901)
	if err != nil {
		t.Fatal(err)
	}
	if container.Status != "running" || container.Host != "10.20.30.40" ||
		container.Port != 31337 {
		t.Fatalf("unexpected HTB container: %#v", container)
	}

	download, err := client.GetDownloadLink(context.Background(), 901)
	if err != nil {
		t.Fatal(err)
	}
	if download.URL != "https://cdn.hackthebox.com/warmup.zip" {
		t.Fatalf("unexpected HTB download: %#v", download)
	}

	receipt, err := client.SubmitFlag(context.Background(), 901, "HTB{fixture}")
	if err != nil {
		t.Fatal(err)
	}
	if receipt.Correct == nil || !*receipt.Correct || receipt.Status != "accepted" {
		t.Fatalf("unexpected HTB receipt: %#v", receipt)
	}
	if receipt.Message != "Correct flag [candidate redacted]" {
		t.Fatalf("HTB candidate leaked through receipt: %#v", receipt)
	}
	if len(calls) != 5 ||
		calls[2] != ToolStartContainer ||
		calls[3] != ToolGetDownloadLink ||
		calls[4] != ToolSubmitFlag {
		t.Fatalf("unexpected HTB tool call sequence: %#v", calls)
	}
}

func TestOfficialToolBoundaryRejectsUnknownToolsBeforeNetwork(t *testing.T) {
	client, err := newClient("https://example.com/mcp", "token", http.DefaultClient)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := client.callOfficialTool(
		context.Background(),
		"server_supplied_shell",
		map[string]any{},
	); err == nil {
		t.Fatal("unmapped HTB MCP tool was allowed")
	}
}
