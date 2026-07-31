package ctf

import "testing"

func TestTrainingPlatformsExposeOnlyWorkingSourcesAsSelectable(t *testing.T) {
	platforms := TrainingPlatforms()
	if len(platforms) != 4 {
		t.Fatalf("unexpected platform registry: %#v", platforms)
	}
	selectable := make(map[string]bool, len(platforms))
	status := make(map[string]PlatformIntegrationStatus, len(platforms))
	for _, platform := range platforms {
		selectable[platform.ID] = platform.Selectable
		status[platform.ID] = platform.Status
		if platform.Name == "" || platform.Experience == "" || platform.Adapter == "" ||
			len(platform.Capabilities) == 0 || platform.SourceURL == "" {
			t.Fatalf("incomplete platform definition: %#v", platform)
		}
	}
	if !selectable["nssctf"] || !selectable["ctfshow"] {
		t.Fatalf("working platform adapters must be selectable: %#v", platforms)
	}
	if selectable["hackthebox"] || status["hackthebox"] != PlatformRestricted {
		t.Fatalf("permission-gated HTB Labs must stay restricted: %#v", platforms)
	}
	if selectable["tryhackme"] || status["tryhackme"] != PlatformRestricted {
		t.Fatalf("TryHackMe consumer users must not be promised an unavailable API: %#v", platforms)
	}
}
