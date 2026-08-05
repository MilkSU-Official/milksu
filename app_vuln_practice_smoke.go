package main

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/vuln"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

const (
	vulnerabilityPracticeSmokeResultEnv          = "MILKSU_VULN_PRACTICE_SMOKE_RESULT"
	vulnerabilityPracticeSmokeDirectoryEnv       = "MILKSU_VULN_PRACTICE_SMOKE_DIRECTORY"
	vulnerabilityPracticeSmokeCVEEnv             = "MILKSU_VULN_PRACTICE_SMOKE_CVE"
	vulnerabilityPracticeSmokeEnvironmentEnv     = "MILKSU_VULN_PRACTICE_SMOKE_ENVIRONMENT"
	vulnerabilityPracticeSmokeRevisionEnv        = "MILKSU_VULN_PRACTICE_SMOKE_REVISION"
	vulnerabilityPracticeSmokeProjectEnv         = "MILKSU_VULN_PRACTICE_SMOKE_PROJECT"
	vulnerabilityPracticeSmokeQuitEnv            = "MILKSU_VULN_PRACTICE_SMOKE_QUIT"
	vulnerabilityPracticeSmokeSchema             = "milksu-vuln-practice-packaged-smoke/v1"
	defaultVulnerabilityPracticeSmokeCVE         = "CVE-2023-46604"
	defaultVulnerabilityPracticeSmokeEnvironment = "vulhub-cve-2023-46604"
)

type vulnerabilityPracticeSmokeReport struct {
	Schema        string                          `json:"schema"`
	RanAt         string                          `json:"ranAt"`
	DataDirectory string                          `json:"dataDirectory"`
	Request       vuln.PracticeRequest            `json:"request"`
	Start         vuln.PracticeRun                `json:"start"`
	Status        vuln.PracticeRun                `json:"status"`
	Stop          vuln.PracticeRun                `json:"stop"`
	Gates         vulnerabilityPracticeSmokeGates `json:"gates"`
	Limitations   []string                        `json:"limitations,omitempty"`
	Error         string                          `json:"error,omitempty"`
}

type vulnerabilityPracticeSmokeGates struct {
	PackagedAppStartedPractice bool `json:"packagedAppStartedPractice"`
	PackagedAppObservedStatus  bool `json:"packagedAppObservedStatus"`
	PackagedAppStoppedPractice bool `json:"packagedAppStoppedPractice"`
	EvidencePersisted          bool `json:"evidencePersisted"`
	NoProviderCredentialLeak   bool `json:"noProviderCredentialLeak"`
}

func (a *App) maybeRunVulnerabilityPracticeSmoke() {
	resultPath := strings.TrimSpace(os.Getenv(vulnerabilityPracticeSmokeResultEnv))
	if resultPath == "" {
		return
	}
	report := a.buildVulnerabilityPracticeSmokeReport(vuln.PracticeRequest{
		CVEID:          envOrDefault(vulnerabilityPracticeSmokeCVEEnv, defaultVulnerabilityPracticeSmokeCVE),
		EnvironmentID:  envOrDefault(vulnerabilityPracticeSmokeEnvironmentEnv, defaultVulnerabilityPracticeSmokeEnvironment),
		Directory:      strings.TrimSpace(os.Getenv(vulnerabilityPracticeSmokeDirectoryEnv)),
		SourceRevision: strings.TrimSpace(os.Getenv(vulnerabilityPracticeSmokeRevisionEnv)),
		ProjectName:    strings.TrimSpace(os.Getenv(vulnerabilityPracticeSmokeProjectEnv)),
		CleanupVolumes: true,
	})
	if err := writeVulnerabilityPracticeSmokeReport(resultPath, report); err != nil {
		a.diagnostics.Record("vuln-practice", "error", "packaged vulnerability practice smoke report failed")
	}
	if strings.TrimSpace(os.Getenv(vulnerabilityPracticeSmokeQuitEnv)) == "1" && a.ctx != nil {
		go func() {
			time.Sleep(250 * time.Millisecond)
			wailsruntime.Quit(a.ctx)
		}()
	}
}

func (a *App) buildVulnerabilityPracticeSmokeReport(request vuln.PracticeRequest) vulnerabilityPracticeSmokeReport {
	report := vulnerabilityPracticeSmokeReport{
		Schema:        vulnerabilityPracticeSmokeSchema,
		RanAt:         time.Now().UTC().Format(time.RFC3339Nano),
		DataDirectory: a.dataDirectory,
		Request:       request,
		Limitations: []string{
			"This smoke starts and stops a benign local Docker Compose fixture through MilkSU's CVE practice lifecycle.",
			"It does not run exploit code, submit vulnerability-triggering input, scan external targets, or prove a real asset is vulnerable.",
		},
	}
	if strings.TrimSpace(request.Directory) == "" {
		report.Error = fmt.Sprintf("%s is required", vulnerabilityPracticeSmokeDirectoryEnv)
		report.Gates.NoProviderCredentialLeak = !vulnerabilityPracticeSmokeContainsSensitiveShape(report)
		return report
	}
	start, err := a.StartVulnerabilityPractice(request)
	report.Start = start
	if err != nil {
		report.Error = err.Error()
		report.Gates.NoProviderCredentialLeak = !vulnerabilityPracticeSmokeContainsSensitiveShape(report)
		return report
	}
	status, err := a.GetVulnerabilityPracticeStatus(request)
	report.Status = status
	if err != nil {
		report.Error = err.Error()
		_, _ = a.StopVulnerabilityPractice(request)
		report.Gates.NoProviderCredentialLeak = !vulnerabilityPracticeSmokeContainsSensitiveShape(report)
		return report
	}
	stop, err := a.StopVulnerabilityPractice(request)
	report.Stop = stop
	if err != nil {
		report.Error = err.Error()
		report.Gates.NoProviderCredentialLeak = !vulnerabilityPracticeSmokeContainsSensitiveShape(report)
		return report
	}
	report.Gates.PackagedAppStartedPractice = start.State == "running" &&
		start.Gates.Started &&
		start.Gates.ComposeFileValidated &&
		start.Gates.DockerAvailable
	report.Gates.PackagedAppObservedStatus = status.Gates.StatusObserved &&
		status.ContainerCount > 0
	report.Gates.PackagedAppStoppedPractice = stop.State == "stopped" &&
		stop.Gates.Stopped
	report.Gates.EvidencePersisted = vulnerabilityPracticeFileExists(start.EvidencePath) &&
		vulnerabilityPracticeFileExists(status.EvidencePath) &&
		vulnerabilityPracticeFileExists(stop.EvidencePath)
	report.Gates.NoProviderCredentialLeak = !vulnerabilityPracticeSmokeContainsSensitiveShape(report)
	if !report.Gates.PackagedAppStartedPractice ||
		!report.Gates.PackagedAppObservedStatus ||
		!report.Gates.PackagedAppStoppedPractice ||
		!report.Gates.EvidencePersisted ||
		!report.Gates.NoProviderCredentialLeak {
		report.Error = "vulnerability practice smoke did not prove every lifecycle gate"
	}
	return report
}

func writeVulnerabilityPracticeSmokeReport(path string, report vulnerabilityPracticeSmokeReport) error {
	absolute, err := filepath.Abs(path)
	if err != nil {
		return fmt.Errorf("resolve vulnerability practice smoke report path: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(absolute), 0o700); err != nil {
		return fmt.Errorf("create vulnerability practice smoke report directory: %w", err)
	}
	payload, err := json.MarshalIndent(report, "", "  ")
	if err != nil {
		return fmt.Errorf("encode vulnerability practice smoke report: %w", err)
	}
	payload = append(payload, '\n')
	temporary, err := os.CreateTemp(filepath.Dir(absolute), ".milksu-vuln-practice-smoke-*")
	if err != nil {
		return fmt.Errorf("create temporary vulnerability practice smoke report: %w", err)
	}
	temporaryPath := temporary.Name()
	defer os.Remove(temporaryPath)
	if err := temporary.Chmod(0o600); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("protect temporary vulnerability practice smoke report: %w", err)
	}
	if _, err := temporary.Write(payload); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("write temporary vulnerability practice smoke report: %w", err)
	}
	if err := temporary.Sync(); err != nil {
		_ = temporary.Close()
		return fmt.Errorf("sync temporary vulnerability practice smoke report: %w", err)
	}
	if err := temporary.Close(); err != nil {
		return fmt.Errorf("close temporary vulnerability practice smoke report: %w", err)
	}
	if err := os.Rename(temporaryPath, absolute); err != nil {
		return fmt.Errorf("install vulnerability practice smoke report: %w", err)
	}
	return os.Chmod(absolute, 0o600)
}

func vulnerabilityPracticeSmokeContainsSensitiveShape(report vulnerabilityPracticeSmokeReport) bool {
	encoded, err := json.Marshal(report)
	if err != nil {
		return true
	}
	lower := strings.ToLower(string(encoded))
	for _, forbidden := range []string{
		"api_key=",
		"authorization: bearer",
		"bearer sk-",
		"sk-",
		"password=",
		"secret=",
		"token=",
	} {
		if strings.Contains(lower, forbidden) {
			return true
		}
	}
	return false
}

func vulnerabilityPracticeFileExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && info.Mode().IsRegular()
}

func envOrDefault(name string, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(name)); value != "" {
		return value
	}
	return fallback
}
