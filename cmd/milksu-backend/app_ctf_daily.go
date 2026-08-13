package main

import (
	"fmt"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/nssctf"
	"github.com/MilkSU-Official/milksu/internal/sessionindex"
)

func (a *App) RecommendCTFDailyChallenge(
	dateKey string,
	excludedProblemIDs []int,
) (nssctf.DailyChallengeSelection, error) {
	dateKey = strings.TrimSpace(dateKey)
	if len(dateKey) != len("2006-01-02") {
		dateKey = time.Now().Format("2006-01-02")
	}
	dashboard, err := a.GetNSSCTFTrainingDashboard()
	if err != nil {
		return nssctf.DailyChallengeSelection{}, err
	}
	excluded := make(map[int]struct{}, len(excludedProblemIDs))
	for _, id := range excludedProblemIDs {
		excluded[id] = struct{}{}
	}
	candidates := make([]nssctf.Recommendation, 0, len(dashboard.Recommendations))
	for _, candidate := range dashboard.Recommendations {
		if _, skip := excluded[candidate.Problem.PlatformID]; skip {
			continue
		}
		candidates = append(candidates, candidate)
	}
	fallback, err := nssctf.RuleDailyChallenge(dateKey, candidates)
	if err != nil {
		return nssctf.DailyChallengeSelection{}, err
	}
	prompt, err := nssctf.DailyChallengePrompt(nssctf.DailyChallengeContext{
		DateKey:        dateKey,
		Candidates:     candidates,
		Dimensions:     dashboard.Dimensions,
		RecentActivity: a.dailyCTFRecentActivity(),
		Memories:       a.dailyCTFMemories(),
	})
	if err != nil {
		return fallback, nil
	}
	generated, err := a.engines.GenerateText(prompt, a.settings.GetResolved())
	if err != nil {
		return fallback, nil
	}
	selection, err := nssctf.ProjectDailyChallenge(
		generated.Text,
		dateKey,
		candidates,
		generated.Provider,
		generated.Model,
	)
	if err != nil {
		return fallback, nil
	}
	return selection, nil
}

func (a *App) dailyCTFRecentActivity() []string {
	activities := make([]string, 0, 12)
	if summaries, err := a.ctfJobs.ListJobs(a.commandContext()); err == nil {
		sort.SliceStable(summaries, func(left, right int) bool {
			return summaries[left].UpdatedAt.After(summaries[right].UpdatedAt)
		})
		for _, summary := range summaries {
			if len(activities) >= 6 {
				break
			}
			activities = append(activities, dailyCTFSnippet(fmt.Sprintf(
				"训练：%s · %s · %s",
				summary.Title,
				summary.Category,
				summary.Status,
			), 220))
		}
	}
	conversations, err := a.conversations.List()
	if err != nil {
		return activities
	}
	for _, conversation := range conversations {
		if len(activities) >= 12 || strings.TrimSpace(conversation.CTFJobID) == "" {
			continue
		}
		latestUserMessage := ""
		for index := len(conversation.Messages) - 1; index >= 0; index-- {
			if conversation.Messages[index].Role == "user" {
				latestUserMessage = conversation.Messages[index].Content
				break
			}
		}
		activities = append(activities, dailyCTFSnippet(fmt.Sprintf(
			"Coding 对话：%s；用户最近请求：%s",
			conversation.Title,
			latestUserMessage,
		), 260))
	}
	return activities
}

func (a *App) dailyCTFMemories() []string {
	if a.ctfMemory == nil {
		return nil
	}
	memories, err := a.ctfMemory.Recall(a.commandContext(), "", "", 8)
	if err != nil {
		return nil
	}
	result := make([]string, 0, len(memories))
	for _, memory := range a.attributeCTFMemories(memories) {
		result = append(result, dailyCTFSnippet(fmt.Sprintf(
			"%s：%s；类别 %s；贡献 %s/%s；验证 %s",
			memory.Title,
			memory.Summary,
			memory.Category,
			memory.Actor,
			memory.Assistance,
			memory.Verification,
		), 320))
	}
	return result
}

func dailyCTFSnippet(value string, limit int) string {
	value = strings.Join(strings.Fields(sessionindex.RedactSnippet(value)), " ")
	if utf8.RuneCountInString(value) <= limit {
		return value
	}
	runes := []rune(value)
	return string(runes[:limit]) + "…"
}
