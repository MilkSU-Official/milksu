package main

import "github.com/MilkSU-Official/milksu/internal/codingtools"

func (a *App) ListCodingToolSkills() []codingtools.SkillSnapshot {
	if a.codingTools == nil {
		return nil
	}
	return a.codingTools.List(a.commandContext())
}

func (a *App) CheckCodingToolSkill(name string) (codingtools.SkillSnapshot, error) {
	if a.codingTools == nil {
		return codingtools.SkillSnapshot{}, nil
	}
	return a.codingTools.Check(a.commandContext(), name)
}

func (a *App) StartCodingToolSkillSetup(name string) (codingtools.SetupSnapshot, error) {
	if a.codingTools == nil {
		return codingtools.SetupSnapshot{}, nil
	}
	snapshot, err := a.codingTools.StartSetup(a.commandContext(), name)
	if err != nil {
		return codingtools.SetupSnapshot{}, err
	}
	return snapshot, nil
}

func (a *App) GetCodingToolSkillSetup(name string) (codingtools.SetupSnapshot, error) {
	if a.codingTools == nil {
		return codingtools.SetupSnapshot{}, nil
	}
	return a.codingTools.SetupStatus(name)
}

func (a *App) emitCodingToolSetup(snapshot codingtools.SetupSnapshot) {
	if a.ctx == nil {
		return
	}
	a.emitDesktopEvent("coding-tool-setup", snapshot)
	if snapshot.State == "completed" && a.engines != nil {
		a.engines.Close()
	}
}
