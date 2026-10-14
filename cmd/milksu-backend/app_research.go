package main

import (
	"context"
	"fmt"
	"net"
	"net/url"
	"strings"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/research"
)

func isResearchWorkspaceAction(action string) bool {
	switch action {
	case "start_research_run",
		"register_research_task",
		"open_research_browser_tab",
		"list_research_runs",
		"get_research_run",
		"seal_research_batch",
		"begin_research_gap_fill",
		"record_research_source",
		"read_research_source",
		"read_research_report",
		"record_research_citation",
		"complete_research_run",
		"cancel_research_run",
		"resume_research_run":
		return true
	default:
		return false
	}
}

func validateResearchBrowserURL(raw string) (string, error) {
	return validateResearchBrowserURLWithLookup(raw, net.LookupIP)
}

func validateResearchBrowserURLWithLookup(
	raw string,
	lookup func(string) ([]net.IP, error),
) (string, error) {
	parsed, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return "", fmt.Errorf("invalid research Browser URL")
	}
	scheme := strings.ToLower(parsed.Scheme)
	if (scheme != "http" && scheme != "https") || parsed.Host == "" || parsed.Hostname() == "" {
		return "", fmt.Errorf("research Browser fallback requires an absolute HTTP(S) URL")
	}
	if parsed.User != nil {
		return "", fmt.Errorf("research Browser URL cannot include credentials")
	}
	host := strings.TrimSuffix(strings.ToLower(parsed.Hostname()), ".")
	if strings.Contains(host, "%") {
		return "", fmt.Errorf("research Browser fallback cannot open a zoned IP address")
	}
	if host == "localhost" || strings.HasSuffix(host, ".localhost") ||
		strings.HasSuffix(host, ".local") || strings.HasSuffix(host, ".internal") {
		return "", fmt.Errorf("research Browser fallback cannot open a local or internal host")
	}
	addresses := []net.IP{net.ParseIP(host)}
	if addresses[0] == nil {
		if !strings.Contains(host, ".") || strings.Trim(host, "0123456789.") == "" || strings.HasPrefix(host, "0x") {
			return "", fmt.Errorf("research Browser fallback cannot open a local or non-standard numeric host")
		}
		addresses, err = lookup(host)
		if err != nil || len(addresses) == 0 {
			return "", fmt.Errorf("research Browser fallback could not verify the host")
		}
	}
	for _, ip := range addresses {
		if isNonPublicResearchIP(ip) {
			return "", fmt.Errorf("research Browser fallback cannot open a private IP address")
		}
	}
	parsed.Scheme = scheme
	return parsed.String(), nil
}

// researchBlockedIPRanges mirrors the Research egress policy's non-public
// ranges (desktop/research-browser-network-policy.cjs) so the Go preflight and
// the Electron request gate fail closed on the same addresses. Segments already
// covered by net.IP helpers (loopback, RFC1918, link-local, multicast, etc.)
// are not repeated here.
var researchBlockedIPRanges = mustResearchCIDRs([]string{
	"0.0.0.0/8",       // "this network" incl. non-zero 0.x hosts
	"192.0.0.0/24",    // IETF protocol assignments
	"192.0.2.0/24",    // TEST-NET-1
	"198.18.0.0/15",   // RFC 2544 benchmarking, commonly used by fake-IP DNS
	"198.51.100.0/24", // TEST-NET-2
	"203.0.113.0/24",  // TEST-NET-3
	"240.0.0.0/4",     // reserved incl. broadcast
	"2001::/23",       // special-purpose IPv6 (Teredo, ORCHID, etc.)
	"2001:db8::/32",   // IPv6 documentation
	"2002::/16",       // 6to4
	"3fff::/20",       // IPv6 documentation (new)
})

var researchGlobalUnicastV6 = mustResearchCIDRs([]string{"2000::/3"})[0]

func mustResearchCIDRs(cidrs []string) []*net.IPNet {
	networks := make([]*net.IPNet, 0, len(cidrs))
	for _, cidr := range cidrs {
		_, network, err := net.ParseCIDR(cidr)
		if err != nil {
			panic(err)
		}
		networks = append(networks, network)
	}
	return networks
}

func isNonPublicResearchIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	if ip.IsPrivate() || ip.IsLoopback() || ip.IsLinkLocalUnicast() ||
		ip.IsLinkLocalMulticast() || ip.IsMulticast() || ip.IsUnspecified() {
		return true
	}
	if ipv4 := ip.To4(); ipv4 != nil {
		for _, network := range researchBlockedIPRanges {
			if network.Contains(ipv4) {
				return true
			}
		}
		_, sharedAddressRange, _ := net.ParseCIDR("100.64.0.0/10")
		return sharedAddressRange.Contains(ipv4)
	}
	if !researchGlobalUnicastV6.Contains(ip) {
		return true
	}
	for _, network := range researchBlockedIPRanges {
		if network.Contains(ip) {
			return true
		}
	}
	return false
}

func (a *App) handleResearchWorkspaceAction(
	conversationID, action string,
	request codingWorkspaceRequest,
) (string, error) {
	if a.research == nil {
		return "", fmt.Errorf("research runtime is unavailable")
	}
	if err := a.requirePiResearchConversation(conversationID); err != nil {
		return "", err
	}
	ctx := a.commandContext()
	switch action {
	case "start_research_run":
		run, err := a.research.Start(ctx, conversationID, request.Query, request.TraceID)
		if err != nil {
			return "", err
		}
		if a.engines != nil {
			a.engines.TrackResearchRun(conversationID, run.ID, true)
		}
		if err := a.setResearchBrowserMode(conversationID, true); err != nil {
			a.diagnostics.Record("research", "warning", "research Browser mode could not be enabled")
		}
		return encodeWorkspaceResult(map[string]any{"run": run})
	case "register_research_task":
		task, err := a.research.RegisterTask(ctx, conversationID, request.RunID, request.TaskPrompt)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(map[string]any{"task": task})
	case "open_research_browser_tab":
		snapshot, err := a.research.Get(ctx, conversationID, request.RunID)
		if err != nil {
			return "", err
		}
		if snapshot.Run.Status != research.RunRunning {
			return "", fmt.Errorf("research run is not running")
		}
		if _, err := a.ensureWorkspaceBrowser(conversationID); err != nil {
			return "", err
		}
		status, err := a.createResearchCodingBrowserTab(conversationID, request.URL)
		if err != nil {
			return "", err
		}
		a.revealCodingWorkspace(conversationID, "browser", "", "", "")
		return encodeWorkspaceResult(map[string]any{
			"runId":       request.RunID,
			"opened":      true,
			"activeTabId": status.ActiveTabID,
		})
	case "list_research_runs":
		runs, err := a.research.List(ctx, conversationID)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(map[string]any{"runs": runs})
	case "get_research_run":
		snapshot, err := a.research.Get(ctx, conversationID, request.RunID)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(snapshot)
	case "seal_research_batch":
		run, err := a.research.SealBatch(ctx, conversationID, request.RunID)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(map[string]any{"run": run})
	case "begin_research_gap_fill":
		run, err := a.research.BeginGapFill(ctx, conversationID, request.RunID)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(map[string]any{"run": run})
	case "record_research_source":
		source, err := a.research.AddSource(
			ctx,
			conversationID,
			request.RunID,
			request.URL,
			request.Title,
			request.Extract,
		)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(map[string]any{"source": source})
	case "read_research_source":
		source, extract, err := a.research.ReadSource(ctx, conversationID, request.SourceID)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(map[string]any{"source": source, "extract": extract})
	case "read_research_report":
		report, err := a.research.ReadReport(ctx, conversationID, request.RunID)
		if err != nil {
			return "", err
		}
		return report, nil
	case "record_research_citation":
		citation, err := a.research.RecordCitation(
			ctx,
			conversationID,
			request.RunID,
			request.Claim,
			request.SourceID,
			request.Verdict,
			request.Reason,
		)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(map[string]any{"citation": citation})
	case "complete_research_run":
		run, err := a.research.Complete(ctx, conversationID, request.RunID, request.Report)
		if err != nil {
			return "", err
		}
		if a.engines != nil {
			a.engines.TrackResearchRun(conversationID, run.ID, false)
		}
		if err := a.setResearchBrowserMode(conversationID, false); err != nil {
			a.diagnostics.Record("research", "warning", "research Browser mode could not be cleared")
		}
		return encodeWorkspaceResult(map[string]any{"runId": run.ID, "status": run.Status})
	case "cancel_research_run":
		run, err := a.cancelResearchRun(conversationID, request.RunID)
		if err != nil {
			return "", err
		}
		return encodeWorkspaceResult(map[string]any{"run": run})
	case "resume_research_run":
		snapshot, err := a.research.Resume(ctx, conversationID, request.RunID)
		if err != nil {
			return "", err
		}
		if a.engines != nil {
			a.engines.TrackResearchRun(conversationID, snapshot.Run.ID, true)
		}
		if err := a.setResearchBrowserMode(conversationID, true); err != nil {
			a.diagnostics.Record("research", "warning", "research Browser mode could not be restored")
		}
		return encodeWorkspaceResult(snapshot)
	default:
		return "", fmt.Errorf("unknown research action")
	}
}

type ResearchSourceDetail struct {
	Source  research.Source `json:"source"`
	Extract string          `json:"extract"`
}

func (a *App) ListResearchRuns(conversationID string) ([]research.Run, error) {
	if a.research == nil {
		return nil, fmt.Errorf("research runtime is unavailable")
	}
	if err := a.requirePersistedPiResearchConversation(conversationID); err != nil {
		return nil, err
	}
	return a.research.List(a.commandContext(), conversationID)
}

func (a *App) GetResearchRun(conversationID, runID string) (research.Snapshot, error) {
	if a.research == nil {
		return research.Snapshot{}, fmt.Errorf("research runtime is unavailable")
	}
	if err := a.requirePersistedPiResearchConversation(conversationID); err != nil {
		return research.Snapshot{}, err
	}
	return a.research.Get(a.commandContext(), conversationID, runID)
}

func (a *App) ReadResearchSource(conversationID, sourceID string) (ResearchSourceDetail, error) {
	if a.research == nil {
		return ResearchSourceDetail{}, fmt.Errorf("research runtime is unavailable")
	}
	if err := a.requirePersistedPiResearchConversation(conversationID); err != nil {
		return ResearchSourceDetail{}, err
	}
	source, extract, err := a.research.ReadSource(a.commandContext(), conversationID, sourceID)
	if err != nil {
		return ResearchSourceDetail{}, err
	}
	return ResearchSourceDetail{Source: source, Extract: extract}, nil
}

func (a *App) ReadResearchReport(conversationID, runID string) (string, error) {
	if a.research == nil {
		return "", fmt.Errorf("research runtime is unavailable")
	}
	if err := a.requirePersistedPiResearchConversation(conversationID); err != nil {
		return "", err
	}
	return a.research.ReadReport(a.commandContext(), conversationID, runID)
}

func (a *App) CancelResearchRun(conversationID, runID string) (research.Run, error) {
	return a.cancelResearchRun(conversationID, runID)
}

func (a *App) cancelResearchRun(conversationID, runID string) (research.Run, error) {
	if a.research == nil {
		return research.Run{}, fmt.Errorf("research runtime is unavailable")
	}
	conversationID = strings.TrimSpace(conversationID)
	if err := a.requirePersistedPiResearchConversation(conversationID); err != nil {
		return research.Run{}, err
	}
	snapshot, err := a.research.Get(a.commandContext(), conversationID, runID)
	if err != nil {
		return research.Run{}, err
	}
	workerStopMayBeNeeded := snapshot.Run.WorkerStopUnconfirmed
	for _, task := range snapshot.Tasks {
		if task.Status == research.TaskRunning || task.Status == research.TaskInterrupted {
			workerStopMayBeNeeded = true
			break
		}
	}
	run, err := a.research.Cancel(a.commandContext(), conversationID, runID)
	if err != nil {
		return research.Run{}, err
	}
	var workerStopErr error
	registeredPiSession := false
	if a.engines != nil {
		a.engines.TrackResearchRun(conversationID, run.ID, false)
		registeredPiSession = a.engines.HasRegisteredSession(conversationID) &&
			a.engines.SessionKernel(conversationID) == engine.KernelPi
	}
	if workerStopMayBeNeeded {
		run, err = a.research.SetWorkerStopUnconfirmed(
			a.commandContext(),
			conversationID,
			run.ID,
			true,
		)
		if err != nil {
			return run, fmt.Errorf("research run was cancelled but worker stop state could not be saved: %w", err)
		}
	}
	if registeredPiSession {
		workerStopErr = a.engines.CancelResearchRun(conversationID, run.ID, workerStopMayBeNeeded)
	}
	if err := a.setResearchBrowserMode(conversationID, false); err != nil && a.diagnostics != nil {
		a.diagnostics.Record("research", "warning", "research Browser mode could not be cleared")
	}
	if workerStopErr != nil {
		if a.diagnostics != nil {
			a.diagnostics.Record("research", "warning", "cancelled research workers could not be signaled")
		}
		return run, fmt.Errorf("research run was cancelled but worker stop could not be requested: %w", workerStopErr)
	}
	return run, nil
}

func (a *App) requirePersistedPiResearchConversation(conversationID string) error {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" || a.conversations == nil {
		return fmt.Errorf("research conversation is unavailable")
	}
	stored, err := a.conversations.Get(conversationID)
	if err != nil {
		return err
	}
	if conversation.NormalizeKernel(stored.Kernel) != conversation.KernelPi {
		return fmt.Errorf("Deep Research runs require a Pi conversation")
	}
	return nil
}

func (a *App) requirePiResearchConversation(conversationID string) error {
	conversationID = strings.TrimSpace(conversationID)
	if err := a.requirePersistedPiResearchConversation(conversationID); err != nil {
		return err
	}
	if a.engines != nil && a.engines.SessionKernel(conversationID) != engine.KernelPi {
		return fmt.Errorf("Deep Research runs require the conversation's Pi session")
	}
	return nil
}

func (a *App) researchRunActiveForConversation(conversationID string) (bool, error) {
	if a.research == nil {
		return false, nil
	}
	runs, err := a.research.List(a.commandContext(), conversationID)
	if err != nil {
		return false, err
	}
	for _, run := range runs {
		if run.Status == research.RunRunning {
			return true, nil
		}
	}
	return false, nil
}

func (a *App) recordResearchWorkerEvent(event engine.Event) {
	if a.research == nil || event.SessionID == "" || event.ResearchRunID == "" {
		return
	}
	updates := make([]research.WorkerUpdate, 0, len(event.ResearchTasks))
	for _, task := range event.ResearchTasks {
		updates = append(updates, research.WorkerUpdate{
			ID:       task.ID,
			Prompt:   task.Prompt,
			Status:   task.Status,
			WorkerID: task.WorkerID,
			Result:   task.Result,
		})
	}
	ctx := context.Background()
	run, ready, err := a.research.RecordWorkerUpdates(ctx, event.SessionID, event.ResearchRunID, updates)
	if err != nil {
		if a.research.MarkInterrupted(ctx, event.SessionID, event.ResearchRunID) == nil && a.engines != nil {
			a.engines.TrackResearchRun(event.SessionID, event.ResearchRunID, false)
		}
		a.diagnostics.Record("research", "error", "research worker status could not be persisted")
		return
	}
	if !ready {
		return
	}
	run, claimed, err := a.research.ClaimContinuation(ctx, event.SessionID, event.ResearchRunID)
	if err != nil || !claimed {
		if err != nil {
			if a.research.MarkInterrupted(ctx, event.SessionID, event.ResearchRunID) == nil && a.engines != nil {
				a.engines.TrackResearchRun(event.SessionID, event.ResearchRunID, false)
			}
			a.diagnostics.Record("research", "error", "research continuation could not be claimed")
		}
		return
	}
	if a.engines == nil {
		_ = a.research.MarkInterrupted(ctx, event.SessionID, run.ID)
		a.diagnostics.Record("research", "warning", "research parent session is unavailable")
		return
	}
	locale := ""
	if a.settings != nil {
		locale = config.ResolvedUserInterfaceLocale(a.settings.Get())
	}
	if err := a.engines.ContinueRegisteredMessage(event.SessionID, researchContinuationPrompt(run, locale)); err != nil {
		_ = a.research.MarkInterrupted(ctx, event.SessionID, run.ID)
		a.engines.TrackResearchRun(event.SessionID, run.ID, false)
		a.diagnostics.Record("research", "warning", "research workers completed but the parent session could not continue")
	}
}

func (a *App) interruptResearchRunForSession(conversationID string) {
	if a.research == nil || strings.TrimSpace(conversationID) == "" {
		return
	}
	ctx := context.Background()
	runs, err := a.research.List(ctx, conversationID)
	if err != nil {
		a.diagnostics.Record("research", "error", "research runs could not be checked after session loss")
		return
	}
	for _, run := range runs {
		if run.Status != research.RunRunning {
			continue
		}
		if err := a.research.MarkInterrupted(ctx, conversationID, run.ID); err != nil {
			a.diagnostics.Record("research", "error", "research run could not be marked interrupted")
		} else if a.engines != nil {
			a.engines.TrackResearchRun(conversationID, run.ID, false)
		}
	}
}

func researchContinuationPrompt(run research.Run, locale string) string {
	english := locale == "en"
	if run.Phase == research.PhaseFinalizing {
		if english {
			return fmt.Sprintf(
				"The gap-fill workers for research run %s have finished. Call milksu_workspace get_research_run first; if the run is cancelled, stop without synthesizing. Otherwise inspect the saved results, verify important claims, run the final critic, and persist the report with complete_research_run. Do not start another worker batch.",
				run.ID,
			)
		}
		return fmt.Sprintf(
			"研究运行 %s 的 gap-fill 工作者已完成。先调用 milksu_workspace get_research_run；若运行已取消就停止，不要合成。否则读取保存结果，核验重要主张，完成最终 Critic，并用 complete_research_run 持久化报告。不要再启动研究批次。",
			run.ID,
		)
	}
	if english {
		return fmt.Sprintf(
			"The background workers for research run %s have finished. Call milksu_workspace get_research_run first; if the run is cancelled, stop without synthesizing. Otherwise inspect saved results and sources, verify important claims in the parent session, synthesize, and run the critic. Start at most one gap-fill batch only if a material gap remains, then persist the report.",
			run.ID,
		)
	}
	return fmt.Sprintf(
		"研究运行 %s 的后台工作者已完成。先调用 milksu_workspace get_research_run；若运行已取消就停止，不要合成。否则读取保存结果和来源，继续同一研究任务：由父会话核验重要主张、合成结果并运行 Critic；只有存在实质缺口时才启动一次 gap-fill 批次，最后持久化报告。",
		run.ID,
	)
}
