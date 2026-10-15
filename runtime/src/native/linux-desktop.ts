import {
  LINUX_COMPUTER_USE_PROBLEM,
  type LinuxDesktopInfo,
} from '../computercap/types.ts'

const HYPRLAND_COMPUTER_USE_PROBLEM =
  'Computer Use 在 Hyprland 上暂不可用。GNOME 可用系统桌面共享授权；不会走 xinput 摘键鼠。'

function envValue(env: NodeJS.ProcessEnv, key: string): string {
  return String(env[key] ?? '')
}

function desktopValue(env: NodeJS.ProcessEnv): string {
  return `${envValue(env, 'XDG_CURRENT_DESKTOP')}:${envValue(env, 'DESKTOP_SESSION')}`.toLowerCase()
}

export function linuxGnomeWayland(env: NodeJS.ProcessEnv = process.env): boolean {
  const session = envValue(env, 'XDG_SESSION_TYPE').trim().toLowerCase()
  const wayland = session === 'wayland' || envValue(env, 'WAYLAND_DISPLAY').trim() !== ''
  if (!wayland) return false
  return desktopValue(env).includes('gnome')
}

export function linuxHyprland(env: NodeJS.ProcessEnv = process.env): boolean {
  if (envValue(env, 'HYPRLAND_INSTANCE_SIGNATURE').trim() !== '') return true
  return desktopValue(env).includes('hyprland')
}

export function linuxUnavailableProblem(env: NodeJS.ProcessEnv = process.env): string {
  if (linuxHyprland(env)) return HYPRLAND_COMPUTER_USE_PROBLEM
  if (linuxGnomeWayland(env)) return ''
  return LINUX_COMPUTER_USE_PROBLEM
}

export function probeLinuxDesktop(env: NodeJS.ProcessEnv = process.env): LinuxDesktopInfo {
  if (linuxGnomeWayland(env)) return { available: true }
  const problem = linuxUnavailableProblem(env)
  return problem ? { available: false, problem } : { available: false }
}
