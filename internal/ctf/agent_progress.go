package ctf

import (
	"strings"
	"time"
	"unicode"
)

const AgentProgressSchemaVersion = "ctf-agent-progress.milksu.dev/v1alpha1"

type AgentProgress struct {
	SchemaVersion      string    `json:"schemaVersion"`
	Phase              string    `json:"phase"`
	LastVerifiedFact   string    `json:"lastVerifiedFact,omitempty"`
	CurrentHypothesis  string    `json:"currentHypothesis,omitempty"`
	NextAction         string    `json:"nextAction,omitempty"`
	StrategyNextAction string    `json:"strategyNextAction,omitempty"`
	DeadEnds           []string  `json:"deadEnds"`
	NeedsReplan        bool      `json:"needsReplan"`
	ReplanReason       string    `json:"replanReason,omitempty"`
	RecommendedRole    string    `json:"recommendedRole"`
	UpdatedAt          time.Time `json:"updatedAt"`
}

func buildAgentProgress(
	notes, strategyReview []byte,
	checkpoint AgentRunCheckpoint,
) AgentProgress {
	noteSections := markdownSections(string(notes))
	strategySections := markdownSections(string(strategyReview))

	progress := AgentProgress{
		SchemaVersion:   AgentProgressSchemaVersion,
		Phase:           "首轮分诊",
		DeadEnds:        []string{},
		RecommendedRole: AgentWorkspaceRoleSolver,
		UpdatedAt:       checkpoint.UpdatedAt.UTC(),
	}
	progress.LastVerifiedFact = lastVerifiedFact(
		findSection(noteSections, "已确认事实", "confirmed facts", "facts"),
	)
	progress.CurrentHypothesis = currentHypothesis(
		findSection(noteSections, "当前假设", "current hypothesis", "hypotheses"),
	)
	progress.NextAction = lastSectionItem(
		findSection(noteSections, "下一步", "next action", "next step"),
	)
	progress.DeadEnds = boundedSectionItems(
		findSection(noteSections, "失败分支", "已证伪路线", "dead ends", "failed branches"),
		3,
	)
	progress.StrategyNextAction = lastSectionItem(
		findSection(
			strategySections,
			"信息增益最高的唯一下一步",
			"唯一下一步",
			"最高信息增益",
			"next action",
			"next step",
		),
	)
	if progress.NextAction == "" {
		progress.NextAction = progress.StrategyNextAction
	}

	switch checkpoint.ExitReason {
	case "same-tool-call-repeated":
		progress.NeedsReplan = true
		progress.ReplanReason = "连续重复同一工具调用"
	case "same-tool-failure-repeated":
		progress.NeedsReplan = true
		progress.ReplanReason = "同一工具连续失败"
	}
	if checkpoint.RepeatedToolUses >= 3 && !progress.NeedsReplan {
		progress.NeedsReplan = true
		progress.ReplanReason = "连续重复同一工具调用"
	}
	if checkpoint.RepeatedFailures >= 3 && !progress.NeedsReplan {
		progress.NeedsReplan = true
		progress.ReplanReason = "同一工具连续失败"
	}

	switch {
	case checkpoint.CandidateCount > 0:
		progress.Phase = "候选复核"
	case progress.NeedsReplan:
		progress.Phase = "卡关复盘"
		progress.RecommendedRole = AgentWorkspaceRoleStrategist
	case progress.CurrentHypothesis != "" || progress.NextAction != "":
		progress.Phase = "验证中"
	case checkpoint.Metrics.ToolCalls > 0 || progress.LastVerifiedFact != "":
		progress.Phase = "探索中"
	}
	return progress
}

func markdownSections(value string) map[string][]string {
	sections := make(map[string][]string)
	current := ""
	for _, rawLine := range strings.Split(strings.ReplaceAll(value, "\r\n", "\n"), "\n") {
		line := strings.TrimSpace(rawLine)
		if strings.HasPrefix(line, "## ") {
			current = normalizeSectionName(strings.TrimSpace(strings.TrimPrefix(line, "## ")))
			continue
		}
		if current == "" || line == "" {
			continue
		}
		sections[current] = append(sections[current], line)
	}
	return sections
}

func normalizeSectionName(value string) string {
	value = strings.TrimSpace(strings.ToLower(value))
	return strings.Join(strings.FieldsFunc(value, func(r rune) bool {
		return unicode.IsSpace(r) || strings.ContainsRune("：:·—–-_/", r)
	}), "")
}

func findSection(sections map[string][]string, names ...string) []string {
	for _, name := range names {
		normalized := normalizeSectionName(name)
		if lines, ok := sections[normalized]; ok {
			return lines
		}
	}
	for section, lines := range sections {
		for _, name := range names {
			normalized := normalizeSectionName(name)
			if strings.Contains(section, normalized) || strings.Contains(normalized, section) {
				return lines
			}
		}
	}
	return nil
}

func currentHypothesis(lines []string) string {
	var fallback string
	for _, line := range lines {
		cells := markdownTableCells(line)
		if len(cells) >= 4 {
			if isTableHeader(cells) {
				continue
			}
			status := strings.ToLower(cells[len(cells)-1])
			if containsAny(
				status,
				"反驳", "证伪", "失败", "排除", "rejected", "false", "failed", "closed",
			) {
				continue
			}
			if hypothesis := cleanProgressLine(cells[0]); hypothesis != "" {
				fallback = hypothesis
			}
			continue
		}
		if item := cleanProgressLine(line); item != "" {
			fallback = item
		}
	}
	return fallback
}

func lastSectionItem(lines []string) string {
	items := boundedSectionItems(lines, 1)
	if len(items) == 0 {
		return ""
	}
	return items[len(items)-1]
}

func lastVerifiedFact(lines []string) string {
	for index := len(lines) - 1; index >= 0; index-- {
		item := cleanProgressLine(lines[index])
		if item == "" || isProgressHousekeeping(item) {
			continue
		}
		return item
	}
	return ""
}

func isProgressHousekeeping(value string) bool {
	normalized := strings.ToLower(value)
	return containsAny(
		normalized,
		"memory.md",
		"notes.md",
		"candidate-flags.txt",
		"evidence/run.json",
		"无相关旧结论",
		"没有匹配的旧题",
		"workspace 已",
		"工作区已",
	)
}

func boundedSectionItems(lines []string, limit int) []string {
	if limit <= 0 {
		return []string{}
	}
	items := make([]string, 0, min(limit, len(lines)))
	for _, line := range lines {
		if len(markdownTableCells(line)) > 1 {
			continue
		}
		item := cleanProgressLine(line)
		if item == "" {
			continue
		}
		items = append(items, item)
		if len(items) > limit {
			items = items[len(items)-limit:]
		}
	}
	return items
}

func markdownTableCells(line string) []string {
	line = strings.TrimSpace(line)
	if !strings.Contains(line, "|") {
		return nil
	}
	line = strings.Trim(line, "|")
	rawCells := strings.Split(line, "|")
	cells := make([]string, 0, len(rawCells))
	for _, cell := range rawCells {
		cells = append(cells, strings.TrimSpace(cell))
	}
	return cells
}

func isTableHeader(cells []string) bool {
	for _, cell := range cells {
		normalized := strings.Trim(strings.TrimSpace(cell), "-:")
		if normalized == "" {
			continue
		}
		if containsAny(strings.ToLower(cell), "假设", "依据", "验证方法", "状态", "hypothesis", "status") {
			return true
		}
		return false
	}
	return true
}

func cleanProgressLine(value string) string {
	value = strings.TrimSpace(value)
	if value == "" ||
		strings.HasPrefix(value, "<!--") ||
		strings.HasPrefix(value, "```") ||
		isMarkdownDivider(value) {
		return ""
	}
	value = strings.TrimSpace(strings.TrimLeft(value, "-*+>"))
	if index := strings.Index(value, ". "); index > 0 && index <= 3 {
		numeric := true
		for _, char := range value[:index] {
			if char < '0' || char > '9' {
				numeric = false
				break
			}
		}
		if numeric {
			value = strings.TrimSpace(value[index+2:])
		}
	}
	value = strings.ReplaceAll(value, "**", "")
	value = strings.ReplaceAll(value, "__", "")
	value = strings.Trim(value, "` ")
	return truncateRunes(value, 240)
}

func isMarkdownDivider(value string) bool {
	value = strings.ReplaceAll(value, " ", "")
	value = strings.ReplaceAll(value, "|", "")
	value = strings.ReplaceAll(value, ":", "")
	value = strings.ReplaceAll(value, "-", "")
	return value == ""
}

func containsAny(value string, needles ...string) bool {
	for _, needle := range needles {
		if strings.Contains(value, strings.ToLower(needle)) {
			return true
		}
	}
	return false
}
