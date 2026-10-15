import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import readline from 'node:readline'
import test from 'node:test'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { AppSettings } from '../config/settings-store.ts'
import { ConversationStore } from '../conversations.ts'
import { Engine, type StartSidecar } from '../engine.ts'
import { handleOwnedMethod, isOwnedMethod, type HandlerContext } from '../handlers.ts'
import { LabJobStore } from '../lab.ts'
import { ResearchService } from '../research/service.ts'
import type { SidecarProcess } from '../sidecar.ts'
import './agent-control.ts'
import { inspectDestructiveTarget } from './agent-control.ts'

const execFileAsync = promisify(execFile)

const FAKE_SIDECAR = `
import readline from 'node:readline'
const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity })
lines.on('line', (line) => {
  let command
  try { command = JSON.parse(line) } catch { return }
  if (command.action === 'shutdown') {
    process.exit(0)
    return
  }
  const id = command.conversationId ?? null
  const requestId = command.requestId
  if (command.action === 'send_message') {
    process.stdout.write(JSON.stringify({
      type: 'workspace_action',
      id,
      action: 'env_status',
      requestId: 'wa-env',
    }) + '\\n')
    return
  }
  if (command.action === 'list_commands') {
    process.stdout.write(JSON.stringify({
      type: 'dsh_commands',
      id,
      requestId,
      commands: [{ name: 'help', description: 'Show help' }],
    }) + '\\n')
    return
  }
  if (command.action === 'execute_command') {
    process.stdout.write(JSON.stringify({
      type: 'dsh_command',
      id,
      requestId,
      command: { name: 'help', text: command.line, executed: true },
    }) + '\\n')
    return
  }
  if (command.action === 'set_plan_mode') {
    process.stdout.write(JSON.stringify({
      type: 'dsh_command',
      id,
      requestId,
      command: { name: 'plan' },
      planMode: { active: command.active === true },
    }) + '\\n')
    return
  }
  if (command.action === 'control_goal') {
    process.stdout.write(JSON.stringify({
      type: 'dsh_command',
      id,
      requestId,
      command: { name: 'goal', text: command.goalAction },
    }) + '\\n')
    return
  }
  if (command.action === 'kill_job') {
    process.stdout.write(JSON.stringify({
      type: 'dsh_job_killed',
      id,
      requestId,
      jobId: command.jobId,
    }) + '\\n')
  }
})
`

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'milksu-agent-control-'))
}

async function startFakeSidecar(
  onLine: (value: unknown) => void,
  recorded: Record<string, unknown>[],
): Promise<SidecarProcess> {
  const dir = await mkdtemp(join(tmpdir(), 'milksu-agent-fake-'))
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
  const proc: SidecarProcess = {
    kernel: 'dsh',
    workspace: dir,
    child: child as SidecarProcess['child'],
    write(command) {
      recorded.push(command)
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
  return proc
}

async function stubStores(home: string) {
  const conversations = await ConversationStore.open(home)
  const labJobs = await LabJobStore.open(home)
  const research = ResearchService.open(join(home, 'data'))
  return { conversations, labJobs, research }
}

function stubSettings(command?: string): { get(): AppSettings; exportSidecarEnvironment(): string[] } {
  return {
    get: () => (command ? { acp_agent: { command } } : {}),
    exportSidecarEnvironment: () => [],
  }
}

test('owned Agent control methods are registered', () => {
  for (const method of [
    'RelaunchDesktopApp',
    'ListDshCommands',
    'ExecuteDshCommand',
    'SetDshPlanMode',
    'ControlDshGoal',
    'KillDshJob',
    'InspectDestructiveTarget',
  ]) {
    assert.equal(isOwnedMethod(method), true, method)
  }
})

test('RelaunchDesktopApp uses host_request app.relaunch', async () => {
  const calls: Array<{ method: string; payload?: unknown }> = []
  const ctx = {
    home: await tempHome(),
    emit: () => {},
    hostCall: async (method: string, payload?: unknown) => {
      calls.push({ method, payload })
      return true
    },
  } as unknown as HandlerContext
  const started = await handleOwnedMethod(ctx, 'renderer', 'RelaunchDesktopApp', [])
  assert.equal(started, true)
  assert.deepEqual(calls, [{ method: 'app.relaunch', payload: null }])
})

test('InspectDestructiveTarget measures paths and rejects relative ones', async () => {
  await assert.rejects(
    () => inspectDestructiveTarget('relative/path'),
    /absolute path is required/,
  )
  const missing = await inspectDestructiveTarget(join(await tempHome(), 'not-there'))
  assert.equal(missing.status, 'missing')
  assert.equal(missing.exists, false)

  const empty = await mkdtemp(join(tmpdir(), 'milksu-inspect-empty-'))
  const emptyResult = await inspectDestructiveTarget(empty)
  assert.equal(emptyResult.status, 'ok')
  assert.equal(emptyResult.emptyDirectory, true)

  const dir = await mkdtemp(join(tmpdir(), 'milksu-inspect-dir-'))
  await writeFile(join(dir, 'file.txt'), '1234567890')
  const counted = await inspectDestructiveTarget(dir)
  assert.equal(counted.status, 'ok')
  assert.equal(counted.isDirectory, true)
  assert.equal(counted.emptyDirectory, false)
  assert.ok(counted.fileCount >= 2)
  assert.ok(counted.totalBytes > 0)
  assert.equal(counted.sampled, false)

  const target = join(dir, 'MilkSU Beta Test.app')
  const backup = join(dir, '.MilkSU Beta Test.app.bak-20260914-112838')
  await mkdir(target)
  await mkdir(backup)
  const withBackup = await inspectDestructiveTarget(target)
  assert.deepEqual(withBackup.backups, [backup])
  assert.equal(withBackup.rebuildable, true)
})

test('InspectDestructiveTarget reports git tracking when git is available', async (t) => {
  try {
    await execFileAsync('git', ['--version'])
  } catch {
    t.skip('git is not installed')
    return
  }
  const repo = await mkdtemp(join(tmpdir(), 'milksu-inspect-git-'))
  const run = async (...args: string[]) => {
    await execFileAsync('git', args, {
      cwd: repo,
      env: {
        ...process.env,
        GIT_AUTHOR_NAME: 't',
        GIT_AUTHOR_EMAIL: 't@t',
        GIT_COMMITTER_NAME: 't',
        GIT_COMMITTER_EMAIL: 't@t',
      },
    })
  }
  await run('-c', 'commit.gpgsign=false', 'init', '-q')
  const tracked = join(repo, 'tracked.txt')
  const untracked = join(repo, 'untracked.txt')
  await writeFile(tracked, 'a')
  await writeFile(untracked, 'b')
  await run('-c', 'commit.gpgsign=false', 'add', 'tracked.txt')
  await run('-c', 'commit.gpgsign=false', 'commit', '-q', '-m', 'init')
  const trackedResult = await inspectDestructiveTarget(tracked)
  assert.equal(trackedResult.inGitRepository, true)
  assert.equal(trackedResult.gitTracked, true)
  assert.equal(trackedResult.rebuildable, true)
  const untrackedResult = await inspectDestructiveTarget(untracked)
  assert.equal(untrackedResult.inGitRepository, true)
  assert.equal(untrackedResult.gitTracked, false)
  assert.equal(untrackedResult.rebuildable, false)
})

test('Agent control RPCs fail with Agent command is not configured', async () => {
  const home = await tempHome()
  const { conversations, labJobs, research } = await stubStores(home)
  await conversations.save({
    id: 'dsh-1',
    title: 'guest',
    createdAt: 1,
    kernel: 'dsh',
    messages: [],
  })
  const engine = new Engine(home, conversations, process.execPath, () => {})
  const ctx = {
    conversations,
    labJobs,
    research,
    engine,
    emit: () => {},
    home,
  } as unknown as HandlerContext
  await assert.rejects(
    () => handleOwnedMethod(ctx, 'renderer', 'ListDshCommands', ['dsh-1']),
    /Agent command is not configured/,
  )
  await assert.rejects(
    () => handleOwnedMethod(ctx, 'renderer', 'ExecuteDshCommand', ['dsh-1', '/help']),
    /Agent command is not configured/,
  )
  await engine.stopAll()
})

test('fake sidecar records Agent control commands', async () => {
  const home = await tempHome()
  const { conversations, labJobs, research } = await stubStores(home)
  await conversations.save({
    id: 'dsh-live',
    title: 'guest',
    createdAt: 1,
    kernel: 'dsh',
    messages: [],
  })
  const recorded: Record<string, unknown>[] = []
  const startSidecar: StartSidecar = (input) => startFakeSidecar(input.onLine, recorded)
  const engine = new Engine(
    home,
    conversations,
    process.execPath,
    () => {},
    undefined,
    undefined,
    startSidecar,
  )
  engine.attachSettings(stubSettings('/usr/bin/true') as never)
  const ctx = {
    conversations,
    labJobs,
    research,
    engine,
    emit: () => {},
    home,
  } as unknown as HandlerContext
  try {
    await engine.sendMessage({
      conversationId: 'dsh-live',
      prompt: 'hello',
      workspacePath: '',
      modelMode: '',
      modelProvider: '',
      modelId: '',
      thinkingLevel: '',
      modelSourcePreference: 'auto',
      executionMode: 'go',
      approvalPolicy: 'workspace-auto',
      mcpConfigDigest: '',
      mcpServers: [],
      attachments: [],
      branchFromUserOccurrence: -1,
      traceId: '',
    })
    const envDeadline = Date.now() + 2000
    while (
      !recorded.some((item) => item.action === 'workspace_action_response')
      && Date.now() < envDeadline
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
    const envResponse = recorded.find((item) => item.action === 'workspace_action_response')
    assert.equal(envResponse?.ok, false)
    assert.match(String(envResponse?.error ?? ''), /没有环境作业/)
    const commands = await handleOwnedMethod(ctx, 'renderer', 'ListDshCommands', ['dsh-live']) as Array<{
      name: string
    }>
    assert.equal(commands[0]?.name, 'help')
    const executed = await handleOwnedMethod(ctx, 'renderer', 'ExecuteDshCommand', ['dsh-live', '/help']) as {
      text?: string
      executed?: boolean
    }
    assert.equal(executed.text, '/help')
    assert.equal(executed.executed, true)
    const plan = await handleOwnedMethod(ctx, 'renderer', 'SetDshPlanMode', ['dsh-live', true]) as {
      active: boolean
    }
    assert.equal(plan.active, true)
    await handleOwnedMethod(ctx, 'renderer', 'ControlDshGoal', ['dsh-live', 'set', 'ship it'])
    await handleOwnedMethod(ctx, 'renderer', 'KillDshJob', ['dsh-live', 'job-1'])
    const actions = recorded.map((item) => item.action)
    assert.ok(actions.includes('list_commands'))
    assert.ok(actions.includes('execute_command'))
    assert.ok(actions.includes('set_plan_mode'))
    assert.ok(actions.includes('control_goal'))
    assert.ok(actions.includes('kill_job'))
    const kill = recorded.find((item) => item.action === 'kill_job')
    assert.equal(kill?.jobId, 'job-1')
    const goal = recorded.find((item) => item.action === 'control_goal')
    assert.equal(goal?.goalAction, 'set')
    assert.equal(goal?.objective, 'ship it')
  } finally {
    await engine.stopAll()
  }
})
