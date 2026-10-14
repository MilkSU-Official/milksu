package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func TestExportSidecarEnvironmentUnavailableToRenderer(t *testing.T) {
	result, err := invokeAppMethod(&App{}, desktopRPCSourceRenderer, "ExportSidecarEnvironment", nil)
	if err == nil || !strings.Contains(err.Error(), "unavailable to renderer") {
		t.Fatalf("invokeAppMethod() result=%v err=%v, want error containing %q", result, err, "unavailable to renderer")
	}
}

func TestExportSidecarEnvironmentElectronHostIncludesProviderKey(t *testing.T) {
	root := t.TempDir()
	t.Setenv("MILKSU_APPDATA_DIR", root)
	t.Setenv("DEEPSEEK_API_KEY", "")
	store, err := config.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	const key = "test-deepseek-secret"
	settings := store.Get()
	settings.Providers["deepseek"] = config.ProviderConfig{
		APIKey:  key,
		Enabled: true,
	}
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	if store.Get().Providers["deepseek"].APIKey != "" {
		t.Fatal("public settings leaked api key")
	}
	data, err := os.ReadFile(filepath.Join(root, "config", "settings.json"))
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(data), key) {
		t.Fatal("settings.json leaked api key")
	}

	result, err := invokeAppMethod(&App{settings: store}, desktopRPCSourceElectronHost, "ExportSidecarEnvironment", nil)
	if err != nil {
		t.Fatal(err)
	}
	environment, ok := result.([]string)
	if !ok {
		t.Fatalf("result type %T", result)
	}
	found := false
	for _, entry := range environment {
		if entry == "DEEPSEEK_API_KEY="+key {
			found = true
			continue
		}
		if strings.Contains(entry, key) {
			t.Fatalf("key appeared in unexpected entry %q", entry)
		}
	}
	if !found {
		t.Fatalf("missing DEEPSEEK_API_KEY in %#v", environment)
	}
}
