package main

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/appdata"
)

func TestSingleInstanceUniqueIDUsesDefault(t *testing.T) {
	t.Setenv(instanceIDEnv, "")
	if got := singleInstanceUniqueID(); got != appdata.BundleIdentifier {
		t.Fatalf("singleInstanceUniqueID() = %q, want %q", got, appdata.BundleIdentifier)
	}
}

func TestSingleInstanceUniqueIDUsesSafeSuffix(t *testing.T) {
	t.Setenv(instanceIDEnv, "codex-ui-qa.1")
	expected := appdata.BundleIdentifier + ".codex-ui-qa.1"
	if got := singleInstanceUniqueID(); got != expected {
		t.Fatalf("singleInstanceUniqueID() = %q, want %q", got, expected)
	}
}

func TestSingleInstanceUniqueIDRejectsUnsafeSuffix(t *testing.T) {
	for name, value := range map[string]string{
		"slash":      "codex/ui",
		"whitespace": "codex ui",
		"empty":      "",
	} {
		t.Run(name, func(t *testing.T) {
			t.Setenv(instanceIDEnv, value)
			if got := singleInstanceUniqueID(); got != appdata.BundleIdentifier {
				t.Fatalf("singleInstanceUniqueID() = %q, want default %q", got, appdata.BundleIdentifier)
			}
		})
	}
}
