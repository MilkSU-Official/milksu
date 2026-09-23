package main

import (
	"strings"

	"github.com/MilkSU-Official/milksu/internal/imagegencatalog"
	"github.com/MilkSU-Official/milksu/internal/modelcatalog"
)

func (a *App) GetModelCatalog() modelcatalog.Snapshot {
	return a.modelCatalog.Snapshot()
}

func (a *App) GetImageGenCatalog() imagegencatalog.Snapshot {
	snapshot := imagegencatalog.Snapshot{
		Schema: imagegencatalog.Schema,
		Models: []imagegencatalog.Model{},
	}
	if a == nil || a.modelCatalog == nil {
		return snapshot
	}
	for _, item := range a.modelCatalog.Snapshot().ImageModels {
		if strings.TrimSpace(item.ImageTransport) == "" {
			continue
		}
		snapshot.Models = append(snapshot.Models, imagegencatalog.Describe(item.ID, item.Name))
	}
	return snapshot
}
