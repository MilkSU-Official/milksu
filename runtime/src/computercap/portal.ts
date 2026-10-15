import { execFile as execFileCallback } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { chmod, readFile, unlink } from 'node:fs/promises'
import net from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { cleanupEndpoint } from './driver.ts'
import { linuxPortalDesktopTarget, type Target } from './types.ts'

export { probeLinuxDesktop } from '../native/linux-desktop.ts'

const execFile = promisify(execFileCallback)

const PORTAL_BUS_NAME = 'org.freedesktop.portal.Desktop'
const PORTAL_OBJECT_PATH = '/org/freedesktop/portal/desktop'
const PORTAL_REMOTE_DESKTOP = 'org.freedesktop.portal.RemoteDesktop'
const PORTAL_SCREEN_CAST = 'org.freedesktop.portal.ScreenCast'
const PORTAL_SCREENSHOT = 'org.freedesktop.portal.Screenshot'
const PORTAL_REQUEST_IFACE = 'org.freedesktop.portal.Request'
const PORTAL_SESSION_IFACE = 'org.freedesktop.portal.Session'
const DEVICE_KEYBOARD = 1
const DEVICE_POINTER = 2
const LINUX_BUTTON_LEFT = 272
const DEFAULT_START_TIMEOUT_MS = 90_000
const MAX_REQUEST_BYTES = 8 << 20

const REQUEST_XML = `<node>
  <interface name="org.freedesktop.portal.Request">
    <signal name="Response">
      <arg type="u" name="response"/>
      <arg type="a{sv}" name="results"/>
    </signal>
    <method name="Close"/>
  </interface>
</node>`

const SESSION_XML = `<node>
  <interface name="org.freedesktop.portal.Session">
    <method name="Close"/>
  </interface>
</node>`

type DbusVariant = { signature: string; value: unknown }

type DbusInterface = {
  on(event: string, listener: (...args: unknown[]) => void): void
  off(event: string, listener: (...args: unknown[]) => void): void
  [member: string]: unknown
}

type DbusProxy = {
  getInterface(name: string): DbusInterface
}

type DbusMessageBus = {
  name?: string | null
  getProxyObject(name: string, path: string, xml?: string): Promise<DbusProxy>
  call(message: unknown): Promise<{ type?: number; body?: unknown[] }>
  disconnect(): void
}

type DbusModule = {
  sessionBus: () => DbusMessageBus
  Variant: new (signature: string, value: unknown) => DbusVariant
  Message: new (params: Record<string, unknown>) => unknown
}

export type PortalSession = {
  start(signal?: AbortSignal): Promise<void>
  screenshot(signal?: AbortSignal): Promise<{ png: Buffer; width: number; height: number }>
  click(x: number, y: number): Promise<void>
  type(text: string): Promise<void>
  key(name: string, modifiers: string[]): Promise<void>
  scroll(direction: string, amount: number): Promise<void>
  close(): Promise<void>
}

type PortalReply = {
  result?: Record<string, unknown>
  error?: string
}

class Mutex {
  private locked = false
  private readonly waiters: Array<() => void> = []

  async lock(): Promise<void> {
    if (!this.locked) {
      this.locked = true
      return
    }
    await new Promise<void>((resolve) => this.waiters.push(resolve))
  }

  unlock(): void {
    const next = this.waiters.shift()
    if (next) next()
    else this.locked = false
  }
}

export class PortalServer {
  private readonly mu = new Mutex()
  private readonly toolMu = new Mutex()
  private session: PortalSession | null = null
  private server: net.Server | null = null
  private readonly connections = new Set<net.Socket>()
  private serveAbort: AbortController | null = null
  private serving: Promise<void> | null = null

  async start(socketPath: string, timeoutMs?: number): Promise<void> {
    if (process.platform !== 'linux') {
      throw new Error('XDG Desktop Portal Computer Use requires Linux')
    }
    await this.mu.lock()
    try {
      if (this.session) throw new Error('Computer Use portal is already running')
      const session = await openXdgPortalSession()
      const timeout = timeoutMs && timeoutMs > 0 ? timeoutMs : DEFAULT_START_TIMEOUT_MS
      const startAbort = new AbortController()
      const timer = setTimeout(() => startAbort.abort(), timeout)
      try {
        await session.start(startAbort.signal)
      } catch (error) {
        await session.close().catch(() => {})
        throw new Error(`GNOME 桌面共享未授权或已取消：${error instanceof Error ? error.message : error}`)
      } finally {
        clearTimeout(timer)
      }
      await cleanupEndpoint(socketPath)
      const serveAbort = new AbortController()
      this.session = session
      this.serveAbort = serveAbort
      const server = net.createServer((connection) => {
        this.connections.add(connection)
        connection.on('close', () => this.connections.delete(connection))
        void this.handleConnection(connection)
      })
      try {
        await listenUnix(server, socketPath)
        await chmod(socketPath, 0o600)
      } catch (error) {
        this.session = null
        this.serveAbort = null
        server.close()
        await session.close().catch(() => {})
        throw new Error(`listen portal Computer Use socket: ${error instanceof Error ? error.message : error}`)
      }
      this.server = server
      this.serving = onceClose(server)
    } finally {
      this.mu.unlock()
    }
  }

  async stop(): Promise<void> {
    if (process.platform !== 'linux') return
    await this.mu.lock()
    const session = this.session
    const server = this.server
    const serving = this.serving
    const serveAbort = this.serveAbort
    const connections = [...this.connections]
    this.session = null
    this.server = null
    this.serving = null
    this.serveAbort = null
    this.connections.clear()
    this.mu.unlock()
    serveAbort?.abort()
    for (const connection of connections) {
      connection.destroy()
    }
    if (server) await closeServer(server)
    if (session) await session.close().catch(() => {})
    if (serving) await Promise.race([serving, sleep(1000)])
  }

  private async handleConnection(connection: net.Socket): Promise<void> {
    try {
      const line = await readLine(connection)
      if (line === null) return
      let call: { tool?: unknown; args?: unknown }
      try {
        call = JSON.parse(line) as { tool?: unknown; args?: unknown }
      } catch (error) {
        writePortalReply(connection, { error: error instanceof Error ? error.message : String(error) })
        return
      }
      const session = this.session
      if (!session) {
        writePortalReply(connection, { error: 'Computer Use portal is unavailable' })
        return
      }
      await this.toolMu.lock()
      try {
        const result = await handlePortalTool(
          session,
          linuxPortalDesktopTarget(),
          String(call.tool ?? ''),
          asArgs(call.args),
          this.serveAbort?.signal,
        )
        writePortalReply(connection, { result })
      } catch (error) {
        writePortalReply(connection, { error: error instanceof Error ? error.message : String(error) })
      } finally {
        this.toolMu.unlock()
      }
    } catch (error) {
      writePortalReply(connection, { error: error instanceof Error ? error.message : String(error) })
    } finally {
      connection.end()
    }
  }
}

export async function handlePortalTool(
  session: PortalSession,
  target: Target,
  tool: string,
  args: Record<string, unknown> = {},
  signal?: AbortSignal,
): Promise<Record<string, unknown>> {
  const window = {
    window_id: target.windowId,
    pid: target.pid,
    title: target.windowTitle,
    app: target.name,
  }
  switch (tool) {
    case 'start_session':
    case 'end_session':
      return { ok: true }
    case 'list_windows':
      return { windows: [window] }
    case 'get_window_state': {
      const state: Record<string, unknown> = {
        window_id: target.windowId,
        pid: target.pid,
        title: target.windowTitle,
        elements: [],
        scope: 'display',
      }
      if (args.include_screenshot === true) {
        const shot = await session.screenshot(signal)
        state.screenshot_png_b64 = shot.png.toString('base64')
        state.screenshot_mime_type = 'image/png'
        state.width = shot.width
        state.height = shot.height
      }
      return state
    }
    case 'click': {
      const { x, y } = portalCoordinates(args)
      await session.click(x, y)
      return { ok: true, scope: 'display' }
    }
    case 'type_text': {
      const text = typeof args.text === 'string' ? args.text : ''
      if (text.trim() === '') throw new Error('type_text requires text')
      await session.type(text)
      return { ok: true, scope: 'display' }
    }
    case 'press_key': {
      const key = typeof args.key === 'string' ? args.key : ''
      await session.key(key, stringList(args.modifiers))
      return { ok: true, scope: 'display' }
    }
    case 'scroll': {
      await session.scroll(
        typeof args.direction === 'string' ? args.direction : '',
        intArg(args.amount, 1),
      )
      return { ok: true, scope: 'display' }
    }
    default:
      throw new Error(`unsupported portal Computer Use tool ${JSON.stringify(tool)}`)
  }
}

export function pngSize(png: Uint8Array): { width: number; height: number } {
  if (png.length < 24) return { width: 0, height: 0 }
  const width = ((png[16]! << 24) | (png[17]! << 16) | (png[18]! << 8) | png[19]!) >>> 0
  const height = ((png[20]! << 24) | (png[21]! << 16) | (png[22]! << 8) | png[23]!) >>> 0
  return { width, height }
}

class XdgPortalSession implements PortalSession {
  private readonly mu = new Mutex()
  private sessionPath = ''
  private stream = 0
  private remote: DbusInterface | null = null
  private screencast: DbusInterface | null = null
  private screenshotIface: DbusInterface | null = null
  private readonly dbus: DbusModule
  private readonly bus: DbusMessageBus
  private readonly desktop: DbusProxy

  constructor(dbus: DbusModule, bus: DbusMessageBus, desktop: DbusProxy) {
    this.dbus = dbus
    this.bus = bus
    this.desktop = desktop
  }

  async start(signal?: AbortSignal): Promise<void> {
    await this.mu.lock()
    try {
      if (this.sessionPath) return
      if (await gnomeSessionLocked(this.dbus, this.bus)) {
        throw new Error('GNOME 会话已锁屏，无法弹出桌面共享授权')
      }
      this.remote = this.desktop.getInterface(PORTAL_REMOTE_DESKTOP)
      this.screencast = this.desktop.getInterface(PORTAL_SCREEN_CAST)
      this.screenshotIface = this.desktop.getInterface(PORTAL_SCREENSHOT)
      const sessionToken = portalToken()
      let create: Record<string, unknown>
      try {
        create = await this.portalCall(this.remote, 'CreateSession', [this.options({
          session_handle_token: ['s', sessionToken],
          handle_token: ['s', portalToken()],
        })], signal)
      } catch (error) {
        throw wrapPortalError('portal CreateSession', error)
      }
      const sessionPath = variantObjectPath(create.session_handle)
      if (!sessionPath) throw new Error('portal CreateSession did not return a session')
      try {
        await this.portalCall(this.remote, 'SelectDevices', [sessionPath, this.options({
          types: ['u', DEVICE_KEYBOARD | DEVICE_POINTER],
          persist_mode: ['u', 1],
          handle_token: ['s', portalToken()],
        })], signal)
      } catch (error) {
        throw wrapPortalError('portal SelectDevices', error)
      }
      try {
        await this.portalCall(this.screencast, 'SelectSources', [sessionPath, this.options({
          types: ['u', 1],
          multiple: ['b', false],
          cursor_mode: ['u', 2],
          handle_token: ['s', portalToken()],
        })], signal)
      } catch (error) {
        throw wrapPortalError('portal SelectSources', error)
      }
      let started: Record<string, unknown>
      try {
        started = await this.portalCall(this.remote, 'Start', [sessionPath, '', this.options({
          handle_token: ['s', portalToken()],
        })], signal)
      } catch (error) {
        throw wrapPortalError('portal Start', error)
      }
      this.sessionPath = sessionPath
      this.stream = firstPortalStream(started)
      if (this.stream === 0) {
        throw new Error('桌面共享未包含屏幕，无法按坐标点击或截屏')
      }
    } finally {
      this.mu.unlock()
    }
  }

  async screenshot(signal?: AbortSignal): Promise<{ png: Buffer; width: number; height: number }> {
    await this.mu.lock()
    try {
      try {
        return await this.screenshotPortalLocked(signal)
      } catch (error) {
        if (this.stream !== 0) {
          try {
            return await this.screenshotStreamLocked(signal)
          } catch {
            // keep the portal Screenshot error
          }
        }
        throw error
      }
    } finally {
      this.mu.unlock()
    }
  }

  async click(x: number, y: number): Promise<void> {
    await this.mu.lock()
    try {
      await this.pointerMoveLocked(x, y)
      await this.notify('NotifyPointerButton', LINUX_BUTTON_LEFT, 1)
      await this.notify('NotifyPointerButton', LINUX_BUTTON_LEFT, 0)
    } finally {
      this.mu.unlock()
    }
  }

  async type(text: string): Promise<void> {
    await this.mu.lock()
    try {
      for (const rune of text) {
        const keysym = runeKeysym(rune.codePointAt(0) ?? 0)
        if (keysym === null) continue
        await this.keysymLocked(keysym)
      }
    } finally {
      this.mu.unlock()
    }
  }

  async key(name: string, modifiers: string[]): Promise<void> {
    await this.mu.lock()
    try {
      for (const modifier of modifiers) {
        await this.notify('NotifyKeyboardKeysym', modifierKeysym(modifier), 1)
      }
      await this.keysymLocked(namedKeysym(name))
      for (let i = modifiers.length - 1; i >= 0; i -= 1) {
        await this.notify('NotifyKeyboardKeysym', modifierKeysym(modifiers[i] ?? ''), 0)
      }
    } finally {
      this.mu.unlock()
    }
  }

  async scroll(direction: string, amount: number): Promise<void> {
    await this.mu.lock()
    try {
      if (amount < 1) amount = 1
      let steps = amount
      let axis = 0
      switch (direction.toLowerCase()) {
        case 'up':
          steps = -amount
          break
        case 'down':
          steps = amount
          break
        case 'left':
          axis = 1
          steps = -amount
          break
        case 'right':
          axis = 1
          steps = amount
          break
      }
      await this.notify('NotifyPointerAxisDiscrete', axis, steps)
    } finally {
      this.mu.unlock()
    }
  }

  async close(): Promise<void> {
    await this.mu.lock()
    try {
      if (this.sessionPath) {
        try {
          const obj = await this.bus.getProxyObject(PORTAL_BUS_NAME, this.sessionPath, SESSION_XML)
          const iface = obj.getInterface(PORTAL_SESSION_IFACE)
          const close = iface.Close
          if (typeof close === 'function') await (close as () => Promise<unknown>).call(iface)
        } catch {
          // session may already be closed
        }
        this.sessionPath = ''
      }
      try {
        this.bus.disconnect()
      } catch {
        // bus may already be down
      }
    } finally {
      this.mu.unlock()
    }
  }

  private options(entries: Record<string, [string, unknown]>): Record<string, DbusVariant> {
    const out: Record<string, DbusVariant> = {}
    for (const [key, [signature, value]] of Object.entries(entries)) {
      out[key] = new this.dbus.Variant(signature, value)
    }
    return out
  }

  private async screenshotPortalLocked(signal?: AbortSignal): Promise<{ png: Buffer; width: number; height: number }> {
    if (!this.screenshotIface) throw new Error('portal Screenshot: interface is unavailable')
    let results: Record<string, unknown>
    try {
      results = await this.portalCall(this.screenshotIface, 'Screenshot', ['', this.options({
        interactive: ['b', false],
        modal: ['b', false],
        handle_token: ['s', portalToken()],
      })], signal)
    } catch (error) {
      throw wrapPortalError('portal Screenshot', error)
    }
    const uri = String(unwrapPortalValue(results.uri) ?? '')
    if (!uri) throw new Error('portal Screenshot did not return a file')
    const path = portalScreenshotPath(uri)
    const png = await readFile(path)
    await unlink(path).catch(() => {})
    const size = pngSize(png)
    return { png, width: size.width, height: size.height }
  }

  private async screenshotStreamLocked(signal?: AbortSignal): Promise<{ png: Buffer; width: number; height: number }> {
    const path = join(tmpdir(), `milksu-portal-shot-${randomBytes(8).toString('hex')}.png`)
    try {
      try {
        await execFile(
          'gst-launch-1.0',
          [
            '-q',
            'pipewiresrc',
            `path=${this.stream}`,
            'num-buffers=1',
            '!',
            'videoconvert',
            '!',
            'pngenc',
            '!',
            'filesink',
            `location=${path}`,
          ],
          { signal, timeout: 15_000, maxBuffer: 4 << 20 },
        )
      } catch (error) {
        const err = error as { code?: string; message?: string; stderr?: string; stdout?: string }
        if (err.code === 'ENOENT') throw new Error('exec: "gst-launch-1.0": executable file not found in $PATH')
        const output = String(err.stderr || err.stdout || '').trim()
        throw new Error(`capture shared screen: ${err.message ?? error}: ${output}`)
      }
      const png = await readFile(path)
      const size = pngSize(png)
      if (size.width <= 0 || size.height <= 0) throw new Error('shared screen capture was empty')
      return { png, width: size.width, height: size.height }
    } finally {
      await unlink(path).catch(() => {})
    }
  }

  private async pointerMoveLocked(x: number, y: number): Promise<void> {
    await this.notify('NotifyPointerMotionAbsolute', this.stream, x, y)
  }

  private async keysymLocked(keysym: number): Promise<void> {
    await this.notify('NotifyKeyboardKeysym', keysym, 1)
    await this.notify('NotifyKeyboardKeysym', keysym, 0)
  }

  private async notify(method: string, ...args: unknown[]): Promise<void> {
    const iface = this.remote
    if (!iface) throw new Error(`portal ${method} is unavailable`)
    const fn = iface[method]
    if (typeof fn !== 'function') throw new Error(`portal ${method} is unavailable`)
    await (fn as (...values: unknown[]) => Promise<unknown>).call(iface, this.sessionPath, {}, ...args)
  }

  private async portalCall(
    iface: DbusInterface,
    method: string,
    args: unknown[],
    signal?: AbortSignal,
  ): Promise<Record<string, unknown>> {
    const unique = String(this.bus.name ?? '').replace(/^:/, '').replaceAll('.', '_')
    const handleToken = handleTokenFromArgs(args)
    const requestPath = `/org/freedesktop/portal/desktop/request/${unique}/${handleToken}`
    const requestObj = await this.bus.getProxyObject(PORTAL_BUS_NAME, requestPath, REQUEST_XML)
    const request = requestObj.getInterface(PORTAL_REQUEST_IFACE)
    const local = new AbortController()
    const onAbort = () => local.abort()
    signal?.addEventListener('abort', onAbort)
    if (signal?.aborted) local.abort()
    const pending = waitForRequestResponse(request, local.signal)
    try {
      const fn = iface[method]
      if (typeof fn !== 'function') throw new Error(`portal ${method} is unavailable`)
      await (fn as (...values: unknown[]) => Promise<unknown>).apply(iface, args)
      return await pending
    } catch (error) {
      local.abort()
      await pending.catch(() => {})
      throw error
    } finally {
      signal?.removeEventListener('abort', onAbort)
    }
  }
}

async function openXdgPortalSession(): Promise<XdgPortalSession> {
  let dbus: DbusModule
  try {
    dbus = await loadDbus()
  } catch (error) {
    throw new Error(`connect session bus for desktop portal: ${error instanceof Error ? error.message : error}`)
  }
  let bus: DbusMessageBus
  try {
    bus = dbus.sessionBus()
  } catch (error) {
    throw new Error(`connect session bus for desktop portal: ${error instanceof Error ? error.message : error}`)
  }
  try {
    const desktop = await bus.getProxyObject(PORTAL_BUS_NAME, PORTAL_OBJECT_PATH)
    return new XdgPortalSession(dbus, bus, desktop)
  } catch (error) {
    try { bus.disconnect() } catch { /* ignore */ }
    throw new Error(`connect session bus for desktop portal: ${error instanceof Error ? error.message : error}`)
  }
}

async function loadDbus(): Promise<DbusModule> {
  const specifier = 'dbus-next'
  const loaded = await import(specifier) as DbusModule & { default?: DbusModule }
  const mod = loaded.default && typeof loaded.default.sessionBus === 'function' ? loaded.default : loaded
  if (typeof mod.sessionBus !== 'function' || typeof mod.Variant !== 'function') {
    throw new Error('dbus-next sessionBus is unavailable')
  }
  return mod
}

async function gnomeSessionLocked(dbus: DbusModule, bus: DbusMessageBus): Promise<boolean> {
  try {
    const reply = await bus.call(new dbus.Message({
      destination: 'org.gnome.ScreenSaver',
      path: '/org/gnome/ScreenSaver',
      interface: 'org.gnome.ScreenSaver',
      member: 'GetActive',
    }))
    return Array.isArray(reply?.body) && reply.body[0] === true
  } catch {
    return false
  }
}

function waitForRequestResponse(request: DbusInterface, signal?: AbortSignal): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup()
      const reason = signal?.reason
      reject(reason instanceof Error ? reason : new Error('portal request timed out'))
    }
    const onResponse = (...body: unknown[]) => {
      cleanup()
      const response = Number(body[0] ?? 0)
      if (response !== 0) {
        reject(new Error(portalResponseError(response)))
        return
      }
      const results = body[1]
      resolve(results && typeof results === 'object' && !Array.isArray(results)
        ? results as Record<string, unknown>
        : {})
    }
    const cleanup = () => {
      request.off('Response', onResponse)
      signal?.removeEventListener('abort', onAbort)
    }
    request.on('Response', onResponse)
    if (signal?.aborted) {
      onAbort()
      return
    }
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

function portalResponseError(response: number): string {
  switch (response) {
    case 1:
      return '用户取消了桌面共享授权'
    case 2:
      return '系统拒绝了桌面共享（会话可能已锁屏）'
    default:
      return `desktop portal request failed (${response})`
  }
}

function handleTokenFromArgs(args: unknown[]): string {
  const last = args[args.length - 1]
  if (!last || typeof last !== 'object') return ''
  const token = (last as Record<string, DbusVariant | undefined>).handle_token
  return String(unwrapPortalValue(token) ?? '')
}

function variantObjectPath(value: unknown): string {
  const unwrapped = unwrapPortalValue(value)
  return typeof unwrapped === 'string' && unwrapped ? unwrapped : ''
}

function firstPortalStream(results: Record<string, unknown>): number {
  if (!('streams' in results)) return 0
  const streams = unwrapPortalValue(results.streams)
  if (!Array.isArray(streams) || streams.length === 0) return 0
  if (Array.isArray(streams[0])) return uintFromPortal(streams[0][0])
  return streamEntryID(streams[0])
}

function streamEntryID(entry: unknown): number {
  const typed = unwrapPortalValue(entry)
  if (Array.isArray(typed) && typed.length > 0) return uintFromPortal(typed[0])
  return uintFromPortal(typed)
}

function unwrapPortalValue(value: unknown): unknown {
  if (isVariant(value)) return unwrapPortalValue(value.value)
  return value
}

function isVariant(value: unknown): value is DbusVariant {
  return Boolean(
    value
    && typeof value === 'object'
    && 'signature' in value
    && 'value' in value
    && typeof (value as DbusVariant).signature === 'string',
  )
}

function uintFromPortal(value: unknown): number {
  const typed = unwrapPortalValue(value)
  if (typeof typed === 'number' && Number.isFinite(typed)) return typed >>> 0
  if (typeof typed === 'bigint') return Number(typed) >>> 0
  return 0
}

function portalToken(): string {
  return `m${randomBytes(8).toString('hex')}`
}

function runeKeysym(value: number): number | null {
  if (value === 0x0a || value === 0x0d) return 0xff0d
  if (value === 0x09) return 0xff09
  if (value >= 0x20 && value <= 0x7e) return value
  return null
}

function namedKeysym(name: string): number {
  switch (name.trim().toLowerCase()) {
    case 'enter':
    case 'return':
      return 0xff0d
    case 'tab':
      return 0xff09
    case 'escape':
    case 'esc':
      return 0xff1b
    case 'backspace':
      return 0xff08
    case 'space':
      return 0x0020
    case 'up':
      return 0xff52
    case 'down':
      return 0xff54
    case 'left':
      return 0xff51
    case 'right':
      return 0xff53
    case 'delete':
      return 0xffff
    default:
      if (name.length === 1) {
        const keysym = runeKeysym(name.charCodeAt(0))
        if (keysym !== null) return keysym
      }
      return 0xff0d
  }
}

function modifierKeysym(name: string): number {
  switch (name.toLowerCase()) {
    case 'shift':
      return 0xffe1
    case 'ctrl':
    case 'control':
      return 0xffe3
    case 'alt':
    case 'option':
      return 0xffe9
    case 'cmd':
    case 'meta':
      return 0xffe7
    default:
      return 0
  }
}

function portalScreenshotPath(uri: string): string {
  let parsed: URL
  try {
    parsed = new URL(uri)
  } catch {
    throw new Error('portal Screenshot uri is not a local file')
  }
  if (parsed.protocol !== 'file:' || !parsed.pathname) {
    throw new Error('portal Screenshot uri is not a local file')
  }
  return fileURLToPath(parsed)
}

function wrapPortalError(prefix: string, error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith(`${prefix}:`)) return error instanceof Error ? error : new Error(message)
  return new Error(`${prefix}: ${message}`)
}

function portalCoordinates(args: Record<string, unknown>): { x: number; y: number } {
  const x = jsonNumber(args.x)
  const y = jsonNumber(args.y)
  if (x === null || y === null) {
    throw new Error('Linux Computer Use 需要截屏坐标 x/y，没有窗口内 AX 元素')
  }
  return { x, y }
}

function jsonNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  return null
}

function intArg(value: unknown, fallback: number): number {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value)
  return fallback
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const item of value) {
    if (typeof item === 'string') out.push(item)
  }
  return out
}

function asArgs(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  return value as Record<string, unknown>
}

function writePortalReply(connection: net.Socket, reply: PortalReply): void {
  try {
    connection.write(`${JSON.stringify(reply)}\n`)
  } catch {
    // connection may already be closed
  }
}

function readLine(connection: net.Socket): Promise<string | null> {
  return new Promise((resolve, reject) => {
    let buf = ''
    const onData = (chunk: Buffer | string) => {
      buf += typeof chunk === 'string' ? chunk : chunk.toString('utf8')
      if (Buffer.byteLength(buf) > MAX_REQUEST_BYTES) {
        cleanup()
        reject(new Error('portal Computer Use request too large'))
        return
      }
      const index = buf.indexOf('\n')
      if (index >= 0) {
        cleanup()
        resolve(buf.slice(0, index).replace(/\r$/, ''))
      }
    }
    const onEnd = () => {
      cleanup()
      resolve(null)
    }
    const onError = () => {
      cleanup()
      resolve(null)
    }
    const cleanup = () => {
      connection.off('data', onData)
      connection.off('end', onEnd)
      connection.off('error', onError)
    }
    connection.setEncoding('utf8')
    connection.on('data', onData)
    connection.on('end', onEnd)
    connection.on('error', onError)
  })
}

function listenUnix(server: net.Server, socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onError = (error: Error) => {
      server.off('error', onError)
      reject(error)
    }
    server.once('error', onError)
    server.listen(socketPath, () => {
      server.off('error', onError)
      resolve()
    })
  })
}

function closeServer(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => resolve())
  })
}

function onceClose(server: net.Server): Promise<void> {
  return new Promise((resolve) => {
    server.once('close', () => resolve())
  })
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
