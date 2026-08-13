package main

import "github.com/MilkSU-Official/milksu/internal/modelcatalog"

func (a *App) GetModelCatalog() modelcatalog.Snapshot {
	return a.modelCatalog.Snapshot()
}
