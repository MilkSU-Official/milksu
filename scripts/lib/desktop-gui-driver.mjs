/**
 * External Stable desktop driver. Not imported by product startup or Vue.
 * Attaches via Chromium DevTools on a random loopback port, then calls
 * window.milksu.invoke. Does not print Provider keys.
 */

import { spawn } from 'node:child_process'
import { execFile } from 'node:child_process'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

export function killProcessGroup(child, signal = 'SIGTERM') {
  if (!child || child.exitCode != null) return false
  if (process.platform === 'win32') {
    spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    return true
  }
  try {
    process.kill(-child.pid, signal)
    return true
  } catch {
    try {
      child.kill(signal)
      return true
    } catch {
      return false
    }
  }
}

export async function waitForExit(child, timeoutMs = 8_000) {
  if (!child || child.exitCode != null) return
  await Promise.race([
    new Promise(resolveExit => child.once('exit', resolveExit)),
    delay(timeoutMs),
  ])
  if (child.exitCode == null) {
    killProcessGroup(child, 'SIGKILL')
    await delay(400)
  }
}

async function listLoopbackListenPorts() {
  try {
    const { stdout } = await execFileAsync('lsof', ['-nP', '-iTCP@127.0.0.1', '-sTCP:LISTEN'], {
      encoding: 'utf8',
      timeout: 5_000,
    })
    const ports = new Set()
    for (const line of stdout.split('\n')) {
      const match = line.match(/127\.0\.0\.1:(\d+)/)
      if (match) ports.add(Number(match[1]))
    }
    return [...ports]
  } catch {
    return []
  }
}

async function fetchJson(url, timeoutMs = 400) {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  return response.json()
}

export function isMilkSUPage(target) {
  const title = String(target?.title ?? '')
  const url = String(target?.url ?? '')
  if (/MilkSU/i.test(title)) return true
  if (/milksu:\/\//i.test(url)) return true
  if (/localhost:\d+/.test(url) && /milksu|vite/i.test(url + title)) return true
  return false
}

export async function findDesktopCdpTarget() {
  const ports = await listLoopbackListenPorts()
  for (const port of ports) {
    try {
      const version = await fetchJson(`http://127.0.0.1:${port}/json/version`)
      const browser = String(version.Browser ?? version.browser ?? '')
      if (!/Chrome|Electron|MilkSU/i.test(browser)) continue
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`)
      const pages = Array.isArray(list) ? list : []
      const page = pages.find(item => (
        (item.type === 'page' || item.type === 'webview')
        && item.webSocketDebuggerUrl
        && isMilkSUPage(item)
      ))
      if (!page) continue
      return {
        port,
        browser,
        title: page.title ?? '',
        url: page.url ?? '',
        webSocketDebuggerUrl: page.webSocketDebuggerUrl,
      }
    } catch {
      // Not a DevTools endpoint.
    }
  }
  return null
}

export class CdpSession {
  constructor(webSocketDebuggerUrl) {
    this.url = webSocketDebuggerUrl
    this.ws = null
    this.nextId = 1
    this.pending = new Map()
  }

  async open() {
    if (typeof WebSocket !== 'function') {
      throw new Error('This Node runtime has no WebSocket; cannot attach Desktop CDP')
    }
    this.ws = new WebSocket(this.url)
    await new Promise((resolveOpen, rejectOpen) => {
      this.ws.addEventListener('open', () => resolveOpen())
      this.ws.addEventListener('error', () => rejectOpen(new Error('CDP WebSocket failed')))
    })
    this.ws.addEventListener('message', message => {
      let payload
      try {
        payload = JSON.parse(String(message.data))
      } catch {
        return
      }
      const waiter = this.pending.get(payload.id)
      if (!waiter) return
      this.pending.delete(payload.id)
      if (payload.error) waiter.reject(new Error(payload.error.message || 'CDP error'))
      else waiter.resolve(payload.result)
    })
  }

  send(method, params = {}) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolveSend, rejectSend) => {
      this.pending.set(id, { resolve: resolveSend, reject: rejectSend })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression, awaitPromise = false) {
    const result = await this.send('Runtime.evaluate', {
      expression,
      awaitPromise,
      returnByValue: true,
    })
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'renderer evaluate failed')
    }
    return result?.result?.value
  }

  close() {
    try {
      this.ws?.close()
    } catch {
      // Already closed.
    }
  }
}

export class GuiDriver {
  constructor(options = {}) {
    this.repositoryRoot = options.repositoryRoot || repositoryRoot
    this.cdp = null
    this.target = null
    this.startedChild = null
    this.gaps = []
  }

  async attachOrStart(timeoutMs) {
    this.target = await findDesktopCdpTarget()
    if (!this.target) {
      this.startedChild = spawn('npm', ['run', 'desktop:start'], {
        cwd: this.repositoryRoot,
        env: {
          ...process.env,
          MILKSU_CHANNEL: 'stable',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      })
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline && !this.target) {
        if (this.startedChild.exitCode != null) {
          throw new Error(`desktop:start exited ${this.startedChild.exitCode}`)
        }
        await delay(1_000)
        this.target = await findDesktopCdpTarget()
      }
    }
    if (!this.target) {
      this.gaps.push(
        '未能附着产品窗口：Electron 把 DevTools 绑在随机 127.0.0.1 端口，扫描超时。没有对外 Desktop RPC 套接字。',
      )
      return false
    }
    this.cdp = new CdpSession(this.target.webSocketDebuggerUrl)
    await this.cdp.open()
    const hasRuntime = await this.cdp.evaluate('Boolean(window.milksu && window.milksu.invoke)')
    if (!hasRuntime) {
      this.gaps.push('已连上 Chromium 页，但 window.milksu 不可用，无法调用 Desktop RPC。')
      return false
    }
    await this.cdp.evaluate(`(() => {
      if (window.__milksuProductLoop) return true;
      window.__milksuProductLoop = { events: [] };
      window.milksu.onEvent('engine-event', value => {
        window.__milksuProductLoop.events.push(value);
      });
      return true;
    })()`)
    return true
  }

  async invoke(method, args) {
    const encoded = JSON.stringify(args ?? [])
    return this.cdp.evaluate(
      `window.milksu.invoke(${JSON.stringify(method)}, ${encoded})`,
      true,
    )
  }

  async drainEvents(conversationId) {
    const raw = await this.cdp.evaluate(
      'window.__milksuProductLoop ? window.__milksuProductLoop.events.splice(0) : []',
    )
    const events = Array.isArray(raw) ? raw : []
    if (!conversationId) return events
    return events.filter(event => {
      const id = String(event?.sessionId ?? event?.id ?? '')
      return !id || id === conversationId
    })
  }

  async waitForTurn(conversationId, timeoutMs) {
    const collected = []
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      const batch = await this.drainEvents(conversationId)
      collected.push(...batch)
      if (collected.some(event => {
        const type = String(event?.type ?? event?.Type ?? '')
        return type === 'assistant.settled'
          || type === 'assistant.completed'
          || /^(error|engine\.error|engine\.protocol_error)$/i.test(type)
      })) {
        return { events: collected, timeout: false }
      }
      await delay(250)
    }
    return { events: collected, timeout: true, error: 'GUI turn timed out' }
  }

  async createKernelConversation(workspacePath, title, kernel = 'dsh') {
    const conversation = await this.createConversation({
      title,
      workspacePath,
      kernel,
      approvalPolicy: 'workspace-auto',
    })
    return conversation.id
  }

  async createConversation(options) {
    const conversation = {
      id: options.id || `product-loop-${Date.now().toString(36)}`,
      title: options.title || 'product-loop',
      createdAt: Date.now(),
      workspacePath: options.workspacePath,
      kernel: options.kernel || 'pi',
      executionMode: options.executionMode || 'go',
      approvalPolicy: options.approvalPolicy || 'workspace-auto',
      pinned: options.pinned === true ? true : undefined,
      pinnedOrder: Number.isFinite(Number(options.pinnedOrder))
        ? Number(options.pinnedOrder)
        : undefined,
      messages: [],
    }
    await this.invoke('SaveConversation', [conversation])
    return conversation
  }

  async listConversations() {
    const list = await this.invoke('ListConversations', [])
    return Array.isArray(list) ? list : []
  }

  async sendMessage(conversationId, prompt, workspacePath, options = {}) {
    return this.invoke('SendMessage', [
      conversationId,
      prompt,
      workspacePath,
      '',
      '',
      '',
      '',
      'auto',
      options.executionMode || 'go',
      options.approvalPolicy || 'workspace-auto',
      '',
      [],
      [],
      undefined,
      -1,
    ])
  }

  async credentialPresent() {
    try {
      const account = await this.invoke('GetAccountStatus', [])
      if (account?.authenticated) return 'account-session'
    } catch {
      // Account surface may be unconfigured.
    }
    try {
      const settings = await this.invoke('GetSettings', [])
      const providers = settings?.Providers || settings?.providers || {}
      for (const provider of Object.values(providers)) {
        if (String(provider?.APIKey || provider?.apiKey || '').trim()) return 'settings-provider'
      }
    } catch {
      // Settings unavailable.
    }
    const deepseek = String(process.env.DEEPSEEK_API_KEY ?? '').trim()
    const tokenflux = String(process.env.TOKENFLUX_API_KEY ?? '').trim()
    if (deepseek) return 'env:DEEPSEEK_API_KEY'
    if (tokenflux) return 'env:TOKENFLUX_API_KEY'
    return 'none'
  }

  async abortMessage(conversationId) {
    const id = String(conversationId ?? '').trim()
    if (!id) return
    try {
      await this.invoke('AbortMessage', [id])
    } catch {
      // Already settled or the Sidecar already left the session.
    }
  }

  async ensureCodingBrowser(conversationId) {
    return this.invoke('EnsureCodingBrowser', [conversationId])
  }

  async navigateCodingBrowser(conversationId, url) {
    return this.invoke('NavigateCodingBrowser', [conversationId, url])
  }

  async listComputerUseTargets() {
    try {
      return await this.invoke('ListCodingComputerUseTargets', [])
    } catch (error) {
      return { error: String(error instanceof Error ? error.message : error) }
    }
  }

  async close() {
    this.cdp?.close()
    this.cdp = null
    if (this.startedChild && this.startedChild.exitCode == null) {
      killProcessGroup(this.startedChild, 'SIGTERM')
      await waitForExit(this.startedChild, 8_000)
    }
    this.startedChild = null
  }
}
