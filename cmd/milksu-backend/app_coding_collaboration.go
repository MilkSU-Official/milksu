package main

import (
	"context"
	"errors"
	"time"

	"github.com/MilkSU-Official/milksu/internal/codingcollab"
)

func (a *App) PrepareCodingCollaboration(
	conversationID,
	workspacePath string,
	writers int,
) (codingcollab.Status, error) {
	if a.codingCollab == nil {
		return codingcollab.Status{}, errors.New(
			"Coding collaboration service is unavailable",
		)
	}
	actionContext, cancel := context.WithTimeout(a.commandContext(), 3*time.Minute)
	defer cancel()
	return a.codingCollab.Prepare(
		actionContext,
		conversationID,
		workspacePath,
		writers,
	)
}

func (a *App) GetCodingCollaboration(
	conversationID,
	workspacePath string,
) (codingcollab.Status, error) {
	if a.codingCollab == nil {
		return codingcollab.Status{}, errors.New(
			"Coding collaboration service is unavailable",
		)
	}
	actionContext, cancel := context.WithTimeout(a.commandContext(), 8*time.Second)
	defer cancel()
	return a.codingCollab.Get(
		actionContext,
		conversationID,
		workspacePath,
	)
}

func (a *App) FinishCodingCollaboration(
	conversationID,
	workspacePath string,
) (codingcollab.Status, error) {
	if a.codingCollab == nil {
		return codingcollab.Status{}, errors.New(
			"Coding collaboration service is unavailable",
		)
	}
	actionContext, cancel := context.WithTimeout(a.commandContext(), 30*time.Second)
	defer cancel()
	return a.codingCollab.Finish(
		actionContext,
		conversationID,
		workspacePath,
	)
}
