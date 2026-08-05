package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/sessionindex"
)

const (
	sessionHistoryImportSmokeResultEnv = "MILKSU_SESSION_HISTORY_IMPORT_SMOKE_RESULT"
	sessionHistoryImportSmokePathEnv   = "MILKSU_SESSION_HISTORY_IMPORT_SMOKE_PATH"
	sessionHistoryImportSmokeSourceEnv = "MILKSU_SESSION_HISTORY_IMPORT_SMOKE_SOURCE"
	sessionHistoryImportSmokeQueryEnv  = "MILKSU_SESSION_HISTORY_IMPORT_SMOKE_QUERY"
)

type sessionHistoryImportSmokeReport struct {
	Schema        string                            `json:"schema"`
	RanAt         string                            `json:"ranAt"`
	Query         string                            `json:"query"`
	DataDirectory string                            `json:"dataDirectory"`
	Import        sessionindex.ExternalImportResult `json:"import"`
	Status        sessionindex.Status               `json:"status"`
	ResultCount   int                               `json:"resultCount"`
	FirstResult   *sessionindex.SearchResult        `json:"firstResult,omitempty"`
	Error         string                            `json:"error,omitempty"`
}

func (a *App) maybeRunExternalSessionImportSmoke() {
	resultPath := strings.TrimSpace(os.Getenv(sessionHistoryImportSmokeResultEnv))
	if resultPath == "" {
		return
	}
	source := strings.TrimSpace(os.Getenv(sessionHistoryImportSmokeSourceEnv))
	if source == "" {
		source = "codex"
	}
	query := strings.TrimSpace(os.Getenv(sessionHistoryImportSmokeQueryEnv))
	if query == "" {
		query = "ExternalHistoryPackagedSmoke"
	}
	report := sessionHistoryImportSmokeReport{
		Schema:        "milksu-session-history-import-packaged-smoke/v1",
		RanAt:         time.Now().UTC().Format(time.RFC3339Nano),
		Query:         query,
		DataDirectory: a.dataDirectory,
	}

	importPath := strings.TrimSpace(os.Getenv(sessionHistoryImportSmokePathEnv))
	if importPath == "" {
		report.Error = "external history import smoke path is required"
	} else {
		result, err := a.ImportExternalSessionHistory(sessionindex.ExternalImportRequest{
			Source:      source,
			Path:        importPath,
			Project:     "milksu",
			ProjectPath: filepath.Dir(importPath),
		})
		if err != nil {
			report.Error = err.Error()
		} else {
			report.Import = result
			response, searchErr := a.SearchSessionHistory(sessionindex.SearchRequest{
				Query:  query,
				Source: source,
				Limit:  4,
			})
			if searchErr != nil {
				report.Error = searchErr.Error()
			} else {
				report.Status = response.Status
				report.ResultCount = len(response.Results)
				if len(response.Results) > 0 {
					first := response.Results[0]
					report.FirstResult = &first
				}
			}
		}
	}

	if err := writeSessionHistoryImportSmokeReport(resultPath, report); err != nil {
		a.diagnostics.Record("session-index", "error", "external import smoke report failed")
	}
}

func writeSessionHistoryImportSmokeReport(path string, report sessionHistoryImportSmokeReport) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve external import smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create external import smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode external import smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-session-history-import-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary external import smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary external import smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary external import smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary external import smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary external import smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install external import smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect external import smoke report: %w", err)
	}
	return nil
}
