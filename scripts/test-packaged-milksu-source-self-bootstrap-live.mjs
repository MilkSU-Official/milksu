#!/usr/bin/env node

import { spawn, execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { once } from 'node:events'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { arch, platform, tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { performance } from 'node:perf_hooks'
import { promisify } from 'node:util'
import { fileURLToPath } from 'node:url'
import { build } from 'esbuild'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const appBundle = resolve(
  process.env.MILKSU_APP_PATH || join(repositoryRoot, 'build', 'bin', 'MilkSU.app'),
)
const appExecutable = join(appBundle, 'Contents', 'MacOS', 'MilkSU')
const packagedNode = join(appBundle, 'Contents', 'Resources', 'milksu-sidecar', 'node')
const resultsDirectory = join(repositoryRoot, 'build', 'test-results')
const resultPath = join(resultsDirectory, 'milksu-source-self-bootstrap-live.json')
const gitReportPath = join(resultsDirectory, 'milksu-source-self-bootstrap-git.json')
const liveSmokeEnabled = process.env.MILKSU_MILKSU_SOURCE_SELF_BOOTSTRAP_LIVE_SMOKE === '1'
const conversationId = 'milksu-source-self-bootstrap-live'
const commitMessage = 'test: package app self-edits milksu source clone'
const startupTimeoutMs = 45_000
const shutdownTimeoutMs = 10_000

const sourceFile = 'scripts/lib/milksu-source-self-bootstrap-smoke.mjs'
const testFile = 'tests/scripts/milksu-source-self-bootstrap-smoke.test.mjs'
const sourceContent = `export function summarizeSourceSelfBootstrap(task) {
  const moduleName = String(task?.module || 'unknown').trim() || 'unknown'
  const changedPaths = Array.isArray(task?.changedPaths) ? task.changedPaths : []
  const tests = Array.isArray(task?.tests) ? task.tests : []
  return {
    module: moduleName,
    changedPathCount: changedPaths.length,
    testCount: tests.length,
    summary: \`\${moduleName}: \${changedPaths.length} changed path\${changedPaths.length === 1 ? '' : 's'} / \${tests.length} test\${tests.length === 1 ? '' : 's'}\`,
  }
}
`
const testContent = `import assert from 'node:assert/strict'
import test from 'node:test'

import { summarizeSourceSelfBootstrap } from '../../scripts/lib/milksu-source-self-bootstrap-smoke.mjs'

test('summarizes a MilkSU source self-bootstrap task', () => {
  const actual = summarizeSourceSelfBootstrap({
    module: 'Coding',
    changedPaths: [
      'scripts/lib/milksu-source-self-bootstrap-smoke.mjs',
      'tests/scripts/milksu-source-self-bootstrap-smoke.test.mjs',
    ],
    tests: ['node --test tests/scripts/milksu-source-self-bootstrap-smoke.test.mjs'],
  })
  assert.deepEqual(actual, {
    module: 'Coding',
    changedPathCount: 2,
    testCount: 1,
    summary: 'Coding: 2 changed paths / 1 test',
  })
})
`

function assert(condition, message) {
  if (!condition) throw new Error(message)
}

function delay(milliseconds) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, milliseconds))
}

async function exists(path) {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

async function runGit(args, options = {}) {
  const { stdout } = await execFileAsync('git', args, {
    ...options,
    maxBuffer: 20 * 1024 * 1024,
  })
  return stdout.trim()
}

async function waitForExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return { code: child.exitCode, signal: child.signalCode, timedOut: false }
  }
  return new Promise(resolveExit => {
    const timer = setTimeout(() => {
      child.off('exit', onExit)
      resolveExit({ code: null, signal: null, timedOut: true })
    }, timeoutMs)
    function onExit(code, signal) {
      clearTimeout(timer)
      resolveExit({ code, signal, timedOut: false })
    }
    child.once('exit', onExit)
  })
}

function tool(name, args) {
  return { type: 'tool', name, args }
}

function answer(text) {
  return { type: 'text', text }
}

function providerUsage(entry, requestBody) {
  const promptTokens = Math.max(10, Math.ceil(JSON.stringify(requestBody.messages ?? []).length / 4))
  const completionTokens = entry.type === 'tool'
    ? 2
    : Math.max(4, Math.ceil(entry.text.length / 4))
  return {
    prompt_tokens: promptTokens,
    completion_tokens: completionTokens,
    total_tokens: promptTokens + completionTokens,
  }
}

function sendSSE(response, sequence, entry, requestBody, usage) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'close',
  })
  const base = {
    id: `milksu-source-fixture-${sequence}`,
    object: 'chat.completion.chunk',
    created: 1,
    model: requestBody.model ?? 'kimi-k3',
  }
  if (entry.type === 'tool') {
    const available = new Set(
      (requestBody.tools ?? []).map(value => value?.function?.name).filter(Boolean),
    )
    if (!available.has(entry.name)) throw new Error(`fake provider requested unavailable tool ${entry.name}`)
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [{
            index: 0,
            id: `milksu-source-call-${sequence}`,
            type: 'function',
            function: {
              name: entry.name,
              arguments: JSON.stringify(entry.args),
            },
          }],
        },
        finish_reason: null,
      }],
    })}\n\n`)
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }],
      usage,
    })}\n\n`)
  } else {
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: [{
        index: 0,
        delta: { role: 'assistant', content: entry.text },
        finish_reason: 'stop',
      }],
      usage,
    })}\n\n`)
  }
  response.end('data: [DONE]\n\n')
}

async function startFakeProvider(plan) {
  let requestCount = 0
  const requests = []
  const server = createServer(async (request, response) => {
    try {
      if (request.method !== 'POST' || request.url !== '/v1/chat/completions') {
        response.writeHead(404).end()
        return
      }
      let raw = ''
      request.setEncoding('utf8')
      for await (const chunk of request) raw += chunk
      const body = JSON.parse(raw)
      const entry = plan.shift()
      if (!entry) throw new Error('fake provider response plan is exhausted')
      requestCount++
      const usage = providerUsage(entry, body)
      requests.push({
        sequence: requestCount,
        entry: entry.type === 'tool' ? `tool:${entry.name}` : entry.type,
        messageCount: body.messages?.length ?? 0,
        usage,
      })
      sendSSE(response, requestCount, entry, body, usage)
    } catch (error) {
      response.writeHead(500, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ error: { message: error.message } }))
    }
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const address = server.address()
  return {
    baseURL: `http://127.0.0.1:${address.port}/v1`,
    requests,
    remaining: () => plan.length,
    close: async () => {
      server.close()
      await once(server, 'close')
    },
  }
}

async function bundleBridge(output) {
  await build({
    entryPoints: [join(repositoryRoot, 'bridge.js')],
    outfile: output,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['@napi-rs/system-ocr'],
    banner: {
      js: "const __import_meta_url = require('node:url').pathToFileURL(__filename).href;",
    },
    define: { 'import.meta.url': '__import_meta_url' },
    legalComments: 'eof',
    logLevel: 'silent',
  })
  await fs.mkdir(join(dirname(output), 'skills'), { recursive: true })
  await fs.writeFile(
    join(dirname(output), 'package.json'),
    '{"name":"milksu-source-self-bootstrap-sidecar","private":true,"type":"commonjs"}\n',
    { mode: 0o600 },
  )
  await fs.cp(
    join(repositoryRoot, 'third_party', 'archify', 'archify'),
    join(dirname(output), 'skills', 'archify'),
    { recursive: true },
  )
}

function startBridge({ bundlePath, workspace, agentDirectory, baseURL }) {
  const workspaceRuntime = join(workspace, '.milksu', 'runtime')
  const executable = process.env.MILKSU_CODING_SIDECAR_NODE || packagedNode
  const argumentsList = executable === process.execPath
    ? [bundlePath]
    : [
        '--permission',
        `--allow-fs-read=${dirname(bundlePath)}`,
        `--allow-fs-read=${dirname(dirname(bundlePath))}`,
        `--allow-fs-read=${dirname(executable)}`,
        `--allow-fs-read=${workspace}`,
        `--allow-fs-read=${agentDirectory}`,
        `--allow-fs-write=${workspace}`,
        `--allow-fs-write=${agentDirectory}`,
        '--allow-child-process',
        '--allow-fs-read=/bin/bash',
        '--allow-fs-read=/bin/sh',
        '--allow-fs-read=/usr/bin/env',
        '--allow-fs-read=/usr/bin/sandbox-exec',
        bundlePath,
      ]
  const child = spawn(executable, argumentsList, {
    cwd: workspace,
    env: {
      ...process.env,
      HOME: dirname(workspace),
      KOURICHAT_API_KEY: 'fixture-only-not-a-secret',
      KOURICHAT_BASE_URL: baseURL,
      MILKSU_PI_AGENT_DIR: agentDirectory,
      MILKSU_WORKSPACE_RUNTIME: workspaceRuntime,
      MILKSU_BACKGROUND_TASKS_DIR: join(workspaceRuntime, 'background-tasks'),
      TMPDIR: join(workspaceRuntime, 'tmp'),
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  })
  const events = []
  const waiters = new Set()
  let stderr = ''
  let stdoutBuffer = ''

  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => { stderr += chunk })
  child.stdout.setEncoding('utf8')
  child.stdout.on('data', chunk => {
    stdoutBuffer += chunk
    while (stdoutBuffer.includes('\n')) {
      const index = stdoutBuffer.indexOf('\n')
      const line = stdoutBuffer.slice(0, index).trim()
      stdoutBuffer = stdoutBuffer.slice(index + 1)
      if (!line) continue
      const event = JSON.parse(line)
      events.push(event)
      for (const waiter of [...waiters]) {
        if (!waiter.predicate(event)) continue
        waiters.delete(waiter)
        clearTimeout(waiter.timer)
        waiter.resolve(event)
      }
    }
  })

  function waitFor(predicate, timeoutMs = 30_000) {
    const existing = events.find(predicate)
    if (existing) return Promise.resolve(existing)
    return new Promise((resolvePromise, rejectPromise) => {
      const waiter = {
        predicate,
        resolve: resolvePromise,
        timer: setTimeout(() => {
          waiters.delete(waiter)
          rejectPromise(new Error(
            `bridge event timeout\nstderr: ${stderr}\nrecent events: `
            + JSON.stringify(events.slice(-12), null, 2),
          ))
        }, timeoutMs),
      }
      waiters.add(waiter)
    })
  }

  function command(value) {
    child.stdin.write(`${JSON.stringify(value)}\n`)
  }

  async function createSession() {
    const start = events.length
    command({
      action: 'create_session',
      conversationId,
      provider: 'kourichat',
      model: 'kimi-k3',
      executionMode: 'go',
      approvalPolicy: 'workspace-auto',
    })
    return await waitFor(
      event => events.indexOf(event) >= start
        && event.type === 'ready'
        && event.id === conversationId,
    )
  }

  async function prompt(text) {
    const start = events.length
    command({
      action: 'send_message',
      conversationId,
      provider: 'kourichat',
      model: 'kimi-k3',
      executionMode: 'go',
      approvalPolicy: 'workspace-auto',
      prompt: text,
    })
    const event = await waitFor(
      candidate => events.indexOf(candidate) >= start
        && candidate.id === conversationId
        && (candidate.type === 'message_done' || candidate.type === 'error'),
      60_000,
    )
    if (event.type === 'error') throw new Error(event.error)
    return events.slice(start)
  }

  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    await once(child, 'close')
  }

  return {
    events,
    createSession,
    prompt,
    stop,
  }
}

async function prepareSourceClone(root) {
  const workspace = join(root, 'workspace')
  const remote = join(root, 'origin.git')
  await runGit(['clone', '--local', '--no-hardlinks', repositoryRoot, workspace])
  await runGit(['checkout', '-B', 'main'], { cwd: workspace })
  await runGit(['config', 'user.name', 'MilkSU Source Self Bootstrap Smoke'], { cwd: workspace })
  await runGit(['config', 'user.email', 'milksu-source-self-bootstrap@example.invalid'], { cwd: workspace })
  await runGit(['init', '--bare', remote])
  await runGit(['remote', 'set-url', 'origin', remote], { cwd: workspace })
  await runGit(['push', '-u', 'origin', 'main'], { cwd: workspace })
  return { workspace, remote }
}

async function workspaceDigest(workspace) {
  const files = [
    'go.mod',
    'bridge.js',
    'app/src/App.vue',
    'scripts/test-packaged-coding-self-bootstrap-live.mjs',
  ]
  const hash = createHash('sha256')
  for (const file of files) {
    hash.update(file)
    hash.update('\0')
    hash.update(await fs.readFile(join(workspace, file), 'utf8'))
    hash.update('\0')
  }
  return hash.digest('hex')
}

async function runPackagedGitSmoke(root, workspace) {
  const appDataDirectory = join(root, 'app-data')
  const appReportPath = join(root, 'milksu-source-self-bootstrap-git-app-report.json')
  const fixtureTemp = join(root, 'tmp')
  await fs.mkdir(appDataDirectory, { recursive: true, mode: 0o700 })
  await fs.mkdir(fixtureTemp, { recursive: true, mode: 0o700 })

  let spawnError
  let stdoutBytes = 0
  let stderrBytes = 0
  const child = spawn(appExecutable, [], {
    cwd: root,
    env: {
      HOME: root,
      TMPDIR: fixtureTemp,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      MILKSU_APPDATA_DIR: appDataDirectory,
      MILKSU_ENABLE_MANAGED_LABS: '0',
      MILKSU_INSTANCE_ID: `milksu-source-self-bootstrap-${process.pid}-${Date.now()}`,
      MILKSU_CODING_GIT_DELIVERY_SMOKE_WORKSPACE: workspace,
      MILKSU_CODING_GIT_DELIVERY_SMOKE_MESSAGE: commitMessage,
      MILKSU_CODING_GIT_DELIVERY_SMOKE_RESULT: appReportPath,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.once('error', error => { spawnError = error })
  child.stdout.on('data', chunk => { stdoutBytes += chunk.length })
  child.stderr.on('data', chunk => { stderrBytes += chunk.length })

  const deadline = performance.now() + startupTimeoutMs
  while (!(await exists(appReportPath))) {
    if (spawnError) throw spawnError
    if (child.exitCode !== null || child.signalCode !== null) {
      throw new Error(
        `packaged App exited before source Git smoke report `
          + `(code=${child.exitCode}, signal=${child.signalCode})`,
      )
    }
    assert(performance.now() < deadline, `source Git smoke report exceeded ${startupTimeoutMs} ms`)
    await delay(100)
  }
  const appReport = JSON.parse(await fs.readFile(appReportPath, 'utf8'))
  child.kill('SIGTERM')
  let exit = await waitForExit(child, shutdownTimeoutMs)
  let gracefulShutdown = true
  if (exit.timedOut) {
    gracefulShutdown = false
    child.kill('SIGKILL')
    exit = await waitForExit(child, 5_000)
  }
  assert(!exit.timedOut, 'packaged App did not terminate after source Git smoke')
  await fs.copyFile(appReportPath, gitReportPath)
  return {
    appReport,
    app: {
      stdoutBytes,
      stderrBytes,
      gracefulShutdown,
      exitCode: exit.code,
      exitSignal: exit.signal,
    },
    appDataDirectory,
  }
}

function assertGitSmoke(report) {
  assert(report.schema === 'milksu-coding-git-delivery-packaged-smoke/v1', 'unexpected Git smoke schema')
  assert(!report.error, `Git smoke failed: ${report.error}`)
  assert(report.gates?.workspaceIsRepository === true, 'Git smoke did not see repository')
  assert(report.gates?.hadPendingChanges === true, 'Git smoke did not see pending source changes')
  assert(report.gates?.stageAllStagedChanges === true, 'Git smoke did not stage source changes')
  assert(report.gates?.commitCreatedHead === true, 'Git smoke did not commit source changes')
  assert(report.gates?.pushUpdatedUpstream === true, 'Git smoke did not push source changes')
  assert(report.gates?.cleanAfterPush === true, 'Git smoke did not leave source workspace clean')
}

async function main() {
  if (!liveSmokeEnabled) {
    console.log('Skipping MilkSU source self-bootstrap live smoke; set MILKSU_MILKSU_SOURCE_SELF_BOOTSTRAP_LIVE_SMOKE=1 to run it.')
    return
  }
  assert(platform() === 'darwin', 'MilkSU source self-bootstrap live smoke requires macOS')
  assert(await exists(appExecutable), `missing packaged App executable: ${appExecutable}`)
  assert(await exists(packagedNode), `missing packaged sidecar node: ${packagedNode}`)

  const temporaryBase = process.platform === 'darwin' ? '/private/tmp' : tmpdir()
  const root = await fs.mkdtemp(join(temporaryBase, 'milksu-source-self-bootstrap-live-'))
  let provider
  let bridge
  try {
    const activeWorktreeStatusBefore = await runGit(['-C', repositoryRoot, 'status', '--porcelain=v1'])
    const { workspace, remote } = await prepareSourceClone(root)
    const sourceRevision = await runGit(['-C', workspace, 'rev-parse', 'HEAD'])
    const digest = await workspaceDigest(workspace)
    const agentDirectory = join(workspace, '.milksu', 'agent')
    const bundlePath = join(root, 'sidecar', 'chat-bridge.cjs')
    await fs.mkdir(agentDirectory, { recursive: true })
    await fs.mkdir(join(workspace, '.milksu', 'runtime', 'tmp'), { recursive: true })
    await fs.mkdir(join(workspace, '.milksu', 'runtime', 'background-tasks'), { recursive: true })
    await fs.mkdir(dirname(bundlePath), { recursive: true })
    await bundleBridge(bundlePath)

    provider = await startFakeProvider([
      tool('read', { path: 'package.json' }),
      tool('read', { path: 'app/src/App.vue' }),
      tool('write', { path: sourceFile, content: sourceContent }),
      tool('write', { path: testFile, content: testContent }),
      tool('bash', { command: `node --test ${testFile}` }),
      answer('已在真实 MilkSU 源码副本中新增自举摘要工具和 node:test 回归，并通过测试。'),
    ])
    bridge = startBridge({
      bundlePath,
      workspace,
      agentDirectory,
      baseURL: provider.baseURL,
    })
    const ready = await bridge.createSession()
    const transcript = await bridge.prompt(
      [
        '在这个 MilkSU 源码仓库里完成一个小型真实自举任务。',
        `新增 ${sourceFile} 和 ${testFile}。`,
        `运行 node --test ${testFile}。`,
        '只修改这两个文件，不提交 Git。',
      ].join('\n'),
    )
    await bridge.stop()
    bridge = null
    const providerRequests = provider.requests.length
    const providerPlanConsumed = provider.remaining() === 0
    await provider.close()
    provider = null

    const changed = (await runGit(['-C', workspace, 'status', '--porcelain=v1']))
      .split('\n')
      .map(line => line.trim())
      .filter(Boolean)
      .map(line => line.slice(3))
      .sort()
    assert(JSON.stringify(changed) === JSON.stringify([sourceFile, testFile].sort()), `unexpected source changes: ${changed.join(', ')}`)
    const { stdout: verificationOutput } = await execFileAsync('node', ['--test', testFile], {
      cwd: workspace,
      maxBuffer: 4 * 1024 * 1024,
    })
    assert(verificationOutput.includes('pass 1'), 'independent node:test did not pass')

    const gitSmoke = await runPackagedGitSmoke(root, workspace)
    assertGitSmoke(gitSmoke.appReport)
    const remoteHead = await runGit(['--git-dir', remote, 'rev-parse', '--short=12', 'refs/heads/main'])
    const localHead = await runGit(['-C', workspace, 'rev-parse', '--short=12', 'HEAD'])
    const finalStatus = await runGit(['-C', workspace, 'status', '--porcelain=v1'])
    const subject = await runGit(['-C', workspace, 'log', '-1', '--format=%s'])
    assert(remoteHead === localHead, 'local source clone and isolated remote diverged')
    assert(finalStatus === '', `source clone was not clean after packaged Git delivery: ${finalStatus}`)
    assert(subject === commitMessage, `unexpected commit subject: ${subject}`)
    const activeWorktreeStatusAfter = await runGit(['-C', repositoryRoot, 'status', '--porcelain=v1'])
    const activeWorktreeUntouched = activeWorktreeStatusAfter === activeWorktreeStatusBefore

    const toolStarts = transcript.filter(event => event.type === 'tool_call_start')
    const toolEnds = transcript.filter(event => event.type === 'tool_call_end')
    const finalMessages = transcript.filter(event => event.type === 'message_done')
    const report = {
      schema: 'milksu-source-self-bootstrap-live-smoke/v1',
      measuredAt: new Date().toISOString(),
      environment: {
        platform: platform(),
        architecture: arch(),
        isolatedSourceClone: true,
        isolatedRemote: true,
      },
      source: {
        repository: 'MilkSU-Official/milksu',
        revision: sourceRevision,
        digest,
        changedPaths: changed,
        commitMessage,
        localHead,
        remoteHead,
        finalStatusClean: finalStatus === '',
      },
      runtime: {
        packagedNode: relative(repositoryRoot, packagedNode),
        packagedApp: relative(repositoryRoot, appBundle),
        ready: {
          executionMode: ready.executionMode,
          approvalPolicy: ready.approvalPolicy,
          extensions: ready.extensions ?? [],
          skills: ready.skills ?? [],
          tools: ready.tools ?? [],
        },
        providerRequests,
        providerPlanConsumed,
        toolCalls: toolStarts.map(event => event.toolName),
        toolFailures: toolEnds.filter(event => event.isError).length,
        finalMessage: finalMessages.map(event => event.content).join('\n').slice(0, 500),
      },
      tests: {
        command: `node --test ${testFile}`,
        passed: true,
        stdoutBytes: Buffer.byteLength(verificationOutput),
      },
      git: {
        packagedAppFacade: {
          report: relative(repositoryRoot, gitReportPath),
          gates: gitSmoke.appReport.gates,
          gracefulShutdown: gitSmoke.app.gracefulShutdown,
        },
      },
      limitations: [
        'This smoke uses a deterministic local provider, not a real external model provider.',
        'It edits an isolated clone of the real MilkSU repository, not the active developer worktree.',
        'It pushes only to an isolated local bare remote and does not create a hosted PR.',
      ],
      gates: {
        usedRealMilkSUSourceClone: true,
        codingRuntimeEditedSource: changed.includes(sourceFile) && changed.includes(testFile),
        codingRuntimeRanNarrowTest: true,
        packagedAppCommittedAndPushed: true,
        isolatedRemoteOnly: true,
        activeWorktreeUntouched,
      },
    }
    assert(providerPlanConsumed, 'source self-bootstrap provider plan was not consumed')
    assert(activeWorktreeUntouched, 'source self-bootstrap smoke changed the active developer worktree')
    const serialized = JSON.stringify(report)
    assert(!/OPENAI_API_KEY|ANTHROPIC_API_KEY|DEEPSEEK_API_KEY|sk-[A-Za-z0-9]/.test(serialized), 'source self-bootstrap report leaked key-shaped content')
    await fs.mkdir(resultsDirectory, { recursive: true, mode: 0o700 })
    await fs.writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    console.log('MilkSU packaged source self-bootstrap live smoke passed.')
    console.log(`  source revision: ${sourceRevision.slice(0, 12)}`)
    console.log(`  changed paths: ${changed.join(', ')}`)
    console.log(`  remote head: ${remoteHead}`)
    console.log(`  report: ${relative(repositoryRoot, resultPath)}`)
  } finally {
    if (bridge) await bridge.stop().catch(() => undefined)
    if (provider) await provider.close().catch(() => undefined)
    await fs.rm(root, { recursive: true, force: true })
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exitCode = 1
})
