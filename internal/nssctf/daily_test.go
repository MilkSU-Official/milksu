package nssctf

import (
	"strings"
	"testing"
)

func dailyCandidate(id int, title string, reason string) Recommendation {
	return Recommendation{
		Problem: CatalogProblem{PlatformID: id, Title: title, Category: "Web", Difficulty: 1.5},
		Kind:    "补短板",
		Reason:  reason,
	}
}

func TestDailyChallengePromptBoundsCandidateChoiceAndSeparatesContribution(t *testing.T) {
	prompt, err := DailyChallengePrompt(DailyChallengeContext{
		DateKey: "2026-08-13",
		Candidates: []Recommendation{
			dailyCandidate(10, "SSTI 入门", "需要补足模板注入"),
			dailyCandidate(20, "RSA 基础", "适合巩固数学基础"),
		},
		Dimensions: []AbilityDimension{{
			Label: "Web", ProfileAttempts: 3, IndependentSolved: 1, DelegatedSolved: 2,
		}},
		RecentActivity: []string{"最近在 SSTI 题中请求了提示"},
		Memories:       []string{"用户确认：容易漏掉模板上下文枚举"},
	})
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"P10 | SSTI 入门", "P20 | RSA 基础", "Agent 代做 2", "最近在 SSTI", "用户确认",
	} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("prompt missing %q:\n%s", expected, prompt)
		}
	}
}

func TestProjectDailyChallengeAcceptsOnlyBoundedJSONSelection(t *testing.T) {
	candidates := []Recommendation{
		dailyCandidate(10, "SSTI 入门", "规则理由"),
		dailyCandidate(20, "RSA 基础", "规则理由"),
	}
	selection, err := ProjectDailyChallenge(
		`{"problemId":20,"reason":"最近的 Web 练习较多，今天换个方向巩固密码学基础。"}`,
		"2026-08-13",
		candidates,
		"tokenflux",
		"grok-4.5",
	)
	if err != nil {
		t.Fatal(err)
	}
	if selection.Problem.PlatformID != 20 || selection.Source != "model" || selection.Model != "grok-4.5" {
		t.Fatalf("unexpected selection: %#v", selection)
	}
	if _, err := ProjectDailyChallenge(
		`{"problemId":99,"reason":"不在候选中。"}`,
		"2026-08-13", candidates, "", "",
	); err == nil {
		t.Fatal("out-of-candidate model selection was accepted")
	}
}

func TestRuleDailyChallengeIsAnExplainableFallback(t *testing.T) {
	selection, err := RuleDailyChallenge("2026-08-13", []Recommendation{
		dailyCandidate(10, "SSTI 入门", "近期错误集中在模板上下文识别。"),
	})
	if err != nil {
		t.Fatal(err)
	}
	if selection.Source != "rules" || selection.Reason != "近期错误集中在模板上下文识别。" {
		t.Fatalf("unexpected fallback: %#v", selection)
	}
}
