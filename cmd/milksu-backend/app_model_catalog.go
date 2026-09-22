package main

import (
	"github.com/MilkSU-Official/milksu/internal/imagegencatalog"
	"github.com/MilkSU-Official/milksu/internal/modelcatalog"
)

func (a *App) GetModelCatalog() modelcatalog.Snapshot {
	return a.modelCatalog.Snapshot()
}

func (a *App) GetImageGenCatalog() imagegencatalog.Snapshot {
	return imagegencatalog.Builtin()
}
