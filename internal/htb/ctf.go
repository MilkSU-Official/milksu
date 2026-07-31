package htb

import (
	"context"
	"encoding/json"
	"fmt"
	"strconv"
	"strings"
)

const (
	ToolListCTFEvents     = "list_ctf_events"
	ToolRetrieveCTF       = "retrieve_ctf"
	ToolRetrieveMyTeams   = "retrieve_my_teams"
	ToolJoinCTFEvent      = "join_ctf_event"
	ToolRetrieveCTFScores = "retrieve_ctf_scores"
	ToolStartContainer    = "start_container"
	ToolStopContainer     = "stop_container"
	ToolContainerStatus   = "container_status"
	ToolSubmitFlag        = "submit_flag"
	ToolGetDownloadLink   = "get_download_link"
	maxToolTextBytes      = 1 << 20
)

var officialToolRequirements = map[string][]string{
	ToolListCTFEvents:     {},
	ToolRetrieveCTF:       {"ctf_id"},
	ToolRetrieveMyTeams:   {},
	ToolJoinCTFEvent:      {"ctf_id", "team_id", "consent"},
	ToolRetrieveCTFScores: {"ctf_id"},
	ToolStartContainer:    {"challenge_id"},
	ToolStopContainer:     {"challenge_id"},
	ToolContainerStatus:   {"challenge_id"},
	ToolSubmitFlag:        {"challenge_id", "flag"},
	ToolGetDownloadLink:   {"challenge_id"},
}

type Event struct {
	ID            int64  `json:"id"`
	Name          string `json:"name"`
	Status        string `json:"status,omitempty"`
	StartsAt      string `json:"startsAt,omitempty"`
	EndsAt        string `json:"endsAt,omitempty"`
	CanPlay       bool   `json:"canPlay"`
	HasJoined     bool   `json:"hasJoined"`
	MCPAccessMode string `json:"mcpAccessMode,omitempty"`
}

type Challenge struct {
	ID           int64  `json:"id"`
	Name         string `json:"name"`
	Description  string `json:"description,omitempty"`
	Category     string `json:"category"`
	Difficulty   string `json:"difficulty,omitempty"`
	Points       int    `json:"points"`
	Solved       bool   `json:"solved"`
	HasContainer bool   `json:"hasContainer"`
	HasDownload  bool   `json:"hasDownload"`
}

type CTFDetails struct {
	ID          int64       `json:"id"`
	Name        string      `json:"name"`
	Description string      `json:"description,omitempty"`
	Status      string      `json:"status,omitempty"`
	Challenges  []Challenge `json:"challenges"`
}

type Container struct {
	ChallengeID int64  `json:"challengeId"`
	Status      string `json:"status"`
	Host        string `json:"host,omitempty"`
	Port        int    `json:"port,omitempty"`
	URL         string `json:"url,omitempty"`
	ExpiresAt   string `json:"expiresAt,omitempty"`
}

type Download struct {
	ChallengeID int64  `json:"challengeId"`
	URL         string `json:"url"`
	ExpiresAt   string `json:"expiresAt,omitempty"`
}

type FlagReceipt struct {
	ChallengeID int64  `json:"challengeId"`
	Status      string `json:"status"`
	Correct     *bool  `json:"correct,omitempty"`
	Message     string `json:"message"`
	Reference   string `json:"reference"`
}

type toolContentBlock struct {
	Type string `json:"type"`
	Text string `json:"text,omitempty"`
}

type callToolResult struct {
	Content           []toolContentBlock `json:"content"`
	StructuredContent json.RawMessage    `json:"structuredContent,omitempty"`
	IsError           bool               `json:"isError,omitempty"`
}

func (c *Client) ListEvents(ctx context.Context) ([]Event, error) {
	c.mu.Lock()
	defer c.mu.Unlock()

	raw, err := c.callOfficialTool(ctx, ToolListCTFEvents, map[string]any{})
	if err != nil {
		return nil, err
	}
	value, err := decodeToolJSON(raw)
	if err != nil {
		return nil, fmt.Errorf("decode HTB CTF events: %w", err)
	}
	items := valueArray(value, "events", "items", "data")
	if items == nil {
		return nil, fmt.Errorf("HTB MCP returned an invalid CTF event catalog")
	}
	events := make([]Event, 0, len(items))
	for _, item := range items {
		object, ok := item.(map[string]any)
		if !ok {
			return nil, fmt.Errorf("HTB MCP returned an invalid CTF event")
		}
		event := Event{
			ID:            valueInt64(object, "id", "ctf_id"),
			Name:          boundedText(valueString(object, "name", "title"), 240),
			Status:        boundedText(valueString(object, "status"), 80),
			StartsAt:      boundedText(valueString(object, "starts_at", "startsAt", "start_time"), 120),
			EndsAt:        boundedText(valueString(object, "ends_at", "endsAt", "end_time"), 120),
			CanPlay:       valueBool(object, "canPlay", "can_play"),
			HasJoined:     valueBool(object, "hasJoined", "has_joined", "joined"),
			MCPAccessMode: boundedText(valueString(object, "mcp_access_mode", "mcpAccessMode"), 80),
		}
		if event.ID <= 0 || event.Name == "" || containsControl(event.Name) {
			return nil, fmt.Errorf("HTB MCP returned incomplete CTF event metadata")
		}
		events = append(events, event)
		if len(events) > 1000 {
			return nil, fmt.Errorf("HTB MCP returned too many CTF events")
		}
	}
	return events, nil
}

func (c *Client) RetrieveCTF(ctx context.Context, ctfID int64) (CTFDetails, error) {
	if ctfID <= 0 {
		return CTFDetails{}, fmt.Errorf("HTB CTF id must be positive")
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	raw, err := c.callOfficialTool(ctx, ToolRetrieveCTF, map[string]any{"ctf_id": ctfID})
	if err != nil {
		return CTFDetails{}, err
	}
	value, err := decodeToolJSON(raw)
	if err != nil {
		return CTFDetails{}, fmt.Errorf("decode HTB CTF details: %w", err)
	}
	object := valueObject(value, "ctf", "event", "data")
	if object == nil {
		return CTFDetails{}, fmt.Errorf("HTB MCP returned invalid CTF details")
	}
	details := CTFDetails{
		ID:          valueInt64(object, "id", "ctf_id"),
		Name:        boundedText(valueString(object, "name", "title"), 240),
		Description: boundedText(valueString(object, "description", "desc"), 8000),
		Status:      boundedText(valueString(object, "status"), 80),
		Challenges:  []Challenge{},
	}
	if details.ID == 0 {
		details.ID = ctfID
	}
	if details.ID != ctfID {
		return CTFDetails{}, fmt.Errorf("HTB MCP returned a different CTF id")
	}
	if details.Name == "" {
		details.Name = fmt.Sprintf("HTB CTF %d", ctfID)
	}
	challengeItems := valueArray(object, "challenges", "items")
	if challengeItems == nil {
		challengeItems = []any{}
	}
	for _, item := range challengeItems {
		challengeObject, ok := item.(map[string]any)
		if !ok {
			return CTFDetails{}, fmt.Errorf("HTB MCP returned an invalid challenge")
		}
		challenge := Challenge{
			ID:           valueInt64(challengeObject, "id", "challenge_id"),
			Name:         boundedText(valueString(challengeObject, "name", "title"), 240),
			Description:  boundedText(valueString(challengeObject, "description", "desc"), 12000),
			Category:     boundedText(valueString(challengeObject, "category", "category_name", "challenge_category_id"), 120),
			Difficulty:   boundedText(valueString(challengeObject, "difficulty", "level"), 80),
			Points:       int(valueInt64(challengeObject, "points", "score")),
			Solved:       valueBool(challengeObject, "solved", "is_solved"),
			HasContainer: valueBool(challengeObject, "has_container", "hasContainer", "docker", "spawnable"),
			HasDownload:  valueBool(challengeObject, "has_download", "hasDownload", "has_attachment", "downloadable"),
		}
		if challenge.ID <= 0 || challenge.Name == "" || containsControl(challenge.Name) {
			return CTFDetails{}, fmt.Errorf("HTB MCP returned incomplete challenge metadata")
		}
		details.Challenges = append(details.Challenges, challenge)
		if len(details.Challenges) > 2000 {
			return CTFDetails{}, fmt.Errorf("HTB MCP returned too many challenges")
		}
	}
	return details, nil
}

func (c *Client) StartContainer(ctx context.Context, challengeID int64) (Container, error) {
	return c.containerTool(ctx, ToolStartContainer, challengeID)
}

func (c *Client) ContainerStatus(ctx context.Context, challengeID int64) (Container, error) {
	return c.containerTool(ctx, ToolContainerStatus, challengeID)
}

func (c *Client) StopContainer(ctx context.Context, challengeID int64) (Container, error) {
	return c.containerTool(ctx, ToolStopContainer, challengeID)
}

func (c *Client) containerTool(
	ctx context.Context,
	toolName string,
	challengeID int64,
) (Container, error) {
	if challengeID <= 0 {
		return Container{}, fmt.Errorf("HTB challenge id must be positive")
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	raw, err := c.callOfficialTool(ctx, toolName, map[string]any{
		"challenge_id": challengeID,
	})
	if err != nil {
		return Container{}, err
	}
	value, err := decodeToolJSON(raw)
	if err != nil {
		return Container{}, fmt.Errorf("decode HTB container state: %w", err)
	}
	object := valueObject(value, "container", "data", "instance")
	if object == nil {
		return Container{}, fmt.Errorf("HTB MCP returned invalid container state")
	}
	container := Container{
		ChallengeID: valueInt64(object, "challenge_id", "challengeId", "id"),
		Status:      boundedText(valueString(object, "status", "state"), 80),
		Host:        boundedText(valueString(object, "host", "ip", "hostname"), 255),
		Port:        int(valueInt64(object, "port")),
		URL:         boundedText(valueString(object, "url", "connection_url", "connectionUrl"), 2000),
		ExpiresAt:   boundedText(valueString(object, "expires_at", "expiresAt", "expiration"), 120),
	}
	if container.ChallengeID == 0 {
		container.ChallengeID = challengeID
	}
	if container.ChallengeID != challengeID {
		return Container{}, fmt.Errorf("HTB MCP returned a different challenge id")
	}
	if container.Status == "" {
		container.Status = "unknown"
	}
	if container.Port < 0 || container.Port > 65535 {
		return Container{}, fmt.Errorf("HTB MCP returned an invalid container port")
	}
	if containsControl(container.Host) || containsControl(container.URL) {
		return Container{}, fmt.Errorf("HTB MCP returned invalid container metadata")
	}
	return container, nil
}

func (c *Client) GetDownloadLink(ctx context.Context, challengeID int64) (Download, error) {
	if challengeID <= 0 {
		return Download{}, fmt.Errorf("HTB challenge id must be positive")
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	raw, err := c.callOfficialTool(ctx, ToolGetDownloadLink, map[string]any{
		"challenge_id": challengeID,
	})
	if err != nil {
		return Download{}, err
	}
	value, err := decodeToolJSON(raw)
	if err != nil {
		return Download{}, fmt.Errorf("decode HTB download link: %w", err)
	}
	object := valueObject(value, "download", "data", "attachment")
	if object == nil {
		return Download{}, fmt.Errorf("HTB MCP returned invalid download metadata")
	}
	download := Download{
		ChallengeID: valueInt64(object, "challenge_id", "challengeId", "id"),
		URL:         boundedText(valueString(object, "url", "download_url", "downloadUrl", "link"), 4000),
		ExpiresAt:   boundedText(valueString(object, "expires_at", "expiresAt", "expiration"), 120),
	}
	if download.ChallengeID == 0 {
		download.ChallengeID = challengeID
	}
	if download.ChallengeID != challengeID || download.URL == "" || containsControl(download.URL) {
		return Download{}, fmt.Errorf("HTB MCP returned incomplete download metadata")
	}
	return download, nil
}

func (c *Client) SubmitFlag(
	ctx context.Context,
	challengeID int64,
	candidate string,
) (FlagReceipt, error) {
	if challengeID <= 0 {
		return FlagReceipt{}, fmt.Errorf("HTB challenge id must be positive")
	}
	candidate = strings.TrimSpace(candidate)
	if candidate == "" || len([]rune(candidate)) > 512 || strings.ContainsAny(candidate, "\r\n") {
		return FlagReceipt{}, fmt.Errorf("HTB flag candidate is invalid")
	}
	c.mu.Lock()
	defer c.mu.Unlock()

	raw, err := c.callOfficialTool(ctx, ToolSubmitFlag, map[string]any{
		"challenge_id": challengeID,
		"flag":         candidate,
	})
	if err != nil {
		return FlagReceipt{}, err
	}
	value, decodeErr := decodeToolJSON(raw)
	object := valueObject(value, "receipt", "data", "result")
	message := ""
	status := ""
	var correct *bool
	reference := ""
	if decodeErr == nil && object != nil {
		message = valueString(object, "message", "detail", "status_message")
		status = strings.ToLower(valueString(object, "status", "verdict"))
		correct = valueOptionalBool(object, "correct", "accepted", "solved")
		reference = valueString(object, "reference", "submission_id", "submissionId", "id")
	} else {
		message = strings.TrimSpace(string(raw))
	}
	lowerMessage := strings.ToLower(message)
	if correct == nil {
		switch {
		case status == "accepted" || status == "correct" || status == "solved" ||
			strings.Contains(lowerMessage, "correct flag") ||
			strings.Contains(lowerMessage, "flag accepted"):
			value := true
			correct = &value
		case status == "rejected" || status == "incorrect" || status == "wrong" ||
			strings.Contains(lowerMessage, "incorrect flag") ||
			strings.Contains(lowerMessage, "wrong flag"):
			value := false
			correct = &value
		}
	}
	if correct != nil {
		if *correct {
			status = "accepted"
		} else {
			status = "rejected"
		}
	} else if status == "" {
		status = "inconclusive"
	}
	message = strings.ReplaceAll(message, candidate, "[candidate redacted]")
	message = boundedText(message, 1000)
	if message == "" {
		message = "HTB MCP returned " + status + "."
	}
	if reference == "" {
		reference = fmt.Sprintf("htb-ctf:challenge:%d", challengeID)
	}
	return FlagReceipt{
		ChallengeID: challengeID,
		Status:      status,
		Correct:     correct,
		Message:     message,
		Reference:   boundedText(reference, 500),
	}, nil
}

func (c *Client) callOfficialTool(
	ctx context.Context,
	name string,
	arguments map[string]any,
) (json.RawMessage, error) {
	required, allowed := officialToolRequirements[name]
	if !allowed {
		return nil, fmt.Errorf("HTB MCP tool %q is not allowed", name)
	}
	if err := c.initialize(ctx); err != nil {
		return nil, fmt.Errorf("initialize HTB MCP: %w", err)
	}
	tools, err := c.listTools(ctx)
	if err != nil {
		return nil, err
	}
	var selected *Tool
	for index := range tools {
		if tools[index].Name == name {
			selected = &tools[index]
			break
		}
	}
	if selected == nil {
		return nil, fmt.Errorf("HTB MCP does not expose required tool %q", name)
	}
	if err := validateOfficialToolSchema(*selected, required); err != nil {
		return nil, err
	}
	for _, property := range required {
		if _, present := arguments[property]; !present {
			return nil, fmt.Errorf("HTB MCP tool %q requires %q", name, property)
		}
	}
	var result callToolResult
	if err := c.call(ctx, "tools/call", map[string]any{
		"name":      name,
		"arguments": arguments,
	}, &result, true); err != nil {
		return nil, fmt.Errorf("call HTB MCP tool %q: %w", name, err)
	}
	if result.IsError {
		return nil, fmt.Errorf("HTB MCP tool %q returned an error", name)
	}
	if len(result.StructuredContent) > 0 &&
		string(result.StructuredContent) != "null" &&
		json.Valid(result.StructuredContent) {
		return result.StructuredContent, nil
	}
	var text strings.Builder
	for _, block := range result.Content {
		if block.Type != "text" || block.Text == "" {
			continue
		}
		if text.Len()+len(block.Text) > maxToolTextBytes {
			return nil, fmt.Errorf("HTB MCP tool %q returned too much text", name)
		}
		text.WriteString(block.Text)
	}
	if text.Len() == 0 {
		return nil, fmt.Errorf("HTB MCP tool %q returned no structured data", name)
	}
	return json.RawMessage(text.String()), nil
}

func validateOfficialToolSchema(tool Tool, required []string) error {
	var schema struct {
		Type       string                     `json:"type"`
		Properties map[string]json.RawMessage `json:"properties"`
		Required   []string                   `json:"required"`
	}
	if err := json.Unmarshal(tool.InputSchema, &schema); err != nil {
		return fmt.Errorf("HTB MCP tool %q has an invalid input schema", tool.Name)
	}
	if schema.Type != "" && schema.Type != "object" {
		return fmt.Errorf("HTB MCP tool %q no longer accepts an object", tool.Name)
	}
	requiredSet := make(map[string]struct{}, len(schema.Required))
	for _, property := range schema.Required {
		requiredSet[property] = struct{}{}
	}
	for _, property := range required {
		if _, present := schema.Properties[property]; !present {
			return fmt.Errorf("HTB MCP tool %q is missing property %q", tool.Name, property)
		}
		if _, present := requiredSet[property]; !present {
			return fmt.Errorf("HTB MCP tool %q no longer requires property %q", tool.Name, property)
		}
	}
	return nil
}

func decodeToolJSON(raw json.RawMessage) (any, error) {
	text := strings.TrimSpace(string(raw))
	if strings.HasPrefix(text, "```") {
		lines := strings.Split(text, "\n")
		if len(lines) >= 3 {
			lines = lines[1 : len(lines)-1]
			text = strings.TrimSpace(strings.Join(lines, "\n"))
		}
	}
	decoder := json.NewDecoder(strings.NewReader(text))
	decoder.UseNumber()
	var value any
	if err := decoder.Decode(&value); err != nil {
		return nil, err
	}
	return value, nil
}

func valueArray(value any, keys ...string) []any {
	if values, ok := value.([]any); ok {
		return values
	}
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	for _, key := range keys {
		if values, ok := object[key].([]any); ok {
			return values
		}
	}
	return nil
}

func valueObject(value any, keys ...string) map[string]any {
	object, ok := value.(map[string]any)
	if !ok {
		return nil
	}
	for _, key := range keys {
		if nested, ok := object[key].(map[string]any); ok {
			return nested
		}
	}
	return object
}

func valueString(object map[string]any, keys ...string) string {
	for _, key := range keys {
		switch value := object[key].(type) {
		case string:
			return strings.TrimSpace(value)
		case json.Number:
			return value.String()
		case float64:
			return strconv.FormatFloat(value, 'f', -1, 64)
		}
	}
	return ""
}

func valueInt64(object map[string]any, keys ...string) int64 {
	for _, key := range keys {
		switch value := object[key].(type) {
		case json.Number:
			if parsed, err := value.Int64(); err == nil {
				return parsed
			}
		case float64:
			return int64(value)
		case string:
			if parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64); err == nil {
				return parsed
			}
		}
	}
	return 0
}

func valueBool(object map[string]any, keys ...string) bool {
	for _, key := range keys {
		switch value := object[key].(type) {
		case bool:
			return value
		case string:
			parsed, err := strconv.ParseBool(strings.TrimSpace(value))
			if err == nil {
				return parsed
			}
		case json.Number:
			return value.String() == "1"
		}
	}
	return false
}

func valueOptionalBool(object map[string]any, keys ...string) *bool {
	for _, key := range keys {
		switch value := object[key].(type) {
		case bool:
			result := value
			return &result
		case string:
			parsed, err := strconv.ParseBool(strings.TrimSpace(value))
			if err == nil {
				return &parsed
			}
		case json.Number:
			if value.String() == "0" || value.String() == "1" {
				result := value.String() == "1"
				return &result
			}
		}
	}
	return nil
}
