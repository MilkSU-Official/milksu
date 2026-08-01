package main

import (
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"mime"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/browsercap"
	"github.com/MilkSU-Official/milksu/internal/codingattachment"
	"github.com/MilkSU-Official/milksu/internal/codingenv"
	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/ctfshow"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/labmanager"
	"github.com/MilkSU-Official/milksu/internal/nssctf"
	"github.com/MilkSU-Official/milksu/internal/securitypolicy"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
	"github.com/MilkSU-Official/milksu/internal/vuln"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the thin L1 desktop adapter. Domain code must not depend on Wails.
type App struct {
	ctx            context.Context
	dataDirectory  string
	settings       *config.Store
	conversations  *conversation.Store
	codingFiles    *codingattachment.Store
	engines        *engine.Supervisor
	securityEngine *engine.SecuritySupervisor
	nssctf         *nssctf.Client
	nssctfCatalog  *nssctf.CatalogService
	ctfshowCatalog *ctfshow.CatalogService
	nssctfArena    *nssctf.ArenaClient
	browserBridge  *browsercap.Manager
	managedLabs    *labmanager.Manager
	jobs           *securityruntime.Service
	ctfJobs        *ctf.Service
	ctfAgent       *ctfAgentRecorder
	ctfMemory      *ctf.MemoryStore
	vulnJobs       *vuln.Service
}

func NewApp() (*App, error) {
	settings, err := config.NewStore()
	if err != nil {
		return nil, fmt.Errorf("create settings store: %w", err)
	}
	conversations, err := conversation.NewStore()
	if err != nil {
		return nil, fmt.Errorf("create conversation store: %w", err)
	}
	dataDirectory, err := appdata.Ensure()
	if err != nil {
		return nil, err
	}
	codingFiles, err := codingattachment.NewStore(
		filepath.Join(dataDirectory, "agent-home", "attachments"),
	)
	if err != nil {
		return nil, fmt.Errorf("create Coding attachment store: %w", err)
	}

	application := &App{
		dataDirectory: dataDirectory,
		settings:      settings,
		conversations: conversations,
		codingFiles:   codingFiles,
	}
	if managedLabsFeatureEnabled() {
		application.managedLabs, err = labmanager.New(dataDirectory)
		if err != nil {
			return nil, fmt.Errorf("create managed lab service: %w", err)
		}
	}
	application.engines = engine.NewSupervisor(application.emitEngineEvent)
	application.nssctf = nssctf.NewClient(nssctf.ClientOptions{})
	application.nssctfCatalog, err = nssctf.NewCatalogService(
		filepath.Join(dataDirectory, "nssctf", "catalog.sqlite3"),
		application.nssctf,
	)
	if err != nil {
		return nil, fmt.Errorf("create NSSCTF catalog: %w", err)
	}
	application.ctfshowCatalog, err = ctfshow.NewCatalogService(
		filepath.Join(dataDirectory, "ctfshow", "catalog.sqlite3"),
	)
	if err != nil {
		application.nssctfCatalog.Close()
		return nil, fmt.Errorf("create CTFshow catalog: %w", err)
	}
	application.nssctfArena = nssctf.NewArenaClient(nssctf.ArenaClientOptions{})
	application.browserBridge, err = browsercap.New(dataDirectory)
	if err != nil {
		application.ctfshowCatalog.Close()
		application.nssctfCatalog.Close()
		return nil, fmt.Errorf("create browser bridge: %w", err)
	}
	application.browserBridge.SetCTFShowCatalogSink(
		func(ctx context.Context, problems []ctfshow.CatalogProblem) error {
			_, replaceErr := application.ctfshowCatalog.Replace(ctx, problems)
			return replaceErr
		},
	)
	application.securityEngine, err = engine.NewSecuritySupervisor(application.settings.GetResolved)
	if err != nil {
		application.browserBridge.Close()
		application.ctfshowCatalog.Close()
		application.nssctfCatalog.Close()
		return nil, fmt.Errorf("create security agent engine: %w", err)
	}
	application.jobs, err = securityruntime.NewService(filepath.Join(dataDirectory, "runtime"), application.emitJobEvent)
	if err != nil {
		application.securityEngine.Close()
		application.browserBridge.Close()
		application.ctfshowCatalog.Close()
		application.nssctfCatalog.Close()
		return nil, fmt.Errorf("create security job runtime: %w", err)
	}
	application.ctfJobs, err = ctf.NewService(application.jobs, ctf.ServiceOptions{Engine: application.securityEngine})
	if err != nil {
		_ = application.jobs.Close()
		application.securityEngine.Close()
		application.browserBridge.Close()
		application.ctfshowCatalog.Close()
		application.nssctfCatalog.Close()
		return nil, fmt.Errorf("create CTF role service: %w", err)
	}
	application.ctfMemory, err = ctf.NewMemoryStore(
		filepath.Join(dataDirectory, "ctf", "memory.sqlite3"),
		filepath.Join(dataDirectory, "ctf", "memories"),
	)
	if err != nil {
		_ = application.ctfJobs.Close()
		_ = application.jobs.Close()
		application.securityEngine.Close()
		application.browserBridge.Close()
		application.ctfshowCatalog.Close()
		application.nssctfCatalog.Close()
		return nil, fmt.Errorf("create CTF memory store: %w", err)
	}
	application.ctfAgent = newCTFAgentRecorder(
		filepath.Join(dataDirectory, "ctf-workspaces"),
		application.ctfJobs,
		application.settings,
	)
	application.vulnJobs, err = vuln.NewService(application.jobs)
	if err != nil {
		_ = application.ctfMemory.Close()
		_ = application.ctfJobs.Close()
		_ = application.jobs.Close()
		application.securityEngine.Close()
		application.browserBridge.Close()
		application.ctfshowCatalog.Close()
		application.nssctfCatalog.Close()
		return nil, fmt.Errorf("create vulnerability research role service: %w", err)
	}
	return application, nil
}

func managedLabsFeatureEnabled() bool {
	return strings.TrimSpace(os.Getenv("MILKSU_ENABLE_MANAGED_LABS")) == "1"
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	if a.managedLabs != nil {
		reconcileContext, cancel := context.WithTimeout(ctx, managedLabReconcileTimeout)
		if _, err := a.managedLabs.Reconcile(reconcileContext); err != nil {
			wailsruntime.EventsEmit(ctx, "managed-lab-runtime-error", err.Error())
		}
		cancel()
	}
	if err := a.jobs.Recover(ctx); err != nil {
		wailsruntime.EventsEmit(ctx, "job-runtime-error", err.Error())
	}
	if err := a.ctfJobs.Recover(ctx); err != nil {
		wailsruntime.EventsEmit(ctx, "job-runtime-error", err.Error())
	}
	if err := a.vulnJobs.Recover(ctx); err != nil {
		wailsruntime.EventsEmit(ctx, "job-runtime-error", err.Error())
	}
}

func (a *App) Shutdown(_ context.Context) {
	_ = a.vulnJobs.Close()
	_ = a.ctfMemory.Close()
	_ = a.ctfJobs.Close()
	a.securityEngine.Close()
	_ = a.jobs.Close()
	a.engines.Close()
	a.browserBridge.Close()
	_ = a.ctfshowCatalog.Close()
	_ = a.nssctfCatalog.Close()
}

func (a *App) showPrimaryWindow() {
	if a.ctx == nil {
		return
	}
	wailsruntime.WindowUnminimise(a.ctx)
	wailsruntime.WindowShow(a.ctx)
}

func (a *App) GetSettings() config.AppSettings {
	return a.settings.Get()
}

func (a *App) SaveSettingsCmd(settings config.AppSettings) error {
	err := a.settings.Save(settings)
	if err != nil && !hasSessionOnlyCredential(a.settings.Get()) {
		return err
	}
	// Provider credentials are supplied only when a sidecar starts. Restarting
	// prevents a running child from retaining credentials removed by the user,
	// and makes a safe session-only fallback available to the next request.
	a.engines.Close()
	a.securityEngine.Restart()
	return err
}

func hasSessionOnlyCredential(settings config.AppSettings) bool {
	for _, provider := range settings.Providers {
		if provider.SessionOnly {
			return true
		}
	}
	return settings.Relay != nil && settings.Relay.SessionOnly ||
		settings.NSSCTFArena != nil && settings.NSSCTFArena.SessionOnly
}

func (a *App) ListConversations() ([]conversation.StoredConversation, error) {
	return a.conversations.List()
}

func (a *App) SaveConversation(value conversation.StoredConversation) error {
	return a.conversations.Save(value)
}

func (a *App) DeleteConversation(id string) error {
	a.engines.DestroySession(id)
	return a.conversations.Delete(id)
}

func (a *App) ChooseAgentWorkspace() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("desktop runtime is not ready")
	}
	return wailsruntime.OpenDirectoryDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "选择 Coding Agent 项目目录",
	})
}

func (a *App) ChooseCTFMaterials() ([]ctf.MaterialRequest, error) {
	if a.ctx == nil {
		return nil, fmt.Errorf("desktop runtime is not ready")
	}
	paths, err := wailsruntime.OpenMultipleFilesDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "补充 CTF 图片或附件",
		Filters: []wailsruntime.FileFilter{
			{
				DisplayName: "CTF 材料",
				Pattern:     "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.txt;*.md;*.json;*.xml;*.html;*.js;*.py;*.c;*.cpp;*.h;*.zip;*.gz;*.tar;*.7z;*.rar;*.pdf;*.pcap;*.pcapng;*.bin;*.elf;*.exe",
			},
			{DisplayName: "所有文件", Pattern: "*"},
		},
	})
	if err != nil {
		return nil, err
	}
	return loadLocalCTFMaterials(paths)
}

func (a *App) ChooseCodingAttachments() ([]codingattachment.Attachment, error) {
	if a.ctx == nil {
		return nil, fmt.Errorf("desktop runtime is not ready")
	}
	paths, err := wailsruntime.OpenMultipleFilesDialog(a.ctx, wailsruntime.OpenDialogOptions{
		Title: "添加 Coding 文件或图片",
		Filters: []wailsruntime.FileFilter{
			{
				DisplayName: "代码、文档与图片",
				Pattern:     "*.png;*.jpg;*.jpeg;*.gif;*.webp;*.svg;*.txt;*.md;*.json;*.yaml;*.yml;*.toml;*.xml;*.html;*.css;*.js;*.jsx;*.ts;*.tsx;*.vue;*.py;*.go;*.rs;*.c;*.cpp;*.h;*.java;*.kt;*.swift;*.sh;*.sql;*.csv;*.pdf;*.zip;*.gz;*.tar",
			},
			{DisplayName: "所有文件", Pattern: "*"},
		},
	})
	if err != nil {
		return nil, err
	}
	if len(paths) == 0 {
		return []codingattachment.Attachment{}, nil
	}
	return a.codingFiles.Import(paths)
}

const (
	maxLocalCTFMaterialCount = 8
	maxLocalCTFMaterialBytes = 32 * 1024 * 1024
	maxLocalCTFTotalBytes    = 96 * 1024 * 1024
)

func loadLocalCTFMaterials(paths []string) ([]ctf.MaterialRequest, error) {
	if len(paths) > maxLocalCTFMaterialCount {
		return nil, fmt.Errorf("一次最多补充 %d 个材料", maxLocalCTFMaterialCount)
	}
	materials := make([]ctf.MaterialRequest, 0, len(paths))
	total := int64(0)
	for _, path := range paths {
		path = strings.TrimSpace(path)
		info, err := os.Lstat(path)
		if err != nil {
			return nil, fmt.Errorf("读取材料信息: %w", err)
		}
		if info.Mode()&os.ModeSymlink != 0 || !info.Mode().IsRegular() {
			return nil, fmt.Errorf("材料 %q 必须是普通文件，不能是链接或目录", filepath.Base(path))
		}
		name := filepath.Base(path)
		if name == "" || name == "." || name == string(filepath.Separator) ||
			len([]rune(name)) > 160 || !utf8.ValidString(name) ||
			strings.IndexFunc(name, unicode.IsControl) >= 0 {
			return nil, fmt.Errorf("材料文件名无效")
		}
		if info.Size() <= 0 || info.Size() > maxLocalCTFMaterialBytes {
			return nil, fmt.Errorf("材料 %q 必须在 1 字节到 32 MiB 之间", name)
		}
		total += info.Size()
		if total > maxLocalCTFTotalBytes {
			return nil, fmt.Errorf("补充材料合计不能超过 96 MiB")
		}

		file, err := os.Open(path)
		if err != nil {
			return nil, fmt.Errorf("打开材料 %q: %w", name, err)
		}
		openedInfo, statErr := file.Stat()
		if statErr != nil || !openedInfo.Mode().IsRegular() || !os.SameFile(info, openedInfo) ||
			openedInfo.Size() != info.Size() {
			_ = file.Close()
			return nil, fmt.Errorf("材料 %q 在读取前发生变化", name)
		}
		data, readErr := io.ReadAll(io.LimitReader(file, maxLocalCTFMaterialBytes+1))
		closeErr := file.Close()
		if readErr != nil {
			return nil, fmt.Errorf("读取材料 %q: %w", name, readErr)
		}
		if closeErr != nil {
			return nil, fmt.Errorf("关闭材料 %q: %w", name, closeErr)
		}
		if len(data) == 0 || len(data) > maxLocalCTFMaterialBytes {
			return nil, fmt.Errorf("材料 %q 必须在 1 字节到 32 MiB 之间", name)
		}
		if int64(len(data)) != info.Size() {
			return nil, fmt.Errorf("材料 %q 在读取时发生变化", name)
		}

		mediaType := mime.TypeByExtension(strings.ToLower(filepath.Ext(name)))
		if mediaType == "" {
			mediaType = http.DetectContentType(data)
		}
		if separator := strings.IndexByte(mediaType, ';'); separator >= 0 {
			mediaType = mediaType[:separator]
		}
		digest := sha256.Sum256(data)
		materials = append(materials, ctf.MaterialRequest{
			Name:       name,
			MediaType:  mediaType,
			DataBase64: base64.StdEncoding.EncodeToString(data),
			Provenance: fmt.Sprintf("local-file-picker:%s:sha256:%s", name, hex.EncodeToString(digest[:])),
		})
	}
	return materials, nil
}

func (a *App) SendMessage(
	conversationID,
	prompt,
	workspacePath,
	modelMode,
	modelProvider,
	modelID,
	executionMode,
	approvalPolicy,
	mcpConfigDigest string,
	mcpServers []string,
	attachments []codingattachment.Attachment,
) error {
	sessionRole := ""
	if a.ctfAgent != nil {
		if err := a.ctfAgent.AuthorizeTurn(a.commandContext(), conversationID, workspacePath); err != nil {
			return err
		}
		switch {
		case strings.HasPrefix(conversationID, "ctf_tool_"):
			sessionRole = ctf.AgentWorkspaceRoleToolBuilder
		case strings.HasPrefix(conversationID, "ctf_strategy_"):
			sessionRole = ctf.AgentWorkspaceRoleStrategist
		case strings.HasPrefix(conversationID, "ctf_"):
			sessionRole = ctf.AgentWorkspaceRoleSolver
		}
	}
	settings, err := engine.ResolveTaskModel(
		a.settings.GetResolved(),
		sessionRole,
		modelMode,
		modelProvider,
		modelID,
	)
	if err != nil {
		return err
	}
	return a.engines.SendMessage(
		conversationID,
		prompt,
		workspacePath,
		sessionRole,
		executionMode,
		approvalPolicy,
		mcpServers,
		mcpConfigDigest,
		attachments,
		settings,
	)
}

func (a *App) AbortMessage(conversationID string) error {
	return a.engines.AbortMessage(conversationID)
}

func (a *App) RespondToolApproval(
	conversationID,
	requestID string,
	approved bool,
) error {
	return a.engines.RespondToolApproval(conversationID, requestID, approved)
}

func (a *App) GetRuntimeStatus() engine.RuntimeStatus {
	return a.engines.Status()
}

func (a *App) GetCodingEnvironment(workspacePath string) (codingenv.Snapshot, error) {
	inspectContext, cancel := context.WithTimeout(a.commandContext(), 4*time.Second)
	defer cancel()
	return codingenv.Inspect(inspectContext, workspacePath)
}

func (a *App) GetCodingMCPConfig(workspacePath string) (codingenv.MCPConfigSnapshot, error) {
	return codingenv.InspectMCPConfig(workspacePath)
}

func (a *App) GetCodingDiff(workspacePath, relativePath string) (codingenv.DiffSnapshot, error) {
	inspectContext, cancel := context.WithTimeout(a.commandContext(), 4*time.Second)
	defer cancel()
	return codingenv.InspectDiff(inspectContext, workspacePath, relativePath)
}

func (a *App) ApplyCodingGitAction(
	workspacePath,
	action,
	relativePath,
	message string,
) (codingenv.GitActionResult, error) {
	timeout := 15 * time.Second
	if action == codingenv.GitActionPush {
		timeout = 2 * time.Minute
	}
	actionContext, cancel := context.WithTimeout(a.commandContext(), timeout)
	defer cancel()
	return codingenv.ApplyGitAction(
		actionContext,
		workspacePath,
		action,
		relativePath,
		message,
	)
}

func (a *App) GetCodingArchitecturePreview(
	workspacePath,
	relativePath string,
) (codingenv.ArchitecturePreview, error) {
	return codingenv.InspectArchitecturePreview(workspacePath, relativePath)
}

func (a *App) TestAgentModel() (engine.ModelProbeResult, error) {
	result, err := a.engines.ProbeModel(a.settings.GetResolved())
	if err != nil {
		return engine.ModelProbeResult{}, err
	}
	if err := a.settings.RecordModelVerification(
		result.Provider,
		result.Model,
		time.Now(),
	); err != nil {
		return engine.ModelProbeResult{}, err
	}
	return result, nil
}

func (a *App) StartSampleCTF() (ctf.Projection, error) {
	return a.ctfJobs.StartSampleChallenge(a.commandContext())
}

func (a *App) ImportNSSCTFChallenge(rawURL string) (nssctf.Challenge, error) {
	return a.nssctf.ImportChallenge(a.commandContext(), rawURL)
}

func (a *App) SyncNSSCTFCatalog(rawURL string) (nssctf.CatalogSyncResult, error) {
	return a.nssctfCatalog.Sync(a.commandContext(), rawURL)
}

func (a *App) GetNSSCTFTrainingDashboard() (nssctf.TrainingDashboard, error) {
	signals, err := a.trainingSignals()
	if err != nil {
		return nssctf.TrainingDashboard{}, err
	}
	return a.nssctfCatalog.Dashboard(a.commandContext(), signals)
}

func (a *App) trainingSignals() ([]nssctf.TrainingSignal, error) {
	projections, err := a.trainingProjections()
	if err != nil {
		return nil, err
	}
	signals := make([]nssctf.TrainingSignal, 0, len(projections))
	for _, projection := range projections {
		if signal, eligible := realTrainingSignal(projection); eligible {
			signals = append(signals, signal)
		}
	}
	return signals, nil
}

func (a *App) trainingProjections() ([]ctf.Projection, error) {
	summaries, err := a.ctfJobs.ListJobs(a.commandContext())
	if err != nil {
		return nil, err
	}
	projections := make([]ctf.Projection, 0, len(summaries))
	for _, summary := range summaries {
		projection, err := a.ctfJobs.GetJob(a.commandContext(), summary.ID)
		if err != nil {
			return nil, err
		}
		projections = append(projections, projection)
	}
	return projections, nil
}

func (a *App) ListNSSCTFCatalog(query nssctf.CatalogQuery) (nssctf.CatalogSearchResult, error) {
	result, err := a.nssctfCatalog.Search(a.commandContext(), query)
	if err != nil {
		return nssctf.CatalogSearchResult{}, err
	}
	signals, err := a.trainingSignals()
	if err != nil {
		return nssctf.CatalogSearchResult{}, err
	}
	result.AttemptedProblemIDs, result.CompletedProblemIDs = catalogTrainingProgress(
		result.Problems,
		signals,
	)
	return result, nil
}

func catalogTrainingProgress(
	problems []nssctf.CatalogProblem,
	signals []nssctf.TrainingSignal,
) ([]int, []int) {
	progress := make(map[int]struct {
		attempted bool
		completed bool
	}, len(signals))
	for _, signal := range signals {
		if signal.ProblemID <= 0 || !strings.HasPrefix(signal.Platform, "nssctf") {
			continue
		}
		value := progress[signal.ProblemID]
		value.attempted = true
		value.completed = value.completed || signal.Succeeded
		progress[signal.ProblemID] = value
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

func (a *App) GetCTFTrainingPlatforms() []ctf.TrainingPlatform {
	return ctf.TrainingPlatforms()
}

func boundedRunes(value string, maximum int) string {
	value = strings.TrimSpace(value)
	runes := []rune(value)
	if len(runes) <= maximum {
		return value
	}
	return string(runes[:maximum])
}

func realTrainingSignal(projection ctf.Projection) (nssctf.TrainingSignal, bool) {
	platform := strings.TrimSpace(projection.Challenge.ExternalPlatform)
	if platform == "" {
		return nssctf.TrainingSignal{}, false
	}
	problemID := 0
	if _, value, err := nssctf.NormalizeProblemURL(projection.Challenge.Source.URI); err == nil {
		problemID = value
	}
	state := nssctf.TrainingStateActive
	if projection.Outcome != nil {
		switch projection.Outcome.Status {
		case securityruntime.OutcomeSucceeded:
			state = nssctf.TrainingStateSucceeded
		case securityruntime.OutcomeFailed:
			state = nssctf.TrainingStateFailed
		case securityruntime.OutcomeCancelled:
			state = nssctf.TrainingStateCancelled
		}
	} else {
		switch projection.Job.Status {
		case securityruntime.JobSucceeded:
			state = nssctf.TrainingStateSucceeded
		case securityruntime.JobFailed:
			state = nssctf.TrainingStateFailed
		case securityruntime.JobCancelled:
			state = nssctf.TrainingStateCancelled
		}
	}
	succeeded := projection.Outcome != nil &&
		projection.Outcome.Status == securityruntime.OutcomeSucceeded
	verification := nssctf.TrainingVerificationUnverified
	if succeeded {
		verification = nssctf.TrainingVerificationUserConfirmed
		for _, receipt := range projection.JudgeReceipts {
			if receipt.Correct != nil &&
				*receipt.Correct &&
				strings.EqualFold(receipt.Platform, platform) {
				verification = nssctf.TrainingVerificationPlatformJudge
				break
			}
		}
	}
	return nssctf.TrainingSignal{
		ProblemID: problemID,
		Platform:  platform,
		Category:  projection.Challenge.Category,
		Tags:      append([]string{}, projection.Challenge.KnowledgePoints...),
		State:     state,
		Succeeded: succeeded,
		// A persisted CTF job is one learner attempt. Runtime/PI restarts inside
		// the job are execution details and must not lower the learner's solve rate.
		Attempts:         1,
		Hints:            projection.HumanOutcome.HintCount,
		IndependentSteps: projection.HumanOutcome.IndependentSteps,
		Verification:     verification,
	}, true
}

func (a *App) OpenNSSCTFChallenge(rawURL string) error {
	normalized, _, err := nssctf.NormalizeProblemURL(rawURL)
	if err != nil {
		return err
	}
	if a.ctx == nil {
		return fmt.Errorf("desktop runtime is not ready")
	}
	wailsruntime.BrowserOpenURL(a.ctx, normalized)
	return nil
}

func (a *App) OpenCTFSourceURL(rawURL string) error {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil ||
		(parsed.Scheme != "http" && parsed.Scheme != "https") ||
		parsed.Host == "" ||
		parsed.User != nil {
		return fmt.Errorf("CTF source must be an http(s) URL without credentials")
	}
	if a.ctx == nil {
		return fmt.Errorf("desktop runtime is not ready")
	}
	wailsruntime.BrowserOpenURL(a.ctx, parsed.String())
	return nil
}

func (a *App) OpenChromeExtensionManager() error {
	if a.ctx == nil {
		return fmt.Errorf("desktop runtime is not ready")
	}
	if runtime.GOOS != "darwin" {
		return fmt.Errorf("open Chrome extensions is currently supported on macOS")
	}
	if err := exec.Command(
		"/usr/bin/open",
		"-b",
		"com.google.Chrome",
		"chrome://extensions/",
	).Run(); err != nil {
		return fmt.Errorf("open Chrome extensions: %w", err)
	}
	return nil
}

func (a *App) RevealBrowserExtension() error {
	if a.ctx == nil {
		return fmt.Errorf("desktop runtime is not ready")
	}
	if runtime.GOOS != "darwin" {
		return fmt.Errorf("reveal browser extension is currently supported on macOS")
	}
	info, err := a.browserBridge.StartBridge()
	if err != nil {
		return err
	}
	extensionPath := filepath.Clean(info.ExtensionPath)
	if extensionPath == "." || !filepath.IsAbs(extensionPath) {
		return fmt.Errorf("browser extension directory is unavailable")
	}
	stat, err := os.Stat(extensionPath)
	if err != nil {
		return fmt.Errorf("inspect browser extension directory: %w", err)
	}
	if !stat.IsDir() {
		return fmt.Errorf("browser extension path is not a directory")
	}
	if err := exec.Command("/usr/bin/open", extensionPath).Run(); err != nil {
		return fmt.Errorf("open browser extension directory: %w", err)
	}
	return nil
}

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
	wailsruntime.BrowserOpenURL(a.ctx, "https://www.nssctf.cn/ai/agents")
	return nil
}

func (a *App) StartCTFChallenge(request ctf.ChallengeRequest) (ctf.Projection, error) {
	return a.ctfJobs.StartChallenge(a.commandContext(), request)
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

func (a *App) ListCTFJobs() ([]ctf.Summary, error) {
	return a.ctfJobs.ListJobs(a.commandContext())
}

func (a *App) GetCTFJob(id string) (ctf.Projection, error) {
	return a.ctfJobs.GetJob(a.commandContext(), id)
}

func (a *App) GetCTFArtifactPreview(id string, artifactID string) (ctf.ArtifactPreview, error) {
	return a.ctfJobs.GetArtifactPreview(a.commandContext(), id, artifactID)
}

func (a *App) PrepareCTFAgentWorkspace(id string) (ctf.AgentWorkspaceHandoff, error) {
	projection, err := a.ctfJobs.GetJob(a.commandContext(), id)
	if err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	handoff, err := ctf.PrepareAgentWorkspace(
		a.commandContext(),
		filepath.Join(a.dataDirectory, "ctf-workspaces"),
		projection,
		a.jobs,
	)
	if err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	if a.ctfMemory != nil {
		memories, recallErr := a.ctfMemory.RecallForChallenge(
			a.commandContext(),
			ctf.TrainingMemoryRecallContext{
				Category:        projection.Challenge.Category,
				Title:           projection.Challenge.Title,
				KnowledgePoints: projection.Challenge.KnowledgePoints,
				SourceJobID:     projection.Job.ID,
			},
			5,
		)
		if recallErr != nil {
			return ctf.AgentWorkspaceHandoff{}, recallErr
		}
		if err := ctf.WriteAgentMemoryContext(handoff.WorkspacePath, memories); err != nil {
			return ctf.AgentWorkspaceHandoff{}, err
		}
	}
	if err := a.ctfAgent.Register(handoff); err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	return handoff, nil
}

func (a *App) SaveCTFTrainingMemory(id string) (ctf.TrainingMemory, error) {
	if a.ctfMemory == nil {
		return ctf.TrainingMemory{}, fmt.Errorf("CTF memory store is unavailable")
	}
	projection, err := a.ctfJobs.GetJob(a.commandContext(), id)
	if err != nil {
		return ctf.TrainingMemory{}, err
	}
	sourceSessionID := ""
	if len(projection.AgentRuns) > 0 {
		sourceSessionID = projection.AgentRuns[len(projection.AgentRuns)-1].SessionID
	}
	memory, err := a.ctfMemory.SaveFromProjection(
		a.commandContext(),
		projection,
		sourceSessionID,
		time.Now(),
	)
	if err != nil {
		return ctf.TrainingMemory{}, err
	}
	workspacePath, pathErr := ctf.AgentWorkspacePath(
		filepath.Join(a.dataDirectory, "ctf-workspaces"),
		id,
	)
	if pathErr == nil {
		if _, statErr := os.Stat(filepath.Join(workspacePath, "challenge.json")); statErr == nil {
			memories, recallErr := a.ctfMemory.RecallForChallenge(
				a.commandContext(),
				ctf.TrainingMemoryRecallContext{
					Category:        projection.Challenge.Category,
					Title:           projection.Challenge.Title,
					KnowledgePoints: projection.Challenge.KnowledgePoints,
					SourceJobID:     projection.Job.ID,
				},
				5,
			)
			if recallErr == nil {
				_ = ctf.WriteAgentMemoryContext(workspacePath, memories)
			}
		}
	}
	return memory, nil
}

func (a *App) ListCTFMemories(category, query string) ([]ctf.TrainingMemory, error) {
	if a.ctfMemory == nil {
		return nil, fmt.Errorf("CTF memory store is unavailable")
	}
	return a.ctfMemory.Recall(a.commandContext(), category, query, 20)
}

func (a *App) GetCTFMemoryContext(id string) ([]ctf.TrainingMemory, error) {
	if a.ctfMemory == nil {
		return nil, fmt.Errorf("CTF memory store is unavailable")
	}
	projection, err := a.ctfJobs.GetJob(a.commandContext(), id)
	if err != nil {
		return nil, err
	}
	return a.ctfMemory.RecallForChallenge(
		a.commandContext(),
		ctf.TrainingMemoryRecallContext{
			Category:        projection.Challenge.Category,
			Title:           projection.Challenge.Title,
			KnowledgePoints: projection.Challenge.KnowledgePoints,
			SourceJobID:     projection.Job.ID,
		},
		5,
	)
}

func (a *App) ArchiveCTFMemory(id, reason string) error {
	if a.ctfMemory == nil {
		return fmt.Errorf("CTF memory store is unavailable")
	}
	return a.ctfMemory.Archive(a.commandContext(), id, reason, time.Now())
}

func (a *App) PrepareCTFToolBuilderWorkspace(id string) (ctf.AgentWorkspaceHandoff, error) {
	if _, err := a.ctfJobs.GetJob(a.commandContext(), id); err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	workspacePath, err := ctf.AgentWorkspacePath(
		filepath.Join(a.dataDirectory, "ctf-workspaces"),
		id,
	)
	if err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	if _, err := os.Stat(filepath.Join(workspacePath, "challenge.json")); errors.Is(err, os.ErrNotExist) {
		if _, prepareErr := a.PrepareCTFAgentWorkspace(id); prepareErr != nil {
			return ctf.AgentWorkspaceHandoff{}, prepareErr
		}
	} else if err != nil {
		return ctf.AgentWorkspaceHandoff{}, fmt.Errorf("inspect CTF Agent workspace: %w", err)
	}
	handoff, err := ctf.LoadAgentToolBuilderHandoff(workspacePath)
	if err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	if err := a.ctfAgent.Register(handoff); err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	return handoff, nil
}

func (a *App) PrepareCTFStrategistWorkspace(id string) (ctf.AgentWorkspaceHandoff, error) {
	if _, err := a.ctfJobs.GetJob(a.commandContext(), id); err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	workspacePath, err := ctf.AgentWorkspacePath(
		filepath.Join(a.dataDirectory, "ctf-workspaces"),
		id,
	)
	if err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	if _, err := os.Stat(filepath.Join(workspacePath, "challenge.json")); errors.Is(err, os.ErrNotExist) {
		if _, prepareErr := a.PrepareCTFAgentWorkspace(id); prepareErr != nil {
			return ctf.AgentWorkspaceHandoff{}, prepareErr
		}
	} else if err != nil {
		return ctf.AgentWorkspaceHandoff{}, fmt.Errorf("inspect CTF Agent workspace: %w", err)
	}
	handoff, err := ctf.LoadAgentStrategistHandoff(workspacePath)
	if err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	if err := a.ctfAgent.Register(handoff); err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	return handoff, nil
}

func (a *App) GetCTFToolWorkshopState(id string) (ctf.ToolWorkshopState, error) {
	if _, err := a.ctfJobs.GetJob(a.commandContext(), id); err != nil {
		return ctf.ToolWorkshopState{}, err
	}
	workspacePath, err := ctf.AgentWorkspacePath(
		filepath.Join(a.dataDirectory, "ctf-workspaces"),
		id,
	)
	if err != nil {
		return ctf.ToolWorkshopState{}, err
	}
	handoff, err := ctf.LoadAgentWorkspaceHandoff(workspacePath)
	if err != nil {
		return ctf.ToolWorkshopState{}, fmt.Errorf("load CTF Agent workspace: %w", err)
	}
	if handoff.JobID != id {
		return ctf.ToolWorkshopState{}, fmt.Errorf("CTF Agent workspace does not match the requested job")
	}
	return ctf.ReadToolWorkshopState(workspacePath)
}

func (a *App) GetCTFAgentReplay(id string) (ctf.AgentReplay, error) {
	if _, err := a.ctfJobs.GetJob(a.commandContext(), id); err != nil {
		return ctf.AgentReplay{}, err
	}
	workspacePath, err := ctf.AgentWorkspacePath(
		filepath.Join(a.dataDirectory, "ctf-workspaces"),
		id,
	)
	if err != nil {
		return ctf.AgentReplay{}, err
	}
	handoff, err := ctf.LoadAgentWorkspaceHandoff(workspacePath)
	if err != nil {
		return ctf.AgentReplay{}, fmt.Errorf("load CTF Agent workspace: %w", err)
	}
	if handoff.JobID != id {
		return ctf.AgentReplay{}, fmt.Errorf("CTF Agent workspace does not match the requested job")
	}
	return ctf.ReadAgentReplay(workspacePath)
}

func (a *App) GetCTFAgentBudgetStatus(id string) (ctf.AgentBudgetStatus, error) {
	projection, err := a.ctfJobs.GetJob(a.commandContext(), id)
	if err != nil {
		return ctf.AgentBudgetStatus{}, err
	}
	return ctf.EvaluateAgentBudget(projection, time.Now()), nil
}

func (a *App) GetCTFAgentRunCheckpoint(id string) (*ctf.AgentRunCheckpoint, error) {
	if _, err := a.ctfJobs.GetJob(a.commandContext(), id); err != nil {
		return nil, err
	}
	workspacePath, err := ctf.AgentWorkspacePath(
		filepath.Join(a.dataDirectory, "ctf-workspaces"),
		id,
	)
	if err != nil {
		return nil, err
	}
	checkpoint, err := ctf.LoadAgentRunCheckpoint(workspacePath)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if checkpoint.JobID != id {
		return nil, fmt.Errorf("CTF Agent checkpoint does not match the requested job")
	}
	return &checkpoint, nil
}

func (a *App) GenerateCTFTrainingReport(id string) (ctf.TrainingReportExport, error) {
	projection, err := a.ctfJobs.GetJob(a.commandContext(), id)
	if err != nil {
		return ctf.TrainingReportExport{}, err
	}
	handoff, err := a.PrepareCTFAgentWorkspace(id)
	if err != nil {
		return ctf.TrainingReportExport{}, err
	}
	refreshedRun, err := ctf.PersistAgentRunCheckpoint(
		handoff.WorkspacePath,
		handoff,
		ctf.AgentRunSnapshot{
			Status:                 handoff.Run.Status,
			ExitReason:             handoff.Run.ExitReason,
			Model:                  handoff.Run.Model,
			LastToolFingerprint:    handoff.Run.LastToolFingerprint,
			RepeatedToolUses:       handoff.Run.RepeatedToolUses,
			LastFailureFingerprint: handoff.Run.LastFailureFingerprint,
			RepeatedFailures:       handoff.Run.RepeatedFailures,
			LastAssistantSummary:   handoff.Run.LastAssistantSummary,
		},
		time.Now().UTC(),
	)
	if err != nil {
		return ctf.TrainingReportExport{}, err
	}
	handoff.Run = refreshedRun
	replay, err := ctf.ReadAgentReplay(handoff.WorkspacePath)
	if err != nil {
		return ctf.TrainingReportExport{}, err
	}
	report, err := ctf.BuildTrainingReport(projection, handoff, replay, time.Now().UTC())
	if err != nil {
		return ctf.TrainingReportExport{}, err
	}
	return ctf.PersistTrainingReport(handoff.WorkspacePath, report)
}

func (a *App) CancelCTFJob(id string) error {
	return a.ctfJobs.CancelJob(a.commandContext(), id)
}

func (a *App) RecordCTFLearning(id string, request ctf.LearningRecordRequest) (ctf.Projection, error) {
	return a.ctfJobs.RecordLearning(a.commandContext(), id, request)
}

func (a *App) ContinueCTFJob(id string) (ctf.Projection, error) {
	return a.ctfJobs.ContinueJob(a.commandContext(), id)
}

func (a *App) ReviewCTFSubmission(id string, accepted bool, summary string) (ctf.Projection, error) {
	return a.ctfJobs.ReviewSubmission(a.commandContext(), id, accepted, summary)
}

func (a *App) PrepareCTFExternalSubmission(
	id, candidate, explanation string,
) (ctf.Projection, error) {
	return a.ctfJobs.PrepareExternalSubmission(
		a.commandContext(),
		id,
		candidate,
		explanation,
		0,
	)
}

func (a *App) RecordCTFExternalVerdict(
	id string,
	accepted bool,
	summary string,
) (ctf.Projection, error) {
	return a.ctfJobs.RecordExternalVerdict(
		a.commandContext(),
		id,
		accepted,
		summary,
	)
}

func (a *App) StartPacketParserResearch() (vuln.Projection, error) {
	return a.vulnJobs.StartPacketParserFixture(a.commandContext())
}

func (a *App) ListVulnJobs() ([]vuln.Summary, error) {
	return a.vulnJobs.ListJobs(a.commandContext())
}

func (a *App) GetVulnJob(id string) (vuln.Projection, error) {
	return a.vulnJobs.GetJob(a.commandContext(), id)
}

func (a *App) SubmitVulnReproduction(id string, request vuln.ReproductionRequest) (vuln.Projection, error) {
	return a.vulnJobs.SubmitReproductionEvidence(a.commandContext(), id, request)
}

func (a *App) RecordVulnLearning(id string, request vuln.LearningRecordRequest) (vuln.Projection, error) {
	return a.vulnJobs.RecordLearning(a.commandContext(), id, request)
}

func (a *App) CancelVulnJob(id string) error {
	return a.vulnJobs.CancelJob(a.commandContext(), id)
}

func (a *App) emitEngineEvent(event engine.Event) {
	if a.ctx != nil {
		wailsruntime.EventsEmit(a.ctx, "engine-event", event)
	}
	if a.ctfAgent != nil {
		if err := a.ctfAgent.Record(a.commandContext(), event); err != nil && a.ctx != nil {
			if errors.Is(err, errCTFAgentLoopDetected) {
				_ = a.engines.AbortMessage(event.SessionID)
			}
			wailsruntime.EventsEmit(a.ctx, "job-runtime-error", err.Error())
		}
	}
}

func (a *App) emitJobEvent(event securityruntime.Event) {
	if a.ctx == nil {
		return
	}
	wailsruntime.EventsEmit(a.ctx, "job-event", event)
}

func (a *App) commandContext() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}
