package main

import (
	"github.com/MilkSU-Official/milksu/internal/conversation"
	"github.com/MilkSU-Official/milksu/internal/engine"
	"github.com/MilkSU-Official/milksu/internal/sessionindex"
)

// GenerateConversationTitle reuses the current Pi session implementation for
// a bounded, tool-free projection. It does not enter the visible conversation
// stream or delay the primary Coding turn.
func (a *App) GenerateConversationTitle(
	firstMessage,
	modelMode,
	modelProvider,
	modelID string,
) (string, error) {
	settings, err := engine.ResolveTaskModel(
		a.settings.GetResolved(),
		"",
		modelMode,
		modelProvider,
		modelID,
	)
	if err != nil {
		return "", err
	}
	prompt, err := conversation.TitlePrompt(sessionindex.RedactSnippet(firstMessage))
	if err != nil {
		return "", err
	}
	generated, err := a.engines.GenerateText(prompt, settings)
	if err != nil {
		return "", err
	}
	return conversation.NormalizeGeneratedTitle(
		sessionindex.RedactSnippet(generated.Text),
	)
}
