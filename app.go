package main

import (
	"context"
	"fmt"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// App is the thin L1 desktop adapter. Domain code must not depend on Wails.
type App struct {
	ctx           context.Context
	settings      *config.Store
	conversations *conversation.Store
	engines       *engine.Supervisor
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

	application := &App{
		settings:      settings,
		conversations: conversations,
	}
	application.engines = engine.NewSupervisor(application.emitEngineEvent)
	return application, nil
}

func (a *App) Startup(ctx context.Context) {
	a.ctx = ctx
}

func (a *App) Shutdown(_ context.Context) {
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

func (a *App) emitEngineEvent(event engine.Event) {
	if a.ctx == nil {
		return
	}
	runtime.EventsEmit(a.ctx, "engine-event", event)
}
