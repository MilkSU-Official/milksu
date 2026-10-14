package main

import (
	"errors"

	"github.com/MilkSU-Official/milksu/internal/ptyhelper"
)

func (a *App) OpenPty(
	command string,
	args []string,
	cwd string,
	env []string,
	columns,
	rows int,
) (ptyhelper.Handle, error) {
	if a.ptyPool == nil {
		return ptyhelper.Handle{}, errors.New("PTY helper is unavailable")
	}
	return a.ptyPool.Open(command, args, cwd, env, columns, rows)
}

func (a *App) PtyWrite(id, data string) error {
	if a.ptyPool == nil {
		return errors.New("PTY helper is unavailable")
	}
	return a.ptyPool.Write(id, data)
}

func (a *App) PtyResize(id string, columns, rows int) error {
	if a.ptyPool == nil {
		return errors.New("PTY helper is unavailable")
	}
	return a.ptyPool.Resize(id, columns, rows)
}

func (a *App) ClosePty(id string) error {
	if a.ptyPool == nil {
		return errors.New("PTY helper is unavailable")
	}
	return a.ptyPool.ClosePty(id)
}

func (a *App) emitPtyEvent(event string, payload any) {
	if a.ctx == nil {
		return
	}
	a.emitDesktopEvent(event, payload)
}
