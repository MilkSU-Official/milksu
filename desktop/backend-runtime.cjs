'use strict'

const readline = require('node:readline')

const METHOD_PATTERN = /^[A-Z][A-Za-z0-9]{0,80}$/u
const MAX_BACKEND_MESSAGE_BYTES = 128 << 20
const BACKEND_INVOKE_SOURCE_RENDERER = 'renderer'
const BACKEND_INVOKE_SOURCE_ELECTRON_HOST = 'electron_host'
// The runtime's stdout is a first-party JSON protocol, so a stray non-JSON
// line is logged and skipped instead of failing every pending invocation.
// Only a stream that is clearly not speaking the protocol at all fails the
// generation; the desktop↔runtime channel has no third-party logger on it,
// but the same one-diagnostic-must-not-be-fatal rule applies.
const MALFORMED_BACKEND_LINE_LIMIT = 32
const BACKEND_DIAGNOSTIC_LINE_LIMIT = 512

function renderBackendDiagnosticLine(line) {
  const redacted = String(line)
    .replace(/(?:sk[-_]|gsk_|aiza|nss_agent_)[a-z0-9._-]{8,}/gi, '[REDACTED]')
    .replace(/(bearer\s+)[a-z0-9._~+/=-]{8,}/gi, '$1[REDACTED]')
    .replace(/\b(api[_ -]?key|key|token|secret|password)\s*[:=]\s*[^\s,;]+/gi, '$1=[REDACTED]')
    .replace(/([?&](?:api[_-]?key|key|token|secret|password)=)[^&#\s]+/gi, '$1[REDACTED]')
  const characters = [...redacted]
  const bounded = characters.length > BACKEND_DIAGNOSTIC_LINE_LIMIT
    ? characters.slice(0, BACKEND_DIAGNOSTIC_LINE_LIMIT).join('') + '…[truncated]'
    : redacted
  return JSON.stringify(bounded)
}

function isClosedPipeError(error) {
  return error?.code === 'EPIPE' || error?.code === 'ERR_STREAM_DESTROYED'
}

function runtimeUserError(code) {
  if (code === 'starting') return new Error('运行时正在启动，请稍候。')
  if (code === 'recovering') return new Error('正在恢复运行时。')
  if (code === 'stale') return new Error('正在恢复运行时。')
  if (code === 'exited') return new Error('本地运行时已停止，请重新打开应用。')
  return new Error('本地运行时已停止，请重新打开应用。')
}

class BackendRuntime {
  constructor({
    spawnProcess,
    hostHandler,
    eventHandler,
    recoverDelayMs = 400,
    maxRecoveries = 3,
    readyTimeoutMs = 20_000,
  }) {
    if (typeof spawnProcess !== 'function') {
      throw new Error('BackendRuntime requires spawnProcess')
    }
    this.spawnProcess = spawnProcess
    this.hostHandler = hostHandler
    this.eventHandler = typeof eventHandler === 'function' ? eventHandler : () => {}
    this.recoverDelayMs = recoverDelayMs
    this.maxRecoveries = maxRecoveries
    this.readyTimeoutMs = readyTimeoutMs
    this.pending = new Map()
    this.nextID = 0
    this.generation = 0
    this.recoverCount = 0
    this.malformedLines = 0
    this.stopping = false
    this.recovering = false
    this.state = 'starting'
    this.process = null
    this.readyPromise = Promise.resolve()
    this.resolveReady = () => {}
    this.rejectReady = () => {}
    this.spawn()
  }

  emitStatus(state, extra = {}) {
    this.eventHandler('runtime.status', {
      state,
      generation: this.generation,
      ...extra,
    })
  }

  spawn() {
    this.generation += 1
    const generation = this.generation
    this.state = 'starting'
    this.malformedLines = 0
    this.readyPromise = new Promise((resolve, reject) => {
      this.resolveReady = resolve
      this.rejectReady = reject
    })
    this.readyPromise.catch(() => {})
    const child = this.spawnProcess()
    this.process = child
    child.once('error', error => {
      if (generation !== this.generation) return
      this.failGeneration(generation, error)
    })
    child.stdin?.on?.('error', error => {
      if (this.stopping && isClosedPipeError(error)) return
      if (generation !== this.generation) return
      this.failGeneration(generation, error)
    })
    child.once('exit', (code, signal) => {
      if (generation !== this.generation) return
      if (this.stopping) {
        this.state = 'exited'
        this.failGeneration(generation, runtimeUserError('exited'))
        this.emitStatus('exited', { code, signal })
        return
      }
      this.failGeneration(generation, runtimeUserError('recovering'))
      void this.recover(generation)
    })
    const lines = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    })
    lines.on('line', line => {
      if (generation !== this.generation) return
      if (Buffer.byteLength(line) > MAX_BACKEND_MESSAGE_BYTES) {
        this.failGeneration(generation, new Error('本地运行时消息过长。'))
        return
      }
      this.handleLine(line, generation)
    })
    this.emitStatus('starting')
  }

  async recover(fromGeneration) {
    if (this.stopping || this.recovering || fromGeneration !== this.generation) return
    this.recovering = true
    this.recoverCount += 1
    if (this.recoverCount > this.maxRecoveries) {
      this.recovering = false
      this.state = 'exited'
      this.emitStatus('exited', { recoveries: this.recoverCount })
      return
    }
    this.state = 'starting'
    this.emitStatus('recovering', { recoveries: this.recoverCount })
    await new Promise(resolve => setTimeout(resolve, this.recoverDelayMs))
    if (this.stopping || fromGeneration !== this.generation) {
      this.recovering = false
      return
    }
    this.spawn()
    this.recovering = false
  }

  handleLine(line, generation) {
    if (!line.trim()) {
      // A blank separator line is noise, not protocol corruption.
      return
    }
    let message
    try {
      message = JSON.parse(line)
    } catch {
      this.malformedLines += 1
      const rendered = renderBackendDiagnosticLine(line)
      if (
        this.malformedLines <= 4
        || this.malformedLines === MALFORMED_BACKEND_LINE_LIMIT
        || this.malformedLines % 128 === 0
      ) {
        console.error(
          `[backend-runtime] runtime emitted a non-JSON stdout line (generation=${generation}, consecutive=${this.malformedLines}, bytes=${Buffer.byteLength(line)}): ${rendered}`,
        )
      }
      if (this.malformedLines === MALFORMED_BACKEND_LINE_LIMIT) {
        this.failGeneration(generation, new Error(
          `本地运行时连续输出了 ${MALFORMED_BACKEND_LINE_LIMIT} 行无法解析的消息。`,
        ))
      }
      return
    }
    this.malformedLines = 0
    if (message.type === 'ready') {
      if (generation !== this.generation) return
      this.state = 'ready'
      this.recoverCount = 0
      this.resolveReady()
      this.emitStatus('ready')
      return
    }
    if (message.type === 'result') {
      const pending = this.pending.get(message.id)
      if (!pending || pending.generation !== generation) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error))
      else pending.resolve(message.result)
      return
    }
    if (message.type === 'event') {
      this.eventHandler(message.event, message.payload)
      return
    }
    if (message.type === 'host_request') {
      void this.handleHostRequest(message, generation)
    }
  }

  async handleHostRequest(message, generation) {
    try {
      const result = await this.hostHandler(message.method, message.payload)
      this.send({ type: 'host_response', id: message.id, result: result ?? null }, { generation })
    } catch (error) {
      this.send({
        type: 'host_response',
        id: message.id,
        error: error.message,
      }, { generation, allowClosed: true })
    }
  }

  send(message, { allowClosed = false, generation = this.generation } = {}) {
    if (generation !== this.generation && !allowClosed) return false
    if (this.stopping && !allowClosed) return false
    const stdin = this.process?.stdin
    if (!stdin || stdin.destroyed || !stdin.writable) {
      if (allowClosed) return false
      throw runtimeUserError(this.state === 'starting' ? 'starting' : 'exited')
    }
    try {
      return stdin.write(`${JSON.stringify(message)}\n`)
    } catch (error) {
      if (allowClosed && isClosedPipeError(error)) return false
      throw error
    }
  }

  async ensureReady() {
    if (this.stopping || this.state === 'exited') {
      throw runtimeUserError('exited')
    }
    if (this.state === 'ready') return
    let timeout
    try {
      await Promise.race([
        this.readyPromise,
        new Promise((_, reject) => {
          timeout = setTimeout(() => reject(runtimeUserError('starting')), this.readyTimeoutMs)
        }),
      ])
    } finally {
      if (timeout) clearTimeout(timeout)
    }
    if (this.state !== 'ready') {
      throw runtimeUserError(this.state === 'exited' ? 'exited' : 'starting')
    }
  }

  async ready() {
    return this.ensureReady()
  }

  invoke(method, args) {
    return this.invokeFromRenderer(method, args)
  }

  invokeFromRenderer(method, args) {
    return this.invokeWithSource(BACKEND_INVOKE_SOURCE_RENDERER, method, args)
  }

  invokeFromElectronHost(method, args) {
    return this.invokeWithSource(BACKEND_INVOKE_SOURCE_ELECTRON_HOST, method, args)
  }

  async invokeWithSource(source, method, args) {
    if (!METHOD_PATTERN.test(method) || !Array.isArray(args)) {
      return Promise.reject(new Error('invalid desktop invocation'))
    }
    if (source !== BACKEND_INVOKE_SOURCE_RENDERER && source !== BACKEND_INVOKE_SOURCE_ELECTRON_HOST) {
      return Promise.reject(new Error('invalid desktop invocation source'))
    }
    await this.ensureReady()
    const generation = this.generation
    const id = `invoke-${++this.nextID}`
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, generation })
      try {
        this.send({ type: 'invoke', id, source, method, args, generation }, { generation })
      } catch (error) {
        this.pending.delete(id)
        reject(error)
      }
    })
  }

  failGeneration(generation, error) {
    if (generation === this.generation) {
      this.rejectReady(error)
    }
    for (const [id, pending] of this.pending) {
      if (pending.generation !== generation) continue
      this.pending.delete(id)
      pending.reject(error)
    }
  }

  beginStop() {
    this.stopping = true
  }

  async stop({
    gracefulMs = 2000,
    termMs = 500,
  } = {}) {
    this.beginStop()
    if (!this.process || this.process.exitCode !== null) return
    this.send({ type: 'shutdown' }, { allowClosed: true })
    await Promise.race([
      new Promise(resolve => this.process.once('exit', resolve)),
      new Promise(resolve => setTimeout(resolve, gracefulMs)),
    ])
    if (this.process.exitCode === null) {
      try { this.process.kill('SIGTERM') } catch {}
      await Promise.race([
        new Promise(resolve => this.process.once('exit', resolve)),
        new Promise(resolve => setTimeout(resolve, termMs)),
      ])
    }
    if (this.process.exitCode === null) {
      try { this.process.kill('SIGKILL') } catch {}
    }
  }
}

module.exports = {
  BackendRuntime,
  runtimeUserError,
  METHOD_PATTERN,
  MAX_BACKEND_MESSAGE_BYTES,
  MALFORMED_BACKEND_LINE_LIMIT,
  renderBackendDiagnosticLine,
  BACKEND_INVOKE_SOURCE_RENDERER,
  BACKEND_INVOKE_SOURCE_ELECTRON_HOST,
}
