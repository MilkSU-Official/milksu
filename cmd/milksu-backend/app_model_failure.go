package main

import (
	"strings"
	"time"

	"github.com/MilkSU-Official/milksu/internal/engine"
)

// applyModelCallOutcome keeps the picker's model-failure record in step with reality.
//
// Only what was really observed is applied: a provider error that names the model, or the usage
// the sidecar reports for a model call that did not return. Nothing is inferred from a missing
// answer, and a model that never failed is never marked.
//
// A successful model call for that provider/model clears the record, so the red mark disappears
// the moment the model works again.
func (a *App) applyModelCallOutcome(event engine.Event) {
	if a.settings == nil {
		return
	}
	switch event.Type {
	case "engine.error":
		// The error text carries the provider's own words, so this is a real failure. The
		// conversation tells us which model was in flight, because the engine event does not.
		if !engine.LooksLikeModelFailure(event.Error) {
			return
		}
		provider, model := a.conversationModel(event.SessionID)
		if provider == "" || model == "" {
			return
		}
		_ = a.settings.RecordModelFailure(provider, model, event.Error, time.Now())
	case "usage.recorded":
		if event.Usage == nil {
			return
		}
		provider := strings.TrimSpace(event.Usage.Provider)
		model := strings.TrimSpace(event.Usage.Model)
		if provider == "" || model == "" {
			// Tool and non-model usage carries no model identity; it proves nothing either way.
			return
		}
		if event.Usage.Success {
			_ = a.settings.ClearModelFailure(provider, model)
			return
		}
		reason := strings.TrimSpace(event.Error)
		if reason == "" {
			reason = "模型调用失败（服务端未返回成功结果）"
		}
		_ = a.settings.RecordModelFailure(provider, model, reason, time.Now())
	}
}

// conversationModel reads the model a conversation selected, which is what an engine error has to
// be attributed to.
func (a *App) conversationModel(sessionID string) (string, string) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" || a.conversations == nil {
		return "", ""
	}
	stored, err := a.conversations.Get(sessionID)
	if err != nil {
		return "", ""
	}
	return strings.TrimSpace(stored.ModelProvider), strings.TrimSpace(stored.ModelID)
}
