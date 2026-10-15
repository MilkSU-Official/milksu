import assert from 'node:assert/strict'
import test from 'node:test'
import { linuxGnomeWayland, linuxHyprland, probeLinuxDesktop } from '../native/linux-desktop.ts'
import {
  handlePortalTool,
  pngSize,
  PortalServer,
  probeLinuxDesktop as probeFromPortal,
  type PortalSession,
} from './portal.ts'
import { linuxPortalDesktopTarget } from './types.ts'

const PNG_1X1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
  0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
  0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
  0x00, 0x00, 0x03, 0x00, 0x01, 0x3b, 0x6d, 0xa8,
  0xdb, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
  0x44, 0xae, 0x42, 0x60, 0x82,
])

class FakeSession implements PortalSession {
  clicks: Array<[number, number]> = []
  typed = ''
  keys: Array<{ name: string; modifiers: string[] }> = []
  scrolls: Array<{ direction: string; amount: number }> = []
  screenshotCalls = 0
  closed = false

  async start(): Promise<void> {}

  async screenshot(): Promise<{ png: Buffer; width: number; height: number }> {
    this.screenshotCalls += 1
    return { png: PNG_1X1, width: 1, height: 1 }
  }

  async click(x: number, y: number): Promise<void> {
    this.clicks.push([x, y])
  }

  async type(text: string): Promise<void> {
    this.typed += text
  }

  async key(name: string, modifiers: string[]): Promise<void> {
    this.keys.push({ name, modifiers })
  }

  async scroll(direction: string, amount: number): Promise<void> {
    this.scrolls.push({ direction, amount })
  }

  async close(): Promise<void> {
    this.closed = true
  }
}

test('handlePortalTool encodes screenshot and display click/type', async () => {
  const session = new FakeSession()
  const target = linuxPortalDesktopTarget()

  const listed = await handlePortalTool(session, target, 'list_windows')
  assert.deepEqual(listed, {
    windows: [{
      window_id: 1,
      pid: 2,
      title: 'Desktop',
      app: 'Desktop',
    }],
  })

  const started = await handlePortalTool(session, target, 'start_session')
  assert.deepEqual(started, { ok: true })

  const observed = await handlePortalTool(session, target, 'get_window_state', { include_screenshot: true })
  assert.equal(observed.scope, 'display')
  assert.equal(observed.screenshot_mime_type, 'image/png')
  assert.equal(observed.width, 1)
  assert.equal(observed.height, 1)
  assert.equal(session.screenshotCalls, 1)
  assert.equal(observed.screenshot_png_b64, PNG_1X1.toString('base64'))
  assert.deepEqual(Buffer.from(String(observed.screenshot_png_b64), 'base64'), PNG_1X1)

  const skipped = await handlePortalTool(session, target, 'get_window_state', {})
  assert.equal(skipped.screenshot_png_b64, undefined)
  assert.equal(session.screenshotCalls, 1)

  const clicked = await handlePortalTool(session, target, 'click', { x: 12, y: 34 })
  assert.deepEqual(clicked, { ok: true, scope: 'display' })
  assert.deepEqual(session.clicks, [[12, 34]])

  const typed = await handlePortalTool(session, target, 'type_text', { text: 'hi' })
  assert.deepEqual(typed, { ok: true, scope: 'display' })
  assert.equal(session.typed, 'hi')

  const keyed = await handlePortalTool(session, target, 'press_key', { key: 'enter', modifiers: ['ctrl'] })
  assert.deepEqual(keyed, { ok: true, scope: 'display' })
  assert.deepEqual(session.keys, [{ name: 'enter', modifiers: ['ctrl'] }])

  const scrolled = await handlePortalTool(session, target, 'scroll', { direction: 'down', amount: 3 })
  assert.deepEqual(scrolled, { ok: true, scope: 'display' })
  assert.deepEqual(session.scrolls, [{ direction: 'down', amount: 3 }])

  const ended = await handlePortalTool(session, target, 'end_session')
  assert.deepEqual(ended, { ok: true })
})

test('handlePortalTool keeps Chinese errors for missing click/type args', async () => {
  const session = new FakeSession()
  const target = linuxPortalDesktopTarget()
  await assert.rejects(
    () => handlePortalTool(session, target, 'click', { x: 1 }),
    { message: 'Linux Computer Use 需要截屏坐标 x/y，没有窗口内 AX 元素' },
  )
  await assert.rejects(
    () => handlePortalTool(session, target, 'type_text', { text: '  ' }),
    { message: 'type_text requires text' },
  )
  await assert.rejects(
    () => handlePortalTool(session, target, 'hover'),
    { message: 'unsupported portal Computer Use tool "hover"' },
  )
})

test('pngSize reads IHDR width and height', () => {
  assert.deepEqual(pngSize(PNG_1X1), { width: 1, height: 1 })
  assert.deepEqual(pngSize(PNG_1X1.subarray(0, 10)), { width: 0, height: 0 })
})

test('probeLinuxDesktop matches GNOME Wayland and Hyprland copy', () => {
  assert.equal(probeFromPortal, probeLinuxDesktop)
  assert.equal(linuxGnomeWayland({
    XDG_SESSION_TYPE: 'wayland',
    XDG_CURRENT_DESKTOP: 'ubuntu:GNOME',
  }), true)
  assert.equal(linuxGnomeWayland({
    HYPRLAND_INSTANCE_SIGNATURE: 'abc',
    XDG_SESSION_TYPE: 'wayland',
    XDG_CURRENT_DESKTOP: 'Hyprland',
  }), false)
  assert.equal(linuxHyprland({
    HYPRLAND_INSTANCE_SIGNATURE: 'abc',
  }), true)
  const hyprland = probeLinuxDesktop({
    XDG_CURRENT_DESKTOP: 'Hyprland',
    XDG_SESSION_TYPE: 'wayland',
  })
  assert.equal(hyprland.available, false)
  assert.match(hyprland.problem ?? '', /Hyprland/)
  const gnome = probeLinuxDesktop({
    XDG_SESSION_TYPE: 'wayland',
    XDG_CURRENT_DESKTOP: 'GNOME',
  })
  assert.deepEqual(gnome, { available: true })
})

test('PortalServer.start refuses non-linux and stop is a no-op', async () => {
  const server = new PortalServer()
  if (process.platform !== 'linux') {
    await assert.rejects(
      () => server.start('portal.sock'),
      { message: 'XDG Desktop Portal Computer Use requires Linux' },
    )
  }
  await server.stop()
})
