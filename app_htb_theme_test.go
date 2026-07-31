package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLabsThemeAndHTBCTFPlatformAreVisibleInTheDesktopProduct(t *testing.T) {
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
		"app/src/components-vue/SettingsPage.vue",
		"Hack The Box CTF (Beta)",
		"HTB Profile Settings → MCP Access",
		"probe_htb_ctf",
		"连接测试",
	)
	assertSourceContains(
		"app/src/components-vue/CTFPage.vue",
		"activeBank === 'hackthebox'",
		"<HTBCTFDesk",
		`:configured="htbReady"`,
		`@select-event="htb.loadEvent"`,
		`@start-challenge="startHTBChallenge"`,
		"isHTBWorkspace",
		"htb.submitFlag",
		"提交到 HTB",
		`:disabled="platform.status === 'restricted'"`,
	)
	assertSourceContains(
		"app/src/components-vue/HTBCTFDesk.vue",
		"Hack The Box CTF",
		"官方 MCP",
		"配置 HTB Token",
		"details.challenges",
		"用 Agent 开始",
		"<CTFCollaborationModePicker",
	)
	assertSourceContains(
		"app.go",
		"func (a *App) ListHTBCTFEvents()",
		"func (a *App) GetHTBCTFEvent(id int64)",
		"func (a *App) StartHTBCTFChallenge(",
		"func (a *App) SubmitHTBCTFFlag(",
		"func (a *App) StopHTBCTFContainer(",
	)

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
