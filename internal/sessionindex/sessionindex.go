package sessionindex

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/conversation"
	_ "modernc.org/sqlite"
)

const (
	// FactBoundary is intentionally for internal API/agent semantics, not for
	// ordinary UI copy. The product surface should say "相关历史", not explain
	// epistemology to the user.
	FactBoundary = "Obelisk 结果只是历史线索；CTF Judge/Evidence、CVE source snapshots、Coding tests/commits/screenshots 才能成为 MilkSU 正式档案。"

	sourcePrefix = "milksu"
)

type Store struct {
	Path string
	Now  func() time.Time
}

type RefreshResult struct {
	IndexedAt     string `json:"indexedAt"`
	IndexPath     string `json:"indexPath"`
	Source        string `json:"source"`
	SessionCount  int    `json:"sessionCount"`
	MessageCount  int    `json:"messageCount"`
	ToolCallCount int    `json:"toolCallCount"`
}

type Status struct {
	Available     bool          `json:"available"`
	Mode          string        `json:"mode"`
	IndexPath     string        `json:"indexPath"`
	CheckedAt     string        `json:"checkedAt"`
	ReadOnly      bool          `json:"readOnly"`
	Reason        string        `json:"reason,omitempty"`
	SessionCount  int64         `json:"sessionCount"`
	MessageCount  int64         `json:"messageCount"`
	ToolCallCount int64         `json:"toolCallCount"`
	MemoryCount   int64         `json:"memoryCount"`
	Sources       []SourceCount `json:"sources"`
	FactBoundary  string        `json:"factBoundary"`
}

type SourceCount struct {
	Source string `json:"source"`
	Count  int64  `json:"count"`
}

type SearchRequest struct {
	Query   string `json:"query"`
	Limit   int    `json:"limit,omitempty"`
	Project string `json:"project,omitempty"`
	Source  string `json:"source,omitempty"`
	Module  string `json:"module,omitempty"`
}

type SearchResponse struct {
	Query        string         `json:"query"`
	SearchedAt   string         `json:"searchedAt"`
	Status       Status         `json:"status"`
	Results      []SearchResult `json:"results"`
	FactBoundary string         `json:"factBoundary"`
}

type SearchResult struct {
	MessageUUID string  `json:"messageUuid"`
	SessionID   string  `json:"sessionId"`
	SessionName string  `json:"sessionName"`
	Project     string  `json:"project,omitempty"`
	ProjectPath string  `json:"projectPath,omitempty"`
	Source      string  `json:"source,omitempty"`
	Role        string  `json:"role,omitempty"`
	Model       string  `json:"model,omitempty"`
	CWD         string  `json:"cwd,omitempty"`
	Skill       string  `json:"skill,omitempty"`
	Timestamp   string  `json:"timestamp,omitempty"`
	Snippet     string  `json:"snippet"`
	Score       float64 `json:"score,omitempty"`
}

func NewStore(path string) (*Store, error) {
	store := &Store{
		Path: path,
		Now:  time.Now,
	}
	if err := store.Ensure(context.Background()); err != nil {
		return nil, err
	}
	return store, nil
}

func (s Store) Ensure(ctx context.Context) error {
	if strings.TrimSpace(s.Path) == "" {
		return fmt.Errorf("session index path is required")
	}
	if err := os.MkdirAll(filepath.Dir(s.Path), 0o700); err != nil {
		return fmt.Errorf("create session index directory: %w", err)
	}
	db, err := sql.Open("sqlite", s.Path)
	if err != nil {
		return fmt.Errorf("open session index: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)
	if _, err := db.ExecContext(ctx, `PRAGMA foreign_keys = ON`); err != nil {
		return fmt.Errorf("configure session index: %w", err)
	}
	for _, statement := range schemaStatements {
		if _, err := db.ExecContext(ctx, statement); err != nil {
			return fmt.Errorf("initialize session index schema: %w", err)
		}
	}
	if err := os.Chmod(s.Path, 0o600); err != nil {
		return fmt.Errorf("tighten session index permissions: %w", err)
	}
	return nil
}

func (s Store) Status(ctx context.Context) (Status, error) {
	now := s.now()
	status := Status{
		Mode:         "milksu-obelisk-core",
		IndexPath:    s.Path,
		CheckedAt:    now.Format(time.RFC3339Nano),
		ReadOnly:     true,
		FactBoundary: FactBoundary,
	}
	if strings.TrimSpace(s.Path) == "" {
		status.Reason = "Session Index 路径尚未配置。"
		return status, nil
	}
	info, err := os.Stat(s.Path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			status.Reason = "Session Index 尚未初始化。"
			return status, nil
		}
		return status, fmt.Errorf("inspect session index: %w", err)
	}
	if info.IsDir() {
		status.Reason = "Session Index 路径是目录，不是 sqlite 文件。"
		return status, nil
	}

	db, err := openReadOnly(s.Path)
	if err != nil {
		status.Reason = "无法以只读方式打开 Session Index。"
		return status, nil
	}
	defer db.Close()

	if err := db.PingContext(ctx); err != nil {
		status.Reason = "Session Index 不可读。"
		return status, nil
	}
	s.populateCounts(ctx, db, &status)
	status.Available = tableExists(ctx, db, "sessions") && tableExists(ctx, db, "messages")
	if !status.Available && status.Reason == "" {
		status.Reason = "Session Index 缺少 sessions/messages 表。"
	}
	return status, nil
}

func (s Store) RefreshMilkSUConversations(ctx context.Context, values []conversation.StoredConversation) (RefreshResult, error) {
	if err := s.Ensure(ctx); err != nil {
		return RefreshResult{}, err
	}
	db, err := sql.Open("sqlite", s.Path)
	if err != nil {
		return RefreshResult{}, fmt.Errorf("open session index for refresh: %w", err)
	}
	defer db.Close()
	db.SetMaxOpenConns(1)

	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return RefreshResult{}, fmt.Errorf("begin session index refresh: %w", err)
	}
	defer tx.Rollback()

	for _, statement := range []string{
		`DELETE FROM tool_results WHERE session_id LIKE 'milksu:%'`,
		`DELETE FROM tool_calls WHERE session_id LIKE 'milksu:%'`,
		`DELETE FROM messages WHERE session_id LIKE 'milksu:%'`,
		`DELETE FROM sessions WHERE id LIKE 'milksu:%'`,
	} {
		if _, err := tx.ExecContext(ctx, statement); err != nil {
			return RefreshResult{}, fmt.Errorf("clear MilkSU session index: %w", err)
		}
	}

	indexedAt := s.now().Format(time.RFC3339Nano)
	result := RefreshResult{
		IndexedAt: indexedAt,
		IndexPath: s.Path,
		Source:    sourcePrefix,
	}
	for _, value := range values {
		sessionID := "milksu:" + value.ID
		source := sessionSource(value)
		project := projectName(value.WorkspacePath)
		startedAt := timestampToRFC3339(value.CreatedAt)
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO sessions(
				id, title, project, project_path, started_at, ended_at, git_branch,
				version, message_count, jsonl_path, source
			) VALUES (?, ?, ?, ?, ?, '', '', '', ?, '', ?)
		`, sessionID, fallback(value.Title, "MilkSU 会话"), project, value.WorkspacePath, startedAt,
			len(value.Messages), source); err != nil {
			return RefreshResult{}, fmt.Errorf("insert indexed session: %w", err)
		}
		result.SessionCount++
		for _, message := range value.Messages {
			messageID := "milksu:" + value.ID + ":" + message.ID
			text := truncateIndexedText(RedactSnippet(message.Content))
			skill := ""
			if message.ToolName != nil {
				skill = *message.ToolName
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT INTO messages(
					uuid, session_id, type, parent_uuid, timestamp, role, text,
					content_type, is_meta, visibility, model, is_sidechain, agent_id,
					input_tokens, output_tokens, cwd, skill, turn_duration_ms, source
				) VALUES (?, ?, ?, '', ?, ?, ?, 'text/plain', 0, 'visible', ?, 0, '', NULL, NULL, ?, ?, ?, ?)
			`, messageID, sessionID, message.Role, timestampToRFC3339(message.Timestamp),
				message.Role, text, value.ModelID, value.WorkspacePath, skill, durationMS(message), source); err != nil {
				return RefreshResult{}, fmt.Errorf("insert indexed message: %w", err)
			}
			result.MessageCount++
			if message.ToolName == nil {
				continue
			}
			toolID := "milksu:" + value.ID + ":tool:" + message.ID
			if message.ToolCallID != nil && strings.TrimSpace(*message.ToolCallID) != "" {
				toolID = "milksu:" + value.ID + ":tool:" + *message.ToolCallID
			}
			inputJSON := "{}"
			if message.ApprovalInput != nil && strings.TrimSpace(*message.ApprovalInput) != "" {
				encoded, err := json.Marshal(map[string]string{
					"approvalInput": truncateIndexedText(RedactSnippet(*message.ApprovalInput)),
				})
				if err == nil {
					inputJSON = string(encoded)
				}
			}
			if _, err := tx.ExecContext(ctx, `
				INSERT OR REPLACE INTO tool_calls(
					id, message_uuid, session_id, name, presentation, input_json, file_path
				) VALUES (?, ?, ?, ?, 'default', ?, '')
			`, toolID, messageID, sessionID, *message.ToolName, inputJSON); err != nil {
				return RefreshResult{}, fmt.Errorf("insert indexed tool call: %w", err)
			}
			result.ToolCallCount++
			if message.Role == "tool" {
				if _, err := tx.ExecContext(ctx, `
					INSERT OR REPLACE INTO tool_results(
						tool_use_id, message_uuid, session_id, content, file_path, is_error
					) VALUES (?, ?, ?, ?, '', ?)
				`, toolID, messageID, sessionID, text, boolToInt(message.Status != nil && *message.Status == "error")); err != nil {
					return RefreshResult{}, fmt.Errorf("insert indexed tool result: %w", err)
				}
			}
		}
	}
	if _, err := tx.ExecContext(ctx, `
		INSERT INTO index_state(jsonl_path, mtime, lines_processed, cursor)
		VALUES ('milksu:conversations', ?, ?, ?)
		ON CONFLICT(jsonl_path) DO UPDATE SET
			mtime = excluded.mtime,
			lines_processed = excluded.lines_processed,
			cursor = excluded.cursor
	`, float64(s.now().Unix()), result.MessageCount, indexedAt); err != nil {
		return RefreshResult{}, fmt.Errorf("record session index state: %w", err)
	}
	if err := tx.Commit(); err != nil {
		return RefreshResult{}, fmt.Errorf("commit session index refresh: %w", err)
	}
	return result, nil
}

func (s Store) Search(ctx context.Context, request SearchRequest) (SearchResponse, error) {
	now := s.now()
	query := normalizeSpace(request.Query)
	if query == "" {
		return SearchResponse{}, fmt.Errorf("history search query is required")
	}
	limit := clampLimit(request.Limit)
	status, err := s.Status(ctx)
	if err != nil {
		return SearchResponse{}, err
	}
	response := SearchResponse{
		Query:        query,
		SearchedAt:   now.Format(time.RFC3339Nano),
		Status:       status,
		FactBoundary: FactBoundary,
	}
	if !status.Available {
		return response, nil
	}
	db, err := openReadOnly(s.Path)
	if err != nil {
		return SearchResponse{}, fmt.Errorf("open session index: %w", err)
	}
	defer db.Close()

	results, err := searchFTS(ctx, db, query, request, limit)
	if err != nil || len(results) == 0 {
		fallback, fallbackErr := searchLike(ctx, db, query, request, limit)
		if fallbackErr != nil {
			if err != nil {
				return SearchResponse{}, fmt.Errorf("search session index: %w; fallback: %v", err, fallbackErr)
			}
			return SearchResponse{}, fmt.Errorf("search session index fallback: %w", fallbackErr)
		}
		results = fallback
	}
	response.Results = results
	return response, nil
}

func (s Store) now() time.Time {
	if s.Now != nil {
		return s.Now().UTC()
	}
	return time.Now().UTC()
}

func (s Store) populateCounts(ctx context.Context, db *sql.DB, status *Status) {
	status.SessionCount = countTable(ctx, db, "sessions")
	status.MessageCount = countTable(ctx, db, "messages")
	status.ToolCallCount = countTable(ctx, db, "tool_calls")
	status.MemoryCount = countTable(ctx, db, "memories")
	status.Sources = sourceCounts(ctx, db)
}

func openReadOnly(path string) (*sql.DB, error) {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return nil, err
	}
	uri := url.URL{Scheme: "file", Path: absolute}
	query := uri.Query()
	query.Set("mode", "ro")
	uri.RawQuery = query.Encode()
	db, err := sql.Open("sqlite", uri.String())
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

func tableExists(ctx context.Context, db *sql.DB, name string) bool {
	var count int
	err := db.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = ?
	`, name).Scan(&count)
	return err == nil && count > 0
}

func countTable(ctx context.Context, db *sql.DB, name string) int64 {
	if !tableExists(ctx, db, name) {
		return 0
	}
	var count int64
	if err := db.QueryRowContext(ctx, `SELECT COUNT(*) FROM `+safeTable(name)).Scan(&count); err != nil {
		return 0
	}
	return count
}

func sourceCounts(ctx context.Context, db *sql.DB) []SourceCount {
	if !tableExists(ctx, db, "sessions") {
		return nil
	}
	rows, err := db.QueryContext(ctx, `
		SELECT COALESCE(NULLIF(source, ''), 'unknown') AS source, COUNT(*)
		FROM sessions
		GROUP BY COALESCE(NULLIF(source, ''), 'unknown')
		ORDER BY source
	`)
	if err != nil {
		return nil
	}
	defer rows.Close()

	values := make([]SourceCount, 0)
	for rows.Next() {
		var value SourceCount
		if err := rows.Scan(&value.Source, &value.Count); err == nil {
			values = append(values, value)
		}
	}
	return values
}

func searchFTS(ctx context.Context, db *sql.DB, query string, request SearchRequest, limit int) ([]SearchResult, error) {
	if !tableExists(ctx, db, "messages_fts") {
		return nil, fmt.Errorf("messages_fts table is unavailable")
	}
	source := requestSource(request)
	rows, err := db.QueryContext(ctx, `
		SELECT
			m.uuid,
			m.session_id,
			COALESCE(s.title, ''),
			COALESCE(s.project, ''),
			COALESCE(s.project_path, ''),
			COALESCE(NULLIF(m.source, ''), NULLIF(s.source, ''), ''),
			COALESCE(m.role, ''),
			COALESCE(m.model, ''),
			COALESCE(m.cwd, ''),
			COALESCE(m.skill, ''),
			COALESCE(m.timestamp, ''),
			COALESCE(m.text, ''),
			bm25(messages_fts) AS score
		FROM messages_fts
		JOIN messages m ON m.rowid = messages_fts.rowid
		LEFT JOIN sessions s ON s.id = m.session_id
		WHERE messages_fts MATCH ?
			AND COALESCE(m.visibility, 'visible') != 'hidden'
			AND (? = '' OR COALESCE(s.project, '') LIKE ? OR COALESCE(s.project_path, '') LIKE ? OR COALESCE(m.cwd, '') LIKE ?)
			AND (? = '' OR COALESCE(NULLIF(m.source, ''), NULLIF(s.source, ''), '') = ?)
		ORDER BY score ASC, COALESCE(m.timestamp, '') DESC
		LIMIT ?
	`, ftsPhrase(query), strings.TrimSpace(request.Project), likeContains(request.Project), likeContains(request.Project), likeContains(request.Project),
		source, source, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanResults(rows, query)
}

func searchLike(ctx context.Context, db *sql.DB, query string, request SearchRequest, limit int) ([]SearchResult, error) {
	source := requestSource(request)
	rows, err := db.QueryContext(ctx, `
		SELECT
			m.uuid,
			m.session_id,
			COALESCE(s.title, ''),
			COALESCE(s.project, ''),
			COALESCE(s.project_path, ''),
			COALESCE(NULLIF(m.source, ''), NULLIF(s.source, ''), ''),
			COALESCE(m.role, ''),
			COALESCE(m.model, ''),
			COALESCE(m.cwd, ''),
			COALESCE(m.skill, ''),
			COALESCE(m.timestamp, ''),
			COALESCE(m.text, ''),
			0.0 AS score
		FROM messages m
		LEFT JOIN sessions s ON s.id = m.session_id
		WHERE COALESCE(m.text, '') LIKE ? ESCAPE '\'
			AND COALESCE(m.visibility, 'visible') != 'hidden'
			AND (? = '' OR COALESCE(s.project, '') LIKE ? OR COALESCE(s.project_path, '') LIKE ? OR COALESCE(m.cwd, '') LIKE ?)
			AND (? = '' OR COALESCE(NULLIF(m.source, ''), NULLIF(s.source, ''), '') = ?)
		ORDER BY COALESCE(m.timestamp, '') DESC
		LIMIT ?
	`, likeContains(query), strings.TrimSpace(request.Project), likeContains(request.Project), likeContains(request.Project), likeContains(request.Project),
		source, source, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanResults(rows, query)
}

func scanResults(rows *sql.Rows, query string) ([]SearchResult, error) {
	values := make([]SearchResult, 0)
	for rows.Next() {
		var value SearchResult
		var text string
		if err := rows.Scan(
			&value.MessageUUID,
			&value.SessionID,
			&value.SessionName,
			&value.Project,
			&value.ProjectPath,
			&value.Source,
			&value.Role,
			&value.Model,
			&value.CWD,
			&value.Skill,
			&value.Timestamp,
			&text,
			&value.Score,
		); err != nil {
			return nil, err
		}
		value.SessionName = fallback(value.SessionName, value.SessionID)
		value.Snippet = RedactSnippet(extractSnippet(text, query, 520))
		values = append(values, value)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	sort.SliceStable(values, func(i, j int) bool {
		if values[i].Score != values[j].Score {
			return values[i].Score < values[j].Score
		}
		return values[i].Timestamp > values[j].Timestamp
	})
	return values, nil
}

func clampLimit(value int) int {
	if value <= 0 {
		return 6
	}
	if value > 20 {
		return 20
	}
	return value
}

func ftsPhrase(query string) string {
	return `"` + strings.ReplaceAll(query, `"`, `""`) + `"`
}

func likeContains(query string) string {
	query = strings.ReplaceAll(query, `\`, `\\`)
	query = strings.ReplaceAll(query, `%`, `\%`)
	query = strings.ReplaceAll(query, `_`, `\_`)
	return "%" + query + "%"
}

func safeTable(name string) string {
	switch name {
	case "sessions", "messages", "tool_calls", "tool_results", "memories":
		return name
	default:
		panic("unsafe sqlite table name")
	}
}

func requestSource(request SearchRequest) string {
	if source := strings.TrimSpace(request.Source); source != "" {
		return source
	}
	switch strings.ToLower(strings.TrimSpace(request.Module)) {
	case "coding":
		return "milksu-coding"
	case "ctf":
		return "milksu-ctf"
	case "cve", "vuln", "vulnerability":
		return "milksu-cve"
	default:
		return ""
	}
}

func normalizeSpace(value string) string {
	return strings.Join(strings.Fields(value), " ")
}

func fallback(value, fallbackValue string) string {
	if strings.TrimSpace(value) != "" {
		return value
	}
	return fallbackValue
}

func extractSnippet(text, query string, maxRunes int) string {
	text = normalizeVisibleText(text)
	if text == "" {
		return ""
	}
	lowerText := strings.ToLower(text)
	lowerQuery := strings.ToLower(query)
	index := strings.Index(lowerText, lowerQuery)
	if index < 0 {
		return trimRunes(text, maxRunes)
	}
	start := index
	for prefixRunes := 0; start > 0 && prefixRunes < maxRunes/3; prefixRunes++ {
		_, size := utf8.DecodeLastRuneInString(text[:start])
		if size <= 0 {
			break
		}
		start -= size
	}
	end := index + len(query)
	for suffixRunes := 0; end < len(text) && suffixRunes < maxRunes*2/3; suffixRunes++ {
		_, size := utf8.DecodeRuneInString(text[end:])
		if size <= 0 {
			break
		}
		end += size
	}
	snippet := strings.TrimSpace(text[start:end])
	if start > 0 {
		snippet = "…" + snippet
	}
	if end < len(text) {
		snippet += "…"
	}
	return snippet
}

func normalizeVisibleText(value string) string {
	value = strings.Map(func(r rune) rune {
		if r == '\n' || r == '\r' || r == '\t' {
			return ' '
		}
		if unicode.IsControl(r) {
			return -1
		}
		return r
	}, value)
	return normalizeSpace(value)
}

func trimRunes(value string, limit int) string {
	runes := []rune(value)
	if len(runes) <= limit {
		return value
	}
	return strings.TrimSpace(string(runes[:limit])) + "…"
}

func truncateIndexedText(value string) string {
	return trimRunes(normalizeVisibleText(value), 20000)
}

func timestampToRFC3339(value uint64) string {
	if value == 0 {
		return ""
	}
	if value > 100_000_000_000 {
		return time.UnixMilli(int64(value)).UTC().Format(time.RFC3339Nano)
	}
	return time.Unix(int64(value), 0).UTC().Format(time.RFC3339Nano)
}

func projectName(workspacePath string) string {
	if strings.TrimSpace(workspacePath) == "" {
		return "MilkSU"
	}
	name := filepath.Base(workspacePath)
	if strings.TrimSpace(name) == "" || name == "." || name == string(filepath.Separator) {
		return "MilkSU"
	}
	return name
}

var cveIDPattern = regexp.MustCompile(`(?i)\bCVE-\d{4}-\d{4,}\b`)

func sessionSource(value conversation.StoredConversation) string {
	if strings.TrimSpace(value.CTFJobID) != "" {
		return "milksu-ctf"
	}
	if cveIDPattern.MatchString(value.Title) {
		return "milksu-cve"
	}
	for index, message := range value.Messages {
		if index >= 8 {
			break
		}
		if cveIDPattern.MatchString(message.Content) {
			return "milksu-cve"
		}
	}
	return "milksu-coding"
}

func durationMS(message conversation.StoredMessage) any {
	if message.DurationMS == nil {
		return nil
	}
	return *message.DurationMS
}

func boolToInt(value bool) int {
	if value {
		return 1
	}
	return 0
}

var credentialPatterns = []*regexp.Regexp{
	regexp.MustCompile(`(?i)\bBearer\s+[A-Za-z0-9._~+/=-]{10,}`),
	regexp.MustCompile(`\bsk-[A-Za-z0-9_-]{10,}\b`),
	regexp.MustCompile(`\bsess-[A-Za-z0-9_-]{10,}\b`),
	regexp.MustCompile(`(?i)\b(?:OPENAI|KIMI|MOONSHOT|ANTHROPIC|DEEPSEEK|GEMINI|DASHSCOPE|VOLCENGINE)?_?API_KEY\s*[:=]\s*["']?[^"'\s,;]+`),
	regexp.MustCompile(`(?i)([?&](?:api_key|apikey|access_token|token|secret|key)=)[^&#\s]+`),
	regexp.MustCompile(`(?i)\b(x-api-key|api-key|authorization)\s*[:=]\s*["']?[^"'\s,;]+`),
}

func RedactSnippet(value string) string {
	for _, pattern := range credentialPatterns {
		value = pattern.ReplaceAllStringFunc(value, func(match string) string {
			if strings.Contains(match, "?") || strings.Contains(match, "&") {
				submatches := pattern.FindStringSubmatch(match)
				if len(submatches) > 1 {
					return submatches[1] + "[credential redacted]"
				}
			}
			if strings.Contains(match, "=") {
				parts := strings.SplitN(match, "=", 2)
				return strings.TrimSpace(parts[0]) + "=[credential redacted]"
			}
			if strings.Contains(match, ":") && !strings.HasPrefix(strings.ToLower(match), "http") {
				parts := strings.SplitN(match, ":", 2)
				return strings.TrimSpace(parts[0]) + ": [credential redacted]"
			}
			return "[credential redacted]"
		})
	}
	return value
}

var schemaStatements = []string{
	`CREATE TABLE IF NOT EXISTS sessions (
		id TEXT PRIMARY KEY,
		title TEXT,
		project TEXT,
		project_path TEXT,
		started_at TEXT,
		ended_at TEXT,
		git_branch TEXT,
		version TEXT,
		message_count INTEGER DEFAULT 0,
		jsonl_path TEXT,
		source TEXT DEFAULT 'milksu'
	)`,
	`CREATE TABLE IF NOT EXISTS messages (
		uuid TEXT PRIMARY KEY,
		session_id TEXT,
		type TEXT,
		parent_uuid TEXT,
		timestamp TEXT,
		role TEXT,
		text TEXT,
		content_type TEXT,
		is_meta INTEGER DEFAULT 0,
		visibility TEXT DEFAULT 'visible',
		model TEXT,
		is_sidechain INTEGER DEFAULT 0,
		agent_id TEXT,
		input_tokens INTEGER,
		output_tokens INTEGER,
		cwd TEXT,
		skill TEXT,
		turn_duration_ms INTEGER,
		source TEXT DEFAULT 'milksu'
	)`,
	`CREATE TABLE IF NOT EXISTS tool_calls (
		id TEXT PRIMARY KEY,
		message_uuid TEXT,
		session_id TEXT,
		name TEXT,
		presentation TEXT DEFAULT 'default',
		input_json TEXT,
		file_path TEXT
	)`,
	`CREATE TABLE IF NOT EXISTS tool_results (
		tool_use_id TEXT PRIMARY KEY,
		message_uuid TEXT,
		session_id TEXT,
		content TEXT,
		file_path TEXT,
		is_error INTEGER DEFAULT 0
	)`,
	`CREATE TABLE IF NOT EXISTS subagents (
		agent_id TEXT PRIMARY KEY,
		session_id TEXT,
		parent_tool_use_id TEXT,
		agent_type TEXT,
		description TEXT,
		duration_ms INTEGER,
		total_tokens INTEGER
	)`,
	`CREATE TABLE IF NOT EXISTS workflows (
		run_id TEXT PRIMARY KEY,
		session_id TEXT,
		parent_tool_use_id TEXT,
		task_id TEXT,
		script TEXT,
		result_json TEXT,
		timestamp TEXT,
		agent_count INTEGER DEFAULT 0,
		duration_ms INTEGER,
		total_tokens INTEGER,
		status TEXT,
		workflow_name TEXT
	)`,
	`CREATE TABLE IF NOT EXISTS workflow_agents (
		agent_id TEXT PRIMARY KEY,
		run_id TEXT,
		session_id TEXT,
		agent_type TEXT,
		description TEXT,
		phase TEXT,
		label TEXT,
		model TEXT,
		state TEXT,
		duration_ms INTEGER,
		tokens INTEGER,
		tool_calls INTEGER
	)`,
	`CREATE TABLE IF NOT EXISTS index_state (
		jsonl_path TEXT PRIMARY KEY,
		mtime REAL,
		lines_processed INTEGER,
		cursor TEXT
	)`,
	`CREATE TABLE IF NOT EXISTS summaries (
		id TEXT PRIMARY KEY,
		session_id TEXT,
		timestamp TEXT,
		source TEXT,
		content TEXT,
		visibility TEXT DEFAULT 'visible',
		input_tokens INTEGER,
		output_tokens INTEGER
	)`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
		uuid UNINDEXED,
		session_id UNINDEXED,
		text,
		content=messages,
		content_rowid=rowid
	)`,
	`CREATE TRIGGER IF NOT EXISTS messages_fts_ai AFTER INSERT ON messages BEGIN
		INSERT INTO messages_fts(rowid, uuid, session_id, text)
		VALUES (new.rowid, new.uuid, new.session_id, new.text);
	END`,
	`CREATE TRIGGER IF NOT EXISTS messages_fts_ad AFTER DELETE ON messages BEGIN
		INSERT INTO messages_fts(messages_fts, rowid, uuid, session_id, text)
		VALUES ('delete', old.rowid, old.uuid, old.session_id, old.text);
	END`,
	`CREATE TRIGGER IF NOT EXISTS messages_fts_au AFTER UPDATE ON messages BEGIN
		INSERT INTO messages_fts(messages_fts, rowid, uuid, session_id, text)
		VALUES ('delete', old.rowid, old.uuid, old.session_id, old.text);
		INSERT INTO messages_fts(rowid, uuid, session_id, text)
		VALUES (new.rowid, new.uuid, new.session_id, new.text);
	END`,
	`CREATE INDEX IF NOT EXISTS idx_messages_session ON messages(session_id)`,
	`CREATE INDEX IF NOT EXISTS idx_messages_agent ON messages(agent_id)`,
	`CREATE INDEX IF NOT EXISTS idx_messages_ts ON messages(session_id, timestamp)`,
	`CREATE INDEX IF NOT EXISTS idx_sessions_source ON sessions(source)`,
	`CREATE INDEX IF NOT EXISTS idx_messages_source ON messages(source)`,
	`CREATE INDEX IF NOT EXISTS idx_tc_session_name ON tool_calls(session_id, name)`,
	`CREATE INDEX IF NOT EXISTS idx_tc_message ON tool_calls(message_uuid)`,
	`CREATE INDEX IF NOT EXISTS idx_tc_file ON tool_calls(file_path)`,
	`CREATE INDEX IF NOT EXISTS idx_tr_session ON tool_results(session_id)`,
	`CREATE INDEX IF NOT EXISTS idx_tr_message ON tool_results(message_uuid)`,
	`CREATE INDEX IF NOT EXISTS idx_sa_session ON subagents(session_id)`,
	`CREATE INDEX IF NOT EXISTS idx_wf_session ON workflows(session_id)`,
	`CREATE INDEX IF NOT EXISTS idx_wa_run ON workflow_agents(run_id)`,
	`CREATE INDEX IF NOT EXISTS idx_summaries_session ON summaries(session_id)`,
	`CREATE TABLE IF NOT EXISTS memories (
		id TEXT PRIMARY KEY,
		session_id TEXT,
		project TEXT,
		message_start TEXT,
		message_end TEXT,
		path TEXT,
		anchors TEXT,
		summary TEXT,
		created_at TEXT,
		deleted_at TEXT,
		deleted_reason TEXT
	)`,
	`CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
		id UNINDEXED,
		path,
		summary,
		content=memories,
		content_rowid=rowid,
		tokenize='unicode61 remove_diacritics 1'
	)`,
	`CREATE TRIGGER IF NOT EXISTS memories_fts_ai AFTER INSERT ON memories BEGIN
		INSERT INTO memories_fts(rowid, id, path, summary)
		VALUES (new.rowid, new.id, new.path, new.summary);
	END`,
	`CREATE TRIGGER IF NOT EXISTS memories_fts_ad AFTER DELETE ON memories BEGIN
		INSERT INTO memories_fts(memories_fts, rowid, id, path, summary)
		VALUES ('delete', old.rowid, old.id, old.path, old.summary);
	END`,
	`CREATE TRIGGER IF NOT EXISTS memories_fts_au AFTER UPDATE ON memories BEGIN
		INSERT INTO memories_fts(memories_fts, rowid, id, path, summary)
		VALUES ('delete', old.rowid, old.id, old.path, old.summary);
		INSERT INTO memories_fts(rowid, id, path, summary)
		VALUES (new.rowid, new.id, new.path, new.summary);
	END`,
	`CREATE INDEX IF NOT EXISTS idx_memories_project ON memories(project)`,
	`CREATE INDEX IF NOT EXISTS idx_memories_session ON memories(session_id)`,
	`CREATE INDEX IF NOT EXISTS idx_memories_created ON memories(created_at)`,
}
