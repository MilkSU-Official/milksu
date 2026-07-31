package htb

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"mime"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode"
)

const (
	Endpoint               = "https://mcp.hackthebox.ai/v1/ctf/mcp/"
	currentProtocolVersion = "2025-11-25"
	maxResponseBytes       = 2 << 20
	maxTools               = 512
	maxToolPages           = 8
)

var supportedProtocolVersions = map[string]struct{}{
	"2025-11-25": {},
	"2025-06-18": {},
	"2025-03-26": {},
}

type ServerInfo struct {
	Name    string `json:"name"`
	Title   string `json:"title,omitempty"`
	Version string `json:"version"`
}

type Tool struct {
	Name        string          `json:"name"`
	Title       string          `json:"title,omitempty"`
	Description string          `json:"description,omitempty"`
	InputSchema json.RawMessage `json:"inputSchema"`
}

type ProbeResult struct {
	Endpoint         string     `json:"endpoint"`
	ProtocolVersion  string     `json:"protocolVersion"`
	Server           ServerInfo `json:"server"`
	ToolNames        []string   `json:"toolNames"`
	MappedOperations []string   `json:"mappedOperations"`
}

type Client struct {
	endpoint       string
	token          string
	httpClient     *http.Client
	downloadClient *http.Client

	mu              sync.Mutex
	nextID          int64
	sessionID       string
	protocolVersion string
	serverInfo      ServerInfo
	initialized     bool
}

func NewClient(token string) (*Client, error) {
	return newClient(
		Endpoint,
		token,
		&http.Client{Timeout: 20 * time.Second},
	)
}

func newClient(endpoint, token string, httpClient *http.Client) (*Client, error) {
	if err := validateToken(token); err != nil {
		return nil, err
	}
	if httpClient == nil {
		return nil, fmt.Errorf("HTB MCP HTTP client is required")
	}
	parsed, err := url.Parse(endpoint)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" {
		return nil, fmt.Errorf("invalid HTB MCP endpoint")
	}
	return &Client{
		endpoint: endpoint, token: token, httpClient: httpClient,
		downloadClient: newPublicDownloadClient(), nextID: 1,
	}, nil
}

func validateToken(token string) error {
	if token == "" {
		return fmt.Errorf("HTB MCP token is required")
	}
	if len(token) > 4096 || strings.TrimSpace(token) != token ||
		strings.ContainsAny(token, "\r\n") {
		return fmt.Errorf("invalid HTB MCP token")
	}
	return nil
}

func (c *Client) Probe(ctx context.Context) (ProbeResult, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	if err := c.initialize(ctx); err != nil {
		return ProbeResult{}, err
	}
	tools, err := c.listTools(ctx)
	if err != nil {
		return ProbeResult{}, err
	}
	names := make([]string, 0, len(tools))
	mapped := make([]string, 0, len(tools))
	for _, tool := range tools {
		names = append(names, tool.Name)
		if required, allowed := officialToolRequirements[tool.Name]; allowed &&
			validateOfficialToolSchema(tool, required) == nil {
			mapped = append(mapped, tool.Name)
		}
	}
	return ProbeResult{
		Endpoint: c.endpoint, ProtocolVersion: c.protocolVersion,
		Server: c.serverInfo, ToolNames: names, MappedOperations: mapped,
	}, nil
}

func (c *Client) reset() {
	c.sessionID = ""
	c.protocolVersion = ""
	c.initialized = false
	c.serverInfo = ServerInfo{}
}

type initializeResult struct {
	ProtocolVersion string                     `json:"protocolVersion"`
	Capabilities    map[string]json.RawMessage `json:"capabilities"`
	ServerInfo      ServerInfo                 `json:"serverInfo"`
}

func (c *Client) initialize(ctx context.Context) error {
	c.reset()
	var result initializeResult
	if err := c.call(ctx, "initialize", map[string]any{
		"protocolVersion": currentProtocolVersion,
		"capabilities":    map[string]any{},
		"clientInfo": map[string]string{
			"name":    "milksu",
			"title":   "MilkSU",
			"version": "0.1.0",
		},
	}, &result, false); err != nil {
		return fmt.Errorf("initialize HTB MCP: %w", err)
	}
	if _, supported := supportedProtocolVersions[result.ProtocolVersion]; !supported {
		return fmt.Errorf(
			"HTB MCP negotiated unsupported protocol version %q",
			boundedText(result.ProtocolVersion, 80),
		)
	}
	if _, hasTools := result.Capabilities["tools"]; !hasTools {
		return fmt.Errorf("HTB MCP server did not advertise tool capability")
	}
	if err := validateServerInfo(result.ServerInfo); err != nil {
		return err
	}
	c.protocolVersion = result.ProtocolVersion
	c.serverInfo = result.ServerInfo
	if err := c.notify(ctx, "notifications/initialized", map[string]any{}); err != nil {
		return fmt.Errorf("confirm HTB MCP initialization: %w", err)
	}
	c.initialized = true
	return nil
}

func validateServerInfo(info ServerInfo) error {
	if strings.TrimSpace(info.Name) == "" || len([]rune(info.Name)) > 160 ||
		len([]rune(info.Title)) > 240 || len([]rune(info.Version)) > 120 ||
		containsControl(info.Name) || containsControl(info.Title) || containsControl(info.Version) {
		return fmt.Errorf("HTB MCP returned invalid server metadata")
	}
	return nil
}

func containsControl(value string) bool {
	for _, character := range value {
		if unicode.IsControl(character) {
			return true
		}
	}
	return false
}

type listToolsResult struct {
	Tools      []Tool `json:"tools"`
	NextCursor string `json:"nextCursor,omitempty"`
}

func (c *Client) listTools(ctx context.Context) ([]Tool, error) {
	if !c.initialized {
		return nil, fmt.Errorf("HTB MCP client is not initialized")
	}
	tools := make([]Tool, 0)
	seenNames := make(map[string]struct{})
	seenCursors := make(map[string]struct{})
	cursor := ""
	for page := 0; page < maxToolPages; page++ {
		params := map[string]any{}
		if cursor != "" {
			params["cursor"] = cursor
		}
		var result listToolsResult
		if err := c.call(ctx, "tools/list", params, &result, true); err != nil {
			return nil, fmt.Errorf("list HTB MCP tools: %w", err)
		}
		for _, tool := range result.Tools {
			if err := validateTool(tool); err != nil {
				return nil, err
			}
			if _, duplicate := seenNames[tool.Name]; duplicate {
				return nil, fmt.Errorf("HTB MCP returned duplicate tool %q", tool.Name)
			}
			seenNames[tool.Name] = struct{}{}
			tools = append(tools, tool)
			if len(tools) > maxTools {
				return nil, fmt.Errorf("HTB MCP exposed more than %d tools", maxTools)
			}
		}
		cursor = strings.TrimSpace(result.NextCursor)
		if cursor == "" {
			return tools, nil
		}
		if len(cursor) > 512 || containsControl(cursor) {
			return nil, fmt.Errorf("HTB MCP returned invalid tools cursor")
		}
		if _, repeated := seenCursors[cursor]; repeated {
			return nil, fmt.Errorf("HTB MCP repeated its tools cursor")
		}
		seenCursors[cursor] = struct{}{}
	}
	return nil, fmt.Errorf("HTB MCP tools list exceeded %d pages", maxToolPages)
}

func validateTool(tool Tool) error {
	tool.Name = strings.TrimSpace(tool.Name)
	if tool.Name == "" || len([]rune(tool.Name)) > 160 ||
		len([]rune(tool.Title)) > 240 ||
		len([]rune(tool.Description)) > 4000 ||
		containsControl(tool.Name) || containsControl(tool.Title) {
		return fmt.Errorf("HTB MCP returned invalid tool metadata")
	}
	if len(tool.InputSchema) == 0 || !json.Valid(tool.InputSchema) {
		return fmt.Errorf("HTB MCP tool %q has an invalid input schema", tool.Name)
	}
	return nil
}

type rpcRequest struct {
	JSONRPC string `json:"jsonrpc"`
	ID      int64  `json:"id,omitempty"`
	Method  string `json:"method"`
	Params  any    `json:"params,omitempty"`
}

type rpcResponse struct {
	JSONRPC string          `json:"jsonrpc"`
	ID      json.RawMessage `json:"id"`
	Result  json.RawMessage `json:"result"`
	Error   *rpcError       `json:"error,omitempty"`
}

type rpcError struct {
	Code    int             `json:"code"`
	Message string          `json:"message"`
	Data    json.RawMessage `json:"data,omitempty"`
}

func (c *Client) call(
	ctx context.Context,
	method string,
	params any,
	result any,
	negotiated bool,
) error {
	id := c.nextID
	c.nextID++
	body, err := json.Marshal(rpcRequest{
		JSONRPC: "2.0", ID: id, Method: method, Params: params,
	})
	if err != nil {
		return fmt.Errorf("encode MCP request: %w", err)
	}
	response, err := c.post(ctx, method, body, negotiated)
	if err != nil {
		return err
	}
	envelope, err := decodeRPCResponse(response, id)
	if err != nil {
		return err
	}
	if envelope.Error != nil {
		return fmt.Errorf(
			"MCP error %d: %s",
			envelope.Error.Code,
			boundedText(envelope.Error.Message, 500),
		)
	}
	if len(envelope.Result) == 0 {
		return fmt.Errorf("MCP response did not include a result")
	}
	if err := json.Unmarshal(envelope.Result, result); err != nil {
		return fmt.Errorf("decode MCP result: %w", err)
	}
	return nil
}

func (c *Client) notify(ctx context.Context, method string, params any) error {
	body, err := json.Marshal(rpcRequest{
		JSONRPC: "2.0", Method: method, Params: params,
	})
	if err != nil {
		return fmt.Errorf("encode MCP notification: %w", err)
	}
	request, err := c.newRequest(ctx, method, body, true)
	if err != nil {
		return err
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return fmt.Errorf("send MCP notification: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("remote MCP returned HTTP %d", response.StatusCode)
	}
	_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4096))
	return nil
}

type transportResponse struct {
	contentType string
	body        []byte
}

func (c *Client) post(
	ctx context.Context,
	method string,
	body []byte,
	negotiated bool,
) (transportResponse, error) {
	request, err := c.newRequest(ctx, method, body, negotiated)
	if err != nil {
		return transportResponse{}, err
	}
	response, err := c.httpClient.Do(request)
	if err != nil {
		return transportResponse{}, fmt.Errorf("send MCP request: %w", err)
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return transportResponse{}, fmt.Errorf("remote MCP returned HTTP %d", response.StatusCode)
	}
	if sessionID := response.Header.Get("Mcp-Session-Id"); sessionID != "" {
		if err := validateSessionID(sessionID); err != nil {
			return transportResponse{}, err
		}
		if c.sessionID != "" && c.sessionID != sessionID {
			return transportResponse{}, fmt.Errorf("HTB MCP changed session id unexpectedly")
		}
		c.sessionID = sessionID
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes+1))
	if err != nil {
		return transportResponse{}, fmt.Errorf("read MCP response: %w", err)
	}
	if len(data) > maxResponseBytes {
		return transportResponse{}, fmt.Errorf("MCP response exceeds %d bytes", maxResponseBytes)
	}
	mediaType, _, err := mime.ParseMediaType(response.Header.Get("Content-Type"))
	if err != nil {
		return transportResponse{}, fmt.Errorf("invalid MCP response content type")
	}
	if mediaType != "application/json" && mediaType != "text/event-stream" {
		return transportResponse{}, fmt.Errorf("unsupported MCP response content type %q", mediaType)
	}
	return transportResponse{contentType: mediaType, body: data}, nil
}

func validateSessionID(value string) error {
	if len(value) > 512 || strings.TrimSpace(value) != value || containsControl(value) {
		return fmt.Errorf("HTB MCP returned invalid session id")
	}
	return nil
}

func (c *Client) newRequest(
	ctx context.Context,
	method string,
	body []byte,
	negotiated bool,
) (*http.Request, error) {
	request, err := http.NewRequestWithContext(
		ctx,
		http.MethodPost,
		c.endpoint,
		bytes.NewReader(body),
	)
	if err != nil {
		return nil, fmt.Errorf("create MCP request: %w", err)
	}
	request.Header.Set("Authorization", "Bearer "+c.token)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json, text/event-stream")
	if negotiated {
		if c.protocolVersion == "" {
			return nil, fmt.Errorf("MCP protocol version was not negotiated")
		}
		request.Header.Set("MCP-Protocol-Version", c.protocolVersion)
	}
	if c.sessionID != "" {
		request.Header.Set("Mcp-Session-Id", c.sessionID)
	}
	request.Header.Set("Mcp-Method", method)
	return request, nil
}

func decodeRPCResponse(response transportResponse, id int64) (rpcResponse, error) {
	if response.contentType == "application/json" {
		var envelope rpcResponse
		if err := json.Unmarshal(response.body, &envelope); err != nil {
			return rpcResponse{}, fmt.Errorf("decode MCP JSON response: %w", err)
		}
		if err := validateResponseID(envelope.ID, id); err != nil {
			return rpcResponse{}, err
		}
		return envelope, nil
	}
	return decodeSSEResponse(response.body, id)
}

func decodeSSEResponse(data []byte, id int64) (rpcResponse, error) {
	scanner := bufio.NewScanner(bytes.NewReader(data))
	scanner.Buffer(make([]byte, 64*1024), maxResponseBytes)
	eventData := make([]string, 0)
	for scanner.Scan() {
		line := strings.TrimSuffix(scanner.Text(), "\r")
		if line == "" {
			if envelope, found, err := decodeSSEEvent(eventData, id); err != nil {
				return rpcResponse{}, err
			} else if found {
				return envelope, nil
			}
			eventData = eventData[:0]
			continue
		}
		if strings.HasPrefix(line, "data:") {
			eventData = append(eventData, strings.TrimSpace(strings.TrimPrefix(line, "data:")))
		}
	}
	if err := scanner.Err(); err != nil {
		return rpcResponse{}, fmt.Errorf("read MCP SSE response: %w", err)
	}
	if envelope, found, err := decodeSSEEvent(eventData, id); err != nil {
		return rpcResponse{}, err
	} else if found {
		return envelope, nil
	}
	return rpcResponse{}, fmt.Errorf("MCP SSE stream ended without response id %d", id)
}

func decodeSSEEvent(lines []string, id int64) (rpcResponse, bool, error) {
	if len(lines) == 0 {
		return rpcResponse{}, false, nil
	}
	var envelope rpcResponse
	if err := json.Unmarshal([]byte(strings.Join(lines, "\n")), &envelope); err != nil {
		return rpcResponse{}, false, fmt.Errorf("decode MCP SSE event: %w", err)
	}
	if len(envelope.ID) == 0 {
		return rpcResponse{}, false, nil
	}
	if err := validateResponseID(envelope.ID, id); err != nil {
		return rpcResponse{}, false, nil
	}
	return envelope, true, nil
}

func validateResponseID(raw json.RawMessage, expected int64) error {
	var value int64
	if err := json.Unmarshal(raw, &value); err != nil || value != expected {
		return fmt.Errorf("MCP response id does not match request %d", expected)
	}
	return nil
}

func boundedText(value string, limit int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return string(runes[:limit]) + "…"
}
