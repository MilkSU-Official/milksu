package sessionindex

import (
	"bufio"
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"time"
)

type ExternalImportRequest struct {
	Source      string `json:"source"`
	Path        string `json:"path"`
	Project     string `json:"project,omitempty"`
	ProjectPath string `json:"projectPath,omitempty"`
	Limit       int    `json:"limit,omitempty"`
}

type ExternalImportResult struct {
	ImportedAt       string `json:"importedAt"`
	IndexPath        string `json:"indexPath"`
	Source           string `json:"source"`
	Path             string `json:"path"`
	SessionCount     int    `json:"sessionCount"`
	MessageCount     int    `json:"messageCount"`
	ToolCallCount    int    `json:"toolCallCount"`
	SkippedLineCount int    `json:"skippedLineCount"`
}

type externalSession struct {
	ID          string
	Title       string
	Project     string
	ProjectPath string
	StartedAt   string
	Messages    []externalMessage
}

type externalMessage struct {
	ID        string
	ParentID  string
	Timestamp string
	Role      string
	Text      string
	Model     string
	CWD       string
	ToolName  string
	ToolInput string
	IsError   bool
}

func (s Store) ImportExternalJSONL(ctx context.Context, request ExternalImportRequest) (ExternalImportResult, error) {
	if err := s.Ensure(ctx); err != nil {
		return ExternalImportResult{}, err
	}
	source := normalizeExternalSource(request.Source)
	if source == "" {
		return ExternalImportResult{}, fmt.Errorf("external history source is required")
	}
	absolutePath, err := filepath.Abs(strings.TrimSpace(request.Path))
	if err != nil || strings.TrimSpace(request.Path) == "" {
		return ExternalImportResult{}, fmt.Errorf("external history path is required")
	}
	info, err := os.Stat(absolutePath)
	if err != nil {
		return ExternalImportResult{}, fmt.Errorf("inspect external history: %w", err)
	}
	if info.IsDir() {
		return ExternalImportResult{}, fmt.Errorf("external history path must be a JSONL file")
	}

	sessions, skipped, err := readExternalJSONL(absolutePath, source, request)
	if err != nil {
		return ExternalImportResult{}, err
	}

	db, err := sql.Open("sqlite", s.Path)
	if err != nil {
		return ExternalImportResult{}, fmt.Errorf("open session index for external import: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return ExternalImportResult{}, fmt.Errorf("begin external session import: %w", err)
	}
	defer tx.Rollback()

	if err := clearExternalImport(ctx, tx, source, absolutePath); err != nil {
		return ExternalImportResult{}, err
	}

	importedAt := s.now().Format(time.RFC3339Nano)
	result := ExternalImportResult{
		ImportedAt:       importedAt,
		IndexPath:        s.Path,
		Source:           source,
		Path:             absolutePath,
		SkippedLineCount: skipped,
	}
	for _, session := range sessions {
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO sessions(
				id, title, project, project_path, started_at, ended_at, git_branch,
				version, message_count, jsonl_path, source
			) VALUES (?, ?, ?, ?, ?, '', '', '', ?, ?, ?)
		`, session.ID, fallback(session.Title, "Imported session"), session.Project, session.ProjectPath,
			session.StartedAt, len(session.Messages), absolutePath, source); err != nil {
			return ExternalImportResult{}, fmt.Errorf("insert external session: %w", err)
		}
		result.SessionCount++
		for _, message := range session.Messages {
			text := truncateIndexedText(RedactSnippet(message.Text))
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO messages(
					uuid, session_id, type, parent_uuid, timestamp, role, text,
					content_type, is_meta, visibility, model, is_sidechain, agent_id,
					input_tokens, output_tokens, cwd, skill, turn_duration_ms, source
				) VALUES (?, ?, 'message', ?, ?, ?, ?, 'text/plain', 0, 'visible', ?, 0, '', NULL, NULL, ?, ?, NULL, ?)
			`, message.ID, session.ID, message.ParentID, message.Timestamp, message.Role, text,
				message.Model, message.CWD, message.ToolName, source); err != nil {
				return ExternalImportResult{}, fmt.Errorf("insert external message: %w", err)
			}
			result.MessageCount++
			if strings.TrimSpace(message.ToolName) == "" {
				continue
			}
			toolID := message.ID + ":tool"
			inputJSON := "{}"
			if strings.TrimSpace(message.ToolInput) != "" {
				encoded, err := json.Marshal(map[string]string{
					"input": truncateIndexedText(RedactSnippet(message.ToolInput)),
				})
				if err == nil {
					inputJSON = string(encoded)
				}
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT OR REPLACE INTO tool_calls(
					id, message_uuid, session_id, name, presentation, input_json, file_path
				) VALUES (?, ?, ?, ?, 'default', ?, '')
			`, toolID, message.ID, session.ID, message.ToolName, inputJSON); err != nil {
				return ExternalImportResult{}, fmt.Errorf("insert external tool call: %w", err)
			}
			result.ToolCallCount++
			if _, err := tx.ExecContext(ctx, `
				INSERT OR REPLACE INTO tool_results(
					tool_use_id, message_uuid, session_id, content, file_path, is_error
				) VALUES (?, ?, ?, ?, '', ?)
			`, toolID, message.ID, session.ID, text, boolToInt(message.IsError)); err != nil {
				return ExternalImportResult{}, fmt.Errorf("insert external tool result: %w", err)
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO index_state(jsonl_path, mtime, lines_processed, cursor)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(jsonl_path) DO UPDATE SET
			mtime = excluded.mtime,
			lines_processed = excluded.lines_processed,
			cursor = excluded.cursor
	`, absolutePath, float64(info.ModTime().Unix()), result.MessageCount, importedAt); err != nil {
		return ExternalImportResult{}, fmt.Errorf("record external index state: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return ExternalImportResult{}, fmt.Errorf("commit external session import: %w", err)
	}
	return result, nil
}

func clearExternalImport(ctx context.Context, tx *sql.Tx, source, path string) error {
	for _, statement := range []string{
		`DELETE FROM tool_results WHERE session_id IN (SELECT id FROM sessions WHERE source = ? AND jsonl_path = ?)`,
		`DELETE FROM tool_calls WHERE session_id IN (SELECT id FROM sessions WHERE source = ? AND jsonl_path = ?)`,
		`DELETE FROM messages WHERE session_id IN (SELECT id FROM sessions WHERE source = ? AND jsonl_path = ?)`,
		`DELETE FROM sessions WHERE source = ? AND jsonl_path = ?`,
	} {
		if _, err := tx.ExecContext(ctx, statement, source, path); err != nil {
			return fmt.Errorf("clear previous external import: %w", err)
		}
	}
	return nil
}

func readExternalJSONL(path, source string, request ExternalImportRequest) ([]externalSession, int, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, 0, fmt.Errorf("open external history: %w", err)
	}
	defer file.Close()

	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 0, 64*1024), 2*1024*1024)

	pathDigest := digestString(path)[:12]
	byID := make(map[string]*externalSession)
	order := make([]string, 0)
	skipped := 0
	line := 0
	for scanner.Scan() {
		line++
		if request.Limit > 0 && line > request.Limit {
			break
		}
		raw := strings.TrimSpace(scanner.Text())
		if raw == "" {
			continue
		}
		var object map[string]any
		if err := json.Unmarshal([]byte(raw), &object); err != nil {
			skipped++
			continue
		}
		message := externalMessageFromObject(object, line)
		if strings.TrimSpace(message.Text) == "" && strings.TrimSpace(message.ToolInput) == "" {
			skipped++
			continue
		}
		rawSessionID := firstString(object, "session_id", "sessionId", "conversation_id", "conversationId", "thread_id", "threadId")
		if rawSessionID == "" {
			rawSessionID = strings.TrimSuffix(filepath.Base(path), filepath.Ext(path))
		}
		sessionID := "external:" + source + ":" + pathDigest + ":" + slugForID(rawSessionID)
		session := byID[sessionID]
		if session == nil {
			session = &externalSession{
				ID:          sessionID,
				Title:       fallback(firstString(object, "title", "session_title", "conversationTitle"), rawSessionID),
				Project:     fallback(firstString(object, "project"), fallback(request.Project, projectName(request.ProjectPath))),
				ProjectPath: fallback(firstString(object, "project_path", "projectPath", "cwd"), request.ProjectPath),
				StartedAt:   normalizeTimestamp(firstString(object, "started_at", "startedAt", "timestamp", "created_at", "createdAt")),
			}
			byID[sessionID] = session
			order = append(order, sessionID)
		}
		if session.StartedAt == "" {
			session.StartedAt = message.Timestamp
		}
		if session.ProjectPath == "" {
			session.ProjectPath = message.CWD
		}
		if session.Project == "" {
			session.Project = projectName(session.ProjectPath)
		}
		message.ID = "external:" + source + ":" + pathDigest + ":" + slugForID(rawSessionID) + ":" + fallback(message.ID, fmt.Sprintf("line-%d", line))
		if message.CWD == "" {
			message.CWD = session.ProjectPath
		}
		session.Messages = append(session.Messages, message)
	}
	if err := scanner.Err(); err != nil {
		return nil, skipped, fmt.Errorf("scan external history: %w", err)
	}

	sort.Strings(order)
	values := make([]externalSession, 0, len(order))
	for _, id := range order {
		session := byID[id]
		if len(session.Messages) == 0 {
			continue
		}
		sort.SliceStable(session.Messages, func(i, j int) bool {
			return session.Messages[i].Timestamp < session.Messages[j].Timestamp
		})
		values = append(values, *session)
	}
	return values, skipped, nil
}

func externalMessageFromObject(object map[string]any, line int) externalMessage {
	messageObject, _ := object["message"].(map[string]any)
	role := fallback(firstString(object, "role"), firstString(messageObject, "role"))
	if role == "" {
		role = fallback(firstString(object, "type"), "message")
	}
	text := firstString(object, "text", "summary")
	if text == "" {
		text = collectContentText(object["content"])
	}
	if text == "" {
		text = collectContentText(messageObject["content"])
	}
	toolName := firstString(object, "toolName", "tool_name", "name")
	if toolName == "" {
		toolName = firstToolName(object["content"])
	}
	if toolName == "" {
		toolName = firstToolName(messageObject["content"])
	}
	toolInput := firstString(object, "toolInput", "tool_input", "input")
	if toolInput == "" {
		toolInput = collectToolInput(object["content"])
	}
	if toolInput == "" {
		toolInput = collectToolInput(messageObject["content"])
	}
	return externalMessage{
		ID:        slugForID(fallback(firstString(object, "uuid", "id", "message_id", "messageId"), fmt.Sprintf("line-%d", line))),
		ParentID:  firstString(object, "parent_uuid", "parentUuid", "parent_id", "parentId"),
		Timestamp: normalizeTimestamp(firstString(object, "timestamp", "created_at", "createdAt")),
		Role:      normalizeRole(role),
		Text:      fallback(text, toolInput),
		Model:     fallback(firstString(object, "model"), firstString(messageObject, "model")),
		CWD:       firstString(object, "cwd", "project_path", "projectPath"),
		ToolName:  toolName,
		ToolInput: toolInput,
		IsError:   strings.EqualFold(firstString(object, "is_error", "isError", "status"), "error"),
	}
}

func normalizeExternalSource(value string) string {
	source := strings.ToLower(strings.TrimSpace(value))
	switch source {
	case "codex", "claude", "kimi", "pi":
		return source
	default:
		return ""
	}
}

func firstString(object map[string]any, keys ...string) string {
	if object == nil {
		return ""
	}
	for _, key := range keys {
		value, ok := object[key]
		if !ok {
			continue
		}
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return strings.TrimSpace(typed)
			}
		case float64:
			return fmt.Sprintf("%.0f", typed)
		case json.Number:
			return typed.String()
		}
	}
	return ""
}

func collectContentText(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []any:
		parts := make([]string, 0)
		for _, item := range typed {
			if text := collectContentText(item); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		if text := firstString(typed, "text", "content", "summary"); text != "" {
			return text
		}
		if typed["type"] == "tool_use" || typed["type"] == "tool_result" {
			return collectToolInput(typed)
		}
	}
	return ""
}

func firstToolName(value any) string {
	switch typed := value.(type) {
	case []any:
		for _, item := range typed {
			if name := firstToolName(item); name != "" {
				return name
			}
		}
	case map[string]any:
		if typed["type"] == "tool_use" || typed["type"] == "tool_result" {
			return firstString(typed, "name", "toolName", "tool_name")
		}
	}
	return ""
}

func collectToolInput(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case []any:
		parts := make([]string, 0)
		for _, item := range typed {
			if text := collectToolInput(item); text != "" {
				parts = append(parts, text)
			}
		}
		return strings.Join(parts, "\n")
	case map[string]any:
		if input, ok := typed["input"]; ok {
			if data, err := json.Marshal(input); err == nil {
				return string(data)
			}
		}
		return firstString(typed, "toolInput", "tool_input", "result", "content")
	}
	return ""
}

func normalizeTimestamp(value string) string {
	if value == "" {
		return ""
	}
	if parsed, err := time.Parse(time.RFC3339Nano, value); err == nil {
		return parsed.UTC().Format(time.RFC3339Nano)
	}
	if parsed, err := time.Parse(time.RFC3339, value); err == nil {
		return parsed.UTC().Format(time.RFC3339Nano)
	}
	if timestamp, err := strconv.ParseInt(value, 10, 64); err == nil {
		if timestamp > 100_000_000_000 {
			return time.UnixMilli(timestamp).UTC().Format(time.RFC3339Nano)
		}
		if timestamp > 1_000_000_000 {
			return time.Unix(timestamp, 0).UTC().Format(time.RFC3339Nano)
		}
	}
	return value
}

func normalizeRole(value string) string {
	switch strings.ToLower(strings.TrimSpace(value)) {
	case "human":
		return "user"
	case "assistant", "user", "tool", "system":
		return strings.ToLower(strings.TrimSpace(value))
	default:
		return fallback(strings.ToLower(strings.TrimSpace(value)), "message")
	}
}

func slugForID(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return "unknown"
	}
	replacer := strings.NewReplacer("/", "-", "\\", "-", " ", "-", ":", "-", "\t", "-")
	value = replacer.Replace(value)
	var builder strings.Builder
	for _, r := range value {
		if r >= 'a' && r <= 'z' || r >= 'A' && r <= 'Z' || r >= '0' && r <= '9' || r == '-' || r == '_' || r == '.' {
			builder.WriteRune(r)
		}
	}
	slug := strings.Trim(builder.String(), "-_.")
	if slug == "" {
		return digestString(value)[:12]
	}
	if len(slug) > 96 {
		return slug[:96]
	}
	return slug
}

func digestString(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:])
}
