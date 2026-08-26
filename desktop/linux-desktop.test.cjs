'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const path = require('node:path')
const {
  applyLinuxChromiumFlags,
  linuxDesktopSession,
  linuxUserAgent,
  linuxWindowIconPath,
} = require('./linux-desktop.cjs')

test('Linux Chromium uses ozone auto so GNOME and Hyprland pick Wayland', () => {
  const switches = []
  const applied = applyLinuxChromiumFlags({
    appendSwitch(name, value) {
      switches.push([name, value])
    },
  }, 'linux', {})
  assert.equal(applied, true)
  assert.deepEqual(switches, [['ozone-platform-hint', 'auto']])
})

test('Linux Chromium uses Wayland when WAYLAND_DISPLAY is set', () => {
  const switches = []
  applyLinuxChromiumFlags({
    appendSwitch(name, value) {
      switches.push([name, value])
    },
  }, 'linux', { WAYLAND_DISPLAY: 'wayland-0' })
  assert.deepEqual(switches, [['ozone-platform', 'wayland']])
})

test('Linux Chromium flags are not applied on macOS or Windows', () => {
  assert.equal(applyLinuxChromiumFlags({ appendSwitch() {} }, 'darwin'), false)
  assert.equal(applyLinuxChromiumFlags({ appendSwitch() {} }, 'win32'), false)
})

test('Linux user agent names the host OS instead of macOS', () => {
  assert.match(linuxUserAgent('131.0.0.0', 'linux', 'x64'), /X11; Linux x86_64/u)
  assert.match(linuxUserAgent('131.0.0.0', 'linux', 'arm64'), /X11; Linux aarch64/u)
  assert.match(linuxUserAgent('131.0.0.0', 'win32'), /Windows NT 10.0/u)
  assert.match(linuxUserAgent('131.0.0.0', 'darwin'), /Macintosh/u)
})

test('desktop session detection distinguishes GNOME and Hyprland', () => {
  const gnome = linuxDesktopSession({
    XDG_CURRENT_DESKTOP: 'ubuntu:GNOME',
    XDG_SESSION_TYPE: 'wayland',
    WAYLAND_DISPLAY: 'wayland-0',
  })
  assert.equal(gnome.gnome, true)
  assert.equal(gnome.hyprland, false)
  assert.equal(gnome.wayland, true)

  const hyprland = linuxDesktopSession({
    XDG_CURRENT_DESKTOP: 'Hyprland',
    XDG_SESSION_TYPE: 'wayland',
    HYPRLAND_INSTANCE_SIGNATURE: 'abc',
  })
  assert.equal(hyprland.hyprland, true)
  assert.equal(hyprland.gnome, false)
  assert.equal(hyprland.wayland, true)
})

test('Linux window icon uses packaged icon.png or the brand asset', () => {
  assert.equal(linuxWindowIconPath({ platform: 'darwin', isPackaged: true, resourcesPath: '/tmp' }), '')
  assert.equal(
    linuxWindowIconPath({ platform: 'linux', isPackaged: true, resourcesPath: '/opt/MilkSU/resources' }),
    path.join('/opt/MilkSU/resources', 'icon.png'),
  )
  assert.equal(
    linuxWindowIconPath({ platform: 'linux', isPackaged: false, repositoryRoot: '/repo' }),
    path.join('/repo', 'build', 'appicon.png'),
  )
})
