package securitytools

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/hostpath"
	"github.com/MilkSU-Official/milksu/internal/userartifact"
)

func TestGhidraPathStaysInArtifactWorkspaces(t *testing.T) {
	artifacts := t.TempDir()
	t.Setenv(userartifact.DirectoryOverrideEnv, artifacts)
	service := NewService(t.TempDir(), &testSettings{value: config.DefaultSettings()}, nil)

	coding := filepath.Join(artifacts, string(userartifact.KindCoding), "sample.bin")
	if !service.AllowGhidraPath(coding) {
		t.Fatal("Coding workspace sample should be allowed")
	}
	lab := filepath.Join(artifacts, string(userartifact.KindLab), "project.gpr")
	if !service.AllowGhidraPath(lab) {
		t.Fatal("Lab Ghidra project should be allowed")
	}
	if service.AllowGhidraPath(filepath.Join(artifacts, string(userartifact.KindCTF), "sample.bin")) {
		t.Fatal("CTF paths are outside the Ghidra overlay contract")
	}
	if home, err := os.UserHomeDir(); err == nil {
		if service.AllowGhidraPath(filepath.Join(home, "Downloads", "sample.bin")) {
			t.Fatal("home Downloads must stay outside Ghidra roots")
		}
	}
}

func TestJADXPathIsLabOrInjuredAndroidCacheOnly(t *testing.T) {
	artifacts := t.TempDir()
	data := t.TempDir()
	t.Setenv(userartifact.DirectoryOverrideEnv, artifacts)
	service := NewService(data, &testSettings{value: config.DefaultSettings()}, nil)

	labAPK := filepath.Join(artifacts, string(userartifact.KindLab), "job", InjuredAndroidAPK)
	if !service.AllowJADXPath(labAPK) {
		t.Fatal("lab InjuredAndroid copy should be allowed")
	}
	cache := filepath.Join(data, "envbroker", "cache", InjuredAndroidAPK)
	if !service.AllowJADXPath(cache) {
		t.Fatal("envbroker InjuredAndroid cache should be allowed")
	}
	other := filepath.Join(data, "envbroker", "cache", "other.apk")
	if service.AllowJADXPath(other) {
		t.Fatal("non-InjuredAndroid cache APK must be rejected")
	}
	if service.AllowJADXPath(filepath.Join(artifacts, string(userartifact.KindCoding), "app.apk")) {
		t.Fatal("Coding APKs are outside the JADX lab path")
	}
}

func TestSanitizeLabOutputRedactsHomeAndClips(t *testing.T) {
	home, err := os.UserHomeDir()
	if err != nil {
		t.Fatal(err)
	}
	got := SanitizeLabOutput(home + "/secret and " + filepath.Join(os.TempDir(), "apk_analysis"))
	if strings.Contains(got, home) {
		t.Fatalf("home path leaked: %q", got)
	}
	if !strings.Contains(got, "$HOME") {
		t.Fatalf("expected $HOME redaction: %q", got)
	}
	if ephemeral := hostpath.EphemeralRoot(); ephemeral != "" && strings.Contains(got, ephemeral) {
		t.Fatalf("ephemeral path leaked: %q", got)
	}

	var lines []string
	for i := 0; i < maxSanitizedOutputLines+20; i++ {
		lines = append(lines, "line")
	}
	clipped := SanitizeLabOutput(strings.Join(lines, "\n"))
	if gotLines := strings.Count(clipped, "\n") + 1; gotLines > maxSanitizedOutputLines+1 {
		t.Fatalf("output was not clipped: %d lines", gotLines)
	}
	if !strings.Contains(clipped, "...(truncated)") {
		t.Fatal("expected truncation marker")
	}
}
