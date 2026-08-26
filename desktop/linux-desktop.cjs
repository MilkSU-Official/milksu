'use strict'

const path = require('node:path')

function applyLinuxChromiumFlags(
  commandLine,
  platform = process.platform,
  environment = process.env,
) {
  if (platform !== 'linux' || !commandLine || typeof commandLine.appendSwitch !== 'function') {
    return false
  }
  if (String(environment.WAYLAND_DISPLAY ?? '').trim()) {
    commandLine.appendSwitch('ozone-platform', 'wayland')
  } else {
    commandLine.appendSwitch('ozone-platform-hint', 'auto')
  }
  return true
}

function linuxUserAgent(chromeVersion, platform = process.platform, arch = process.arch) {
  const version = String(chromeVersion ?? '').trim() || '0.0.0.0'
  if (platform === 'win32') {
    return [
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
      'AppleWebKit/537.36 (KHTML, like Gecko)',
      `Chrome/${version}`,
      'Safari/537.36',
    ].join(' ')
  }
  if (platform === 'linux') {
    const machine = arch === 'arm64' ? 'aarch64' : 'x86_64'
    return [
      `Mozilla/5.0 (X11; Linux ${machine})`,
      'AppleWebKit/537.36 (KHTML, like Gecko)',
      `Chrome/${version}`,
      'Safari/537.36',
    ].join(' ')
  }
  return [
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
    'AppleWebKit/537.36 (KHTML, like Gecko)',
    `Chrome/${version}`,
    'Safari/537.36',
  ].join(' ')
}

function linuxDesktopSession(environment = process.env) {
  const desktop = String(
    environment.XDG_CURRENT_DESKTOP || environment.DESKTOP_SESSION || '',
  )
  const sessionType = String(environment.XDG_SESSION_TYPE || '')
  const hyprland = Boolean(environment.HYPRLAND_INSTANCE_SIGNATURE)
    || /(^|:)hyprland($|:)/i.test(desktop)
  const gnome = /(^|:)gnome($|:)/i.test(desktop)
  return {
    sessionType,
    desktop,
    wayland: sessionType === 'wayland' || Boolean(environment.WAYLAND_DISPLAY),
    gnome,
    hyprland,
  }
}

function linuxWindowIconPath({
  platform = process.platform,
  isPackaged = false,
  resourcesPath = '',
  repositoryRoot = '',
} = {}) {
  if (platform !== 'linux') return ''
  if (isPackaged) return path.join(String(resourcesPath || ''), 'icon.png')
  if (repositoryRoot) return path.join(repositoryRoot, 'build', 'appicon.png')
  return ''
}

module.exports = {
  applyLinuxChromiumFlags,
  linuxUserAgent,
  linuxDesktopSession,
  linuxWindowIconPath,
}
