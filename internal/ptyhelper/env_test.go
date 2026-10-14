package ptyhelper

import (
	"strings"
	"testing"
)

func TestSanitizeEnvironmentKeepsDeveloperEnvironmentWithoutModelCredentials(t *testing.T) {
	environment := sanitizeEnvironment([]string{
		"PATH=/custom/bin",
		"SSH_AUTH_SOCK=/private/tmp/agent.sock",
		"OPENAI_API_KEY=provider-secret",
		"TERM=dumb",
		"COLORTERM=false",
	})
	joined := strings.Join(environment, "\n")
	for _, expected := range []string{
		"PATH=/custom/bin",
		"SSH_AUTH_SOCK=/private/tmp/agent.sock",
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"MILKSU_TERMINAL=1",
	} {
		if !strings.Contains(joined, expected) {
			t.Fatalf("terminal environment is missing %q", expected)
		}
	}
	if strings.Contains(joined, "OPENAI_API_KEY") {
		t.Fatal("provider credential leaked into terminal environment")
	}
}
