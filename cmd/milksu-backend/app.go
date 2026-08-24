package main

import (
	"context"
	"errors"
	"fmt"
	"log"
	"net/url"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/browsercap"
	"github.com/MilkSU-Official/milksu/internal/codingattachment"
	"github.com/MilkSU-Official/milksu/internal/codingcollab"
	"github.com/MilkSU-Official/milksu/internal/codingenv"
	"github.com/MilkSU-Official/milksu/internal/codingterminal"
	"github.com/MilkSU-Official/milksu/internal/codingworkspace"
	"github.com/MilkSU-Official/milksu/internal/computercap"
	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/ctfshow"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/envbroker"
	"github.com/MilkSU-Official/milksu/internal/lab"
	"github.com/MilkSU-Official/milksu/internal/modelcatalog"
	"github.com/MilkSU-Official/milksu/internal/modelusage"
	"github.com/MilkSU-Official/milksu/internal/nssctf"
	pluginruntime "github.com/MilkSU-Official/milksu/internal/plugin"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
	"github.com/MilkSU-Official/milksu/internal/securitytools"
	"github.com/MilkSU-Official/milksu/internal/sessionindex"
	"github.com/MilkSU-Official/milksu/internal/userartifact"
	"github.com/MilkSU-Official/milksu/internal/vuln"
)

// App is the thin L1 desktop adapter. Domain code must not depend on Wails.
type App struct {
	ctx               context.Context
	host              desktopHost
	dataDirectory     string
	artifactDirectory string
	diagnostics       *appdata.DiagnosticRecorder
	settings          *config.Store
	conversations     *conversation.Store
	labJobs           *lab.Store
	envBroker         *envbroker.Service
	codingFiles       *codingattachment.Store
	codingCollab      *codingcollab.Manager
	ctfMaterials      *localCTFMaterialStore
	codingTerminals   *codingterminal.Manager
	codingProjects    *codingworkspace.Store
	codingPRs         *codingenv.PullRequestPublisher
	computerUse       *computercap.Manager
	engines           *engine.Supervisor
	securityEngine    *engine.SecuritySupervisor
	securityTools     *securitytools.Service
	modelCatalog      *modelcatalog.Service
	modelUsage        *modelusage.Store
	pluginRegistry    *pluginruntime.Registry
	nssctf            *nssctf.Client
	nssctfCatalog     *nssctf.CatalogService
	ctfshowCatalog    *ctfshow.CatalogService
	nssctfArena       *nssctf.ArenaClient
	browserBridge     *browsercap.Manager
	jobs              *securityruntime.Service
	ctfJobs           *ctf.Service
	ctfAgent          *ctfAgentRecorder
	ctfMemory         *ctf.MemoryStore
	vulnJobs          *vuln.Service
	sessionIndex      *sessionindex.Store
	lifespanStart     appdata.LifespanStart
	lifespanHandle    appdata.LifespanHandle
}

func NewApp() (*App, error) {
	return newAppWithDesktopHost(nil)
}

func newAppWithDesktopHost(host desktopHost) (*App, error) {
	dataDirectory, err := appdata.Ensure()
	if err != nil {
		return nil, err
	}
	restoreResult, err := appdata.ApplyPendingRestore(dataDirectory)
	if err != nil {
		return nil, fmt.Errorf("apply pending local data restore: %w", err)
	}
	migrationBackup, err := appdata.EnsurePreMigrationBackup(
		context.Background(),
		dataDirectory,
		databaseCompatDescriptors(),
	)
	if err != nil {
		return nil, fmt.Errorf("prepare local database migrations: %w", err)
	}
	settings, err := config.NewStore()
	if err != nil {
		return nil, fmt.Errorf("create settings store: %w", err)
	}
	conversations, err := conversation.NewStore()
	if err != nil {
		return nil, fmt.Errorf("create conversation store: %w", err)
	}
	labJobs, err := lab.NewStore()
	if err != nil {
		return nil, fmt.Errorf("create lab job store: %w", err)
	}
	envBroker, err := envbroker.New(dataDirectory)
	if err != nil {
		return nil, fmt.Errorf("create environment broker: %w", err)
	}
	artifactDirectory, err := userartifact.Directory()
	if err != nil {
		return nil, fmt.Errorf("resolve user artifact directory: %w", err)
	}
	artifactDirectory, err = userartifact.Ensure(artifactDirectory)
	if err != nil {
		return nil, fmt.Errorf("create user artifact directory: %w", err)
	}
	codingFiles, err := codingattachment.NewStore(
		filepath.Join(dataDirectory, "agent-home", "attachments"),
	)
	if err != nil {
		return nil, fmt.Errorf("create Coding attachment store: %w", err)
	}
	codingProjects, err := codingworkspace.NewStore()
	if err != nil {
		return nil, fmt.Errorf("create Coding project memory: %w", err)
	}
	codingCollab, err := newCodingCollaborationManager(dataDirectory, runtime.GOOS)
	if err != nil {
		return nil, fmt.Errorf("create Coding collaboration manager: %w", err)
	}

	application := &App{
		host:              host,
		dataDirectory:     dataDirectory,
		artifactDirectory: artifactDirectory,
		diagnostics:       appdata.NewDiagnosticRecorder(256),
		settings:          settings,
		conversations:     conversations,
		labJobs:           labJobs,
		envBroker:         envBroker,
		codingFiles:       codingFiles,
		codingProjects:    codingProjects,
		codingCollab:      codingCollab,
		ctfMaterials:      newLocalCTFMaterialStore(),
	}
	application.pluginRegistry, err = newPluginRegistry(dataDirectory)
	if err != nil {
		return nil, fmt.Errorf("create plugin registry: %w", err)
	}
	application.diagnostics.Record("app", "info", "application services initialized")
	application.modelCatalog, err = modelcatalog.New(
		dataDirectory,
		settings.GetResolved,
		modelcatalog.Options{},
	)
	if err != nil {
		return nil, fmt.Errorf("create model catalog: %w", err)
	}
	settings.SetRuntimeModelCatalogPath(application.modelCatalog.CachePath())
	application.securityTools = securitytools.NewService(
		dataDirectory,
		settings,
		application.emitSecurityToolSetup,
	)
	if restoreResult.Applied {
		application.diagnostics.Record("appdata", "info", "pending local data restore applied")
		_ = appdata.AppendEventLog(dataDirectory, appdata.PersistedRestoreApplied)
	}
	if restoreResult.RecoveredFirst {
		application.diagnostics.Record("appdata", "warning", "interrupted local data restore recovered")
		_ = appdata.AppendEventLog(dataDirectory, appdata.PersistedInterruptedRestoreRecovered)
	}
	if migrationBackup.Created {
		application.diagnostics.Record("appdata", "info", "pre-migration safety backup created")
		_ = appdata.AppendEventLog(dataDirectory, appdata.PersistedMigrationBackupCreated)
	} else if migrationBackup.Reused {
		application.diagnostics.Record("appdata", "info", "existing pre-migration safety backup verified")
		_ = appdata.AppendEventLog(dataDirectory, appdata.PersistedMigrationBackupVerified)
	}
	application.engines = engine.NewSupervisor(application.emitEngineEvent)
	application.engines.SetWorkspaceActionHandler(application.handleCodingWorkspaceAction)
	application.codingPRs = codingenv.NewPullRequestPublisher()
	// Packaged Electron owns the TCC principal for embedded Computer Use.
	// When a desktop host is attached, permission probes/open must go through
	// host systemPreferences rather than the Go runtime binary identity.
	computerUseOptions := computercap.Options{
		GrantDirectory: filepath.Join(dataDirectory, "computer-use", "task-authorizations"),
		TargetPID:      desktopComputerUseHostPID(),
	}
	if host != nil {
		computerUseOptions.PermissionProbe = desktopComputerUsePermissionProbe(host)
		computerUseOptions.PermissionOpen = desktopComputerUsePermissionOpen(host)
	}
	application.computerUse = computercap.New(computerUseOptions)
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
	if codingHost := newElectronCodingHost(host); codingHost != nil {
		application.browserBridge, err = browsercap.NewWithCodingHost(dataDirectory, codingHost)
	} else {
		application.browserBridge, err = browsercap.New(dataDirectory)
	}
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
		filepath.Join(artifactDirectory, string(userartifact.KindCTF)),
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
	application.codingTerminals = codingterminal.NewManager(
		application.emitCodingTerminalEvent,
	)
	application.sessionIndex, err = sessionindex.NewStore(
		filepath.Join(dataDirectory, "session-index", "obelisk.sqlite"),
	)
	if err != nil {
		_ = application.vulnJobs.Close()
		_ = application.ctfMemory.Close()
		_ = application.ctfJobs.Close()
		_ = application.jobs.Close()
		application.securityEngine.Close()
		application.browserBridge.Close()
		application.ctfshowCatalog.Close()
		application.nssctfCatalog.Close()
		return nil, fmt.Errorf("create session index: %w", err)
	}
	application.modelUsage, err = modelusage.NewStore(
		filepath.Join(dataDirectory, "usage", "model-usage.sqlite3"),
	)
	if err != nil {
		_ = application.vulnJobs.Close()
		_ = application.ctfMemory.Close()
		_ = application.ctfJobs.Close()
		_ = application.jobs.Close()
		application.securityEngine.Close()
		application.browserBridge.Close()
		_ = application.ctfshowCatalog.Close()
		_ = application.nssctfCatalog.Close()
		return nil, fmt.Errorf("create Coding Agent usage ledger: %w", err)
	}
	return application, nil
}

func (a *App) Startup(ctx context.Context) {
	startupBegan := time.Now()
	a.ctx = ctx
	lifespanStart, lifespanHandle, lifespanErr := appdata.BeginLifespan(
		a.dataDirectory,
		os.Getpid(),
	)
	if lifespanErr != nil {
		// A broken marker must not block the desktop app. The free-form error
		// remains in memory; only the fixed classification is persisted.
		a.diagnostics.Record("appdata", "error", "lifespan state unavailable")
		a.lifespanStart = appdata.LifespanStart{
			PreviousExit: appdata.LifespanExitNone,
			StartedAt:    time.Now().UTC().Format(time.RFC3339Nano),
		}
		_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedLifespanUnavailable)
	} else {
		a.lifespanStart = lifespanStart
		a.lifespanHandle = lifespanHandle
		switch lifespanStart.PreviousExit {
		case appdata.LifespanExitAbnormal:
			a.diagnostics.Record("appdata", "warning", fmt.Sprintf(
				"previous MilkSU run did not exit cleanly (started %s; consecutive abnormal exits: %d)",
				lifespanStart.PreviousStartedAt,
				lifespanStart.ConsecutiveAbnormalExits,
			))
			_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedPreviousExitAbnormal)
		case appdata.LifespanExitNone:
			a.diagnostics.Record("appdata", "info", "first MilkSU run: no previous lifespan record")
		default:
			a.diagnostics.Record("appdata", "info", "previous MilkSU run exited cleanly")
		}
	}
	log.Printf("[startup] go.lifespan %dms", time.Since(startupBegan).Milliseconds())
	a.diagnostics.Record("app", "info", "desktop runtime started")
	_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedAppInitialized)
	_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedDesktopRuntimeStarted)
	go func() {
		refreshContext, cancelRefresh := context.WithTimeout(context.WithoutCancel(ctx), 15*time.Second)
		defer cancelRefresh()
		refreshStarted := time.Now()
		refreshedCatalog, refreshErr := a.modelCatalog.Refresh(refreshContext)
		if refreshErr != nil {
			log.Printf("[startup] go.modelCatalog.Refresh failed %dms", time.Since(refreshStarted).Milliseconds())
			a.diagnostics.Record("model-catalog", "warning", "model catalog refresh failed; retained last-known-good catalog")
			return
		}
		log.Printf("[startup] go.modelCatalog.Refresh ok %dms", time.Since(refreshStarted).Milliseconds())
		a.diagnostics.Record("model-catalog", "info", "model catalog refreshed")
		a.emitDesktopEvent("model-catalog-changed", refreshedCatalog)
	}()
	recoverStarted := time.Now()
	if err := a.jobs.Recover(ctx); err != nil {
		a.diagnostics.Record("runtime", "error", "runtime job recovery failed")
		_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedRuntimeRecoveryFailed)
		a.emitDesktopEvent("job-runtime-error", err.Error())
	}
	log.Printf("[startup] go.jobs.Recover %dms", time.Since(recoverStarted).Milliseconds())
	ctfRecoverStarted := time.Now()
	if err := a.ctfJobs.Recover(ctx); err != nil {
		a.diagnostics.Record("ctf", "error", "CTF job recovery failed")
		_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedCTFRecoveryFailed)
		a.emitDesktopEvent("job-runtime-error", err.Error())
	}
	log.Printf("[startup] go.ctfJobs.Recover %dms", time.Since(ctfRecoverStarted).Milliseconds())
	vulnRecoverStarted := time.Now()
	if err := a.vulnJobs.Recover(ctx); err != nil {
		a.diagnostics.Record("vuln", "error", "vulnerability job recovery failed")
		_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedVulnRecoveryFailed)
		a.emitDesktopEvent("job-runtime-error", err.Error())
	}
	log.Printf(
		"[startup] go.vulnJobs.Recover %dms total=%dms",
		time.Since(vulnRecoverStarted).Milliseconds(),
		time.Since(startupBegan).Milliseconds(),
	)
}

func (a *App) Shutdown(_ context.Context) {
	_ = a.vulnJobs.Close()
	_ = a.ctfMemory.Close()
	_ = a.ctfJobs.Close()
	a.securityEngine.Close()
	_ = a.jobs.Close()
	a.engines.Close()
	if a.modelUsage != nil {
		_ = a.modelUsage.Close()
	}
	if a.computerUse != nil {
		a.computerUse.Close()
	}
	if a.codingTerminals != nil {
		a.codingTerminals.Close()
	}
	a.browserBridge.Close()
	_ = a.ctfshowCatalog.Close()
	_ = a.nssctfCatalog.Close()
	if a.lifespanHandle.Valid() {
		if err := appdata.MarkCleanExit(a.dataDirectory, a.lifespanHandle); err != nil {
			a.diagnostics.Record("appdata", "error", "mark clean exit failed")
			_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedCleanExitMarkerFailed)
		} else {
			a.diagnostics.Record("app", "info", "desktop runtime exited cleanly")
			_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedDesktopRuntimeExited)
		}
	}
}

func (a *App) showPrimaryWindow() {
	if a.ctx == nil {
		return
	}
	_ = a.desktopCall("window.show", struct{}{}, nil)
}

func (a *App) GetSettings() config.AppSettings {
	return a.settings.Get()
}

// SetAccountModelCredential is called only by the Electron main process after
// it retrieves the current user's assigned provider credential. The settings
// store persists it in credentials.db and never exposes it to the renderer.
func (a *App) SetAccountModelCredential(baseURL, credential string) error {
	changed, err := a.settings.SetManagedAccountRelay(baseURL, credential)
	if err != nil {
		return err
	}
	// Re-read TokenFlux /v1/models even when the Key string is unchanged so
	// Admin/group membership changes show up without a restart.
	refreshedCatalog := a.modelCatalog.Snapshot()
	refreshContext, cancelRefresh := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancelRefresh()
	if nextCatalog, refreshErr := a.modelCatalog.Refresh(refreshContext); refreshErr != nil {
		a.diagnostics.Record("model-catalog", "warning", "account model catalog refresh failed; retained last-known-good catalog")
	} else if modelcatalog.CatalogsEquivalent(refreshedCatalog, nextCatalog) {
		refreshedCatalog = nextCatalog
	} else {
		refreshedCatalog = nextCatalog
		a.emitDesktopEvent("model-catalog-changed", refreshedCatalog)
	}
	selectionChanged, err := a.alignAccountModelSelection(refreshedCatalog)
	if err != nil {
		return err
	}
	if !changed && !selectionChanged {
		return nil
	}
	a.engines.Close()
	a.securityEngine.Restart()
	return nil
}

func (a *App) alignAccountModelSelection(catalog modelcatalog.Snapshot) (bool, error) {
	settings := a.settings.Get()
	if settings.ActiveProvider != modelcatalog.ProviderTokenFlux {
		return false, nil
	}
	model := accountCatalogModel(settings.ActiveModel, catalog.Models)
	if model == "" || model == settings.ActiveModel {
		return false, nil
	}
	settings.ActiveModel = model
	if err := a.settings.Save(settings); err != nil {
		return false, fmt.Errorf("align account model selection: %w", err)
	}
	return true, nil
}

func accountCatalogModel(active string, models []modelcatalog.Model) string {
	active = strings.TrimSpace(active)
	available := make(map[string]bool, len(models))
	for _, model := range models {
		if id := strings.TrimSpace(model.ID); id != "" {
			available[id] = true
		}
	}
	if available[active] {
		return active
	}
	// TokenFlux single-group keys list bare ids; composite keys list prefix/model
	// from /v1/models. Align a saved selection onto an exact catalog id.
	for _, candidate := range tokenfluxCatalogModelAliases(active, models) {
		if available[candidate] {
			return candidate
		}
	}
	for _, preferred := range []string{
		"grok-4.6", "x-ai/grok-4.6",
		"grok-4.5", "x-ai/grok-4.5",
		"grok-4.3", "x-ai/grok-4.3",
	} {
		if available[preferred] {
			return preferred
		}
	}
	for _, model := range models {
		if id := strings.TrimSpace(model.ID); id != "" {
			return id
		}
	}
	return ""
}

// tokenfluxCatalogModelAliases maps a saved selection onto catalog ids that may
// represent the same model under a different key shape (bare vs prefix/model).
func tokenfluxCatalogModelAliases(active string, models []modelcatalog.Model) []string {
	active = strings.TrimSpace(active)
	if active == "" {
		return nil
	}
	result := make([]string, 0, 4)
	seen := map[string]bool{}
	add := func(value string) {
		value = strings.TrimSpace(value)
		if value == "" || seen[value] {
			return
		}
		seen[value] = true
		result = append(result, value)
	}
	add(active)
	activeBare := tokenfluxBareModelID(active)
	if activeBare != active {
		add(activeBare)
	}
	for _, model := range models {
		id := strings.TrimSpace(model.ID)
		if id == "" {
			continue
		}
		if tokenfluxBareModelID(id) == activeBare || tokenfluxBareModelID(id) == active {
			add(id)
		}
	}
	return result
}

func tokenfluxBareModelID(id string) string {
	id = strings.TrimSpace(id)
	slash := strings.IndexByte(id, '/')
	if slash <= 0 || slash >= len(id)-1 {
		return id
	}
	prefix := id[:slash]
	if len(prefix) == 0 || len(prefix) > 32 {
		return id
	}
	for _, r := range prefix {
		switch {
		case r >= 'a' && r <= 'z', r >= 'A' && r <= 'Z', r >= '0' && r <= '9', r == '_', r == '-':
		default:
			return id
		}
	}
	return id[slash+1:]
}

func (a *App) ClearAccountModelCredential() error {
	changed, err := a.settings.ClearManagedAccountRelay()
	if err != nil {
		return err
	}
	if !changed {
		return nil
	}
	a.engines.Close()
	a.securityEngine.Restart()
	return nil
}

func (a *App) GetStartupRecoveryStatus() appdata.LifespanStart {
	return a.lifespanStart
}

func (a *App) GetLocalDataStatus() (appdata.DataStatus, error) {
	status, err := appdata.Inspect(a.dataDirectory)
	if err != nil {
		return appdata.DataStatus{}, err
	}
	status.Databases = appdata.InspectDatabaseCompatibility(
		a.commandContext(),
		a.dataDirectory,
		databaseCompatDescriptors(),
	)
	return status, nil
}

func (a *App) ExportLocalDataBackup() (appdata.BackupExport, error) {
	if a.ctx == nil {
		return appdata.BackupExport{}, fmt.Errorf("desktop runtime is not ready")
	}
	destination, err := a.saveFile(desktopDialogOptions{
		Title:       "导出 MilkSU 本地数据备份",
		DefaultPath: "MilkSU-backup-" + time.Now().Format("2006-01-02") + ".zip",
		Filters:     []desktopFileFilter{{Name: "MilkSU 备份", Extensions: []string{"zip"}}},
	})
	if err != nil {
		return appdata.BackupExport{}, err
	}
	if strings.TrimSpace(destination) == "" {
		return appdata.BackupExport{Cancelled: true}, nil
	}
	return appdata.ExportBackup(a.commandContext(), a.dataDirectory, destination)
}

func (a *App) ScheduleLocalDataRestore() (appdata.BackupRestoreStage, error) {
	if a.ctx == nil {
		return appdata.BackupRestoreStage{}, fmt.Errorf("desktop runtime is not ready")
	}
	source, err := a.openFile(desktopDialogOptions{
		Title:   "从 MilkSU 安全备份恢复",
		Filters: []desktopFileFilter{{Name: "MilkSU 备份", Extensions: []string{"zip"}}},
	})
	if err != nil {
		return appdata.BackupRestoreStage{}, err
	}
	if strings.TrimSpace(source) == "" {
		return appdata.BackupRestoreStage{Cancelled: true}, nil
	}
	validation, err := appdata.ValidateBackup(source)
	if err != nil {
		return appdata.BackupRestoreStage{}, err
	}
	const confirmButton = "恢复并在重启后应用"
	selection, err := a.showMessage(desktopMessageOptions{
		Type:          "warning",
		Title:         "确认恢复本地数据",
		Message:       fmt.Sprintf("将恢复 %d 个文件。当前数据会先保存为可回滚快照；API 凭据、浏览器配对和 PI 认证保持不变。恢复会在下次启动 MilkSU 时应用。", validation.FileCount),
		Buttons:       []string{confirmButton, "取消"},
		DefaultButton: 1,
		CancelButton:  1,
	})
	if err != nil {
		return appdata.BackupRestoreStage{}, err
	}
	if selection != confirmButton {
		return appdata.BackupRestoreStage{Cancelled: true}, nil
	}
	return appdata.StageBackupRestore(a.dataDirectory, source)
}

func (a *App) ExportLocalDiagnostics() (appdata.DiagnosticExport, error) {
	if a.ctx == nil {
		return appdata.DiagnosticExport{}, fmt.Errorf("desktop runtime is not ready")
	}
	destination, err := a.saveFile(desktopDialogOptions{
		Title:       "导出 MilkSU 诊断包",
		DefaultPath: "MilkSU-diagnostics-" + time.Now().Format("2006-01-02") + ".zip",
		Filters:     []desktopFileFilter{{Name: "MilkSU 诊断包", Extensions: []string{"zip"}}},
	})
	if err != nil {
		return appdata.DiagnosticExport{}, err
	}
	if strings.TrimSpace(destination) == "" {
		return appdata.DiagnosticExport{Cancelled: true}, nil
	}
	runtimeStatus := a.engines.Status()
	settings := a.settings.Get()
	providers := make([]string, 0, len(settings.Providers))
	for provider, configured := range settings.Providers {
		if configured.Enabled || configured.HasAPIKey {
			providers = append(providers, provider)
		}
	}
	return appdata.ExportDiagnostics(
		a.commandContext(),
		a.dataDirectory,
		destination,
		appdata.DiagnosticInput{
			AppVersion: "0.1.0",
			Runtime: appdata.DiagnosticRuntime{
				DefaultEngine:       runtimeStatus.DefaultEngine,
				Running:             runtimeStatus.Running,
				SessionCount:        runtimeStatus.SessionCount,
				Protocol:            runtimeStatus.Protocol,
				BackgroundTaskCount: len(runtimeStatus.BackgroundTasks),
			},
			Settings: appdata.DiagnosticSettings{
				ActiveProvider:     settings.ActiveProvider,
				ActiveModel:        settings.ActiveModel,
				RelayEnabled:       settings.Relay != nil && settings.Relay.Enabled,
				ModelVerified:      settings.ModelVerified != nil,
				ConfiguredProvider: providers,
				ArenaTokenPresent:  settings.NSSCTFArena != nil && settings.NSSCTFArena.HasToken,
			},
			Lifespan: a.lifespanStart,
			Events:   a.diagnostics.Snapshot(),
		},
	)
}

type UserArtifactDirectoryStatus struct {
	Directory string `json:"directory"`
}

func (a *App) GetUserArtifactDirectoryStatus() UserArtifactDirectoryStatus {
	return UserArtifactDirectoryStatus{Directory: a.artifactDirectory}
}

func (a *App) EnsureCodingArtifactWorkspace(conversationID string) (string, error) {
	return a.resolveConversationWorkspace(conversationID, "")
}

func (a *App) SaveSettingsCmd(settings config.AppSettings) error {
	previous := a.settings.Get()
	err := a.settings.Save(settings)
	if err != nil && !hasSessionOnlyCredential(a.settings.Get()) {
		return err
	}
	// Provider credentials are supplied only when a sidecar starts. Restarting
	// prevents a running child from retaining credentials removed by the user,
	// and makes a safe session-only fallback available to the next request.
	a.engines.Close()
	a.securityEngine.Restart()
	// When TokenFlux credentials change, re-read /v1/models so the picker and
	// dual-source routing use the models that key can actually call.
	if tokenFluxCatalogInputsChanged(previous, a.settings.Get()) {
		refreshContext, cancelRefresh := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancelRefresh()
		if refreshedCatalog, refreshErr := a.modelCatalog.Refresh(refreshContext); refreshErr != nil {
			a.diagnostics.Record("model-catalog", "warning", "model catalog refresh after settings save failed; retained last-known-good catalog")
		} else {
			a.diagnostics.Record("model-catalog", "info", "model catalog refreshed after settings save")
			a.emitDesktopEvent("model-catalog-changed", refreshedCatalog)
			if _, alignErr := a.alignAccountModelSelection(refreshedCatalog); alignErr != nil {
				a.diagnostics.Record("model-catalog", "warning", "align account model selection after settings save failed")
			}
		}
	}
	return err
}

func tokenFluxCatalogInputsChanged(previous, next config.AppSettings) bool {
	prevRelay := previous.Relay
	nextRelay := next.Relay
	prevRelayKey := ""
	nextRelayKey := ""
	prevRelayURL := ""
	nextRelayURL := ""
	prevRelayEnabled := false
	nextRelayEnabled := false
	if prevRelay != nil {
		prevRelayKey = strings.TrimSpace(prevRelay.Key)
		prevRelayURL = strings.TrimSpace(prevRelay.URL)
		prevRelayEnabled = prevRelay.Enabled
	}
	if nextRelay != nil {
		nextRelayKey = strings.TrimSpace(nextRelay.Key)
		nextRelayURL = strings.TrimSpace(nextRelay.URL)
		nextRelayEnabled = nextRelay.Enabled
	}
	if prevRelayEnabled != nextRelayEnabled || prevRelayKey != nextRelayKey || prevRelayURL != nextRelayURL {
		return true
	}
	prevProvider := previous.Providers[modelcatalog.ProviderTokenFlux]
	nextProvider := next.Providers[modelcatalog.ProviderTokenFlux]
	prevBase := ""
	nextBase := ""
	if prevProvider.BaseURL != nil {
		prevBase = strings.TrimSpace(*prevProvider.BaseURL)
	}
	if nextProvider.BaseURL != nil {
		nextBase = strings.TrimSpace(*nextProvider.BaseURL)
	}
	return prevProvider.Enabled != nextProvider.Enabled ||
		strings.TrimSpace(prevProvider.APIKey) != strings.TrimSpace(nextProvider.APIKey) ||
		prevBase != nextBase ||
		prevProvider.HasAPIKey != nextProvider.HasAPIKey
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

func (a *App) ListArchivedConversations() ([]conversation.StoredConversation, error) {
	return a.conversations.ListArchived()
}

func (a *App) ArchiveConversation(id string) error {
	if a.engines != nil {
		a.engines.DetachSession(id)
	}
	if err := a.stopConversationResources(id); err != nil {
		return err
	}
	if err := a.conversations.Archive(id); err != nil {
		return err
	}
	return a.refreshConversationIndex()
}

func (a *App) RestoreConversation(id string) error {
	if err := a.conversations.Restore(id); err != nil {
		return err
	}
	return a.refreshConversationIndex()
}

func (a *App) DeleteArchivedConversation(id string) error {
	a.engines.DestroySession(id)
	if err := a.stopConversationResources(id); err != nil {
		return err
	}
	if err := a.conversations.DeleteArchived(id); err != nil {
		return err
	}
	return a.refreshConversationIndex()
}

func (a *App) DeleteConversation(id string) error {
	a.engines.DestroySession(id)
	if err := a.stopConversationResources(id); err != nil {
		return err
	}
	if err := a.conversations.Delete(id); err != nil {
		return err
	}
	return a.refreshConversationIndex()
}

func (a *App) refreshConversationIndex() error {
	if a.sessionIndex == nil {
		return nil
	}
	_, err := a.RefreshSessionIndex()
	return err
}

func (a *App) stopConversationResources(id string) error {
	if a.codingTerminals != nil {
		a.codingTerminals.CloseConversation(id)
	}
	if a.browserBridge != nil {
		if err := a.browserBridge.StopCoding(id); err != nil {
			return err
		}
	}
	if a.computerUse != nil {
		if a.computerUse.OwnsConversation(id) {
			if _, err := a.computerUse.Stop(id); err != nil {
				return err
			}
		} else if err := a.computerUse.Revoke(id); err != nil {
			return err
		}
	}
	if err := a.releaseAgentManagedCodingCollaboration(id); err != nil {
		return err
	}
	return nil
}

func (a *App) ChooseAgentWorkspace() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("desktop runtime is not ready")
	}
	selected, err := a.openDirectory(desktopDialogOptions{
		Title: "选择 Coding Agent 项目目录",
	})
	if err != nil || strings.TrimSpace(selected) == "" {
		return selected, err
	}
	return normalizeAgentWorkspaceSelection(selected)
}

func normalizeAgentWorkspaceSelection(value string) (string, error) {
	value = strings.TrimSpace(value)
	if value == "~" || strings.HasPrefix(value, "~/") {
		home, homeErr := os.UserHomeDir()
		if homeErr != nil {
			return "", fmt.Errorf("locate user directory: %w", homeErr)
		}
		value = filepath.Join(home, strings.TrimPrefix(value, "~/"))
	}
	absolute, err := filepath.Abs(value)
	if err != nil {
		return "", fmt.Errorf("resolve Coding Agent project directory: %w", err)
	}
	resolved, err := filepath.EvalSymlinks(absolute)
	if err != nil {
		return "", fmt.Errorf("resolve Coding Agent project links: %w", err)
	}
	info, err := os.Stat(resolved)
	if err != nil {
		return "", fmt.Errorf("open Coding Agent project directory: %w", err)
	}
	if !info.IsDir() {
		return "", fmt.Errorf("Coding Agent project must be a directory: %s", resolved)
	}
	return filepath.Clean(resolved), nil
}

func (a *App) ChooseCTFMaterials() ([]ctf.MaterialRequest, error) {
	if a.ctx == nil {
		return nil, fmt.Errorf("desktop runtime is not ready")
	}
	paths, err := a.openFiles(desktopDialogOptions{
		Title: "补充 CTF 图片或附件",
		Filters: []desktopFileFilter{
			{Name: "所有文件", Extensions: []string{"*"}},
			{Name: "CTF 材料", Extensions: []string{"png", "jpg", "jpeg", "gif", "webp", "svg", "txt", "md", "json", "xml", "html", "js", "py", "c", "cpp", "h", "zip", "apk", "ipa", "gz", "tar", "7z", "rar", "pdf", "pcap", "pcapng", "bin", "elf", "exe"}},
		},
	})
	if err != nil {
		return nil, err
	}
	return a.localCTFMaterialStore().Import(paths)
}

func (a *App) localCTFMaterialStore() *localCTFMaterialStore {
	if a.ctfMaterials == nil {
		a.ctfMaterials = newLocalCTFMaterialStore()
	}
	return a.ctfMaterials
}

func (a *App) ChooseCodingAttachments() ([]codingattachment.Attachment, error) {
	if a.ctx == nil {
		return nil, fmt.Errorf("desktop runtime is not ready")
	}
	paths, err := a.openFiles(desktopDialogOptions{
		Title: "添加 Coding 文件或图片",
		Filters: []desktopFileFilter{
			{Name: "代码、文档与图片", Extensions: []string{"png", "jpg", "jpeg", "gif", "webp", "svg", "txt", "md", "json", "yaml", "yml", "toml", "xml", "html", "css", "js", "jsx", "ts", "tsx", "vue", "py", "go", "rs", "c", "cpp", "h", "java", "kt", "swift", "sh", "sql", "csv", "pdf", "zip", "gz", "tar"}},
			{Name: "所有文件", Extensions: []string{"*"}},
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

func (a *App) ImportCodingAttachments(
	payloads []codingattachment.ImportPayload,
) ([]codingattachment.Attachment, error) {
	return a.codingFiles.ImportPayloads(payloads)
}

func (a *App) PreviewCodingAttachment(
	attachment codingattachment.Attachment,
) (codingattachment.Preview, error) {
	return a.codingFiles.Preview(attachment)
}

func (a *App) SendMessage(
	conversationID,
	prompt,
	workspacePath string,
	modelMode,
	modelProvider,
	modelID,
	thinkingLevel,
	modelSourcePreference,
	executionMode,
	approvalPolicy,
	mcpConfigDigest string,
	mcpServers []string,
	attachments []codingattachment.Attachment,
	productAction *engine.CodingProductActionDescriptor,
) error {
	resolvedWorkspace, err := a.resolveConversationWorkspace(conversationID, workspacePath)
	if err != nil {
		return err
	}
	workspacePath = resolvedWorkspace
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
	if sessionRole == "" {
		if stored, err := a.conversations.Get(conversationID); err == nil && stored.DomainTaskContext != nil {
			if kind, _ := stored.DomainTaskContext["kind"].(string); kind == "cve" {
				sessionRole = "cve-research"
			} else if kind == "lab" {
				sessionRole = "lab-job"
			}
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
	settings.RuntimeThinkingLevel = strings.TrimSpace(thinkingLevel)
	var codingBrowser *engine.CodingBrowserDescriptor
	if strings.TrimSpace(executionMode) != "plan" &&
		strings.TrimSpace(approvalPolicy) != "read-only" &&
		a.browserBridge != nil {
		// Do not start Chromium on an ordinary Go send. The isolated browser
		// starts when the user opens the rail or the model calls a typed
		// milksu_workspace browser action. Reuse an already-running session.
		if descriptor, enabled := a.browserBridge.CodingDescriptor(conversationID); enabled {
			codingBrowser = &engine.CodingBrowserDescriptor{
				SessionID:   descriptor.SessionID,
				CDPEndpoint: descriptor.CDPEndpoint,
			}
		}
	}
	var computerUse *engine.ComputerUseDescriptor
	if strings.TrimSpace(executionMode) != "plan" &&
		strings.TrimSpace(approvalPolicy) != "read-only" &&
		a.computerUse != nil {
		if _, authorized, restoreErr := a.restoreCodingComputerUse(conversationID); restoreErr != nil {
			a.diagnostics.Record("computer-use", "warning", "authorized task scope could not be restored")
			if authorized {
				return fmt.Errorf("Computer Use 自动恢复失败：%w", restoreErr)
			}
		}
		if descriptor, enabled := a.computerUse.Descriptor(conversationID); enabled {
			computerUse = &engine.ComputerUseDescriptor{
				SessionID:      descriptor.SessionID,
				SocketPath:     descriptor.SocketPath,
				TargetBundleID: descriptor.TargetBundleID,
				TargetName:     descriptor.TargetName,
				TargetPID:      descriptor.TargetPID,
				TargetWindowID: descriptor.TargetWindowID,
			}
		}
	}
	allowPrepare := strings.TrimSpace(executionMode) != "plan" &&
		strings.TrimSpace(approvalPolicy) != "read-only"
	codingCollaboration, err := a.ensureAgentManagedCodingCollaboration(
		conversationID,
		workspacePath,
		allowPrepare,
	)
	if err != nil {
		return err
	}
	a.engines.SetSecurityTools(a.securityTools.RuntimeTools(a.commandContext()))
	return a.engines.SendMessageWithProductAction(
		conversationID,
		prompt,
		workspacePath,
		sessionRole,
		executionMode,
		approvalPolicy,
		mcpServers,
		mcpConfigDigest,
		codingBrowser,
		computerUse,
		codingCollaboration,
		attachments,
		productAction,
		settings,
		modelSourcePreference,
	)
}

func (a *App) resolveConversationWorkspace(conversationID, requested string) (string, error) {
	if strings.TrimSpace(requested) != "" || strings.HasPrefix(conversationID, "ctf_") {
		return requested, nil
	}
	stored, err := a.conversations.Get(conversationID)
	if err != nil {
		return "", fmt.Errorf("read Coding conversation for artifact workspace: %w", err)
	}
	kind := userartifact.KindCoding
	label := "无项目任务"
	workspaceRoot := filepath.Join(a.dataDirectory, "agent-workspaces")
	if domainKind, _ := stored.DomainTaskContext["kind"].(string); domainKind == "cve" {
		kind = userartifact.KindCVE
		workspaceRoot = a.artifactDirectory
		if cveID, _ := stored.DomainTaskContext["cveId"].(string); strings.TrimSpace(cveID) != "" {
			label = cveID
		}
	} else if domainKind == "lab" {
		kind = userartifact.KindLab
		workspaceRoot = a.artifactDirectory
		if title, _ := stored.DomainTaskContext["title"].(string); strings.TrimSpace(title) != "" {
			label = title
		} else {
			label = "实验室作业"
		}
		if jobID, _ := stored.DomainTaskContext["jobId"].(string); strings.TrimSpace(jobID) != "" {
			conversationID = "lab-job-" + strings.TrimSpace(jobID)
		}
	}
	workspace, err := userartifact.Workspace(
		workspaceRoot,
		kind,
		conversationID,
		label,
	)
	if err != nil {
		return "", err
	}
	if kind == userartifact.KindCVE || kind == userartifact.KindLab {
		if seedErr := userartifact.SeedReport(workspace, label); seedErr != nil {
			return "", seedErr
		}
	}
	if kind == userartifact.KindCVE {
		if seedErr := userartifact.SeedRelated(workspace, label); seedErr != nil {
			return "", seedErr
		}
	}
	stored.WorkspacePath = workspace
	if err := a.conversations.Save(stored); err != nil {
		return "", fmt.Errorf("save Coding artifact workspace: %w", err)
	}
	return workspace, nil
}

func (a *App) ctfWorkspaceRoot() string {
	if strings.TrimSpace(a.artifactDirectory) != "" {
		return filepath.Join(a.artifactDirectory, string(userartifact.KindCTF))
	}
	return filepath.Join(a.dataDirectory, "ctf-workspaces")
}

func (a *App) AbortMessage(conversationID string) error {
	return a.engines.AbortMessage(conversationID)
}

func (a *App) SteerMessage(conversationID, prompt string) error {
	return a.engines.SteerMessage(conversationID, prompt)
}

func (a *App) RemoveQueuedMessage(
	conversationID,
	queue string,
	index int,
	expected string,
) error {
	return a.engines.RemoveQueuedMessage(conversationID, queue, index, expected)
}

func (a *App) RespondToolApproval(
	conversationID,
	requestID string,
	approved bool,
	scope string,
) error {
	return a.engines.RespondToolApproval(conversationID, requestID, approved, scope)
}

func (a *App) GetCodingArtifactPreview(
	workspacePath,
	relativePath string,
) (codingenv.ArtifactPreview, error) {
	return codingenv.InspectArtifactPreview(workspacePath, relativePath)
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
	actor := string(projection.HumanOutcome.Contribution.PrimaryActor)
	assistance := string(projection.HumanOutcome.Contribution.Assistance)
	if actor == "" || assistance == "" {
		// A missing typed contribution is unknown evidence, not permission to
		// infer user ability from the selected collaboration mode.
		actor = nssctf.TrainingActorImported
		assistance = nssctf.TrainingAssistanceDelegated
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
		Attempts:          1,
		Hints:             projection.HumanOutcome.HintCount,
		IndependentSteps:  projection.HumanOutcome.IndependentSteps,
		UserAssistedSteps: projection.HumanOutcome.Contribution.UserAssistedSteps,
		Verification:      verification,
		Actor:             actor,
		Assistance:        assistance,
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
	return a.openExternal(normalized)
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
	return a.openExternal(parsed.String())
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

func (a *App) OpenPlaywrightBrowserExtension() error {
	if a.ctx == nil {
		return fmt.Errorf("desktop runtime is not ready")
	}
	return a.openExternal("https://chromewebstore.google.com/detail/playwright-extension/mmlmfjhmonkocbjadbfplnigmagldckm")
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

func (a *App) StartCTFChallenge(request ctf.ChallengeRequest) (ctf.Projection, error) {
	resolved, cleanup, err := a.localCTFMaterialStore().Resolve(request)
	if err != nil {
		return ctf.Projection{}, err
	}
	projection, err := a.ctfJobs.StartChallenge(a.commandContext(), resolved)
	if err != nil {
		return ctf.Projection{}, err
	}
	cleanup()
	return projection, nil
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
		a.ctfWorkspaceRoot(),
		projection,
		a.jobs,
	)
	if err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	if a.ctfMemory != nil {
		if _, err := a.refreshCTFMemoryContext(projection, true); err != nil {
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
	if _, refreshErr := a.refreshCTFMemoryContext(projection, false); refreshErr != nil {
		return ctf.TrainingMemory{}, refreshErr
	}
	return memory, nil
}

func (a *App) GetCTFMemoryContext(id string) ([]ctf.TrainingMemory, error) {
	if a.ctfMemory == nil {
		return nil, fmt.Errorf("CTF memory store is unavailable")
	}
	projection, err := a.ctfJobs.GetJob(a.commandContext(), id)
	if err != nil {
		return nil, err
	}
	return a.refreshCTFMemoryContext(projection, false)
}

func (a *App) refreshCTFMemoryContext(
	projection ctf.Projection,
	requireWorkspace bool,
) ([]ctf.TrainingMemory, error) {
	if a.ctfMemory == nil {
		return nil, fmt.Errorf("CTF memory store is unavailable")
	}
	memories, err := a.ctfMemory.RecallForChallenge(
		a.commandContext(),
		ctf.TrainingMemoryRecallContext{
			Category:        projection.Challenge.Category,
			Title:           projection.Challenge.Title,
			KnowledgePoints: projection.Challenge.KnowledgePoints,
			SourceJobID:     projection.Job.ID,
		},
		5,
	)
	if err != nil {
		return nil, err
	}
	memories = a.attributeCTFMemories(memories)
	workspacePath, pathErr := ctf.AgentWorkspacePath(
		a.ctfWorkspaceRoot(),
		projection.Job.ID,
	)
	if pathErr != nil {
		if requireWorkspace {
			return nil, pathErr
		}
		return memories, nil
	}
	if _, statErr := os.Stat(filepath.Join(workspacePath, "challenge.json")); statErr != nil {
		if requireWorkspace {
			return nil, statErr
		}
		return memories, nil
	}
	if err := ctf.WriteAgentMemoryContext(workspacePath, memories); err != nil {
		return nil, err
	}
	return memories, nil
}

// attributeCTFMemories derives contributor metadata from the append-only
// source projection. It deliberately leaves the existing pre-release memory
// table unchanged; missing source evidence remains conservatively imported.
func (a *App) attributeCTFMemories(memories []ctf.TrainingMemory) []ctf.TrainingMemory {
	result := append([]ctf.TrainingMemory{}, memories...)
	for index := range result {
		projection, err := a.ctfJobs.GetJob(
			a.commandContext(),
			result[index].SourceJobID,
		)
		if err != nil {
			continue
		}
		contribution := projection.HumanOutcome.Contribution
		if contribution.PrimaryActor != "" {
			result[index].Actor = contribution.PrimaryActor
		}
		if contribution.Assistance != "" {
			result[index].Assistance = contribution.Assistance
		}
	}
	return result
}

func (a *App) ArchiveCTFMemory(id, reason string) error {
	if a.ctfMemory == nil {
		return fmt.Errorf("CTF memory store is unavailable")
	}
	return a.ctfMemory.Archive(a.commandContext(), id, reason, time.Now())
}

func (a *App) PrepareCTFToolBuilderWorkspace(id string) (ctf.AgentWorkspaceHandoff, error) {
	if _, err := a.PrepareCTFAgentWorkspace(id); err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	workspacePath, err := ctf.AgentWorkspacePath(
		a.ctfWorkspaceRoot(),
		id,
	)
	if err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
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
	if _, err := a.PrepareCTFAgentWorkspace(id); err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
	}
	workspacePath, err := ctf.AgentWorkspacePath(
		a.ctfWorkspaceRoot(),
		id,
	)
	if err != nil {
		return ctf.AgentWorkspaceHandoff{}, err
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
		a.ctfWorkspaceRoot(),
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
		a.ctfWorkspaceRoot(),
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
		a.ctfWorkspaceRoot(),
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

func (a *App) EnsureVulnTrackingWorkspace(request vuln.TrackingWorkspaceRequest) (vuln.Projection, error) {
	return a.vulnJobs.EnsureCVETrackingWorkspace(a.commandContext(), request)
}

func (a *App) ListVulnJobs() ([]vuln.Summary, error) {
	return a.vulnJobs.ListJobs(a.commandContext())
}

func (a *App) GetVulnJob(id string) (vuln.Projection, error) {
	return a.vulnJobs.GetJob(a.commandContext(), id)
}

func (a *App) FetchCISAKEVFeed() (vuln.FeedSnapshotDownload, error) {
	return a.fetchAndPersistVulnerabilityFeed(func(ctx context.Context) (vuln.FeedSnapshotDownload, error) {
		return vuln.FetchCISAKEVFeed(ctx, nil)
	})
}

func (a *App) FetchNVDCVE(cveID string) (vuln.FeedSnapshotDownload, error) {
	return a.fetchAndPersistVulnerabilityFeed(func(ctx context.Context) (vuln.FeedSnapshotDownload, error) {
		return vuln.FetchNVDCVE(ctx, nil, cveID)
	})
}

func (a *App) SearchNVDCVEs(query string) (vuln.FeedSnapshotDownload, error) {
	return vuln.SearchNVDCVEs(a.commandContext(), nil, query)
}

func (a *App) FetchFIRSTEPSS(cveID string) (vuln.FeedSnapshotDownload, error) {
	return a.fetchAndPersistVulnerabilityFeed(func(ctx context.Context) (vuln.FeedSnapshotDownload, error) {
		return vuln.FetchFIRSTEPSS(ctx, nil, cveID)
	})
}

func (a *App) FetchOSVCVE(cveID string) (vuln.FeedSnapshotDownload, error) {
	return a.fetchAndPersistVulnerabilityFeed(func(ctx context.Context) (vuln.FeedSnapshotDownload, error) {
		return vuln.FetchOSVCVE(ctx, nil, cveID)
	})
}

func (a *App) FetchGitHubAdvisories(cveID string) (vuln.FeedSnapshotDownload, error) {
	return a.fetchAndPersistVulnerabilityFeed(func(ctx context.Context) (vuln.FeedSnapshotDownload, error) {
		return vuln.FetchGitHubAdvisories(ctx, nil, cveID)
	})
}

func (a *App) FetchVulhubPracticeCatalog() (vuln.FeedSnapshotDownload, error) {
	return a.fetchAndPersistVulnerabilityFeed(func(ctx context.Context) (vuln.FeedSnapshotDownload, error) {
		return vuln.FetchVulhubPracticeCatalog(ctx, nil)
	})
}

func (a *App) ChooseVulnerabilityPracticeDirectory() (string, error) {
	if a.ctx == nil {
		return "", fmt.Errorf("desktop runtime is not ready")
	}
	return a.openDirectory(desktopDialogOptions{
		Title: "选择 CVE 本地练习 Docker Compose 目录",
	})
}

func (a *App) StartVulnerabilityPractice(request vuln.PracticeRequest) (vuln.PracticeRun, error) {
	run, err := vuln.StartPracticeEnvironment(a.commandContext(), a.dataDirectory, request)
	if err != nil {
		a.diagnostics.Record("vuln-practice", "error", "start vulnerability practice failed")
		return run, err
	}
	a.diagnostics.Record("vuln-practice", "info", "vulnerability practice started")
	return run, nil
}

func (a *App) GetVulnerabilityPracticeStatus(request vuln.PracticeRequest) (vuln.PracticeRun, error) {
	run, err := vuln.GetPracticeEnvironmentStatus(a.commandContext(), a.dataDirectory, request)
	if err != nil {
		a.diagnostics.Record("vuln-practice", "error", "inspect vulnerability practice failed")
		return run, err
	}
	return run, nil
}

func (a *App) StopVulnerabilityPractice(request vuln.PracticeRequest) (vuln.PracticeRun, error) {
	run, err := vuln.StopPracticeEnvironment(a.commandContext(), a.dataDirectory, request)
	if err != nil {
		a.diagnostics.Record("vuln-practice", "error", "stop vulnerability practice failed")
		return run, err
	}
	a.diagnostics.Record("vuln-practice", "info", "vulnerability practice stopped")
	return run, nil
}

func (a *App) RevealVulnerabilityFeedSnapshot(snapshotPath string) error {
	if a.ctx == nil {
		return fmt.Errorf("desktop runtime is not ready")
	}
	if runtime.GOOS != "darwin" {
		return fmt.Errorf("reveal vulnerability feed snapshot is currently supported on macOS")
	}
	resolved, err := vuln.ResolveFeedSnapshotPath(a.dataDirectory, snapshotPath)
	if err != nil {
		return err
	}
	return vuln.RevealFeedSnapshotInFinder(resolved, vuln.MacOSFinderReveal)
}

func (a *App) fetchAndPersistVulnerabilityFeed(
	fetch func(context.Context) (vuln.FeedSnapshotDownload, error),
) (vuln.FeedSnapshotDownload, error) {
	download, err := fetch(a.commandContext())
	if err != nil {
		return vuln.FeedSnapshotDownload{}, err
	}
	persisted, err := vuln.PersistFeedSnapshot(a.dataDirectory, download)
	if err != nil {
		a.diagnostics.Record("vuln-feed", "error", "persist vulnerability feed snapshot failed")
		return vuln.FeedSnapshotDownload{}, err
	}
	a.diagnostics.Record("vuln-feed", "info", "vulnerability feed snapshot persisted")
	return persisted, nil
}

func (a *App) RecordVulnLearning(id string, request vuln.LearningRecordRequest) (vuln.Projection, error) {
	return a.vulnJobs.RecordLearning(a.commandContext(), id, request)
}

func (a *App) RecordVulnAssetVerification(id string, request vuln.AssetVerificationRequest) (vuln.Projection, error) {
	return a.vulnJobs.RecordAssetVerification(a.commandContext(), id, request)
}

func (a *App) CancelVulnJob(id string) error {
	return a.vulnJobs.CancelJob(a.commandContext(), id)
}

func (a *App) emitEngineEvent(event engine.Event) {
	if event.Error != "" {
		// The renderer projects a bounded, actionable message. Keep the exact
		// runtime failure only in the existing diagnostic recorder, which applies
		// credential redaction and length limits before retaining it.
		a.diagnostics.Record(
			"coding-engine",
			"error",
			fmt.Sprintf("%s: %s", event.Type, event.Error),
		)
	} else if event.Type == "engine.started" || event.Type == "engine.stopped" {
		a.diagnostics.Record("coding-engine", "info", event.Type)
	}
	switch event.Type {
	case "engine.started":
		_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedSidecarStarted)
	case "engine.stopped":
		_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedSidecarStopped)
	case "engine.protocol_error":
		_ = appdata.AppendEventLog(a.dataDirectory, appdata.PersistedSidecarProtocolError)
	}
	usageChanged, usageErr := a.recordCodingUsage(event)
	if usageErr != nil {
		a.diagnostics.Record("coding-usage", "error", "Coding Agent usage recording failed")
	} else if usageChanged && a.ctx != nil {
		a.emitDesktopEvent("model-usage-changed", struct{}{})
	}
	// Forward usage.recorded to the desktop too: Coding UI needs the last call's
	// token counts for the composer strip / Agent rail. CTF Agent recording below
	// still skips usage rows (accounting only).
	if a.ctx != nil {
		a.emitDesktopEvent("engine-event", event)
	}
	if event.Type != "usage.recorded" && a.ctfAgent != nil {
		if err := a.ctfAgent.Record(a.commandContext(), event); err != nil && a.ctx != nil {
			a.diagnostics.Record("ctf-agent", "error", "CTF Agent event recording failed")
			if errors.Is(err, errCTFAgentLoopDetected) {
				_ = a.engines.AbortMessage(event.SessionID)
			}
			a.emitDesktopEvent("job-runtime-error", err.Error())
		}
	}
}

func (a *App) emitJobEvent(event securityruntime.Event) {
	switch event.Kind {
	case securityruntime.EventJobFailed,
		securityruntime.EventAttemptFailed,
		securityruntime.EventStepFailed,
		securityruntime.EventActionFailed:
		a.diagnostics.Record("security-runtime", "error", string(event.Kind))
	}
	if a.ctx == nil {
		return
	}
	a.emitDesktopEvent("job-event", event)
}

func (a *App) commandContext() context.Context {
	if a.ctx != nil {
		return a.ctx
	}
	return context.Background()
}
