package main

import (
	"context"
	"fmt"
	"path/filepath"

	"github.com/MilkSU-Official/milksu/internal/appdata"
	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/securityruntime"
	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the thin L1 desktop adapter. Domain code must not depend on Wails.
type App struct {
	ctx           context.Context
	settings      *config.Store
	conversations *conversation.Store
	engines       *engine.Supervisor
	jobs          *securityruntime.Service
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
	application.jobs, err = securityruntime.NewService(filepath.Join(dataDirectory, "runtime"), application.emitJobEvent)
	if err != nil {
		return nil, fmt.Errorf("create security job runtime: %w", err)
	}
	return application, nil
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
	if err := a.jobs.Recover(ctx); err != nil {
		wailsruntime.EventsEmit(ctx, "job-runtime-error", err.Error())
	}
}

func (a *App) Shutdown(_ context.Context) {
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
	return a.engines.SendMessage(conversationID, prompt, a.settings.Get())
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
