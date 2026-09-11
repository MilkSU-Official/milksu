package codingtools

import (
	"context"
	"os"
	"path/filepath"
	"runtime"
	"testing"
)

type stubProbe struct {
	commands map[string]string
}

func (s stubProbe) LookPath(name string) (string, error) {
	if path, ok := s.commands[name]; ok {
		return path, nil
	}
	return "", os.ErrNotExist
}

func (s stubProbe) Output(context.Context, string, ...string) (string, error) {
	return "1.0", nil
}

func TestDetectJADXUsesPath(t *testing.T) {
	service := NewService(t.TempDir(), nil)
	service.probe = stubProbe{commands: map[string]string{"jadx": "/opt/jadx/bin/jadx"}}
	got := service.detectJADX(context.Background())
	if got.Status != statusFound || got.Name != SkillJADX {
		t.Fatalf("expected found jadx, got %#v", got)
	}
}

func TestDetectJADXMissing(t *testing.T) {
	service := NewService(t.TempDir(), nil)
	service.probe = stubProbe{}
	got := service.detectJADX(context.Background())
	if got.Status != statusMissing {
		t.Fatalf("expected missing jadx, got %#v", got)
	}
}

func TestIsGhidraInstallRecognizesHeadless(t *testing.T) {
	root := t.TempDir()
	support := filepath.Join(root, "support")
	if err := os.MkdirAll(support, 0o700); err != nil {
		t.Fatal(err)
	}
	name := "analyzeHeadless"
	if runtime.GOOS == "windows" {
		name = "analyzeHeadless.bat"
	}
	if err := os.WriteFile(filepath.Join(support, name), []byte("#!/bin/sh\n"), 0o700); err != nil {
		t.Fatal(err)
	}
	if !isGhidraInstall(root) {
		t.Fatal("expected Ghidra install to be recognized")
	}
}

func TestOptionalSkillNames(t *testing.T) {
	if !IsOptionalSkill(SkillGhidraRPC) || !IsOptionalSkill(SkillJADX) {
		t.Fatal("expected optional skill names")
	}
	if IsOptionalSkill("product-design") {
		t.Fatal("reviewed skills are not optional coding tools")
	}
}
