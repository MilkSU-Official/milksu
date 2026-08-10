package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/browsercap"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

func latestNSSCTFPage(
	pages []browsercap.SharedPage,
	problemID int64,
) *browsercap.SharedPage {
	var selected *browsercap.SharedPage
	for _, page := range pages {
		if page.NSSCTF == nil ||
			int64(page.NSSCTF.ProblemID) != problemID ||
			!page.Connected {
			continue
		}
		if selected == nil || page.CapturedAt.After(selected.CapturedAt) {
			value := page
			selected = &value
		}
	}
	return selected
}

type NSSCTFWebBridgeStatus struct {
	Bridge browsercap.BridgeInfo   `json:"bridge"`
	Pages  []browsercap.SharedPage `json:"pages"`
}

type NSSCTFWebSubmission struct {
	Receipt browsercap.NSSCTFJudgeReceipt `json:"receipt"`
	CTF     ctf.Projection                `json:"ctf"`
}

const maxNSSCTFPageMaterialBytes = 64 * 1024

func (a *App) GetNSSCTFWebBridgeStatus() (NSSCTFWebBridgeStatus, error) {
	info, err := a.browserBridge.StartBridge()
	if err != nil {
		return NSSCTFWebBridgeStatus{}, err
	}
	return NSSCTFWebBridgeStatus{Bridge: info, Pages: a.browserBridge.NSSCTFPages()}, nil
}

func (a *App) ImportNSSCTFWebPageMaterial(problemID int) (ctf.MaterialRequest, error) {
	if problemID <= 0 {
		return ctf.MaterialRequest{}, fmt.Errorf("invalid NSSCTF problem id")
	}
	if _, err := a.browserBridge.StartBridge(); err != nil {
		return ctf.MaterialRequest{}, err
	}
	page := latestNSSCTFPage(a.browserBridge.NSSCTFPages(), int64(problemID))
	if page == nil {
		return ctf.MaterialRequest{}, fmt.Errorf(
			"请先在 Chrome 打开 P%d，并用 MilkSU 扩展连接当前题目；已关闭的旧标签不会被复用",
			problemID,
		)
	}
	data, err := boundedNSSCTFPageText(page.Text)
	if err != nil {
		return ctf.MaterialRequest{}, err
	}
	digest := sha256.Sum256(data)
	digestText := hex.EncodeToString(digest[:])
	return ctf.MaterialRequest{
		Name:       fmt.Sprintf("nssctf-p%d-page.txt", problemID),
		MediaType:  "text/plain; charset=utf-8",
		DataBase64: base64.StdEncoding.EncodeToString(data),
		Provenance: fmt.Sprintf(
			"user-browser-extension:nssctf:P%d:page-text:sha256:%s",
			problemID,
			digestText,
		),
	}, nil
}

func boundedNSSCTFPageText(raw string) ([]byte, error) {
	normalized := strings.TrimSpace(strings.ReplaceAll(
		strings.ReplaceAll(raw, "\r\n", "\n"),
		"\r",
		"\n",
	))
	if normalized == "" {
		return nil, fmt.Errorf("已连接的 NSSCTF 页面没有可读取题面；将继续使用公开题面")
	}
	data := []byte(normalized)
	if len(data) <= maxNSSCTFPageMaterialBytes {
		return data, nil
	}
	data = data[:maxNSSCTFPageMaterialBytes]
	for len(data) > 0 && !utf8.Valid(data) {
		data = data[:len(data)-1]
	}
	if len(data) == 0 {
		return nil, fmt.Errorf("已连接的 NSSCTF 页面题面不是有效 UTF-8")
	}
	return data, nil
}

func (a *App) ImportNSSCTFWebAttachment(problemID int) (ctf.MaterialRequest, error) {
	if problemID <= 0 {
		return ctf.MaterialRequest{}, fmt.Errorf("invalid NSSCTF problem id")
	}
	if _, err := a.browserBridge.StartBridge(); err != nil {
		return ctf.MaterialRequest{}, err
	}
	page := latestNSSCTFPage(a.browserBridge.NSSCTFPages(), int64(problemID))
	if page == nil {
		return ctf.MaterialRequest{}, fmt.Errorf(
			"请先在 Chrome 打开 P%d，并用 MilkSU 扩展连接当前题目；已关闭的旧标签不会被复用",
			problemID,
		)
	}
	importContext, cancel := context.WithTimeout(a.commandContext(), 45*time.Second)
	defer cancel()
	attachment, err := a.browserBridge.FetchNSSCTFAttachment(importContext, page.ID)
	if err != nil {
		return ctf.MaterialRequest{}, fmt.Errorf("NSSCTF 附件导入失败: %w", err)
	}
	return ctf.MaterialRequest{
		Name:       attachment.Name,
		MediaType:  attachment.MediaType,
		DataBase64: attachment.DataBase64,
		Provenance: fmt.Sprintf(
			"user-browser-extension:nssctf:P%d:annex:sha256:%s",
			problemID,
			attachment.SHA256,
		),
	}, nil
}

func (a *App) SubmitNSSCTFWebFlag(jobID, candidate string) (NSSCTFWebSubmission, error) {
	projection, err := a.ctfJobs.GetJob(a.commandContext(), jobID)
	if err != nil {
		return NSSCTFWebSubmission{}, err
	}
	if projection.Challenge.ExternalPlatform != "nssctf-web" || projection.Challenge.ExternalAttemptID <= 0 {
		return NSSCTFWebSubmission{}, fmt.Errorf("CTF job is not linked to an NSSCTF browser problem")
	}
	if _, err := a.browserBridge.StartBridge(); err != nil {
		return NSSCTFWebSubmission{}, err
	}
	page := latestNSSCTFPage(
		a.browserBridge.NSSCTFPages(),
		projection.Challenge.ExternalAttemptID,
	)
	if page == nil {
		return NSSCTFWebSubmission{}, fmt.Errorf(
			"请先在 Chrome 打开 P%d，并用 MilkSU 扩展连接当前题目；已关闭的旧标签不会被复用",
			projection.Challenge.ExternalAttemptID,
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
		"候选由 MilkSU CTF harness 产生，并通过已配对的 NSSCTF 浏览器标签页提交。",
		wrongCount,
	)
	if err != nil {
		return NSSCTFWebSubmission{}, err
	}

	submitContext, cancel := context.WithTimeout(a.commandContext(), 25*time.Second)
	defer cancel()
	receipt, err := a.browserBridge.SubmitNSSCTFFlag(submitContext, page.ID, candidate)
	if err != nil {
		summary := fmt.Sprintf("NSSCTF 浏览器提交没有返回可确认结果：%v", err)
		withReceipt, receiptErr := a.ctfJobs.RecordExternalJudgeReceipt(
			a.commandContext(),
			jobID,
			ctf.ExternalJudgeReceiptRequest{
				Platform: "nssctf-web",
				Status:   "error",
				Summary:  summary,
				Reference: fmt.Sprintf(
					"%s#milkSU=browser-submit-error",
					page.URL,
				),
			},
		)
		if receiptErr != nil {
			return NSSCTFWebSubmission{CTF: pending}, fmt.Errorf(
				"NSSCTF 浏览器提交失败: %v；保存失败回执时又发生错误: %w",
				err,
				receiptErr,
			)
		}
		inconclusive, inconclusiveErr := a.ctfJobs.RecordExternalInconclusive(
			a.commandContext(),
			jobID,
			summary+"。MilkSU 已保留证据，可重试同一候选或在平台页面人工核对。",
		)
		if inconclusiveErr != nil {
			return NSSCTFWebSubmission{CTF: withReceipt}, fmt.Errorf(
				"NSSCTF 浏览器提交失败: %v；结束待判定状态时又发生错误: %w",
				err,
				inconclusiveErr,
			)
		}
		return NSSCTFWebSubmission{CTF: inconclusive}, fmt.Errorf("NSSCTF 浏览器提交失败: %w", err)
	}
	withReceipt, err := a.ctfJobs.RecordExternalJudgeReceipt(a.commandContext(), jobID, ctf.ExternalJudgeReceiptRequest{
		Platform: "nssctf-web", Status: receipt.Status, Correct: receipt.Correct,
		Summary: receipt.Message, Reference: receipt.URL + "#command=" + receipt.CommandID,
	})
	if err != nil {
		return NSSCTFWebSubmission{}, err
	}
	if receipt.Correct == nil {
		inconclusive, inconclusiveErr := a.ctfJobs.RecordExternalInconclusive(
			a.commandContext(),
			jobID,
			"NSSCTF Judge 回执不明确："+receipt.Message+"。可重试同一候选或在平台页面人工核对。",
		)
		if inconclusiveErr != nil {
			return NSSCTFWebSubmission{Receipt: receipt, CTF: withReceipt}, inconclusiveErr
		}
		return NSSCTFWebSubmission{Receipt: receipt, CTF: inconclusive}, fmt.Errorf(
			"NSSCTF Judge 回执不明确：%s",
			receipt.Message,
		)
	}
	summary := fmt.Sprintf(
		"NSSCTF browser Judge for P%d returned %s: %s",
		receipt.ProblemID,
		receipt.Status,
		receipt.Message,
	)
	recorded, err := a.ctfJobs.RecordExternalVerdict(a.commandContext(), jobID, *receipt.Correct, summary)
	if err != nil {
		return NSSCTFWebSubmission{}, err
	}
	return NSSCTFWebSubmission{Receipt: receipt, CTF: recorded}, nil
}
