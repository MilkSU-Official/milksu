import { spawn } from 'node:child_process'
import { createInterface } from 'node:readline'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, 'fixture')
const protocolOnly = process.argv.includes('--protocol-only')
const codexBinary = process.env.CODEX_BIN || 'codex'
const prompt = [
  'Solve the micro CTF described by CHALLENGE.md.',
  'You must read artifact.txt before making a claim.',
  'Do not access anything outside the current fixture directory.',
].join(' ')

function emit(type, data = {}) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    engine: 'codex-app-server',
    type,
    timestamp: new Date().toISOString(),
    ...data,
  })}\n`)
}

const child = spawn(codexBinary, ['app-server', '--stdio'], {
  cwd: fixture,
  stdio: ['pipe', 'pipe', 'inherit'],
})
const lines = createInterface({ input: child.stdout })
let threadId
let completed = false
let assistantText = ''

function send(value) {
  child.stdin.write(`${JSON.stringify(value)}\n`)
}

function stop(exitCode = 0) {
  if (completed) return
  completed = true
  clearTimeout(timeout)
  child.stdin.end()
  child.kill('SIGTERM')
  process.exitCode = exitCode
}

const timeout = setTimeout(() => {
  emit('turn.failed', { error: 'Codex app-server spike timed out' })
  stop(1)
}, 180_000)

child.on('error', error => {
  emit('engine.failed', { error: String(error) })
  stop(1)
})

child.on('exit', (code, signal) => {
  if (!completed) {
    emit('engine.stopped', { code, signal })
    stop(code === 0 ? 0 : 1)
  }
})

lines.on('line', line => {
  let message
  try {
    message = JSON.parse(line)
  } catch (error) {
    emit('engine.protocol_error', { error: String(error) })
    return
  }

  if (message.id === 0) {
    if (message.error) {
      emit('engine.failed', { error: message.error.message })
      stop(1)
      return
    }
    emit('engine.ready', {
      mode: protocolOnly ? 'protocol-only' : 'live',
      protocol: 'codex-app-server/jsonl',
      userAgent: message.result?.userAgent,
    })
    send({ method: 'initialized', params: {} })
    if (protocolOnly) {
      stop(0)
      return
    }
    send({
      method: 'thread/start',
      id: 1,
      params: {
        cwd: fixture,
        sandbox: 'read-only',
        approvalPolicy: 'never',
        ephemeral: true,
        ...(process.env.MILKSU_SPIKE_CODEX_MODEL
          ? { model: process.env.MILKSU_SPIKE_CODEX_MODEL }
          : {}),
      },
    })
    return
  }

  if (message.id === 1) {
    if (message.error) {
      emit('turn.failed', { error: message.error.message })
      stop(1)
      return
    }
    threadId = message.result?.thread?.id
    emit('session.started', { sessionId: threadId, cwd: fixture })
    send({
      method: 'turn/start',
      id: 2,
      params: {
        threadId,
        input: [{ type: 'text', text: prompt }],
      },
    })
    return
  }

  if (message.id === 2 && message.error) {
    emit('turn.failed', { error: message.error.message, sessionId: threadId })
    stop(1)
    return
  }

  if (message.method === 'turn/started') {
    emit('turn.started', { sessionId: threadId, turnId: message.params?.turn?.id })
    return
  }
  if (message.method === 'item/agentMessage/delta') {
    const delta = message.params?.delta ?? ''
    assistantText += delta
    emit('assistant.delta', { sessionId: threadId, text: delta })
    return
  }
  if (message.method === 'item/started' || message.method === 'item/completed') {
    const item = message.params?.item
    if (item?.type === 'commandExecution' || item?.type === 'mcpToolCall' || item?.type === 'dynamicToolCall') {
      emit(message.method === 'item/started' ? 'tool.started' : 'tool.completed', {
        sessionId: threadId,
        toolName: item.type,
        item,
      })
    }
    return
  }
  if (message.method === 'turn/completed') {
    const turn = message.params?.turn
    emit('assistant.completed', { sessionId: threadId, text: assistantText })
    emit('turn.completed', {
      sessionId: threadId,
      turnId: turn?.id,
      status: turn?.status,
      error: turn?.error?.message,
    })
    stop(turn?.status === 'completed' ? 0 : 1)
    return
  }

  // A future app-server may send a server-initiated request. The spike never
  // grants new authority; unknown requests are rejected instead of hanging.
  if (message.id !== undefined && message.method) {
    send({
      id: message.id,
      error: { code: -32601, message: `MilkSU M0 spike does not implement ${message.method}` },
    })
  }
})

send({
  method: 'initialize',
  id: 0,
  params: {
    clientInfo: {
      name: 'milksu_m0_spike',
      title: 'MilkSU M0 Engine Spike',
      version: '0.1.0',
    },
  },
})
