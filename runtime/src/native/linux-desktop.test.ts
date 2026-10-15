import assert from 'node:assert/strict'
import test from 'node:test'
import { LINUX_COMPUTER_USE_PROBLEM } from '../computercap/types.ts'
import {
  linuxGnomeWayland,
  linuxHyprland,
  linuxUnavailableProblem,
  probeLinuxDesktop,
} from './linux-desktop.ts'

const HYPRLAND_PROBLEM =
  'Computer Use 在 Hyprland 上暂不可用。GNOME 可用系统桌面共享授权；不会走 xinput 摘键鼠。'

test('linux desktop env table', () => {
  const rows: Array<{
    name: string
    env: NodeJS.ProcessEnv
    gnome: boolean
    hyprland: boolean
    available: boolean
    problem?: string
  }> = [
    {
      name: 'GNOME Wayland via session type',
      env: {
        XDG_SESSION_TYPE: 'wayland',
        XDG_CURRENT_DESKTOP: 'ubuntu:GNOME',
      },
      gnome: true,
      hyprland: false,
      available: true,
    },
    {
      name: 'GNOME via WAYLAND_DISPLAY and DESKTOP_SESSION',
      env: {
        WAYLAND_DISPLAY: 'wayland-0',
        DESKTOP_SESSION: 'gnome',
      },
      gnome: true,
      hyprland: false,
      available: true,
    },
    {
      name: 'Hyprland instance signature',
      env: {
        HYPRLAND_INSTANCE_SIGNATURE: 'abc',
        XDG_SESSION_TYPE: 'wayland',
        XDG_CURRENT_DESKTOP: 'Hyprland',
      },
      gnome: false,
      hyprland: true,
      available: false,
      problem: HYPRLAND_PROBLEM,
    },
    {
      name: 'Hyprland desktop name without signature',
      env: {
        XDG_SESSION_TYPE: 'wayland',
        XDG_CURRENT_DESKTOP: 'Hyprland',
      },
      gnome: false,
      hyprland: true,
      available: false,
      problem: HYPRLAND_PROBLEM,
    },
    {
      name: 'GNOME on X11 is not the portal path',
      env: {
        XDG_SESSION_TYPE: 'x11',
        XDG_CURRENT_DESKTOP: 'GNOME',
      },
      gnome: false,
      hyprland: false,
      available: false,
      problem: LINUX_COMPUTER_USE_PROBLEM,
    },
    {
      name: 'KDE Wayland is unavailable',
      env: {
        XDG_SESSION_TYPE: 'wayland',
        XDG_CURRENT_DESKTOP: 'KDE',
      },
      gnome: false,
      hyprland: false,
      available: false,
      problem: LINUX_COMPUTER_USE_PROBLEM,
    },
    {
      name: 'empty env is unavailable',
      env: {},
      gnome: false,
      hyprland: false,
      available: false,
      problem: LINUX_COMPUTER_USE_PROBLEM,
    },
  ]

  for (const row of rows) {
    assert.equal(linuxGnomeWayland(row.env), row.gnome, `${row.name} gnome`)
    assert.equal(linuxHyprland(row.env), row.hyprland, `${row.name} hyprland`)
    assert.equal(linuxUnavailableProblem(row.env), row.problem ?? '', `${row.name} problem`)
    const info = probeLinuxDesktop(row.env)
    assert.equal(info.available, row.available, `${row.name} available`)
    assert.equal(info.problem, row.problem, `${row.name} info.problem`)
  }
})
