package ptyhelper

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
)

func sanitizeEnvironment(source []string) []string {
	blocked := map[string]struct{}{
		"ANTHROPIC_API_KEY": {},
		"DEEPSEEK_API_KEY":  {},
		"GEMINI_API_KEY":    {},
		"GOOGLE_API_KEY":    {},
		"GROQ_API_KEY":      {},
		"KOURICHAT_API_KEY": {},
		"MILKSU_RELAY_KEY":  {},
		"MISTRAL_API_KEY":   {},
		"OPENAI_API_KEY":    {},
	}
	environment := make([]string, 0, len(source)+3)
	hasPath := false
	for _, entry := range source {
		name, _, found := strings.Cut(entry, "=")
		if !found {
			continue
		}
		if _, denied := blocked[name]; denied {
			continue
		}
		switch name {
		case "TERM", "COLORTERM", "MILKSU_TERMINAL":
			continue
		case "PATH":
			hasPath = true
		}
		environment = append(environment, entry)
	}
	if !hasPath {
		if runtime.GOOS == "windows" {
			systemRoot := strings.TrimSpace(os.Getenv("SystemRoot"))
			if systemRoot == "" {
				systemRoot = `C:\Windows`
			}
			environment = append(environment, "PATH="+filepath.Join(systemRoot, "System32"))
		} else {
			environment = append(environment, "PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin")
		}
	}
	environment = append(
		environment,
		"TERM=xterm-256color",
		"COLORTERM=truecolor",
		"MILKSU_TERMINAL=1",
	)
	return environment
}
