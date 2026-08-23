package userartifact

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestSeedReportWritesOnce(t *testing.T) {
	root := t.TempDir()
	workspace, err := Workspace(root, KindLab, "lab-job-one", "本机 Web 练习机")
	if err != nil {
		t.Fatal(err)
	}
	if err := SeedReport(workspace, "本机 Web 练习机"); err != nil {
		t.Fatal(err)
	}
	first, err := os.ReadFile(filepath.Join(workspace, ReportFileName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(first), "# 本机 Web 练习机\n") {
		t.Fatalf("report = %q", first)
	}
	if err := os.WriteFile(filepath.Join(workspace, ReportFileName), []byte("# kept\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := SeedReport(workspace, "ignored"); err != nil {
		t.Fatal(err)
	}
	second, err := os.ReadFile(filepath.Join(workspace, ReportFileName))
	if err != nil {
		t.Fatal(err)
	}
	if string(second) != "# kept\n" {
		t.Fatalf("seed overwrote an existing report: %q", second)
	}
}

func TestSeedRelatedWritesOnce(t *testing.T) {
	root := t.TempDir()
	workspace, err := Workspace(root, KindCVE, "cve-research-cve-2024-3400", "CVE-2024-3400")
	if err != nil {
		t.Fatal(err)
	}
	if err := SeedRelated(workspace, "CVE-2024-3400"); err != nil {
		t.Fatal(err)
	}
	first, err := os.ReadFile(filepath.Join(workspace, RelatedFileName))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(first), "## 上游") || !strings.Contains(string(first), "## 下游") {
		t.Fatalf("related = %q", first)
	}
	if err := os.WriteFile(filepath.Join(workspace, RelatedFileName), []byte("# kept\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := SeedRelated(workspace, "ignored"); err != nil {
		t.Fatal(err)
	}
	second, err := os.ReadFile(filepath.Join(workspace, RelatedFileName))
	if err != nil {
		t.Fatal(err)
	}
	if string(second) != "# kept\n" {
		t.Fatalf("seed overwrote related CVEs: %q", second)
	}
}
