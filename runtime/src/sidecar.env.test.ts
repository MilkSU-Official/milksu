import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import readline from 'node:readline'
import test from 'node:test'
import { readPublicSettings, stripSecrets } from './settings.ts'
import { resolveHomeRoot } from './home.ts'
import {
  buildSidecarEnvironment,
  loadSidecarProviderEnvironment,
  spawnNodeEnvironment,
} from './sidecar.ts'

const FAKE_KEY = 'fake-runtime-secret'

test('spawnNodeEnvironment sets ELECTRON_RUN_AS_NODE unless the binary is named node', () => {
  const base = { PATH: '/usr/bin', HOME: '/tmp' }
  const asNode = spawnNodeEnvironment('/usr/local/bin/node', base)
  assert.equal(asNode, base)
  assert.equal(asNode.ELECTRON_RUN_AS_NODE, undefined)

  const windowsNode = spawnNodeEnvironment('D:/nodejs/node.exe', { ...base })
  assert.equal(windowsNode.ELECTRON_RUN_AS_NODE, undefined)

  const electron = spawnNodeEnvironment('/Applications/MilkSU.app/Contents/MacOS/MilkSU', { ...base })
  assert.equal(electron.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(electron.PATH, '/usr/bin')
  assert.equal(base.ELECTRON_RUN_AS_NODE, undefined)
})

test('readPublicSettings strips api_key and relay key fields', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-settings-'))
  await mkdir(join(home, 'config'), { recursive: true })
  await writeFile(join(home, 'config', 'settings.json'), JSON.stringify({
    active_provider: 'deepseek',
    providers: { deepseek: { api_key: 'should-not-leak', has_api_key: true, enabled: true } },
    relay: { enabled: true, key: 'relay-secret', has_key: true },
  }))
  const settings = await readPublicSettings(home)
  const providers = settings.providers as Record<string, Record<string, unknown>>
  assert.equal(providers.deepseek.api_key, undefined)
  assert.equal(providers.deepseek.has_api_key, true)
  const relay = settings.relay as Record<string, unknown>
  assert.equal(relay.key, undefined)
  assert.equal(relay.has_key, true)
})

test('sidecar env copies process provider keys and does not read settings.json secrets', () => {
  const home = join(tmpdir(), 'milksu-home-unused')
  const env = buildSidecarEnvironment({
    home,
    workspace: tmpdir(),
    kernel: 'pi',
    settings: stripSecrets({
      providers: { deepseek: { api_key: 'from-file', has_api_key: true, enabled: true } },
    }) as Record<string, unknown>,
    traceId: 'trc_11111111-1111-4111-8111-111111111111',
    env: {
      PATH: '/usr/bin',
      DEEPSEEK_API_KEY: 'from-process',
      HOME: '/tmp',
    },
  })
  assert.equal(env.DEEPSEEK_API_KEY, 'from-process')
  assert.notEqual(env.DEEPSEEK_API_KEY, 'from-file')
  assert.equal(env.MILKSU_TRACE_ID, 'trc_11111111-1111-4111-8111-111111111111')
  assert.notEqual(env.HOME, '/tmp')
})

test('sidecar env merges provider env over process env; settings.json still has no key', () => {
  const home = join(tmpdir(), 'milksu-home-unused')
  const settings = stripSecrets({
    providers: { deepseek: { api_key: 'from-file', has_api_key: true, enabled: true } },
  }) as Record<string, unknown>
  const env = buildSidecarEnvironment({
    home,
    workspace: tmpdir(),
    kernel: 'pi',
    settings,
    traceId: 'trc_11111111-1111-4111-8111-111111111111',
    env: {
      PATH: '/usr/bin',
      DEEPSEEK_API_KEY: 'from-process',
      HOME: '/tmp',
    },
    sidecarProviderEnv: [
      'DEEPSEEK_API_KEY=from-provider-env',
      'HOME=/Users/leaked',
      'MILKSU_MODEL_SOURCE_ORDER=personal',
    ],
  })
  assert.equal(env.DEEPSEEK_API_KEY, 'from-provider-env')
  assert.notEqual(env.DEEPSEEK_API_KEY, 'from-file')
  assert.notEqual(env.DEEPSEEK_API_KEY, 'from-process')
  assert.equal(env.MILKSU_MODEL_SOURCE_ORDER, 'personal')
  assert.notEqual(env.HOME, '/tmp')
  assert.notEqual(env.HOME, '/Users/leaked')
  assert.equal(
    JSON.stringify(settings).includes('from-file') || JSON.stringify(settings).includes('from-provider-env'),
    false,
  )
})

test('loadSidecarProviderEnvironment invokes ExportSidecarEnvironment as electron_host', async () => {
  let seen: { source?: string, method?: string } | undefined
  const env = await loadSidecarProviderEnvironment(async (message) => {
    seen = message
    return [`DEEPSEEK_API_KEY=${FAKE_KEY}`]
  })
  assert.equal(seen?.source, 'electron_host')
  assert.equal(seen?.method, 'ExportSidecarEnvironment')
  assert.equal(env.DEEPSEEK_API_KEY, FAKE_KEY)
})

test('fake runtime JSONL stdout/stderr capture does not contain provider key', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-runtime-env-'))
  const runtimePath = join(home, 'fake-runtime.cjs')
  await writeFile(runtimePath, `'use strict'
const readline = require('node:readline')
process.stderr.write('runtime-boot\\n')
process.stdout.write(JSON.stringify({ type: 'ready' }) + '\\n')
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', (line) => {
  let message
  try { message = JSON.parse(line) } catch { return }
  if (message.type === 'shutdown') {
    process.exit(0)
    return
  }
  if (message.type !== 'invoke') return
  if (message.source !== 'electron_host' || message.method !== 'ExportSidecarEnvironment') {
    process.stdout.write(JSON.stringify({
      type: 'result',
      id: message.id,
      error: 'desktop method ' + message.method + ' is unavailable to ' + message.source,
    }) + '\\n')
    return
  }
  process.stdout.write(JSON.stringify({
    type: 'result',
    id: message.id,
    result: ['DEEPSEEK_API_KEY=${FAKE_KEY}'],
  }) + '\\n')
})
`)

  const child = spawn(process.execPath, [runtimePath], {
    stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, HOME: home },
  })
  const childStderr: string[] = []
  child.stderr.on('data', (chunk) => childStderr.push(String(chunk)))
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  const waitLine = (predicate: (value: Record<string, unknown>) => boolean) => new Promise<Record<string, unknown>>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('timed out waiting for runtime line')), 5000)
    const onLine = (line: string) => {
      let message: Record<string, unknown>
      try { message = JSON.parse(line) as Record<string, unknown> } catch { return }
      if (!predicate(message)) return
      clearTimeout(timer)
      lines.off('line', onLine)
      resolve(message)
    }
    lines.on('line', onLine)
  })

  const captured: string[] = []
  const wrap = (stream: NodeJS.WriteStream) => {
    const original = stream.write.bind(stream)
    stream.write = ((chunk: unknown, encoding?: unknown, callback?: unknown) => {
      captured.push(String(chunk))
      return original(chunk as string | Uint8Array, encoding as BufferEncoding, callback as () => void)
    }) as typeof stream.write
    return original
  }
  const stdoutWrite = wrap(process.stdout)
  const stderrWrite = wrap(process.stderr)
  try {
    await waitLine((message) => message.type === 'ready')
    const sidecarProviderEnv = await loadSidecarProviderEnvironment(async (message) => {
      child.stdin.write(`${JSON.stringify(message)}\n`)
      const response = await waitLine((value) => value.type === 'result' && value.id === message.id)
      if (response.error) throw new Error(String(response.error))
      return response.result ?? null
    })
    const env = buildSidecarEnvironment({
      home,
      workspace: tmpdir(),
      kernel: 'pi',
      settings: stripSecrets({
        providers: { deepseek: { api_key: 'from-file', has_api_key: true, enabled: true } },
      }) as Record<string, unknown>,
      traceId: 'trc_11111111-1111-4111-8111-111111111111',
      env: { PATH: '/usr/bin' },
      sidecarProviderEnv,
    })
    assert.equal(env.DEEPSEEK_API_KEY, FAKE_KEY)
    const publicSettings = await readPublicSettings(home)
    assert.equal(JSON.stringify(publicSettings).includes(FAKE_KEY), false)
    assert.equal(captured.join('').includes(FAKE_KEY), false)
    assert.equal(childStderr.join('').includes(FAKE_KEY), false)
  } finally {
    process.stdout.write = stdoutWrite
    process.stderr.write = stderrWrite
    child.kill('SIGTERM')
  }
})

test('resolveHomeRoot prefers MILKSU_HOME over MILKSU_APPDATA_DIR', () => {
  const preferred = process.platform === 'win32' ? 'D:\\abs\\milksu-home' : '/abs/milksu-home'
  const fallback = process.platform === 'win32' ? 'D:\\abs\\appdata' : '/abs/appdata'
  const userHome = process.platform === 'win32' ? 'C:\\Users\\nobody' : '/Users/nobody'
  const home = resolveHomeRoot({
    MILKSU_HOME: preferred,
    MILKSU_APPDATA_DIR: fallback,
    HOME: userHome,
  }, userHome)
  assert.equal(home, resolve(preferred))
  assert.notEqual(home, resolve(fallback))
})
