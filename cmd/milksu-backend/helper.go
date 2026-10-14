package main

import (
	"context"

	"github.com/MilkSU-Official/milksu/internal/computercap"
	"github.com/MilkSU-Official/milksu/internal/ptyhelper"
)

func newNativeHelper(host desktopHost) *App {
	application := &App{
		host:         host,
		ctx:          context.Background(),
		portalServer: &computercap.PortalServer{},
	}
	application.ptyPool = ptyhelper.NewPool(application.emitPtyEvent)
	return application
}

func (a *App) helperShutdown() {
	if a.ptyPool != nil {
		a.ptyPool.Close()
	}
	if a.portalServer != nil {
		_ = a.portalServer.Stop()
	}
}
