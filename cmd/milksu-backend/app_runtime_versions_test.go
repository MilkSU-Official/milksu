package main

import (
	"testing"

	"github.com/MilkSU-Official/milksu/internal/config"
)

func TestGetSettingsInjectsRuntimeVersions(t *testing.T) {
	t.Setenv("MILKSU_APPDATA_DIR", t.TempDir())
	store, err := config.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	application := &App{
		settings:        store,
		runtimeVersions: map[string]string{"pi": "0.87.0", "dsh": "0.2.0-rc.2"},
	}
	settings := application.GetSettings()
	if settings.RuntimeVersions["pi"] != "0.87.0" || settings.RuntimeVersions["dsh"] != "0.2.0-rc.2" {
		t.Fatalf("expected runtime versions in settings, got %#v", settings.RuntimeVersions)
	}
	// The injected metadata must not reach the persisted document.
	if err := store.Save(settings); err != nil {
		t.Fatal(err)
	}
	loaded := application.GetSettings()
	if len(loaded.RuntimeVersions) == 0 {
		t.Fatal("versions disappeared after the injected field was echoed back through Save")
	}
}

func TestGetSettingsWithoutVersionsStaysEmpty(t *testing.T) {
	t.Setenv("MILKSU_APPDATA_DIR", t.TempDir())
	store, err := config.NewStore()
	if err != nil {
		t.Fatal(err)
	}
	application := &App{settings: store}
	if len(application.GetSettings().RuntimeVersions) != 0 {
		t.Fatal("no runtime versions installed; the field must stay empty")
	}
}
