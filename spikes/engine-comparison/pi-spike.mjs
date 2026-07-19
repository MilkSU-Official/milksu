import {
  VERSION,
  createAgentSession,
  SessionManager,
} from '@earendil-works/pi-coding-agent'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const fixture = join(here, 'fixture')
const protocolOnly = process.argv.includes('--protocol-only')
const prompt = [
  'Solve the micro CTF described by CHALLENGE.md.',
  'You must read artifact.txt before making a claim.',
  'Do not access anything outside the current fixture directory.',
].join(' ')

function emit(type, data = {}) {
  process.stdout.write(`${JSON.stringify({
    schemaVersion: 1,
    engine: 'pi',
    type,
    timestamp: new Date().toISOString(),
    ...data,
  })}\n`)
}

function textContent(message) {
  if (!Array.isArray(message?.content)) return ''
  return message.content
    .filter(item => item.type === 'text')
    .map(item => item.text)
    .join('')
}

emit('engine.ready', {
  version: VERSION,
  mode: protocolOnly ? 'protocol-only' : 'live',
  protocol: 'milksu-engine-events/v1alpha1',
})

if (protocolOnly) process.exit(0)

let session
try {
  const result = await createAgentSession({
    cwd: fixture,
    sessionManager: SessionManager.inMemory(),
    tools: ['read'],
  })
  session = result.session

  const provider = process.env.MILKSU_SPIKE_PROVIDER
  const model = process.env.MILKSU_SPIKE_MODEL
  if (provider && model) {
    const selected = session.modelRegistry.find(provider, model)
    if (!selected) throw new Error(`Pi model not found: ${provider}/${model}`)
    await session.setModel(selected)
  }
  if (!session.model) {
    throw new Error('Pi has no active model; log in with Pi or set MILKSU_SPIKE_PROVIDER and MILKSU_SPIKE_MODEL')
  }

  session.subscribe(event => {
    if (event.type === 'message_update' && event.assistantMessageEvent?.type === 'text_delta') {
      emit('assistant.delta', { text: event.assistantMessageEvent.delta })
      return
    }
    if (event.type === 'tool_execution_start') {
      emit('tool.started', { toolName: event.toolName })
      return
    }
    if (event.type === 'tool_execution_end') {
      emit('tool.completed', {
        toolName: event.toolName,
        isError: event.isError,
      })
      return
    }
    if (event.type === 'message_end' && event.message?.role === 'assistant') {
      emit('assistant.completed', { text: textContent(event.message) })
    }
  })

  emit('turn.started', {
    provider: session.model.provider,
    model: session.model.id,
    cwd: fixture,
  })
  await session.prompt(prompt)
  emit('turn.completed', { status: 'completed' })
} catch (error) {
  emit('turn.failed', { error: String(error) })
  process.exitCode = 1
} finally {
  session?.dispose()
}
