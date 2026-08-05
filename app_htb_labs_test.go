package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLabsThemeAndHTBLabsPlatformAreVisibleWithoutCTFProduct(t *testing.T) {
	repositoryRoot, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	assertSourceContains := func(relativePath string, fragments ...string) {
		t.Helper()
		data, readErr := os.ReadFile(filepath.Join(repositoryRoot, relativePath))
		if readErr != nil {
			t.Fatal(readErr)
		}
		source := string(data)
		for _, fragment := range fragments {
			if !strings.Contains(source, fragment) {
				t.Fatalf("%s does not expose %q", relativePath, fragment)
			}
		}
	}

	assertSourceContains(
		"app/src/index.css",
		"--background: #101927",
		"--card: #151f2e",
		"--muted-foreground: #8799b5",
		"--brand: #9fef00",
		"--btn-primary: var(--brand)",
		"--terminal-cursor: var(--brand)",
	)
	assertSourceContains(
		"app/src/components-vue/CTFPage.vue",
		"activeBank === 'hackthebox'",
		"HTB Labs",
		"Machines",
		"Starting Point",
		"仅人工训练",
		"https://app.hackthebox.com/machines",
	)
	assertSourceContains(
		"internal/ctf/platform_registry.go",
		`Experience: "interactive-lab"`,
		`Status: PlatformRestricted`,
		`Adapter: "permission-gated-official-labs"`,
		`"machines", "starting-point", "challenges", "human-only", "written-permission"`,
		`SourceURL:   "https://app.hackthebox.com/machines"`,
	)

	for _, path := range []string{
		"app/src/components-vue/HTBCTFDesk.vue",
		"app/src/composables/useHTBCTF.ts",
		"internal/htb/ctf.go",
		"internal/htb/mcp.go",
	} {
		if _, statErr := os.Stat(filepath.Join(repositoryRoot, path)); !os.IsNotExist(statErr) {
			t.Fatalf("obsolete HTB CTF integration still exists: %s", path)
		}
	}

	for _, name := range []string{
		"htb-labs-challenges-reference.png",
		"htb-labs-machines-reference.png",
	} {
		info, statErr := os.Stat(filepath.Join(repositoryRoot, "docs", "design", name))
		if statErr != nil {
			t.Fatal(statErr)
		}
		if info.Size() < 10_000 {
			t.Fatalf("%s is not a usable visual reference", name)
		}
	}
}
