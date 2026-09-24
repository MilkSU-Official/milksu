package companion

import (
	"context"
	"strings"
)

// Provisional cut until a real call sample replaces it. 0.5 on a noul means
// the classifier cannot tell yes from no.
const jevYesThreshold = 0.5

const hostNoticePrefix = "companion-host-notice"

const memoryGateInstructions = "Is this a durable fact about this person (a stable preference, form of address, or standing habit), rather than a one-off fragment, a task update, or small talk?"

const speakGateInstructions = "Should the companion speak to the user about this event now? Say yes only when a short update would help. Say no for routine progress."

// NoulJudge is one Jev yes/no. An error means the call did not produce a probability.
type NoulJudge func(ctx context.Context, state any, instructions string) (float64, error)

func keepMemoryItem(ctx context.Context, judge NoulJudge, userText string, item MemoryCommit) bool {
	if judge == nil {
		return true
	}
	yes, err := judge(ctx, map[string]string{
		"user":     strings.TrimSpace(userText),
		"title":    strings.TrimSpace(item.Title),
		"markdown": strings.TrimSpace(item.Markdown),
		"evidence": strings.TrimSpace(item.Evidence),
	}, memoryGateInstructions)
	if err != nil {
		return false
	}
	return yes >= jevYesThreshold
}

func speaksWithoutDecision(kind string) bool {
	switch strings.TrimSpace(kind) {
	case "settled", "completed", "needs_approval", "error":
		return true
	default:
		return false
	}
}

func shouldSpeak(ctx context.Context, judge NoulJudge, title, kind, task string) bool {
	if speaksWithoutDecision(kind) {
		return true
	}
	if strings.TrimSpace(kind) != "stall" {
		return false
	}
	if judge == nil {
		return false
	}
	yes, err := judge(ctx, map[string]string{
		"title": strings.TrimSpace(title),
		"event": "stall",
		"task":  strings.TrimSpace(task),
	}, speakGateInstructions)
	if err != nil {
		return false
	}
	return yes >= jevYesThreshold
}

func mergeHostNotice(current, next string) string {
	current = strings.TrimSpace(current)
	next = strings.TrimSpace(next)
	if current == "" || current == next {
		return next
	}
	if next == "" {
		return current
	}
	lines := strings.Split(next, "\n")
	extra := next
	if len(lines) >= 3 && lines[0] == hostNoticePrefix {
		extra = lines[1] + "\n" + lines[2]
	}
	if strings.Contains(current, extra) {
		return current
	}
	return current + "\n" + extra
}

func hostNoticePrompt(title, kind, locale string) string {
	title = strings.TrimSpace(title)
	kind = strings.TrimSpace(kind)
	line := "用一两句告诉用户。先说对话标题。不要念出第一行标记。"
	if strings.TrimSpace(locale) == "en" {
		line = "Tell the user in one or two sentences. Lead with the conversation title. Do not read the first marker line aloud."
	}
	return hostNoticePrefix + "\n" + title + "\n" + kind + "\n" + line
}

func imageHandoffLine(locale string) string {
	if strings.TrimSpace(locale) == "en" {
		return "The attached pictures are this turn's result. Use these, and do not look for a different file."
	}
	return "附上的图片就是这次的结果。用这几张，不要再去找别的文件。"
}

func isHostNoticeText(text string) bool {
	return strings.HasPrefix(strings.TrimSpace(text), hostNoticePrefix)
}

func companionImageHandoffText(text string) string {
	marker := "[MilkSU attachments]"
	index := strings.Index(text, marker)
	if index < 0 {
		return ""
	}
	return strings.TrimSpace(text[index:])
}
