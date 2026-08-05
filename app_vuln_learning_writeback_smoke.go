package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/vuln"
)

const (
	vulnerabilityLearningWritebackSmokeResultEnv = "MILKSU_VULN_LEARNING_WRITEBACK_SMOKE_RESULT"
	vulnerabilityLearningWritebackSmokeCVEIDEnv  = "MILKSU_VULN_LEARNING_WRITEBACK_SMOKE_CVE_ID"
	defaultVulnerabilityLearningWritebackCVE     = "CVE-2023-46604"
)

type vulnerabilityLearningWritebackSmokeReport struct {
	Schema        string                                      `json:"schema"`
	RanAt         string                                      `json:"ranAt"`
	CVEID         string                                      `json:"cveId"`
	DataDirectory string                                      `json:"dataDirectory"`
	JobID         string                                      `json:"jobId,omitempty"`
	Target        vulnerabilityLearningWritebackTargetSummary `json:"target"`
	LearningCount int                                         `json:"learningCount"`
	Gates         vulnerabilityLearningWritebackSmokeGates    `json:"gates"`
	Error         string                                      `json:"error,omitempty"`
}

type vulnerabilityLearningWritebackTargetSummary struct {
	Name    string `json:"name,omitempty"`
	Version string `json:"version,omitempty"`
	Fixture string `json:"fixture,omitempty"`
}

type vulnerabilityLearningWritebackSmokeGates struct {
	WorkspaceCreated        bool `json:"workspaceCreated"`
	TargetBoundToCVE        bool `json:"targetBoundToCve"`
	LearningRecordPersisted bool `json:"learningRecordPersisted"`
	ProjectionRecovered     bool `json:"projectionRecovered"`
	RawContentOmitted       bool `json:"rawContentOmitted"`
}

func (a *App) maybeRunVulnerabilityLearningWritebackSmoke() {
	resultPath := strings.TrimSpace(os.Getenv(vulnerabilityLearningWritebackSmokeResultEnv))
	if resultPath == "" {
		return
	}
	cveID := strings.TrimSpace(os.Getenv(vulnerabilityLearningWritebackSmokeCVEIDEnv))
	if cveID == "" {
		cveID = defaultVulnerabilityLearningWritebackCVE
	}
	report := a.buildVulnerabilityLearningWritebackSmokeReport(cveID)
	if err := writeVulnerabilityLearningWritebackSmokeReport(resultPath, report); err != nil {
		a.diagnostics.Record("vuln-learning", "error", "packaged learning writeback smoke report failed")
	}
}

func (a *App) buildVulnerabilityLearningWritebackSmokeReport(cveID string) vulnerabilityLearningWritebackSmokeReport {
	report := vulnerabilityLearningWritebackSmokeReport{
		Schema:        "milksu-vuln-learning-writeback-packaged-smoke/v1",
		RanAt:         time.Now().UTC().Format(time.RFC3339Nano),
		CVEID:         strings.ToUpper(strings.TrimSpace(cveID)),
		DataDirectory: a.dataDirectory,
	}
	if report.CVEID == "" {
		report.CVEID = defaultVulnerabilityLearningWritebackCVE
	}
	workspace, err := a.EnsureVulnTrackingWorkspace(vuln.TrackingWorkspaceRequest{
		CVEID:         report.CVEID,
		Title:         report.CVEID + " packaged learning writeback",
		Summary:       "Packaged smoke records a user-confirmed learning note without reproduction input.",
		ReferenceHref: "https://nvd.nist.gov/vuln/detail/" + report.CVEID,
	})
	if err != nil {
		report.Error = err.Error()
		return report
	}
	projection, err := a.RecordVulnLearning(workspace.Job.ID, vuln.LearningRecordRequest{
		Kind:    "reflection",
		Content: "User-confirmed packaged smoke learning note; no PoC, trigger bytes, credentials, or external target access.",
		Concept: report.CVEID,
	})
	if err != nil {
		report.Error = err.Error()
		return report
	}
	recovered, err := a.GetVulnJob(projection.Job.ID)
	if err != nil {
		report.Error = err.Error()
		return report
	}
	report.JobID = projection.Job.ID
	report.Target = vulnerabilityLearningWritebackTargetSummary{
		Name:    projection.Target.Name,
		Version: projection.Target.Version,
		Fixture: projection.Target.Fixture,
	}
	report.LearningCount = len(recovered.Learning)
	report.Gates = vulnerabilityLearningWritebackSmokeGates{
		WorkspaceCreated:        projection.Job.ID != "",
		TargetBoundToCVE:        strings.EqualFold(projection.Target.Name, report.CVEID) && projection.Target.Fixture == "cve-tracking",
		LearningRecordPersisted: len(projection.Learning) > 0 && len(recovered.Learning) == len(projection.Learning),
		ProjectionRecovered:     recovered.Job.ID == projection.Job.ID,
		RawContentOmitted:       true,
	}
	if !report.Gates.WorkspaceCreated ||
		!report.Gates.TargetBoundToCVE ||
		!report.Gates.LearningRecordPersisted ||
		!report.Gates.ProjectionRecovered {
		report.Error = "vulnerability learning writeback smoke did not prove every gate"
	}
	return report
}

func writeVulnerabilityLearningWritebackSmokeReport(
	path string,
	report vulnerabilityLearningWritebackSmokeReport,
) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve vulnerability learning writeback smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create vulnerability learning writeback smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode vulnerability learning writeback smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-vuln-learning-writeback-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary vulnerability learning writeback smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		temporary.Close()
		return fmt.Errorf("protect temporary vulnerability learning writeback smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		temporary.Close()
		return fmt.Errorf("write temporary vulnerability learning writeback smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		temporary.Close()
		return fmt.Errorf("sync temporary vulnerability learning writeback smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary vulnerability learning writeback smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install vulnerability learning writeback smoke report: %w", err)
	}
	if err := os.Chmod(absolute, 0o600); err != nil {
		return fmt.Errorf("protect vulnerability learning writeback smoke report: %w", err)
	}
	return nil
}
