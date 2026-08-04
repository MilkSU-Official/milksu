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
	sessionIndexSmokeResultEnv = "MILKSU_SESSION_INDEX_SMOKE_RESULT"
	sessionIndexSmokeQueryEnv  = "MILKSU_SESSION_INDEX_SMOKE_QUERY"
)

type sessionIndexSmokeReport struct {
	Schema        string                     `json:"schema"`
	RanAt         string                     `json:"ranAt"`
	Query         string                     `json:"query"`
	DataDirectory string                     `json:"dataDirectory"`
	IndexPath     string                     `json:"indexPath"`
	Status        sessionindex.Status        `json:"status"`
	ResultCount   int                        `json:"resultCount"`
	FirstResult   *sessionindex.SearchResult `json:"firstResult,omitempty"`
	Error         string                     `json:"error,omitempty"`
}

func (a *App) maybeRunSessionIndexSmoke() {
	resultPath := strings.TrimSpace(os.Getenv(sessionIndexSmokeResultEnv))
	if resultPath == "" {
		return
	}

	report := sessionIndexSmokeReport{
		Schema:        "milksu-session-index-packaged-smoke/v1",
		RanAt:         time.Now().UTC().Format(time.RFC3339Nano),
		Query:         strings.TrimSpace(os.Getenv(sessionIndexSmokeQueryEnv)),
		DataDirectory: a.dataDirectory,
	}
	if report.Query == "" {
		report.Query = "SessionIndexPackagedSmoke"
	}

	status, err := a.GetSessionIndexStatus()
	if err != nil {
		report.Error = err.Error()
	} else {
		report.Status = status
		report.IndexPath = status.IndexPath
		response, searchErr := a.SearchSessionHistory(sessionindex.SearchRequest{
			Query: report.Query,
			Limit: 4,
		})
		if searchErr != nil {
			report.Error = searchErr.Error()
		} else {
			report.Status = response.Status
			report.IndexPath = response.Status.IndexPath
			report.ResultCount = len(response.Results)
			if len(response.Results) > 0 {
				first := response.Results[0]
				report.FirstResult = &first
			}
		}
	}

	if err := writeSessionIndexSmokeReport(resultPath, report); err != nil {
		a.diagnostics.Record("session-index", "error", "packaged smoke report failed")
	}
}

func writeSessionIndexSmokeReport(path string, report sessionIndexSmokeReport) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve session index smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create session index smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode session index smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-session-index-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary session index smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary session index smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary session index smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary session index smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary session index smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install session index smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect session index smoke report: %w", err)
	}
	return nil
}
