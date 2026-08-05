package main

import (
	"context"
	"fmt"
	"net/url"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/browsercap"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/ctfshow"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

type CTFShowCatalogStatus struct {
	Bridge              browsercap.BridgeInfo   `json:"bridge"`
	Pages               []browsercap.SharedPage `json:"pages"`
	Catalog             ctfshow.CatalogSnapshot `json:"catalog"`
	AttemptedProblemIDs []int                   `json:"attemptedProblemIds"`
	CompletedProblemIDs []int                   `json:"completedProblemIds"`
}

type CTFShowChallengeWorkspace struct {
	Challenge ctfshow.ChallengeCapture `json:"challenge"`
	CTF       ctf.Projection           `json:"ctf"`
}

type CTFShowWebSubmission struct {
	Receipt ctfshow.JudgeReceipt `json:"receipt"`
	CTF     ctf.Projection       `json:"ctf"`
}

func (a *App) GetCTFShowCatalogStatus() (CTFShowCatalogStatus, error) {
	info, err := a.browserBridge.StartBridge()
	if err != nil {
		return CTFShowCatalogStatus{}, err
	}
	catalog, err := a.ctfshowCatalog.Snapshot(a.commandContext())
	if err != nil {
		return CTFShowCatalogStatus{}, err
	}
	projections, err := a.trainingProjections()
	if err != nil {
		return CTFShowCatalogStatus{}, err
	}
	attempted, completed := ctfshowTrainingProgress(catalog.Problems, projections)
	return CTFShowCatalogStatus{
		Bridge: info, Pages: a.browserBridge.CTFShowPages(), Catalog: catalog,
		AttemptedProblemIDs: attempted, CompletedProblemIDs: completed,
	}, nil
}

func ctfshowTrainingProgress(
	problems []ctfshow.CatalogProblem,
	projections []ctf.Projection,
) ([]int, []int) {
	progress := make(map[int]struct {
		attempted bool
		completed bool
	}, len(projections))
	for _, projection := range projections {
		if projection.Challenge.ExternalPlatform != "ctfshow-web" ||
			projection.Challenge.ExternalAttemptID <= 0 {
			continue
		}
		problemID := int(projection.Challenge.ExternalAttemptID)
		value := progress[problemID]
		value.attempted = true
		value.completed = value.completed ||
			projection.Outcome != nil &&
				projection.Outcome.Status == securityruntime.OutcomeSucceeded
		progress[problemID] = value
	}
	attempted := make([]int, 0, len(problems))
	completed := make([]int, 0, len(problems))
	for _, problem := range problems {
		value := progress[problem.PlatformID]
		if value.attempted {
			attempted = append(attempted, problem.PlatformID)
		}
		if value.completed {
			completed = append(completed, problem.PlatformID)
		}
	}
	return attempted, completed
}

func (a *App) OpenCTFShowChallenges(rawURL string) error {
	target := "https://ctf.show/challenges"
	if strings.TrimSpace(rawURL) != "" {
		parsed, err := url.Parse(strings.TrimSpace(rawURL))
		if err != nil || parsed.Scheme != "https" || parsed.Hostname() != "ctf.show" ||
			parsed.Port() != "" || parsed.User != nil || parsed.Path != "/challenges" {
			return fmt.Errorf("invalid CTFshow challenge URL")
		}
		target = parsed.String()
	}
	if a.ctx == nil {
		return fmt.Errorf("desktop runtime is not ready")
	}
	wailsruntime.BrowserOpenURL(a.ctx, target)
	return nil
}

func (a *App) ImportCTFShowChallenge(
	problemID int,
	collaborationMode string,
	localMaterials []ctf.MaterialRequest,
) (CTFShowChallengeWorkspace, error) {
	if problemID <= 0 {
		return CTFShowChallengeWorkspace{}, fmt.Errorf("invalid CTFshow challenge id")
	}
	if _, err := a.browserBridge.StartBridge(); err != nil {
		return CTFShowChallengeWorkspace{}, err
	}
	catalog, err := a.ctfshowCatalog.Snapshot(a.commandContext())
	if err != nil {
		return CTFShowChallengeWorkspace{}, err
	}
	found := false
	for _, problem := range catalog.Problems {
		if problem.PlatformID == problemID {
			found = true
			break
		}
	}
	if !found {
		return CTFShowChallengeWorkspace{}, fmt.Errorf(
			"CTFshow #%d 不在本地目录中；请先用 Chrome 扩展同步题库",
			problemID,
		)
	}
	pages := a.browserBridge.CTFShowPages()
	page := latestCTFShowPage(pages)
	if page == nil {
		return CTFShowChallengeWorkspace{}, fmt.Errorf(
			"请先在已登录的 CTFshow 页面使用 MilkSU 扩展同步题库",
		)
	}
	importContext, cancel := context.WithTimeout(a.commandContext(), 65*time.Second)
	defer cancel()
	challenge, err := a.browserBridge.FetchCTFShowChallenge(
		importContext,
		page.ID,
		problemID,
	)
	if err != nil {
		return CTFShowChallengeWorkspace{}, fmt.Errorf("CTFshow 题目导入失败: %w", err)
	}
	materials := make([]ctf.MaterialRequest, 0, len(challenge.Materials)+len(localMaterials))
	materials = append(materials, localMaterials...)
	for _, material := range challenge.Materials {
		materials = append(materials, ctf.MaterialRequest{
			Name: material.Name, MediaType: material.MediaType,
			DataBase64: material.DataBase64, Provenance: material.Provenance,
		})
	}
	mode := strings.ToLower(strings.TrimSpace(collaborationMode))
	if mode == "" {
		mode = "copilot"
	}
	statement := challenge.Statement
	if len(challenge.Warnings) > 0 {
		statement += "\n\n导入提示：" + strings.Join(challenge.Warnings, "；")
	}
	projection, err := a.ctfJobs.StartChallenge(a.commandContext(), ctf.ChallengeRequest{
		Title: challenge.Title, Statement: statement,
		Category:          strings.ToLower(strings.TrimSpace(challenge.Category)),
		CollaborationMode: mode, DeferAgent: true,
		TrackName:  "CTFshow 真实题库",
		HumanGoal:  "在真实 CTFshow 题目中形成可复现解题过程，并由平台 Judge 回执确认结果。",
		SourceKind: "url", SourceURI: challenge.SourceURL,
		ExternalPlatform: "ctfshow-web", ExternalAttemptID: int64(problemID),
		KnowledgePoints: append([]string{}, challenge.Tags...),
		Materials:       materials,
	})
	if err != nil {
		return CTFShowChallengeWorkspace{}, err
	}
	return CTFShowChallengeWorkspace{Challenge: challenge, CTF: projection}, nil
}

func (a *App) SubmitCTFShowWebFlag(
	jobID, candidate string,
) (CTFShowWebSubmission, error) {
	projection, err := a.ctfJobs.GetJob(a.commandContext(), jobID)
	if err != nil {
		return CTFShowWebSubmission{}, err
	}
	if projection.Challenge.ExternalPlatform != "ctfshow-web" ||
		projection.Challenge.ExternalAttemptID <= 0 {
		return CTFShowWebSubmission{}, fmt.Errorf("CTF job is not linked to a CTFshow challenge")
	}
	if _, err := a.browserBridge.StartBridge(); err != nil {
		return CTFShowWebSubmission{}, err
	}
	pages := a.browserBridge.CTFShowPages()
	page := latestCTFShowPage(pages)
	if page == nil {
		return CTFShowWebSubmission{}, fmt.Errorf(
			"请先在已登录的 CTFshow 页面使用 MilkSU 扩展连接题库",
		)
	}
	wrongCount := 0
	for _, submission := range projection.Submissions {
		if submission.Verdict == securityruntime.VerdictFail {
			wrongCount++
		}
	}
	pending, err := a.ctfJobs.PrepareExternalSubmission(
		a.commandContext(),
		jobID,
		candidate,
		"候选由 MilkSU CTF harness 产生，并通过已配对的 CTFshow 浏览器标签页提交。",
		wrongCount,
	)
	if err != nil {
		return CTFShowWebSubmission{}, err
	}
	submitContext, cancel := context.WithTimeout(a.commandContext(), 25*time.Second)
	defer cancel()
	receipt, err := a.browserBridge.SubmitCTFShowFlag(
		submitContext,
		page.ID,
		int(projection.Challenge.ExternalAttemptID),
		candidate,
	)
	if err != nil {
		return CTFShowWebSubmission{CTF: pending}, fmt.Errorf("CTFshow 浏览器提交失败: %w", err)
	}
	withReceipt, err := a.ctfJobs.RecordExternalJudgeReceipt(
		a.commandContext(),
		jobID,
		ctf.ExternalJudgeReceiptRequest{
			Platform: "ctfshow-web", Status: receipt.Status, Correct: receipt.Correct,
			Summary: receipt.Message, Reference: receipt.URL + "&command=" + receipt.CommandID,
		},
	)
	if err != nil {
		return CTFShowWebSubmission{}, err
	}
	if receipt.Correct == nil {
		return CTFShowWebSubmission{Receipt: receipt, CTF: withReceipt}, fmt.Errorf(
			"CTFshow Judge 回执不明确：%s",
			receipt.Message,
		)
	}
	summary := fmt.Sprintf(
		"CTFshow browser Judge for #%d returned %s: %s",
		receipt.ProblemID,
		receipt.Status,
		receipt.Message,
	)
	recorded, err := a.ctfJobs.RecordExternalVerdict(
		a.commandContext(),
		jobID,
		*receipt.Correct,
		summary,
	)
	if err != nil {
		return CTFShowWebSubmission{}, err
	}
	return CTFShowWebSubmission{Receipt: receipt, CTF: recorded}, nil
}

func latestCTFShowPage(pages []browsercap.SharedPage) *browsercap.SharedPage {
	var selected *browsercap.SharedPage
	for _, page := range pages {
		if page.CTFShow == nil || !page.CTFShow.LoggedIn || !page.Connected {
			continue
		}
		if selected == nil || page.CapturedAt.After(selected.CapturedAt) {
			value := page
			selected = &value
		}
	}
	return selected
}
