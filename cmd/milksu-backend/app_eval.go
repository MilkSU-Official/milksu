package main

import (
	"errors"

	"github.com/MilkSU-Official/milksu/internal/config"
	"github.com/MilkSU-Official/milksu/internal/evalsuite"
)

type evalBoardQuery struct {
	Selected string               `json:"selected"`
	Models   []evalsuite.ModelRef `json:"models"`
}

func (a *App) GetEvalBoard(req evalBoardQuery) (evalsuite.BoardSnapshot, error) {
	if a.evalSuite == nil {
		return evalsuite.BoardSnapshot{}, errors.New("评测服务不可用")
	}
	a.evalSuite.SetSettings(a.settings.GetResolved())
	return a.evalSuite.Snapshot(req.Selected, req.Models)
}

func (a *App) StartEvalRun(req evalsuite.StartRequest) (evalsuite.BoardSnapshot, error) {
	if a.evalSuite == nil {
		return evalsuite.BoardSnapshot{}, errors.New("评测服务不可用")
	}
	a.evalSuite.SetSettings(a.settings.GetResolved())
	catalog := req.Models
	if err := a.evalSuite.Start(req, catalog); err != nil {
		return evalsuite.BoardSnapshot{}, err
	}
	return a.evalSuite.Snapshot(req.Suite, catalog)
}

func (a *App) StopEvalRun() (evalsuite.BoardSnapshot, error) {
	if a.evalSuite == nil {
		return evalsuite.BoardSnapshot{}, errors.New("评测服务不可用")
	}
	if err := a.evalSuite.Stop(); err != nil {
		return evalsuite.BoardSnapshot{}, err
	}
	return a.evalSuite.Snapshot("", nil)
}

func (a *App) sendEvalTurn(sessionID, prompt, workspace string, settings config.AppSettings, source string) error {
	if a.engines == nil {
		return errors.New("评测运行时不可用")
	}
	return a.engines.SendMessage(
		sessionID,
		prompt,
		workspace,
		"eval",
		"workspace-auto",
		"workspace-auto",
		nil,
		"",
		nil,
		nil,
		nil,
		nil,
		settings,
		source,
	)
}

func (a *App) emitEvalProgress(snapshot evalsuite.BoardSnapshot) {
	if a.ctx == nil {
		return
	}
	a.emitDesktopEvent("eval-progress", snapshot)
}
