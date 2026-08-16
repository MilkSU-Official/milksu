package main

import (
	"errors"

	"github.com/MilkSU-Official/milksu/internal/codingterminal"
)

func (a *App) ListCodingTerminals(
	conversationID string,
) ([]codingterminal.Session, error) {
	if a.codingTerminals == nil {
		return nil, errors.New("Coding terminal runtime is unavailable")
	}
	return a.codingTerminals.List(conversationID)
}

func (a *App) StartCodingTerminal(
	conversationID,
	workspacePath string,
	columns,
	rows int,
) (codingterminal.Session, error) {
	if a.codingTerminals == nil {
		return codingterminal.Session{}, errors.New(
			"Coding terminal runtime is unavailable",
		)
	}
	return a.codingTerminals.Start(
		conversationID,
		workspacePath,
		columns,
		rows,
	)
}

func (a *App) WriteCodingTerminal(
	conversationID,
	terminalID,
	data string,
) error {
	if a.codingTerminals == nil {
		return errors.New("Coding terminal runtime is unavailable")
	}
	return a.codingTerminals.Write(conversationID, terminalID, data)
}

func (a *App) ResizeCodingTerminal(
	conversationID,
	terminalID string,
	columns,
	rows int,
) (codingterminal.Session, error) {
	if a.codingTerminals == nil {
		return codingterminal.Session{}, errors.New(
			"Coding terminal runtime is unavailable",
		)
	}
	return a.codingTerminals.Resize(
		conversationID,
		terminalID,
		columns,
		rows,
	)
}

func (a *App) StopCodingTerminal(
	conversationID,
	terminalID string,
) (codingterminal.Session, error) {
	if a.codingTerminals == nil {
		return codingterminal.Session{}, errors.New(
			"Coding terminal runtime is unavailable",
		)
	}
	return a.codingTerminals.Stop(conversationID, terminalID)
}

func (a *App) CloseCodingTerminal(
	conversationID,
	terminalID string,
) error {
	if a.codingTerminals == nil {
		return errors.New("Coding terminal runtime is unavailable")
	}
	return a.codingTerminals.CloseSession(conversationID, terminalID)
}

func (a *App) emitCodingTerminalEvent(event codingterminal.Event) {
	if a.ctx == nil {
		return
	}
	a.emitDesktopEvent("coding-terminal-event", event)
}
