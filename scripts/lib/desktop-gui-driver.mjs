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
import { companionHostToolError, parseCompanionConfirm } from './product-loop-companion.mjs'

const execFileAsync = promisify(execFile)

export const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

export const DESKTOP_CREDENTIAL_ENV_KEYS = Object.freeze([
  'DEEPSEEK_API_KEY',
  'TOKENFLUX_API_KEY',
  'OPENAI_API_KEY',
])

export function stripDesktopCredentialEnv(env = {}) {
  const next = { ...env }
  for (const name of DESKTOP_CREDENTIAL_ENV_KEYS) delete next[name]
  return next
}

export function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

export function eventSessionId(event) {
  if (!event || typeof event !== 'object') return ''
  const nested = event.payload && typeof event.payload === 'object' ? event.payload : null
  return String(
    event.sessionId
    ?? event.SessionID
    ?? nested?.sessionId
    ?? nested?.SessionID
    ?? '',
  ).trim()
}

export function eventTypeOf(event) {
  if (!event || typeof event !== 'object') return ''
  const nested = event.payload && typeof event.payload === 'object' ? event.payload : null
  return String(event.type ?? event.Type ?? nested?.type ?? nested?.Type ?? '')
}

export function eventToolName(event) {
  if (!event || typeof event !== 'object') return ''
  const nested = event.payload && typeof event.payload === 'object' ? event.payload : null
  return String(
    event.toolName
    ?? event.ToolName
    ?? nested?.toolName
    ?? nested?.ToolName
    ?? event.title
    ?? event.kind
    ?? '',
  ).trim()
}

export function classifyTurnEvents(events) {
  const rows = events ?? []
  const types = rows.map(event => eventTypeOf(event))
  const errorTexts = rows.map(event => {
    const nested = event?.payload && typeof event.payload === 'object' ? event.payload : null
    return String(event?.error ?? event?.Error ?? nested?.error ?? event?.text ?? event?.Text ?? '')
  })
  const error = errorTexts.find(text => text.trim()) || ''
  const sidecarStopped = types.some(type => type === 'engine.sidecar_stopped')
  const hostTimedOut = errorTexts.some(text => companionHostToolError(text))
  // Host board/dispatch timeouts stay inside Pi's loop. Do not abort the wait
  // before assistant.settled. Assertions still see hostTimedOut / companionTurnErrored.
  const failed = rows.some((event, index) => {
    const type = eventTypeOf(event)
    if (
      type !== 'engine.error'
      && type !== 'engine.protocol_error'
      && type !== 'engine.stopped'
    ) return false
    return !companionHostToolError(errorTexts[index])
      && !/request aborted|aborterror/i.test(errorTexts[index])
  })
  const settled = types.some(type => type === 'assistant.settled' || type === 'assistant.completed')
  return { settled, failed, error, sidecarStopped, hostTimedOut }
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

export function isCompanionPetSurface(target) {
  return /(?:\?|&)surface=companion(?:&|#|$)/i.test(String(target?.url ?? ''))
}

export function isCompanionChatSurface(target) {
  const url = String(target?.url ?? '')
  if (/(?:\?|&)surface=companion-chat(?:&|#|$)/i.test(url)) return true
  return isCompanionPetSurface(target)
}

export function isCompanionSurface(target) {
  return isCompanionPetSurface(target) || isCompanionChatSurface(target)
}

export function isMainProductSurface(target) {
  return isMilkSUPage(target) && !isCompanionSurface(target)
}

export function isMilkSUPage(target) {
  const title = String(target?.title ?? '')
  const url = String(target?.url ?? '')
  if (/fixture/i.test(title + url)) return false
  if (/about:blank/i.test(url)) return false
  if (isCompanionSurface(target)) return true
  if (/milksu:\/\//i.test(url)) return true
  if (/localhost:\d+/.test(url) && /milksu|vite/i.test(url + title)) return true
  return false
}

export function desktopTargetKey(target) {
  return `${target?.port ?? ''}:${target?.webSocketDebuggerUrl ?? ''}`
}

export async function listRawCdpPages(options = {}) {
  const found = []
  const ports = await listLoopbackListenPorts()
  const wantedPort = options.port == null || options.port === '' ? null : Number(options.port)
  for (const port of ports) {
    if (wantedPort != null && Number.isFinite(wantedPort) && port !== wantedPort) continue
    try {
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`)
      const pages = Array.isArray(list) ? list : []
      for (const item of pages) {
        if ((item.type === 'page' || item.type === 'webview') && item.webSocketDebuggerUrl) {
          found.push({
            port,
            title: item.title ?? '',
            url: item.url ?? '',
            webSocketDebuggerUrl: item.webSocketDebuggerUrl,
          })
        }
      }
    } catch {
      // Not a DevTools endpoint.
    }
  }
  return found
}

export async function listDesktopCdpTargets(options = {}) {
  const found = []
  const ports = await listLoopbackListenPorts()
  const wantedPort = options.port == null || options.port === '' ? null : Number(options.port)
  const excludeKeys = options.excludeKeys instanceof Set ? options.excludeKeys : null
  for (const port of ports) {
    if (wantedPort != null && Number.isFinite(wantedPort) && port !== wantedPort) continue
    try {
      const version = await fetchJson(`http://127.0.0.1:${port}/json/version`)
      const browser = String(version.Browser ?? version.browser ?? '')
      if (!/Chrome|Electron|MilkSU/i.test(browser)) continue
      const list = await fetchJson(`http://127.0.0.1:${port}/json/list`)
      const pages = Array.isArray(list) ? list : []
      for (const item of pages) {
        if (
          (item.type === 'page' || item.type === 'webview')
          && item.webSocketDebuggerUrl
          && isMilkSUPage(item)
        ) {
          const target = {
            port,
            browser,
            title: item.title ?? '',
            url: item.url ?? '',
            webSocketDebuggerUrl: item.webSocketDebuggerUrl,
          }
          if (excludeKeys?.has(desktopTargetKey(target))) continue
          found.push(target)
        }
      }
    } catch {
      // Not a DevTools endpoint.
    }
  }
  found.sort((left, right) => {
    const leftCompanion = isCompanionSurface(left) ? 1 : 0
    const rightCompanion = isCompanionSurface(right) ? 1 : 0
    if (leftCompanion !== rightCompanion) return leftCompanion - rightCompanion
    const leftApp = /milksu:\/\//i.test(left.url) ? 0 : 1
    const rightApp = /milksu:\/\//i.test(right.url) ? 0 : 1
    return leftApp - rightApp
  })
  return found
}

export async function captureActivatedPng(session, options = {}) {
  // Default: do not Page.bringToFront — that steals the user's OS focus every
  // product-loop evidence shot. fromSurface still captures an occluded window.
  if (options.activate === true) {
    await session.send('Page.bringToFront').catch(() => {})
  }
  try {
    await session.evaluate(`new Promise(resolve => {
      requestAnimationFrame(() => requestAnimationFrame(() => resolve(true)))
    })`, true)
  } catch {
    // Hidden or tearing-down surfaces can reject animation frames.
  }
  await delay(120)
  const result = await session.send('Page.captureScreenshot', { format: 'png', fromSurface: true })
  if (!result?.data) return null
  return Buffer.from(result.data, 'base64')
}

export async function readPageCaption(session) {
  try {
    return String(await session.evaluate(`(() => {
      const text = String(document.body && document.body.innerText || '').replace(/\\s+/g, ' ').trim()
      return text.slice(0, 200)
    })()`) || '')
  } catch {
    return ''
  }
}

export async function captureTargetEvidence(target) {
  if (!target?.webSocketDebuggerUrl) return { buffer: null, caption: '' }
  const session = new CdpSession(target.webSocketDebuggerUrl)
  await session.open()
  try {
    const buffer = await captureActivatedPng(session)
    const caption = await readPageCaption(session)
    return { buffer, caption }
  } finally {
    session.close()
  }
}

export async function findDesktopCdpTarget(options = {}) {
  const targets = await listDesktopCdpTargets(options)
  const main = targets.find(isMainProductSurface)
  if (main) return main
  return options.allowCompanion === true ? (targets[0] ?? null) : null
}

export const CDP_EVAL_TIMEOUT_MS = 15_000
export const CDP_INVOKE_TIMEOUT_MS = 60_000

export class CdpSession {
  constructor(webSocketDebuggerUrl) {
    this.url = webSocketDebuggerUrl
    this.ws = null
    this.nextId = 1
    this.pending = new Map()
    this.closed = false
  }

  rejectPending(error) {
    const pending = [...this.pending.values()]
    this.pending.clear()
    for (const waiter of pending) waiter.reject(error)
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
    this.ws.addEventListener('close', () => {
      this.closed = true
      this.rejectPending(new Error('CDP WebSocket closed'))
    })
  }

  send(method, params = {}, timeoutMs = CDP_EVAL_TIMEOUT_MS) {
    const id = this.nextId
    this.nextId += 1
    return new Promise((resolveSend, rejectSend) => {
      if (this.closed || !this.ws || this.ws.readyState !== WebSocket.OPEN) {
        rejectSend(new Error('CDP WebSocket closed'))
        return
      }
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return
        this.pending.delete(id)
        rejectSend(new Error(`CDP ${method} timed out`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: value => {
          clearTimeout(timer)
          resolveSend(value)
        },
        reject: error => {
          clearTimeout(timer)
          rejectSend(error)
        },
      })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }

  async evaluate(expression, awaitPromise = false) {
    const result = await this.send(
      'Runtime.evaluate',
      {
        expression,
        awaitPromise,
        returnByValue: true,
      },
      awaitPromise ? CDP_INVOKE_TIMEOUT_MS : CDP_EVAL_TIMEOUT_MS,
    )
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'renderer evaluate failed')
    }
    return result?.result?.value
  }

  async callFunction(functionDeclaration, args = [], awaitPromise = false) {
    const globalThisHandle = await this.send('Runtime.evaluate', {
      expression: 'globalThis',
      returnByValue: false,
    })
    const objectId = globalThisHandle?.result?.objectId
    if (!objectId) throw new Error('CDP globalThis missing')
    const result = await this.send(
      'Runtime.callFunctionOn',
      {
        objectId,
        functionDeclaration,
        arguments: args.map(value => ({ value })),
        awaitPromise,
        returnByValue: true,
      },
      awaitPromise ? CDP_INVOKE_TIMEOUT_MS : CDP_EVAL_TIMEOUT_MS,
    )
    if (result?.exceptionDetails) {
      throw new Error(result.exceptionDetails.text || 'renderer call failed')
    }
    return result?.result?.value
  }

  close() {
    this.closed = true
    this.rejectPending(new Error('CDP WebSocket closed'))
    try {
      this.ws?.close()
    } catch {
      // Already closed.
    }
  }
}

export function isProductLoopFixtureConversation(value) {
  const id = String(value?.id ?? value?.ID ?? '')
  const title = String(value?.title ?? value?.Title ?? '')
  const workspace = String(value?.workspacePath ?? value?.WorkspacePath ?? '')
  if (/^(loop-pin-|loopopt-pin-|product-loop-|dsh-loop-)/.test(id)) return true
  if (/^(loop-pin-|loopopt-pin-|product-loop\b|DSH )/.test(title)) return true
  if (/^(DSH仓库|DSH隔离|DSH审批|DSH Computer Use)/.test(title)) return true
  if (/(milksu-dsh-loop-|product-loop-surface-|product-loop-pi-|product-loop-isolated)/.test(workspace)) return true
  return false
}

export class GuiDriver {
  constructor(options = {}) {
    this.repositoryRoot = options.repositoryRoot || repositoryRoot
    this.cdp = null
    this.target = null
    this.startedChild = null
    this.gaps = []
    this.createdConversationIds = new Set()
    this.preferredPort = options.preferredPort ?? null
    this.instanceId = String(options.instanceId ?? '').trim()
    this.windowClaim = null
  }

  async attachOrStart(timeoutMs) {
    this.target = await findDesktopCdpTarget({ port: this.preferredPort })
    if (!this.target) {
      this.startedChild = spawn('npm', ['run', 'desktop:start'], {
        cwd: this.repositoryRoot,
        env: stripDesktopCredentialEnv({
          ...process.env,
          MILKSU_CHANNEL: 'stable',
        }),
        stdio: ['ignore', 'pipe', 'pipe'],
        detached: process.platform !== 'win32',
      })
      const deadline = Date.now() + timeoutMs
      while (Date.now() < deadline && !this.target) {
        if (this.startedChild.exitCode != null) {
          throw new Error(`desktop:start exited ${this.startedChild.exitCode}`)
        }
        await delay(1_000)
        this.target = await findDesktopCdpTarget({ port: this.preferredPort })
      }
    }
    if (!this.target) {
      this.gaps.push(
        '未能附着产品窗口：Electron 把 DevTools 绑在随机 127.0.0.1 端口，扫描超时。没有对外 Desktop RPC 套接字。',
      )
      return false
    }
    return this.bindRuntime()
  }

  async startFresh(options = {}) {
    const { keepExclusiveMilkSUWindow } = await import('./product-loop-windows.mjs')
    this.windowClaim = await keepExclusiveMilkSUWindow({ log: true })
    const before = new Set((await listDesktopCdpTargets()).map(desktopTargetKey))
    const instanceId = String(options.instanceId ?? this.instanceId ?? '').trim()
    if (!instanceId) throw new Error('startFresh requires MILKSU_INSTANCE_ID')
    this.instanceId = instanceId
    const extraArgs = options.buildRuntime ? [] : ['--', '--no-build']
    const childEnv = stripDesktopCredentialEnv({
      ...process.env,
      MILKSU_CHANNEL: 'stable',
      MILKSU_INSTANCE_ID: instanceId,
      MILKSU_ACCOUNT_API_URL: process.env.MILKSU_ACCOUNT_API_URL || 'https://accounts.milksu.org',
    })
    this.startedChild = spawn('npm', ['run', 'desktop:start', ...extraArgs], {
      cwd: this.repositoryRoot,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32',
    })
    const deadline = Date.now() + Number(options.timeoutMs || 240_000)
    while (Date.now() < deadline && !this.target) {
      if (this.startedChild.exitCode != null) {
        throw new Error(`desktop:start exited ${this.startedChild.exitCode}`)
      }
      await delay(1_000)
      this.target = await findDesktopCdpTarget({ excludeKeys: before })
    }
    if (!this.target) {
      this.gaps.push(
        '未能附着这次启动的产品窗口：独立实例的 DevTools 端口扫描超时。',
      )
      return false
    }
    this.preferredPort = this.target.port
    const bound = await this.bindRuntime()
    this.windowClaim = await keepExclusiveMilkSUWindow({ driver: this, log: true })
    if (!this.cdpAlive()) {
      this.gaps.push('独立窗口刚附着就被清窗关掉了')
      return false
    }
    return bound
  }

  async bindRuntime() {
    this.cdp = new CdpSession(this.target.webSocketDebuggerUrl)
    try {
      await this.cdp.open()
      const hasRuntime = await this.cdp.evaluate('Boolean(window.milksu && window.milksu.invoke)')
      if (!hasRuntime) {
        this.cdp.close()
        return false
      }
      await this.cdp.evaluate(`(() => {
        const loop = window.__milksuProductLoop || (window.__milksuProductLoop = { events: [], companionEvents: [] });
        loop.companionEvents = loop.companionEvents || [];
        if (!loop.engineBound) {
          window.milksu.onEvent('engine-event', value => {
            loop.events.push(value);
          });
          loop.engineBound = true;
        }
        if (!loop.companionBound) {
          window.milksu.onEvent('companion-event', value => {
            loop.companionEvents.push(value);
          });
          loop.companionBound = true;
        }
        return true;
      })()`)
      return true
    } catch (error) {
      this.gaps.push(error instanceof Error ? error.message : 'CDP WebSocket failed')
      this.cdp?.close()
      return false
    }
  }

  cdpAlive() {
    return Boolean(this.cdp && !this.cdp.closed && this.cdp.ws && this.cdp.ws.readyState === WebSocket.OPEN)
  }

  async ensureAttached() {
    if (this.cdpAlive() && this.target && isMainProductSurface(this.target)) return true
    if (this.cdpAlive() && this.target && isCompanionSurface(this.target)) {
      this.cdp.close()
    }
    const deadline = Date.now() + 8_000
    while (Date.now() <= deadline) {
      const targets = await listDesktopCdpTargets({ port: this.preferredPort })
      const ordered = [
        ...targets.filter(isMainProductSurface),
        ...(this.allowCompanionAttach ? targets.filter(isCompanionSurface) : []),
      ]
      for (const target of ordered) {
        this.target = target
        try {
          if (await this.bindRuntime()) return true
        } catch {
          this.cdp?.close()
        }
      }
      await delay(400)
    }
    this.gaps.push('未能附着产品窗口：Electron 把 DevTools 绑在随机 127.0.0.1 端口，扫描超时。没有对外 Desktop RPC 套接字。')
    return false
  }

  async invoke(method, args) {
    const encoded = JSON.stringify(args ?? [])
    const run = () => this.cdp.evaluate(
      `window.milksu.invoke(${JSON.stringify(method)}, ${encoded})`,
      true,
    )
    if (!await this.ensureAttached()) {
      throw new Error('CDP WebSocket closed')
    }
    try {
      return await run()
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      if (!/CDP WebSocket closed|CDP Runtime\.evaluate timed out/i.test(text)) throw error
      this.cdp.closed = true
      if (!await this.ensureAttached()) throw error
      return run()
    }
  }

  async drainCompanionEvents() {
    const run = () => this.cdp.evaluate(
      'window.__milksuProductLoop ? window.__milksuProductLoop.companionEvents.splice(0) : []',
    )
    if (!await this.ensureAttached()) {
      throw new Error('CDP WebSocket closed')
    }
    let raw
    try {
      raw = await run()
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      if (!/CDP WebSocket closed|CDP Runtime\.evaluate timed out/i.test(text)) throw error
      this.cdp.closed = true
      if (!await this.ensureAttached()) throw error
      raw = await run()
    }
    return Array.isArray(raw) ? raw : []
  }

  async clickCompanionConfirm() {
    // Prefer in-page evaluate on an already-open chat surface; do not raise OS focus.
    await this.invoke('ShowCompanionChatWindow', [{ focus: false }]).catch(() => {})
    const targets = await listDesktopCdpTargets({ port: this.preferredPort })
    for (const target of targets.filter(isCompanionSurface)) {
      const session = new CdpSession(target.webSocketDebuggerUrl)
      await session.open()
      try {
        const clicked = await session.evaluate(`(() => {
          const buttons = Array.from(document.querySelectorAll('button'))
          const confirm = buttons.find(node => /^(确认|Confirm)$/.test((node.textContent || '').trim()))
          if (!confirm) return false
          confirm.click()
          return true
        })()`)
        if (clicked) return true
      } finally {
        session.close()
      }
    }
    return false
  }

  async injectCompanionEventHook(session) {
    await session.evaluate(`(() => {
      const loop = window.__milksuProductLoop || (window.__milksuProductLoop = { events: [], companionEvents: [] });
      loop.companionEvents = loop.companionEvents || [];
      if (!loop.companionBound && window.milksu && window.milksu.onEvent) {
        window.milksu.onEvent('companion-event', value => {
          loop.companionEvents.push(value);
        });
        loop.companionBound = true;
      }
      return true;
    })()`)
  }

  async drainCompanionEventsFromSurfaces() {
    const events = [...await this.drainCompanionEvents()]
    if (!this.preferredPort) return events
    const targets = await listDesktopCdpTargets({ port: this.preferredPort }).catch(() => [])
    for (const target of targets.filter(isCompanionSurface)) {
      if (this.target && target.webSocketDebuggerUrl === this.target.webSocketDebuggerUrl) continue
      const session = new CdpSession(target.webSocketDebuggerUrl)
      await session.open()
      try {
        await this.injectCompanionEventHook(session)
        const batch = await session.evaluate(
          'window.__milksuProductLoop ? window.__milksuProductLoop.companionEvents.splice(0) : []',
        )
        if (Array.isArray(batch)) events.push(...batch)
      } catch {
        // Overlay may still be loading.
      } finally {
        session.close()
      }
    }
    return events
  }

  companionStatusPending(status) {
    const pending = status?.pendingConfirm || status?.PendingConfirm
    if (!pending || typeof pending !== 'object') return null
    const hostRequestId = String(pending.hostRequestId ?? pending.HostRequestID ?? pending.HostRequestId ?? '').trim()
    if (!hostRequestId) return null
    return {
      action: String(pending.action ?? pending.Action ?? 'stop'),
      conversationId: String(pending.conversationId ?? pending.ConversationID ?? pending.ConversationId ?? ''),
      text: String(pending.text ?? pending.Text ?? ''),
      idempotencyKey: String(pending.idempotencyKey ?? pending.IdempotencyKey ?? ''),
      mode: String(pending.mode ?? pending.Mode ?? ''),
      hostRequestId,
    }
  }

  async waitForCompanionTurn(timeoutMs, options = {}) {
    const collected = []
    const confirmed = []
    const rejected = []
    const seenConfirm = new Set()
    const started = Date.now()
    let overlaySweepAt = 0
    const autoConfirm = options.autoConfirm !== false
    const rejectConfirm = options.rejectConfirm === true
    const returnOnConfirm = options.returnOnConfirm === true
    // Confirm via Desktop RPC; do not ShowCompanionChatWindow / bringToFront.
    while (Date.now() - started < timeoutMs) {
      try {
        const now = Date.now()
        const batch = now - overlaySweepAt > 2_000
          ? await this.drainCompanionEventsFromSurfaces()
          : await this.drainCompanionEvents()
        if (now - overlaySweepAt > 2_000) overlaySweepAt = now
        collected.push(...batch)
        for (const event of batch) {
          const request = parseCompanionConfirm(event)
          if (!request?.hostRequestId || seenConfirm.has(request.hostRequestId)) continue
          if (!autoConfirm && !rejectConfirm) {
            seenConfirm.add(request.hostRequestId)
            confirmed.push(request)
            continue
          }
          const accepted = !rejectConfirm
          await this.confirmCompanionDispatch({
            action: request.action,
            conversationId: request.conversationId,
            text: request.text,
            idempotencyKey: request.idempotencyKey,
            mode: request.mode,
            hostRequestId: request.hostRequestId,
            accepted,
          })
          seenConfirm.add(request.hostRequestId)
          if (accepted) confirmed.push(request)
          else rejected.push(request)
        }
        const pending = this.companionStatusPending(await this.getCompanionStatus().catch(() => null))
        if (pending && !seenConfirm.has(pending.hostRequestId)) {
          if (!autoConfirm && !rejectConfirm) {
            seenConfirm.add(pending.hostRequestId)
            confirmed.push(pending)
          } else {
            const accepted = !rejectConfirm
            await this.confirmCompanionDispatch({ ...pending, accepted })
            seenConfirm.add(pending.hostRequestId)
            if (accepted) confirmed.push(pending)
            else rejected.push(pending)
          }
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        if (!/CDP WebSocket closed|CDP Runtime\.evaluate timed out/i.test(text)) throw error
        if (this.cdp) this.cdp.closed = true
        await this.ensureAttached()
        await delay(400)
        continue
      }
      if (returnOnConfirm && (confirmed.length > 0 || rejected.length > 0)) {
        return {
          events: collected,
          timeout: false,
          confirmed: confirmed.length,
          rejected: rejected.length,
          parked: true,
        }
      }
      const outcome = classifyTurnEvents(collected)
      if (outcome.sidecarStopped) {
        return {
          events: collected,
          timeout: false,
          confirmed: confirmed.length,
          rejected: rejected.length,
          sidecarStopped: true,
        }
      }
      if (outcome.settled || outcome.failed) {
        return {
          events: collected,
          timeout: false,
          confirmed: confirmed.length,
          rejected: rejected.length,
          failed: outcome.failed,
          error: outcome.error,
        }
      }
      if (autoConfirm && !rejectConfirm && confirmed.length === 0) {
        await this.clickCompanionConfirm().catch(() => false)
      }
      await delay(250)
    }
    return {
      events: collected,
      timeout: true,
      confirmed: confirmed.length,
      rejected: rejected.length,
      error: 'companion turn timed out',
    }
  }

  async drainEvents(conversationId) {
    const run = () => this.cdp.evaluate(
      'window.__milksuProductLoop ? window.__milksuProductLoop.events.splice(0) : []',
    )
    if (!await this.ensureAttached()) {
      throw new Error('CDP WebSocket closed')
    }
    let raw
    try {
      raw = await run()
    } catch (error) {
      const text = error instanceof Error ? error.message : String(error)
      if (!/CDP WebSocket closed|CDP Runtime\.evaluate timed out/i.test(text)) throw error
      this.cdp.closed = true
      if (!await this.ensureAttached()) throw error
      raw = await run()
    }
    const events = Array.isArray(raw) ? raw : []
    if (!conversationId) return events
    return events.filter(event => eventSessionId(event) === conversationId)
  }

  async waitForTurn(conversationId, timeoutMs) {
    const collected = []
    const started = Date.now()
    while (Date.now() - started < timeoutMs) {
      try {
        const batch = await this.drainEvents(conversationId)
        collected.push(...batch)
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error)
        if (!/CDP WebSocket closed|CDP Runtime\.evaluate timed out/i.test(text)) throw error
        if (this.cdp) this.cdp.closed = true
        await this.ensureAttached()
        await delay(400)
        continue
      }
      const outcome = classifyTurnEvents(collected)
      if (outcome.sidecarStopped) {
        return { events: collected, timeout: false, failed: false, sidecarStopped: true }
      }
      if (outcome.failed) {
        return { events: collected, timeout: false, failed: true, error: outcome.error }
      }
      if (outcome.settled) {
        const owned = collected.some(event => {
          const type = eventTypeOf(event)
          if (type !== 'assistant.settled' && type !== 'assistant.completed') return false
          return eventSessionId(event) === String(conversationId ?? '').trim()
        })
        if (owned) return { events: collected, timeout: false, failed: false }
      }
      await delay(250)
    }
    return { events: collected, timeout: true, failed: false, error: 'GUI turn timed out' }
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
      modelMode: options.modelMode,
      modelProvider: options.modelProvider,
      modelId: options.modelId,
      executionMode: options.executionMode || 'go',
      approvalPolicy: options.approvalPolicy || 'workspace-auto',
      multitask: options.multitask === true ? true : undefined,
      pinned: options.pinned === true ? true : undefined,
      pinnedOrder: Number.isFinite(Number(options.pinnedOrder))
        ? Number(options.pinnedOrder)
        : undefined,
      messages: [],
    }
    await this.invoke('SaveConversation', [conversation])
    this.createdConversationIds.add(conversation.id)
    return conversation
  }

  async listConversations() {
    const list = await this.invoke('ListConversations', [])
    return Array.isArray(list) ? list : []
  }

  async listArchivedConversations() {
    try {
      const list = await this.invoke('ListArchivedConversations', [])
      return Array.isArray(list) ? list : []
    } catch {
      return []
    }
  }

  async deleteConversation(id) {
    const conversationId = String(id ?? '').trim()
    if (!conversationId) return
    try {
      await this.invoke('DeleteConversation', [conversationId])
    } catch {
      // Already gone or the window detached.
    }
    this.createdConversationIds.delete(conversationId)
  }

  async deleteArchivedConversation(id) {
    const conversationId = String(id ?? '').trim()
    if (!conversationId) return
    try {
      await this.invoke('DeleteArchivedConversation', [conversationId])
    } catch {
      // Already gone or the window detached.
    }
    this.createdConversationIds.delete(conversationId)
  }

  async archiveConversation(id) {
    const conversationId = String(id ?? '').trim()
    if (!conversationId) return
    await this.invoke('ArchiveConversation', [conversationId])
  }

  async ensureCompanion() {
    return this.invoke('EnsureCompanion', [])
  }

  async sendCompanionMessage(prompt) {
    return this.invoke('SendCompanionMessage', [String(prompt ?? ''), []])
  }

  async abortCompanionTurn() {
    try {
      await this.invoke('AbortCompanionTurn', [])
    } catch {
      // Turn already settled.
    }
  }

  async stopCompanion() {
    try {
      await this.invoke('StopCompanion', [])
    } catch {
      // Sidecar already gone.
    }
  }

  async getCompanionStatus() {
    return this.invoke('GetCompanionStatus', [])
  }

  async getCompanionBoard() {
    return this.invoke('GetCompanionBoard', [])
  }

  async listCompanionTranscript(limit = 20) {
    return this.invoke('ListCompanionTranscript', [limit, null, true])
  }

  async getCompanionMemory() {
    return this.invoke('GetCompanionMemory', [])
  }

  async getCompanionShellStatus() {
    return this.invoke('GetCompanionShellStatus', [])
  }

  async confirmCompanionDispatch(options) {
    return this.invoke('ConfirmCompanionDispatch', [
      String(options.action ?? ''),
      String(options.conversationId ?? ''),
      String(options.text ?? ''),
      String(options.idempotencyKey ?? ''),
      String(options.mode ?? ''),
      String(options.hostRequestId ?? ''),
      options.accepted !== false,
    ])
  }

  async cleanupConversations() {
    const activeIds = new Set(this.createdConversationIds)
    const archivedIds = new Set()
    if (!this.cdpAlive() && !await this.ensureAttached()) return
    try {
      for (const item of await this.listConversations()) {
        if (isProductLoopFixtureConversation(item)) {
          activeIds.add(String(item.id ?? item.ID ?? ''))
        }
      }
      for (const item of await this.listArchivedConversations()) {
        if (isProductLoopFixtureConversation(item)) {
          archivedIds.add(String(item.id ?? item.ID ?? ''))
        }
      }
    } catch {
      // Keep tracked IDs if listing fails.
    }
    for (const id of activeIds) {
      if (id) await this.deleteConversation(id)
    }
    for (const id of archivedIds) {
      if (id) await this.deleteArchivedConversation(id)
    }
    this.createdConversationIds.clear()
  }

  async sendMessage(conversationId, prompt, workspacePath, options = {}) {
    return this.invoke('SendMessage', [
      conversationId,
      prompt,
      workspacePath,
      options.modelMode || (options.modelProvider ? 'manual' : ''),
      options.modelProvider || '',
      options.modelId || '',
      options.thinkingLevel || '',
      options.modelSourcePreference || 'auto',
      options.executionMode || 'go',
      options.approvalPolicy || 'workspace-auto',
      '',
      [],
      Array.isArray(options.attachments) ? options.attachments : [],
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
        if (provider?.has_api_key || provider?.hasApiKey) return 'settings-provider'
        if (String(provider?.APIKey || provider?.apiKey || '').trim()) return 'settings-provider'
      }
    } catch {
      // Settings unavailable.
    }
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

  async captureMainEvidence() {
    const target = (await listDesktopCdpTargets({ port: this.preferredPort })).find(isMainProductSurface)
    if (!target) return { buffer: null, caption: '' }
    return captureTargetEvidence(target)
  }

  async captureSurfaceEvidence(match) {
    const target = (await listDesktopCdpTargets({ port: this.preferredPort })).find(match)
    if (!target) return { buffer: null, caption: '' }
    return captureTargetEvidence(target)
  }

  async capturePagePng() {
    const shot = await this.captureMainEvidence()
    return shot.buffer || null
  }

  async captureSurfacePng(match) {
    const shot = await this.captureSurfaceEvidence(match)
    return shot.buffer || null
  }

  async close() {
    if (this.cdpAlive() || this.createdConversationIds.size) {
      await this.cleanupConversations().catch(() => {})
    }
    this.cdp?.close()
    this.cdp = null
    if (this.startedChild && this.startedChild.exitCode == null) {
      killProcessGroup(this.startedChild, 'SIGTERM')
      await waitForExit(this.startedChild, 8_000)
    }
    this.startedChild = null
  }
}
