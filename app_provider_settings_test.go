package main

import (
	"os"
	"strings"
	"testing"
)

func TestProviderSettingsSeparateOfficialAndRelayServices(t *testing.T) {
	typesData, err := os.ReadFile("app/src/types.ts")
	if err != nil {
		t.Fatal(err)
	}
	typesSource := string(typesData)
	for _, expected := range []string{
		"kind: 'official'",
		"kind: 'relay'",
		"label: '原厂'",
		"label: '中转站'",
		"defaultBaseUrl:",
	} {
		if !strings.Contains(typesSource, expected) {
			t.Fatalf("provider registry does not expose %q", expected)
		}
	}

	for _, file := range []string{
		"app/src/components-vue/SettingsPage.vue",
		"app/src/components-vue/ChatPage.vue",
	} {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		source := string(data)
		for _, expected := range []string{
			"<SelectGroup>",
			"<SelectLabel>{{ group.label }}</SelectLabel>",
			"<SelectSeparator",
			"PROVIDER_GROUPS",
		} {
			if strings.Contains(source, expected) {
				continue
			}
			t.Fatalf("%s does not visually separate official providers and relay services", file)
		}
	}

	settingsData, err := os.ReadFile("app/src/components-vue/SettingsPage.vue")
	if err != nil {
		t.Fatal(err)
	}
	settingsSource := string(settingsData)
	for _, expected := range []string{
		`label="Base URL"`,
		`provider!.base_url = String(value).trim()`,
		`type="url"`,
	} {
		if !strings.Contains(settingsSource, expected) {
			t.Fatalf("provider settings do not expose editable Base URL: %q", expected)
		}
	}
}

func TestSelectControlsDoNotVerticallyClipTheirLabels(t *testing.T) {
	files := []string{
		"packages/ui/src/lib/trigger.ts",
		"packages/ui/src/components/native-select/NativeSelect.vue",
	}
	for _, file := range files {
		data, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		source := string(data)
		if !strings.Contains(source, "py-0") {
			t.Fatalf("%s does not reserve the full fixed height for its text line", file)
		}
		if strings.Contains(source, "rounded-md px-3 py-2") ||
			strings.Contains(source, "rounded-md py-2 pr-9") {
			t.Fatalf("%s still applies fixed-height vertical padding that clips text", file)
		}
	}

	appStyles, err := os.ReadFile("app/src/index.css")
	if err != nil {
		t.Fatal(err)
	}
	styleSource := string(appStyles)
	for _, expected := range []string{
		`[data-slot="native-select"],`,
		`[data-slot="select-trigger"]`,
		`padding-block: 0`,
		`line-height: var(--text-body--line-height, 1rem)`,
	} {
		if !strings.Contains(styleSource, expected) {
			t.Fatalf("application select typography does not expose %q", expected)
		}
	}
}
