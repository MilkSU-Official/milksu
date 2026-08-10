package main

import (
	"encoding/base64"
	"fmt"
	"net"
	"net/url"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/nssctf"
	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
)

type NSSCTFArenaWorkspace struct {
	Arena nssctf.ArenaResponse `json:"arena"`
	CTF   *ctf.Projection      `json:"ctf,omitempty"`
}

type NSSCTFArenaSubmission struct {
	Arena nssctf.ArenaResponse `json:"arena"`
	CTF   ctf.Projection       `json:"ctf"`
}

func (a *App) GetNSSCTFArenaCurrent() (NSSCTFArenaWorkspace, error) {
	token, err := a.nssctfArenaToken()
	if err != nil {
		return NSSCTFArenaWorkspace{}, err
	}
	response, err := a.nssctfArena.Current(a.commandContext(), token)
	if err != nil {
		return NSSCTFArenaWorkspace{}, err
	}
	return a.ensureNSSCTFArenaWorkspace(response, token)
}

func (a *App) StartNSSCTFArena() (NSSCTFArenaWorkspace, error) {
	token, err := a.nssctfArenaToken()
	if err != nil {
		return NSSCTFArenaWorkspace{}, err
	}
	response, err := a.nssctfArena.Current(a.commandContext(), token)
	if err != nil {
		return NSSCTFArenaWorkspace{}, err
	}
	if response.Attempt == nil {
		response, err = a.nssctfArena.Next(a.commandContext(), token)
		if err != nil {
			return NSSCTFArenaWorkspace{}, err
		}
	}
	return a.ensureNSSCTFArenaWorkspace(response, token)
}

func (a *App) SubmitNSSCTFArenaFlag(jobID string, attemptID int64, candidate string) (NSSCTFArenaSubmission, error) {
	token, err := a.nssctfArenaToken()
	if err != nil {
		return NSSCTFArenaSubmission{}, err
	}
	projection, err := a.ctfJobs.GetJob(a.commandContext(), jobID)
	if err != nil {
		return NSSCTFArenaSubmission{}, err
	}
	if projection.Challenge.ExternalPlatform != "nssctf-agent-arena" || projection.Challenge.ExternalAttemptID != attemptID {
		return NSSCTFArenaSubmission{}, fmt.Errorf("CTF job does not match the selected NSSCTF Arena attempt")
	}
	candidate = strings.TrimSpace(candidate)
	platformState, err := a.nssctfArena.Attempt(a.commandContext(), token, attemptID)
	if err != nil {
		return NSSCTFArenaSubmission{}, err
	}
	if platformState.Attempt == nil || platformState.Attempt.ID != attemptID {
		return NSSCTFArenaSubmission{}, fmt.Errorf("NSSCTF Agent Arena did not return the selected attempt")
	}

	if len(projection.Evaluations) > 0 &&
		projection.Evaluations[len(projection.Evaluations)-1].Verdict == securityruntime.VerdictNeedsReview {
		if len(projection.Submissions) == 0 ||
			strings.TrimSpace(projection.Submissions[len(projection.Submissions)-1].Candidate) != candidate {
			return NSSCTFArenaSubmission{}, fmt.Errorf("another external candidate is already awaiting platform review")
		}
		baseline := platformState.Attempt.WrongCount
		if saved := projection.Submissions[len(projection.Submissions)-1].ExternalWrongCountBefore; saved != nil {
			baseline = *saved
		}
		reconciled, resolved, reconcileErr := nssctf.ReconcilePendingSubmission(platformState, attemptID, baseline)
		if reconcileErr != nil {
			return NSSCTFArenaSubmission{}, reconcileErr
		}
		if resolved {
			return a.recordNSSCTFArenaVerdict(jobID, attemptID, reconciled, true)
		}
	}
	if strings.ToLower(strings.TrimSpace(platformState.Attempt.StateLabel)) != "active" {
		return NSSCTFArenaSubmission{}, fmt.Errorf(
			"NSSCTF Agent Arena attempt is %s and no longer accepts submissions",
			platformState.Attempt.StateLabel,
		)
	}
	wrongCountBefore := platformState.Attempt.WrongCount
	if _, err := a.ctfJobs.PrepareExternalSubmission(
		a.commandContext(),
		jobID,
		candidate,
		"候选由 MilkSU CTF harness 产生，并提交给 NSSCTF Agent Arena 权威判题。",
		wrongCountBefore,
	); err != nil {
		return NSSCTFArenaSubmission{}, err
	}
	response, err := a.nssctfArena.Submit(a.commandContext(), token, attemptID, candidate)
	if err != nil {
		after, syncErr := a.nssctfArena.Attempt(a.commandContext(), token, attemptID)
		if syncErr == nil {
			reconciled, resolved, reconcileErr := nssctf.ReconcilePendingSubmission(after, attemptID, wrongCountBefore)
			if reconcileErr == nil && resolved {
				return a.recordNSSCTFArenaVerdict(jobID, attemptID, reconciled, true)
			}
		}
		return NSSCTFArenaSubmission{}, err
	}
	if response.Correct == nil {
		reconciled, resolved, reconcileErr := nssctf.ReconcilePendingSubmission(response, attemptID, wrongCountBefore)
		if reconcileErr != nil {
			return NSSCTFArenaSubmission{}, reconcileErr
		}
		if !resolved {
			return NSSCTFArenaSubmission{}, fmt.Errorf("NSSCTF Agent Arena response did not contain a verdict")
		}
		response = reconciled
	}
	return a.recordNSSCTFArenaVerdict(jobID, attemptID, response, false)
}

func (a *App) recordNSSCTFArenaVerdict(
	jobID string,
	attemptID int64,
	response nssctf.ArenaResponse,
	reconciled bool,
) (NSSCTFArenaSubmission, error) {
	if response.Correct == nil {
		return NSSCTFArenaSubmission{}, fmt.Errorf("NSSCTF Agent Arena response did not contain a verdict")
	}
	status := "rejected"
	if *response.Correct {
		status = "accepted"
	}
	summary := fmt.Sprintf("NSSCTF Agent Arena attempt %d returned correct=%t.", attemptID, *response.Correct)
	if reconciled {
		summary = fmt.Sprintf(
			"NSSCTF Agent Arena attempt %d state was reconciled after an interrupted or ambiguous submit; correct=%t.",
			attemptID,
			*response.Correct,
		)
	}
	if response.RemainingWrongAttempts != nil {
		summary += fmt.Sprintf(" remaining_wrong_attempts=%d.", *response.RemainingWrongAttempts)
	}
	if _, err := a.ctfJobs.RecordExternalJudgeReceipt(a.commandContext(), jobID, ctf.ExternalJudgeReceiptRequest{
		Platform: "nssctf-agent-arena", Status: status, Correct: response.Correct,
		Summary: summary, Reference: fmt.Sprintf("nssctf-agent-arena:attempt:%d", attemptID),
	}); err != nil {
		return NSSCTFArenaSubmission{}, err
	}
	recorded, err := a.ctfJobs.RecordExternalVerdict(a.commandContext(), jobID, *response.Correct, summary)
	if err != nil {
		return NSSCTFArenaSubmission{}, err
	}
	if !*response.Correct && response.Attempt != nil && response.Attempt.StateLabel != "" && response.Attempt.StateLabel != "active" {
		recorded, err = a.ctfJobs.FinishExternalChallenge(
			a.commandContext(),
			jobID,
			"NSSCTF Agent Arena ended the attempt with state "+response.Attempt.StateLabel+".",
		)
		if err != nil {
			return NSSCTFArenaSubmission{}, err
		}
	}
	return NSSCTFArenaSubmission{Arena: response, CTF: recorded}, nil
}

func (a *App) AbandonNSSCTFArena(jobID string, attemptID int64) (NSSCTFArenaWorkspace, error) {
	token, err := a.nssctfArenaToken()
	if err != nil {
		return NSSCTFArenaWorkspace{}, err
	}
	projection, err := a.ctfJobs.GetJob(a.commandContext(), jobID)
	if err != nil {
		return NSSCTFArenaWorkspace{}, err
	}
	if projection.Challenge.ExternalPlatform != "nssctf-agent-arena" || projection.Challenge.ExternalAttemptID != attemptID {
		return NSSCTFArenaWorkspace{}, fmt.Errorf("CTF job does not match the selected NSSCTF Arena attempt")
	}
	response, err := a.nssctfArena.Abandon(a.commandContext(), token, attemptID)
	if err != nil {
		return NSSCTFArenaWorkspace{}, err
	}
	finished, err := a.ctfJobs.FinishExternalChallenge(
		a.commandContext(),
		jobID,
		fmt.Sprintf("用户主动结束 NSSCTF Agent Arena attempt %d；平台状态为 abandoned。", attemptID),
	)
	if err != nil {
		return NSSCTFArenaWorkspace{}, err
	}
	return NSSCTFArenaWorkspace{Arena: response, CTF: &finished}, nil
}

func (a *App) OpenNSSCTFArena() error {
	if a.ctx == nil {
		return fmt.Errorf("desktop runtime is not ready")
	}
	return a.openExternal("https://www.nssctf.cn/ai/agents")
}

func (a *App) nssctfArenaToken() (string, error) {
	settings := a.settings.GetResolved()
	if settings.NSSCTFArena == nil || strings.TrimSpace(settings.NSSCTFArena.Token) == "" {
		return "", fmt.Errorf("请先在设置中保存 NSSCTF Agent Token")
	}
	return settings.NSSCTFArena.Token, nil
}

func (a *App) ensureNSSCTFArenaWorkspace(
	response nssctf.ArenaResponse,
	token string,
) (NSSCTFArenaWorkspace, error) {
	if response.Attempt == nil {
		return NSSCTFArenaWorkspace{Arena: response}, nil
	}
	attempt := response.Attempt
	jobs, err := a.ctfJobs.ListJobs(a.commandContext())
	if err != nil {
		return NSSCTFArenaWorkspace{}, err
	}
	for _, summary := range jobs {
		projection, projectionErr := a.ctfJobs.GetJob(a.commandContext(), summary.ID)
		if projectionErr != nil {
			return NSSCTFArenaWorkspace{}, projectionErr
		}
		if projection.Challenge.ExternalPlatform == "nssctf-agent-arena" &&
			projection.Challenge.ExternalAttemptID == attempt.ID &&
			projection.Outcome == nil {
			return NSSCTFArenaWorkspace{Arena: response, CTF: &projection}, nil
		}
	}
	statement := nssctf.NormalizeStatement(attempt.Problem.Content)
	if statement == "" {
		statement = "NSSCTF Agent Arena 未提供文字题面；请检查附件或动态环境。"
	}
	materials := []ctf.MaterialRequest{}
	if attempt.Problem.Annex != nil {
		attachment, downloadErr := a.nssctfArena.DownloadAnnex(
			a.commandContext(),
			token,
			*attempt.Problem.Annex,
		)
		if downloadErr != nil {
			return NSSCTFArenaWorkspace{}, downloadErr
		}
		materials = append(materials, ctf.MaterialRequest{
			Name: attachment.Name, MediaType: attachment.MediaType,
			DataBase64: base64.StdEncoding.EncodeToString(attachment.Data),
			Provenance: fmt.Sprintf(
				"nssctf-agent-arena:attempt:%d:annex",
				attempt.ID,
			),
		})
		statement += fmt.Sprintf(
			"\n\n附件：%s（%d bytes）已由 Arena Adapter 下载、校验长度并作为带 provenance 的材料接入。",
			attachment.Name,
			attachment.Size,
		)
	}
	sourceTargets := []securitypolicy.Target{}
	if attempt.Problem.Container != nil && len(attempt.Problem.Container.URL) > 0 {
		sourceTargets = nssctfArenaSourceTargets(attempt.Problem.Container.URL)
		if len(sourceTargets) > 0 {
			statement += "\n\n授权动态环境：" + strings.Join(attempt.Problem.Container.URL, " · ")
		}
	}
	category := strings.TrimSpace(attempt.Problem.TypeLabel)
	if category == "" {
		category = nssctf.CategoryName(attempt.Problem.Type)
	}
	sourceURL := fmt.Sprintf("https://www.nssctf.cn/problem/%d", attempt.Problem.ID)
	projection, err := a.ctfJobs.StartChallenge(a.commandContext(), ctf.ChallengeRequest{
		Title: attempt.Problem.Title, Statement: statement, Category: strings.ToLower(category),
		CollaborationMode: "copilot", DeferAgent: true,
		TrackName:  "NSSCTF Agent Arena",
		HumanGoal:  "在真实限时题目中与 Agent 协作，并用 NSSCTF 的判题响应建立可复盘证据。",
		SourceKind: "url", SourceURI: sourceURL,
		SourceTargets:    sourceTargets,
		ExternalPlatform: "nssctf-agent-arena", ExternalAttemptID: attempt.ID,
		KnowledgePoints: append([]string{}, attempt.Problem.Tag...),
		Materials:       materials,
	})
	if err != nil {
		return NSSCTFArenaWorkspace{}, err
	}
	return NSSCTFArenaWorkspace{Arena: response, CTF: &projection}, nil
}

func nssctfArenaSourceTargets(values []string) []securitypolicy.Target {
	targets := make([]securitypolicy.Target, 0, len(values))
	seen := make(map[string]struct{}, len(values))
	for _, raw := range values {
		raw = strings.TrimSpace(raw)
		if raw == "" {
			continue
		}
		var candidate securitypolicy.Target
		parsed, err := url.Parse(raw)
		switch {
		case err == nil &&
			(parsed.Scheme == "http" || parsed.Scheme == "https") &&
			parsed.Host != "" &&
			parsed.User == nil:
			candidate = securitypolicy.Target{
				Kind: securitypolicy.TargetOrigin, Value: raw,
			}
		case err == nil &&
			parsed.Scheme == "tcp" &&
			parsed.Host != "" &&
			parsed.User == nil:
			candidate = securitypolicy.Target{
				Kind: securitypolicy.TargetSocket, Value: parsed.Host,
			}
		case err == nil &&
			parsed.Scheme == "ssh" &&
			parsed.Host != "" &&
			parsed.User != nil:
			if _, hasPassword := parsed.User.Password(); hasPassword {
				continue
			}
			candidate = securitypolicy.Target{
				Kind: securitypolicy.TargetSocket, Value: parsed.Host,
			}
		default:
			if strings.Contains(raw, "://") {
				continue
			}
			if _, _, splitErr := net.SplitHostPort(raw); splitErr != nil {
				continue
			}
			candidate = securitypolicy.Target{
				Kind: securitypolicy.TargetSocket, Value: raw,
			}
		}
		normalized, err := securitypolicy.NormalizeTarget(candidate)
		if err != nil {
			continue
		}
		key := string(normalized.Kind) + "\x00" + normalized.Value
		if _, exists := seen[key]; exists {
			continue
		}
		seen[key] = struct{}{}
		targets = append(targets, normalized)
		if len(targets) >= 15 {
			break
		}
	}
	return targets
}
