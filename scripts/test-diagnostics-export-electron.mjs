import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { inflateRawSync } from 'node:zlib'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const home = await mkdtemp(join(tmpdir(), 'milksu-diagnostics-e2e-'))
const electron = process.platform === 'win32'
  ? join(root, 'desktop', 'node_modules', 'electron', 'cli.js')
  : join(root, 'desktop', 'node_modules', '.bin', 'electron')
let devToolsPort = 0
const env = {
  ...process.env,
  MILKSU_HOME: home,
}
const rendererEvent = {
  timestamp: new Date().toISOString(),
  category: 'electron-e2e',
  level: 'info',
  message: 'rpc method=ExportLocalDiagnostics',
}

function fail(message) {
  throw new Error(message)
}

function nativeDialogEnvironmentHint() {
  if (process.platform !== 'linux') return ''
  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) return '；当前图形会话可能不支持 Electron 原生对话框'
  return '；Linux 需要可用的 DISPLAY 或 WAYLAND_DISPLAY 图形会话'
}

function readZipEntry(buffer, wanted) {
  const eocd = Buffer.from([0x50, 0x4b, 0x05, 0x06])
  const central = Buffer.from([0x50, 0x4b, 0x01, 0x02])
  const local = Buffer.from([0x50, 0x4b, 0x03, 0x04])
  const eocdOffset = buffer.lastIndexOf(eocd)
  if (eocdOffset < 0) fail('diagnostic output is not a ZIP archive')
  const centralSize = buffer.readUInt32LE(eocdOffset + 12)
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16)
  let offset = centralOffset
  const end = centralOffset + centralSize
  while (offset < end && buffer.subarray(offset, offset + 4).equals(central)) {
    const madeBy = buffer.readUInt16LE(offset + 4)
    const method = buffer.readUInt16LE(offset + 10)
    const compressedSize = buffer.readUInt32LE(offset + 20)
    const nameSize = buffer.readUInt16LE(offset + 28)
    const extraSize = buffer.readUInt16LE(offset + 30)
    const commentSize = buffer.readUInt16LE(offset + 32)
    const localOffset = buffer.readUInt32LE(offset + 42)
    const name = buffer.subarray(offset + 46, offset + 46 + nameSize).toString('utf8')
    const mode = buffer.readUInt32LE(offset + 38) >>> 16
    if ((madeBy >> 8) === 3 && (mode & 0o777) !== 0o600) fail(`${name} mode is ${(mode & 0o777).toString(8)}, want 600`)
    if (name === wanted) {
      if (!buffer.subarray(localOffset, localOffset + 4).equals(local)) fail(`bad local header for ${name}`)
      const localNameSize = buffer.readUInt16LE(localOffset + 26)
      const localExtraSize = buffer.readUInt16LE(localOffset + 28)
      const start = localOffset + 30 + localNameSize + localExtraSize
      const compressed = buffer.subarray(start, start + compressedSize)
      if (method === 0) return compressed
      if (method === 8) return inflateRawSync(compressed)
      fail(`unsupported ZIP method ${method}`)
    }
    offset += 46 + nameSize + extraSize + commentSize
  }
  fail(`${wanted} is missing from diagnostic archive`)
}

class CDP {
  constructor(url) {
    this.url = url
    this.nextID = 0
    this.pending = new Map()
  }

  async connect() {
    this.socket = new WebSocket(this.url)
    this.socket.addEventListener('message', event => {
      const message = JSON.parse(String(event.data))
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    })
    const disconnected = () => {
      const error = new Error('Electron DevTools connection closed')
      for (const { reject } of this.pending.values()) reject(error)
      this.pending.clear()
    }
    this.socket.addEventListener('close', disconnected)
    this.socket.addEventListener('error', disconnected)
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true })
      this.socket.addEventListener('error', reject, { once: true })
    })
  }

  command(method, params = {}) {
    const id = ++this.nextID
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.socket.send(JSON.stringify({ id, method, params }))
    })
  }

  close() {
    this.socket?.close()
  }
}

async function waitForTarget(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!devToolsPort) {
      await new Promise(resolve => setTimeout(resolve, 50))
      continue
    }
    try {
      const response = await fetch(`http://127.0.0.1:${devToolsPort}/json/list`, { cache: 'no-store' })
      if (response.ok) {
        const targets = await response.json()
        const target = targets.find(item => item.type === 'page' && String(item.url).startsWith('milksu://app/'))
        if (target?.webSocketDebuggerUrl) return target
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  fail('Electron DevTools target did not become available')
}

async function invokeDiagnostics(cdp, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const result = await cdp.command('Runtime.evaluate', {
      expression: "typeof window.milksu?.invoke === 'function'",
      returnByValue: true,
    })
    if (result.result?.value === true) {
      return cdp.command('Runtime.evaluate', {
        expression: `window.milksu.invoke('ExportLocalDiagnostics', [[${JSON.stringify(rendererEvent)}]])`,
        awaitPromise: true,
        returnByValue: true,
        userGesture: true,
      })
    }
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  fail('renderer Desktop RPC bridge did not become available')
}

const timeoutMs = Number(process.env.MILKSU_DIAGNOSTICS_E2E_TIMEOUT_MS ?? 180000)
let child
let cdp
let exportedDestination = ''
try {
  child = spawn(electron, ['.'], {
    cwd: join(root, 'desktop'),
    env,
    stdio: ['ignore', 'inherit', 'pipe'],
  })
  child.stderr.on('data', chunk => {
    const match = String(chunk).match(/DevTools listening on ws:\/\/127\.0\.0\.1:(\d+)\//u)
    if (match) devToolsPort = Number(match[1])
    process.stderr.write(chunk)
  })
  const childExit = new Promise((_, reject) => child.once('exit', (code, signal) => {
    reject(new Error(`Electron exited before diagnostics export (code=${code}, signal=${signal})${nativeDialogEnvironmentHint()}`))
  }))
  const target = await Promise.race([waitForTarget(timeoutMs), childExit])
  cdp = new CDP(target.webSocketDebuggerUrl)
  await cdp.connect()
  console.error('请在真实 Electron 文件保存对话框中选择目标 ZIP 并确认保存。')
  const evaluated = await Promise.race([invokeDiagnostics(cdp, timeoutMs), childExit])
  if (evaluated.exceptionDetails) fail(evaluated.exceptionDetails.text ?? 'renderer diagnostics export failed')
  const result = evaluated.result?.value
  if (!result || result.cancelled) fail('native save dialog was cancelled')
  exportedDestination = String(result.path ?? '')
  if (!exportedDestination) fail('Electron diagnostics export returned no destination')
  const archive = await readFile(exportedDestination)
  const report = JSON.parse(readZipEntry(archive, 'diagnostics.json'))
  if (report.schema !== 'milksu-diagnostics/v1') fail(`unexpected diagnostics schema ${report.schema}`)
  if (!report.recentEvents?.some(event => event.message === 'rpc method=ExportLocalDiagnostics')) {
    fail('renderer RPC event is missing from diagnostics archive')
  }
  const info = await stat(exportedDestination)
  if (process.platform !== 'win32' && (info.mode & 0o777) !== 0o600) {
    fail(`diagnostics archive mode is ${(info.mode & 0o777).toString(8)}, want 600`)
  }
  console.log(JSON.stringify({ destination: exportedDestination, bytes: info.size, schema: report.schema }))
} finally {
  cdp?.close()
  if (child && !child.killed) child.kill()
  await rm(home, { recursive: true, force: true })
}
