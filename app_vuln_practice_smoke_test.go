package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/vuln"
)

func TestVulnerabilityPracticeSmokeReportFlagsSensitiveShapes(t *testing.T) {
	report := vulnerabilityPracticeSmokeReport{
		Schema: vulnerabilityPracticeSmokeSchema,
		Start: vuln.PracticeRun{
			Schema: vuln.PracticeRunSchema,
			CommandSummaries: []vuln.PracticeCommandSummary{{
				Name:   "docker compose up",
				Output: "OPENAI_API_KEY=should-not-enter-report",
			}},
		},
	}
	if !vulnerabilityPracticeSmokeContainsSensitiveShape(report) {
		t.Fatal("expected sensitive shape to be detected")
	}
	report.Start.CommandSummaries[0].Output = "Container started"
	if vulnerabilityPracticeSmokeContainsSensitiveShape(report) {
		t.Fatalf("unexpected sensitive shape in safe report")
	}
}

func TestWriteVulnerabilityPracticeSmokeReportIsPrivate(t *testing.T) {
	path := filepath.Join(t.TempDir(), "vuln-practice.json")
	report := vulnerabilityPracticeSmokeReport{
		Schema: vulnerabilityPracticeSmokeSchema,
		Gates:  vulnerabilityPracticeSmokeGates{NoProviderCredentialLeak: true},
	}
	if err := writeVulnerabilityPracticeSmokeReport(path, report); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("report permissions = %o, want 600", info.Mode().Perm())
	}
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), "should-not-enter-report") {
		t.Fatalf("report leaked fixture secret: %s", payload)
	}
}
