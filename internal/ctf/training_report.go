package ctf

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

const TrainingReportSchemaVersion = "ctf-training-report.milksu.dev/v1alpha1"

type TrainingReportMaterial struct {
	Name               string   `json:"name"`
	MediaType          string   `json:"mediaType"`
	SHA256             string   `json:"sha256"`
	Size               int64    `json:"size"`
	Provenance         string   `json:"provenance"`
	DetectedType       string   `json:"detectedType"`
	ArchiveFormat      string   `json:"archiveFormat,omitempty"`
	ExtractedFiles     int      `json:"extractedFiles"`
	ReviewRequired     bool     `json:"reviewRequired"`
	InspectionWarnings []string `json:"inspectionWarnings"`
}

type TrainingReportJudge struct {
	Platform   string    `json:"platform"`
	Status     string    `json:"status"`
	Correct    *bool     `json:"correct,omitempty"`
	Summary    string    `json:"summary"`
	Reference  string    `json:"reference"`
	RecordedAt time.Time `json:"recordedAt"`
}

type TrainingReportStats struct {
	Attempts         int `json:"attempts"`
	Experiments      int `json:"experiments"`
	Evidence         int `json:"evidence"`
	Artifacts        int `json:"artifacts"`
	CompletedTurns   int `json:"completedTurns"`
	ToolCalls        int `json:"toolCalls"`
	ToolErrors       int `json:"toolErrors"`
	Hints            int `json:"hints"`
	IndependentSteps int `json:"independentSteps"`
	Reflections      int `json:"reflections"`
	Candidates       int `json:"candidates"`
}

type TrainingReportToolWorkshop struct {
	Requests          []ToolRequestSummary `json:"requests"`
	ToolCount         int                  `json:"toolCount"`
	BuilderTurns      int                  `json:"builderTurns"`
	BuilderToolCalls  int                  `json:"builderToolCalls"`
	BuilderToolErrors int                  `json:"builderToolErrors"`
}

type TrainingReport struct {
	SchemaVersion         string                      `json:"schemaVersion"`
	GeneratedAt           time.Time                   `json:"generatedAt"`
	JobID                 string                      `json:"jobId"`
	Title                 string                      `json:"title"`
	TrackName             string                      `json:"trackName"`
	Category              string                      `json:"category"`
	CollaborationMode     string                      `json:"collaborationMode"`
	ExternalPlatform      string                      `json:"externalPlatform,omitempty"`
	SourceURI             string                      `json:"sourceUri,omitempty"`
	Status                string                      `json:"status"`
	Verified              bool                        `json:"verified"`
	OutcomeSummary        string                      `json:"outcomeSummary,omitempty"`
	KnowledgePoints       []string                    `json:"knowledgePoints"`
	Materials             []TrainingReportMaterial    `json:"materials"`
	ToolUsage             map[string]int              `json:"toolUsage"`
	ToolWorkshop          *TrainingReportToolWorkshop `json:"toolWorkshop,omitempty"`
	KeyObservations       []string                    `json:"keyObservations"`
	FailureBranches       []string                    `json:"failureBranches"`
	JudgeReceipts         []TrainingReportJudge       `json:"judgeReceipts"`
	Stats                 TrainingReportStats         `json:"stats"`
	LatestCandidateSHA256 string                      `json:"latestCandidateSha256,omitempty"`
	Markdown              string                      `json:"markdown,omitempty"`
}

type TrainingReportExport struct {
	Report       TrainingReport `json:"report"`
	JSONPath     string         `json:"jsonPath"`
	MarkdownPath string         `json:"markdownPath"`
}

func BuildTrainingReport(
	projection Projection,
	handoff AgentWorkspaceHandoff,
	replay AgentReplay,
	now time.Time,
) (TrainingReport, error) {
	if projection.Job.ID == "" ||
		projection.Job.ID != handoff.JobID ||
		projection.Job.ID != replay.JobID {
		return TrainingReport{}, fmt.Errorf("CTF training report inputs do not describe the same job")
	}
	if replay.ConversationID != handoff.ConversationID {
		return TrainingReport{}, fmt.Errorf("CTF training report replay does not match the Agent session")
	}
	report := TrainingReport{
		SchemaVersion:     TrainingReportSchemaVersion,
		GeneratedAt:       now.UTC(),
		JobID:             projection.Job.ID,
		Title:             projection.Challenge.Title,
		TrackName:         projection.Challenge.TrackName,
		Category:          projection.Challenge.Category,
		CollaborationMode: projection.Challenge.CollaborationMode,
		ExternalPlatform:  projection.Challenge.ExternalPlatform,
		SourceURI:         projection.Challenge.Source.URI,
		Status:            string(projection.Job.Status),
		KnowledgePoints:   append([]string{}, projection.Challenge.KnowledgePoints...),
		Materials:         []TrainingReportMaterial{},
		ToolUsage:         copyToolUsage(replay.Metrics.ToolUsage),
		KeyObservations:   append([]string{}, projection.Debrief.KeyObservations...),
		FailureBranches:   append([]string{}, projection.Debrief.FailureBranches...),
		JudgeReceipts:     []TrainingReportJudge{},
		Stats: TrainingReportStats{
			Attempts:         len(projection.Attempts),
			Experiments:      len(projection.Experiments),
			Evidence:         len(projection.Evidence),
			Artifacts:        len(projection.Artifacts),
			CompletedTurns:   replay.Metrics.CompletedTurns,
			ToolCalls:        replay.Metrics.ToolCalls,
			ToolErrors:       replay.Metrics.ToolErrors,
			Hints:            projection.HumanOutcome.HintCount,
			IndependentSteps: projection.HumanOutcome.IndependentSteps,
			Reflections:      projection.HumanOutcome.ReflectionCount,
			Candidates: max(
				handoff.Run.CandidateCount,
				max(len(projection.AgentCandidates), len(projection.Submissions)),
			),
		},
		LatestCandidateSHA256: handoff.Run.LatestCandidateSHA256,
	}
	if projection.Outcome != nil {
		report.Status = string(projection.Outcome.Status)
		report.OutcomeSummary = strings.TrimSpace(projection.Outcome.Summary)
	}
	for _, material := range handoff.Materials {
		report.Materials = append(report.Materials, TrainingReportMaterial{
			Name:               material.Name,
			MediaType:          material.MediaType,
			SHA256:             material.SHA256,
			Size:               material.Size,
			Provenance:         material.Provenance,
			DetectedType:       material.Inspection.DetectedType,
			ArchiveFormat:      material.Inspection.ArchiveFormat,
			ExtractedFiles:     len(material.ExtractedPaths),
			ReviewRequired:     material.Inspection.ReviewRequired,
			InspectionWarnings: append([]string{}, material.Inspection.Warnings...),
		})
	}
	for _, receipt := range projection.JudgeReceipts {
		report.JudgeReceipts = append(report.JudgeReceipts, TrainingReportJudge{
			Platform: receipt.Platform, Status: receipt.Status, Correct: receipt.Correct,
			Summary: receipt.Summary, Reference: receipt.Reference, RecordedAt: receipt.RecordedAt,
		})
		if receipt.Correct != nil && *receipt.Correct {
			report.Verified = true
		}
	}
	if strings.TrimSpace(handoff.WorkspacePath) != "" {
		if workshop, workshopErr := ReadToolWorkshopState(handoff.WorkspacePath); workshopErr == nil &&
			(len(workshop.Requests) > 0 || workshop.ToolCount > 0) {
			report.ToolWorkshop = &TrainingReportToolWorkshop{
				Requests:  append([]ToolRequestSummary{}, workshop.Requests...),
				ToolCount: workshop.ToolCount,
			}
			for _, run := range projection.AgentRuns {
				if !strings.HasPrefix(run.SessionID, "ctf_tool_") {
					continue
				}
				report.ToolWorkshop.BuilderTurns += run.Metrics.CompletedTurns
				report.ToolWorkshop.BuilderToolCalls += run.Metrics.ToolCalls
				report.ToolWorkshop.BuilderToolErrors += run.Metrics.ToolErrors
			}
		}
	}
	if projection.Outcome == nil ||
		projection.Outcome.Status != securityruntime.OutcomeSucceeded {
		report.Verified = false
	}
	redactTrainingReportCandidates(&report, projection)
	report.Markdown = renderTrainingReportMarkdown(report)
	return report, nil
}

func PersistTrainingReport(
	workspacePath string,
	report TrainingReport,
) (TrainingReportExport, error) {
	if report.SchemaVersion != TrainingReportSchemaVersion || report.JobID == "" {
		return TrainingReportExport{}, fmt.Errorf("invalid CTF training report")
	}
	jsonData, err := json.MarshalIndent(reportWithoutMarkdown(report), "", "  ")
	if err != nil {
		return TrainingReportExport{}, fmt.Errorf("encode CTF training report: %w", err)
	}
	jsonPath := filepath.Join(workspacePath, "evidence", "training-report.json")
	markdownPath := filepath.Join(workspacePath, "evidence", "training-report.md")
	if err := atomicWrite(jsonPath, append(jsonData, '\n'), 0o600); err != nil {
		return TrainingReportExport{}, err
	}
	if err := atomicWrite(markdownPath, []byte(report.Markdown), 0o600); err != nil {
		return TrainingReportExport{}, err
	}
	return TrainingReportExport{
		Report: report, JSONPath: jsonPath, MarkdownPath: markdownPath,
	}, nil
}

func reportWithoutMarkdown(report TrainingReport) TrainingReport {
	report.Markdown = ""
	return report
}

func copyToolUsage(source map[string]int) map[string]int {
	target := make(map[string]int, len(source))
	for name, count := range source {
		target[name] = count
	}
	return target
}

func redactTrainingReportCandidates(report *TrainingReport, projection Projection) {
	candidates := make([]string, 0, len(projection.AgentCandidates)+len(projection.Submissions))
	for _, candidate := range projection.AgentCandidates {
		candidates = appendCandidateSecret(candidates, candidate.Candidate)
	}
	for _, submission := range projection.Submissions {
		candidates = appendCandidateSecret(candidates, submission.Candidate)
	}
	redact := func(value string) string {
		for _, candidate := range candidates {
			value = strings.ReplaceAll(value, candidate, "[candidate redacted]")
		}
		return value
	}
	report.Title = redact(report.Title)
	report.TrackName = redact(report.TrackName)
	report.OutcomeSummary = redact(report.OutcomeSummary)
	for index := range report.KnowledgePoints {
		report.KnowledgePoints[index] = redact(report.KnowledgePoints[index])
	}
	for index := range report.KeyObservations {
		report.KeyObservations[index] = redact(report.KeyObservations[index])
	}
	for index := range report.FailureBranches {
		report.FailureBranches[index] = redact(report.FailureBranches[index])
	}
	for index := range report.Materials {
		report.Materials[index].Name = redact(report.Materials[index].Name)
		report.Materials[index].Provenance = redact(report.Materials[index].Provenance)
		for warningIndex := range report.Materials[index].InspectionWarnings {
			report.Materials[index].InspectionWarnings[warningIndex] = redact(
				report.Materials[index].InspectionWarnings[warningIndex],
			)
		}
	}
	for index := range report.JudgeReceipts {
		report.JudgeReceipts[index].Summary = redact(report.JudgeReceipts[index].Summary)
	}
	if report.ToolWorkshop != nil {
		for index := range report.ToolWorkshop.Requests {
			report.ToolWorkshop.Requests[index].Title = redact(
				report.ToolWorkshop.Requests[index].Title,
			)
			report.ToolWorkshop.Requests[index].Name = redact(
				report.ToolWorkshop.Requests[index].Name,
			)
		}
	}
}

func appendCandidateSecret(values []string, candidate string) []string {
	candidate = strings.TrimSpace(candidate)
	if candidate == "" {
		return values
	}
	for _, existing := range values {
		if existing == candidate {
			return values
		}
	}
	return append(values, candidate)
}

func renderTrainingReportMarkdown(report TrainingReport) string {
	var builder strings.Builder
	builder.WriteString("# MilkSU CTF 训练报告\n\n")
	writeReportLine(&builder, "题目", report.Title)
	writeReportLine(&builder, "训练轨道", report.TrackName)
	writeReportLine(&builder, "分类", report.Category)
	writeReportLine(&builder, "协作方式", report.CollaborationMode)
	writeReportLine(&builder, "平台", defaultString(report.ExternalPlatform, "本地/人工 Judge"))
	writeReportLine(&builder, "来源", report.SourceURI)
	writeReportLine(&builder, "状态", report.Status)
	writeReportLine(&builder, "独立 Judge 验证", map[bool]string{true: "已验证", false: "未验证"}[report.Verified])
	writeReportLine(&builder, "生成时间", report.GeneratedAt.Format(time.RFC3339))
	if report.OutcomeSummary != "" {
		builder.WriteString("\n## 结果\n\n")
		builder.WriteString(markdownText(report.OutcomeSummary) + "\n")
	}

	builder.WriteString("\n## 可复核指标\n\n")
	builder.WriteString("| 指标 | 数量 |\n| --- | ---: |\n")
	for _, metric := range []struct {
		label string
		value int
	}{
		{"Agent 完成回合", report.Stats.CompletedTurns},
		{"工具调用", report.Stats.ToolCalls},
		{"工具错误", report.Stats.ToolErrors},
		{"实验", report.Stats.Experiments},
		{"证据", report.Stats.Evidence},
		{"制品", report.Stats.Artifacts},
		{"提示", report.Stats.Hints},
		{"独立步骤", report.Stats.IndependentSteps},
		{"复盘", report.Stats.Reflections},
		{"候选（仅记录数量与哈希）", report.Stats.Candidates},
	} {
		builder.WriteString(fmt.Sprintf("| %s | %d |\n", metric.label, metric.value))
	}

	if len(report.ToolUsage) > 0 {
		builder.WriteString("\n## 工具使用\n\n")
		names := make([]string, 0, len(report.ToolUsage))
		for name := range report.ToolUsage {
			names = append(names, name)
		}
		sort.Strings(names)
		for _, name := range names {
			builder.WriteString(fmt.Sprintf("- `%s`: %d\n", markdownCode(name), report.ToolUsage[name]))
		}
	}
	if report.ToolWorkshop != nil {
		builder.WriteString("\n## 自制工具交接\n\n")
		builder.WriteString(fmt.Sprintf(
			"- Coding Agent：%d 回合 · %d 次工具调用 · %d 次错误\n",
			report.ToolWorkshop.BuilderTurns,
			report.ToolWorkshop.BuilderToolCalls,
			report.ToolWorkshop.BuilderToolErrors,
		))
		builder.WriteString(fmt.Sprintf(
			"- 工作区工具文件：%d\n",
			report.ToolWorkshop.ToolCount,
		))
		for _, request := range report.ToolWorkshop.Requests {
			builder.WriteString(fmt.Sprintf(
				"- `%s` · %s · %s\n",
				markdownCode(request.Status),
				markdownText(request.Title),
				markdownText(request.RelativePath),
			))
		}
	}
	writeReportList(&builder, "关键观察", report.KeyObservations)
	writeReportList(&builder, "失败分支", report.FailureBranches)
	writeReportList(&builder, "知识点", report.KnowledgePoints)

	if len(report.Materials) > 0 {
		builder.WriteString("\n## 材料完整性\n\n")
		for _, material := range report.Materials {
			builder.WriteString(fmt.Sprintf(
				"- %s · `%s` · %d bytes · 安全展开 %d 个文件 · SHA-256 `%s`\n",
				markdownText(material.Name),
				markdownCode(material.DetectedType),
				material.Size,
				material.ExtractedFiles,
				markdownCode(material.SHA256),
			))
			for _, warning := range material.InspectionWarnings {
				builder.WriteString("  - 预检：" + markdownText(warning) + "\n")
			}
		}
	}
	if len(report.JudgeReceipts) > 0 {
		builder.WriteString("\n## Judge 回执\n\n")
		for _, receipt := range report.JudgeReceipts {
			correct := "不明确"
			if receipt.Correct != nil {
				correct = map[bool]string{true: "通过", false: "未通过"}[*receipt.Correct]
			}
			builder.WriteString(fmt.Sprintf(
				"- %s · %s · %s · %s\n",
				markdownText(receipt.Platform),
				markdownText(receipt.Status),
				correct,
				markdownText(receipt.Summary),
			))
		}
	}
	if report.LatestCandidateSHA256 != "" {
		builder.WriteString("\n候选内容未写入可分享报告；最新候选 SHA-256：`" +
			markdownCode(report.LatestCandidateSHA256) + "`\n")
	}
	return builder.String()
}

func writeReportLine(builder *strings.Builder, label, value string) {
	if strings.TrimSpace(value) == "" {
		return
	}
	builder.WriteString("- " + label + "：" + markdownText(value) + "\n")
}

func writeReportList(builder *strings.Builder, heading string, values []string) {
	if len(values) == 0 {
		return
	}
	builder.WriteString("\n## " + heading + "\n\n")
	for _, value := range values {
		builder.WriteString("- " + markdownText(value) + "\n")
	}
}

func markdownText(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	replacer := strings.NewReplacer(
		"\\", "\\\\",
		"`", "\\`",
		"*", "\\*",
		"_", "\\_",
		"[", "\\[",
		"]", "\\]",
		"<", "\\<",
		">", "\\>",
		"#", "\\#",
	)
	return replacer.Replace(value)
}

func markdownCode(value string) string {
	return strings.ReplaceAll(strings.TrimSpace(value), "`", "")
}
