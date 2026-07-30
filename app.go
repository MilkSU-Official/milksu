package main

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/ctf"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
	"github.com/MilkSU-Official/milksu/internal/vuln"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the thin L1 desktop adapter. Domain code must not depend on Wails.
type App struct {
	ctx            context.Context
	settings       *config.Store
	conversations  *conversation.Store
	engines        *engine.Supervisor
	securityEngine *engine.SecuritySupervisor
	jobs           *securityruntime.Service
	ctfJobs        *ctf.Service
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

	application := &App{
		settings:      settings,
		conversations: conversations,
	}
	application.engines = engine.NewSupervisor(application.emitEngineEvent)
	application.securityEngine, err = engine.NewSecuritySupervisor(application.settings.GetResolved)
	if err != nil {
		return nil, fmt.Errorf("create security agent engine: %w", err)
	}
	application.jobs, err = securityruntime.NewService(filepath.Join(dataDirectory, "runtime"), application.emitJobEvent)
	if err != nil {
		return nil, fmt.Errorf("create security job runtime: %w", err)
	}
	application.ctfJobs, err = ctf.NewService(application.jobs, ctf.ServiceOptions{Engine: application.securityEngine})
	if err != nil {
		_ = application.jobs.Close()
		application.securityEngine.Close()
		return nil, fmt.Errorf("create CTF role service: %w", err)
	}
	application.vulnJobs, err = vuln.NewService(application.jobs)
	if err != nil {
		_ = application.ctfJobs.Close()
		_ = application.jobs.Close()
		application.securityEngine.Close()
		return nil, fmt.Errorf("create vulnerability research role service: %w", err)
	}
	return application, nil
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
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
	_ = a.ctfJobs.Close()
	a.securityEngine.Close()
	_ = a.jobs.Close()
	a.engines.Close()
}

func (a *App) GetSettings() config.AppSettings {
	return a.settings.Get()
}

func (a *App) SaveSettingsCmd(settings config.AppSettings) error {
	if err := a.settings.Save(settings); err != nil {
		return err
	}
	// Provider credentials are supplied only when a sidecar starts. Restarting
	// prevents a running child from retaining credentials removed by the user.
	a.engines.Close()
	a.securityEngine.Restart()
	return nil
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

func (a *App) SendMessage(conversationID, prompt string) error {
	return a.engines.SendMessage(conversationID, prompt, a.settings.GetResolved())
}

func (a *App) GetRuntimeStatus() engine.RuntimeStatus {
	return a.engines.Status()
}

func (a *App) StartWalkingSkeleton(title string) (securityruntime.JobProjection, error) {
	return a.jobs.StartWalkingSkeleton(a.commandContext(), title)
}

func (a *App) ListJobs() ([]securityruntime.JobSummary, error) {
	return a.jobs.ListJobs(a.commandContext())
}

func (a *App) GetJob(id string) (securityruntime.JobProjection, error) {
	return a.jobs.GetJob(a.commandContext(), id)
}

func (a *App) CancelJob(id string) error {
	return a.jobs.CancelJob(a.commandContext(), id)
}

func (a *App) StartSampleCTF() (ctf.Projection, error) {
	return a.ctfJobs.StartSampleChallenge(a.commandContext())
}

func (a *App) StartCTFChallenge(request ctf.ChallengeRequest) (ctf.Projection, error) {
	return a.ctfJobs.StartChallenge(a.commandContext(), request)
}

func (a *App) ListCTFJobs() ([]ctf.Summary, error) {
	return a.ctfJobs.ListJobs(a.commandContext())
}

func (a *App) GetCTFJob(id string) (ctf.Projection, error) {
	return a.ctfJobs.GetJob(a.commandContext(), id)
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
	if a.ctx == nil {
		return
	}
	wailsruntime.EventsEmit(a.ctx, "engine-event", event)
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
