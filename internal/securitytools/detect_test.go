package securitytools

import (
	"os"
	"path/filepath"
	"testing"
)

func TestParseQuotedVersionAndMajor(t *testing.T) {
	if got := parseQuotedVersion(`openjdk version "17.0.12" 2024-07-16`); got != "17.0.12" {
		t.Fatalf("quoted version: %q", got)
	}
	if !versionAtLeast("11.3.2", 11) || versionAtLeast("10.4", 11) {
		t.Fatal("versionAtLeast mismatch")
	}
	if firstSemver("Ghidra_11.2_PUBLIC") != "11.2" {
		t.Fatalf("semver from dirname: %q", firstSemver("Ghidra_11.2_PUBLIC"))
	}
}

func TestReadGhidraInstallRequiresHeadlessAndVersion(t *testing.T) {
	root := writeGhidraInstall(t, "11.3.2")
	command, version, err := readGhidraInstall(root)
	if err != nil {
		t.Fatal(err)
	}
	if command != filepath.Join(root, "support", "analyzeHeadless") {
		t.Fatalf("command: %s", command)
	}
	if version != "11.3.2" {
		t.Fatalf("version: %s", version)
	}

	empty := t.TempDir()
	if _, _, err := readGhidraInstall(empty); err == nil {
		t.Fatal("expected missing analyzeHeadless")
	}
}

func writeGhidraInstall(t *testing.T, version string) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "support"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "support", "analyzeHeadless"), []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(root, "Ghidra"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "Ghidra", "application.properties"), []byte("application.version="+version+"\n"), 0o600); err != nil {
		t.Fatal(err)
	}
	return root
}
