import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'
import test from 'node:test'
import type { AppSettings } from '../config/settings-store.ts'
import { MODEL_SOURCE_ACCOUNT } from '../config/settings-store.ts'
import '../domains/companion.ts'
import { handleOwnedMethod, isOwnedMethod, type HandlerContext } from '../handlers.ts'
import { CompanionRuntime } from './runtime.ts'
import type { CompanionSidecarProcess } from './sidecar.ts'

const FAKE_SIDECAR = `
import readline from 'node:readline'
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', (line) => {
  let command
  try { command = JSON.parse(line) } catch { return }
  if (command.action === 'create_session') {
    process.stdout.write(JSON.stringify({ type: 'ready' }) + '\\n')
  }
  if (command.action === 'shutdown') {
    process.exit(0)
  }
})
`

function testSettings(): AppSettings {
  return {
    companion_provider: 'tokenflux',
    companion_model: 'deepseek/deepseek-flash',
    companion_source: MODEL_SOURCE_ACCOUNT,
    relay: { enabled: true, key: 'test-relay', url: 'https://tokenflux.dev/v1' },
    providers: {},
  }
}

async function startFakeSidecar(onLine: (value: unknown) => void): Promise<CompanionSidecarProcess> {
  const dir = await mkdtemp(join(tmpdir(), 'milksu-companion-fake-'))
  const script = join(dir, 'fake-sidecar.mjs')
  await writeFile(script, FAKE_SIDECAR, { mode: 0o700 })
  const child = spawn(process.execPath, [script], { stdio: ['pipe', 'pipe', 'pipe'] })
  child.stderr.pipe(process.stderr)
  const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
  lines.on('line', (line) => {
    try {
      onLine(JSON.parse(line))
    } catch {
      onLine({ type: 'error', error: 'fake sidecar protocol error' })
    }
  })
  let writeChain = Promise.resolve()
  return {
    child: child as CompanionSidecarProcess['child'],
    stderrText() { return '' },
    write(command) {
      const encoded = `${JSON.stringify(command)}\n`
      writeChain = writeChain.then(
        () => new Promise<void>((resolve, reject) => {
          child.stdin.write(encoded, (error) => {
            if (error) reject(error)
            else resolve()
          })
        }),
      )
      return writeChain
    },
    async kill() {
      if (child.exitCode !== null) return
      try {
        child.stdin.write(`${JSON.stringify({ action: 'shutdown' })}\n`)
        child.stdin.end()
      } catch {
        // already closed
      }
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 800)),
      ])
      if (child.exitCode === null) {
        try { child.kill('SIGKILL') } catch { /* ignore */ }
      }
    },
  }
}

test('EnsureCompanion starts a fake sidecar and StopCompanion shuts it down', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-companion-home-'))
  const agentDir = join(home, 'data', 'agent', 'home', 'companion')
  await mkdir(agentDir, { recursive: true, mode: 0o700 })
  const runtime = new CompanionRuntime({
    home,
    agentDir,
    statePath: join(home, 'data', 'companion', 'state.json'),
    settings: testSettings,
    start: ({ onLine }) => startFakeSidecar(onLine),
  })
  const ctx = {
    companion: runtime,
    home,
    emit: () => {},
    invokeHelper: async () => {
      throw new Error('helper should not see companion RPCs')
    },
  } as unknown as HandlerContext

  assert.equal(isOwnedMethod('EnsureCompanion'), true)
  assert.equal(isOwnedMethod('StopCompanion'), true)
  const status = await handleOwnedMethod(ctx, 'renderer', 'EnsureCompanion', []) as { ready: boolean }
  assert.equal(status.ready, true)
  assert.ok(runtime.status().ready)
  await handleOwnedMethod(ctx, 'renderer', 'StopCompanion', [])
  assert.equal(runtime.status().ready, false)
})

test('AbortCompanionTurn without a sidecar does not fail', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-companion-abort-'))
  const runtime = new CompanionRuntime({
    home,
    agentDir: join(home, 'companion-agent'),
    statePath: join(home, 'state.json'),
    settings: testSettings,
  })
  await runtime.abortTurn()
  assert.equal(runtime.status().ready, false)
})
