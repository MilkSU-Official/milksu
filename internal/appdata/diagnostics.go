package appdata

import (
	"archive/zip"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"runtime"
	"runtime/debug"
	"slices"
	"strings"
	"sync"
	"time"
)

const DiagnosticsSchema = "milksu-diagnostics/v1"

var diagnosticDatabasePaths = []string{
	"credentials.db",
	filepath.Join("ctf", "memory.sqlite3"),
	filepath.Join("nssctf", "catalog.sqlite3"),
	filepath.Join("ctfshow", "catalog.sqlite3"),
	filepath.Join("runtime", "events.sqlite3"),
}

var (
	diagnosticCredentialPattern = regexp.MustCompile(
		`(?i)\b(?:sk[-_]|nss_agent_)[a-z0-9._-]{8,}`,
	)
	diagnosticBearerPattern = regexp.MustCompile(
		`(?i)(bearer\s+)[a-z0-9._~+/=-]{8,}`,
	)
	diagnosticAssignmentPattern = regexp.MustCompile(
		`(?i)\b(api[_ -]?key|token|secret|password)\s*[:=]\s*[^\s,;]+`,
	)
	diagnosticQueryPattern = regexp.MustCompile(
		`(?i)([?&](?:api[_-]?key|token|secret|password)=)[^&#\s]+`,
	)
)

type DiagnosticEvent struct {
	Timestamp string `json:"timestamp"`
	Category  string `json:"category"`
	Level     string `json:"level"`
	Message   string `json:"message"`
}

type DiagnosticRecorder struct {
	mu      sync.Mutex
	limit   int
	entries []DiagnosticEvent
}

func NewDiagnosticRecorder(limit int) *DiagnosticRecorder {
	if limit <= 0 {
		limit = 256
	}
	return &DiagnosticRecorder{limit: limit}
}

func (recorder *DiagnosticRecorder) Record(category, level, message string) {
	if recorder == nil {
		return
	}
	message = sanitizeDiagnosticText(message)
	if message == "" {
		return
	}
	entry := DiagnosticEvent{
		Timestamp: time.Now().UTC().Format(time.RFC3339Nano),
		Category:  cleanDiagnosticLabel(category, "app"),
		Level:     cleanDiagnosticLabel(level, "info"),
		Message:   message,
	}
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	recorder.entries = append(recorder.entries, entry)
	if overflow := len(recorder.entries) - recorder.limit; overflow > 0 {
		recorder.entries = slices.Clone(recorder.entries[overflow:])
	}
}

func (recorder *DiagnosticRecorder) Snapshot() []DiagnosticEvent {
	if recorder == nil {
		return nil
	}
	recorder.mu.Lock()
	defer recorder.mu.Unlock()
	return slices.Clone(recorder.entries)
}

type DiagnosticRuntime struct {
	DefaultEngine       string `json:"defaultEngine"`
	Running             bool   `json:"running"`
	SessionCount        int    `json:"sessionCount"`
	Protocol            string `json:"protocol"`
	BackgroundTaskCount int    `json:"backgroundTaskCount"`
}

type DiagnosticSettings struct {
	ActiveProvider     string   `json:"activeProvider"`
	ActiveModel        string   `json:"activeModel"`
	DefaultMode        string   `json:"defaultMode"`
	RelayEnabled       bool     `json:"relayEnabled"`
	ModelVerified      bool     `json:"modelVerified"`
	ConfiguredProvider []string `json:"configuredProviders"`
	ArenaTokenPresent  bool     `json:"arenaTokenPresent"`
}

type DiagnosticInput struct {
	AppVersion string             `json:"appVersion"`
	Runtime    DiagnosticRuntime  `json:"runtime"`
	Settings   DiagnosticSettings `json:"settings"`
	Events     []DiagnosticEvent  `json:"events,omitempty"`
}

type DiagnosticDatabase struct {
	Path       string `json:"path"`
	Exists     bool   `json:"exists"`
	Bytes      int64  `json:"bytes,omitempty"`
	QuickCheck string `json:"quickCheck,omitempty"`
	Error      string `json:"error,omitempty"`
}

type DiagnosticPlatform struct {
	OS        string `json:"os"`
	Arch      string `json:"arch"`
	GoVersion string `json:"goVersion"`
	GoModule  string `json:"goModule,omitempty"`
}

type DiagnosticReport struct {
	Schema       string               `json:"schema"`
	GeneratedAt  string               `json:"generatedAt"`
	AppVersion   string               `json:"appVersion"`
	Platform     DiagnosticPlatform   `json:"platform"`
	Data         DataStatus           `json:"data"`
	Runtime      DiagnosticRuntime    `json:"runtime"`
	Settings     DiagnosticSettings   `json:"settings"`
	Databases    []DiagnosticDatabase `json:"databases"`
	RecentEvents []DiagnosticEvent    `json:"recentEvents,omitempty"`
	Privacy      []string             `json:"privacy"`
}

type DiagnosticExport struct {
	Path        string `json:"path"`
	GeneratedAt string `json:"generatedAt"`
	Bytes       int64  `json:"bytes"`
	EventCount  int    `json:"eventCount"`
	Cancelled   bool   `json:"cancelled,omitempty"`
}

func ExportDiagnostics(
	ctx context.Context,
	root,
	destination string,
	input DiagnosticInput,
) (DiagnosticExport, error) {
	root, err := secureRoot(root)
	if err != nil {
		return DiagnosticExport{}, err
	}
	destination, err = secureDestination(root, destination)
	if err != nil {
		return DiagnosticExport{}, err
	}
	if err := os.MkdirAll(filepath.Dir(destination), 0o700); err != nil {
		return DiagnosticExport{}, fmt.Errorf("create diagnostic destination: %w", err)
	}

	status, err := Inspect(root)
	if err != nil {
		return DiagnosticExport{}, err
	}
	status.Directory = filepath.Join("<user-data>", filepath.Base(root))
	report := DiagnosticReport{
		Schema:       DiagnosticsSchema,
		GeneratedAt:  time.Now().UTC().Format(time.RFC3339),
		AppVersion:   cleanDiagnosticLabel(input.AppVersion, "development"),
		Platform:     diagnosticPlatform(),
		Data:         status,
		Runtime:      input.Runtime,
		Settings:     sanitizeDiagnosticSettings(input.Settings),
		Databases:    inspectDiagnosticDatabases(ctx, root),
		RecentEvents: sanitizeDiagnosticEvents(input.Events),
		Privacy: []string{
			"不包含 API Key、Arena Token、浏览器配对令牌或 PI 认证文件",
			"不包含会话正文、附件内容、模型回复或工具输入输出",
			"数据库只执行只读 quick_check，不复制数据库内容",
		},
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return DiagnosticExport{}, fmt.Errorf("encode diagnostics: %w", err)
	}
	payload = append(payload, '\n')

	temporary, err := os.CreateTemp(filepath.Dir(destination), ".milksu-diagnostics-*.zip")
	if err != nil {
		return DiagnosticExport{}, fmt.Errorf("create diagnostic archive: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return DiagnosticExport{}, fmt.Errorf("protect diagnostic archive: %w", err)
	}

	archive := zip.NewWriter(temporary)
	header := &zip.FileHeader{
		Name:     "diagnostics.json",
		Method:   zip.Deflate,
		Modified: time.Now().UTC(),
	}
	header.SetMode(0o600)
	writer, err := archive.CreateHeader(header)
	if err != nil {
		archive.Close()
		temporary.Close()
		return DiagnosticExport{}, fmt.Errorf("create diagnostic report: %w", err)
	}
	if _, err := writer.Write(payload); err != nil {
		archive.Close()
		temporary.Close()
		return DiagnosticExport{}, fmt.Errorf("write diagnostic report: %w", err)
	}
	if err := archive.Close(); err != nil {
		temporary.Close()
		return DiagnosticExport{}, fmt.Errorf("finish diagnostic archive: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return DiagnosticExport{}, fmt.Errorf("sync diagnostic archive: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return DiagnosticExport{}, fmt.Errorf("close diagnostic archive: %w", err)
	}
	if err := os.Rename(temporaryPath, destination); err != nil {
		return DiagnosticExport{}, fmt.Errorf("install diagnostic archive: %w", err)
	}
	if err := os.Chmod(destination, 0o600); err != nil {
		return DiagnosticExport{}, fmt.Errorf("protect diagnostic archive: %w", err)
	}
	info, err := os.Stat(destination)
	if err != nil {
		return DiagnosticExport{}, fmt.Errorf("inspect diagnostic archive: %w", err)
	}
	return DiagnosticExport{
		Path:        destination,
		GeneratedAt: report.GeneratedAt,
		Bytes:       info.Size(),
		EventCount:  len(report.RecentEvents),
	}, nil
}

func diagnosticPlatform() DiagnosticPlatform {
	platform := DiagnosticPlatform{
		OS:        runtime.GOOS,
		Arch:      runtime.GOARCH,
		GoVersion: runtime.Version(),
	}
	if info, ok := debug.ReadBuildInfo(); ok {
		platform.GoModule = info.Main.Path
	}
	return platform
}

func inspectDiagnosticDatabases(
	ctx context.Context,
	root string,
) []DiagnosticDatabase {
	result := make([]DiagnosticDatabase, 0, len(diagnosticDatabasePaths))
	for _, relativePath := range diagnosticDatabasePaths {
		result = append(result, inspectDiagnosticDatabase(ctx, root, relativePath))
	}
	return result
}

func inspectDiagnosticDatabase(
	ctx context.Context,
	root,
	relativePath string,
) DiagnosticDatabase {
	result := DiagnosticDatabase{Path: filepath.ToSlash(relativePath)}
	path := filepath.Join(root, relativePath)
	info, err := os.Lstat(path)
	if os.IsNotExist(err) {
		result.QuickCheck = "missing"
		return result
	}
	if err != nil {
		result.Error = sanitizeDiagnosticText(strings.ReplaceAll(err.Error(), root, "<data>"))
		return result
	}
	if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
		result.Error = "database path is not a regular file"
		return result
	}
	result.Exists = true
	result.Bytes = info.Size()
	databaseURL := (&url.URL{Scheme: "file", Path: path}).String() + "?mode=ro"
	database, err := sql.Open("sqlite", databaseURL)
	if err != nil {
		result.Error = sanitizeDiagnosticText(strings.ReplaceAll(err.Error(), root, "<data>"))
		return result
	}
	defer database.Close()
	database.SetMaxOpenConns(1)
	var quickCheck string
	if err := database.QueryRowContext(ctx, "PRAGMA quick_check(1)").Scan(&quickCheck); err != nil {
		result.Error = sanitizeDiagnosticText(strings.ReplaceAll(err.Error(), root, "<data>"))
		return result
	}
	result.QuickCheck = cleanDiagnosticLabel(quickCheck, "unknown")
	return result
}

func sanitizeDiagnosticSettings(settings DiagnosticSettings) DiagnosticSettings {
	settings.ActiveProvider = cleanDiagnosticLabel(settings.ActiveProvider, "unknown")
	settings.ActiveModel = cleanDiagnosticLabel(settings.ActiveModel, "unknown")
	settings.DefaultMode = cleanDiagnosticLabel(settings.DefaultMode, "unknown")
	providers := make([]string, 0, len(settings.ConfiguredProvider))
	for _, provider := range settings.ConfiguredProvider {
		provider = cleanDiagnosticLabel(provider, "")
		if provider != "" {
			providers = append(providers, provider)
		}
	}
	slices.Sort(providers)
	settings.ConfiguredProvider = slices.Compact(providers)
	return settings
}

func sanitizeDiagnosticEvents(events []DiagnosticEvent) []DiagnosticEvent {
	if len(events) > 256 {
		events = events[len(events)-256:]
	}
	result := make([]DiagnosticEvent, 0, len(events))
	for _, event := range events {
		message := sanitizeDiagnosticText(event.Message)
		if message == "" {
			continue
		}
		result = append(result, DiagnosticEvent{
			Timestamp: cleanDiagnosticLabel(event.Timestamp, ""),
			Category:  cleanDiagnosticLabel(event.Category, "app"),
			Level:     cleanDiagnosticLabel(event.Level, "info"),
			Message:   message,
		})
	}
	return result
}

func sanitizeDiagnosticText(value string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return ""
	}
	value = diagnosticCredentialPattern.ReplaceAllString(value, "[REDACTED]")
	value = diagnosticBearerPattern.ReplaceAllString(value, "${1}[REDACTED]")
	value = diagnosticAssignmentPattern.ReplaceAllString(value, "${1}=[REDACTED]")
	value = diagnosticQueryPattern.ReplaceAllString(value, "${1}[REDACTED]")
	runes := []rune(value)
	if len(runes) > 4096 {
		value = string(runes[:4096]) + "…"
	}
	return value
}

func cleanDiagnosticLabel(value, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	value = sanitizeDiagnosticText(value)
	value = strings.Map(func(character rune) rune {
		if character < 0x20 || character == 0x7f {
			return -1
		}
		return character
	}, value)
	runes := []rune(value)
	if len(runes) > 160 {
		value = string(runes[:160])
	}
	if value == "" {
		return fallback
	}
	return value
}
