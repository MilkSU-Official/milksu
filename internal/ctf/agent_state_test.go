package ctf

import (
	"strings"
	"testing"
)

func TestRolePromptFollowsUILocale(t *testing.T) {
	chinese := rolePromptForLocale("zh")
	if !strings.Contains(chinese, "解题者") || !strings.Contains(chinese, "ctf.submit_flag") {
		t.Fatalf("chinese role prompt missing required facts")
	}
	if strings.Contains(chinese, "You are the solver") {
		t.Fatalf("chinese role prompt still starts in English")
	}

	english := rolePromptForLocale("en")
	if !strings.Contains(english, "You are the solver") || !strings.Contains(english, "ctf.submit_flag") {
		t.Fatalf("english role prompt missing required facts")
	}
	if strings.Contains(english, "解题者") {
		t.Fatalf("english role prompt carried the Chinese copy")
	}
}
