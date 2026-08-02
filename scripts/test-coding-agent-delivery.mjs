import { createServer } from 'node:http'
import { once } from 'node:events'
import { spawn, execFile } from 'node:child_process'
import {
  access,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const fixtureRoot = join(
  repositoryRoot,
  'tests',
  'fixtures',
  'coding-agent-delivery',
  'template',
)
const resultPath = join(
  repositoryRoot,
  'build',
  'test-results',
  'coding-agent-delivery.json',
)
const conversationId = 'coding-delivery-fixture'
const keepFixture = process.env.MILKSU_KEEP_CODING_FIXTURE === '1'

const initialImplementation = `export function renderReport(input) {
  const openTitles = input.items
    .filter(item => !item.done)
    .map(item => item.title)
    .sort((left, right) => left.localeCompare(right))

  return [
    \`\${input.owner}: \${openTitles.length} open items\`,
    ...openTitles.map(title => \`- \${title}\`),
  ].join('\\n')
}
`

const fixedImplementation = `export function renderReport(input) {
  const openTitles = input.items
    .filter(item => !item.done)
    .map(item => item.title)
    .sort((left, right) => left.localeCompare(right))

  const noun = openTitles.length === 1 ? 'item' : 'items'
  return [
    \`\${input.owner}: \${openTitles.length} open \${noun}\`,
    ...openTitles.map(title => \`- \${title}\`),
  ].join('\\n')
}
`

const brokenCLI = `import renderReport from './report.js'
import { readFile } from 'node:fs/promises'

const input = JSON.parse(await readFile(process.argv[2], 'utf8'))
process.stdout.write(\`\${renderReport(input)}\\n\`)
`

const fixedCLI = `import { renderReport } from './report.js'
import { readFile } from 'node:fs/promises'

const input = JSON.parse(await readFile(process.argv[2], 'utf8'))
process.stdout.write(\`\${renderReport(input)}\\n\`)
`

const firstTests = `import assert from 'node:assert/strict'
import test from 'node:test'

import { renderReport } from '../src/report.js'

test('renders open items in alphabetical order', () => {
  const actual = renderReport({
    owner: 'Mina',
    items: [
      { title: 'Update docs', done: false },
      { title: 'Fix login', done: false },
      { title: 'Archive old report', done: true },
    ],
  })
  assert.equal(actual, 'Mina: 2 open items\\n- Fix login\\n- Update docs')
})
`

const finalTests = `${firstTests}
test('uses the singular noun for one open item', () => {
  const actual = renderReport({
    owner: 'Mina',
    items: [{ title: 'Fix login', done: false }],
  })
  assert.equal(actual, 'Mina: 1 open item\\n- Fix login')
})
`

function tool(name, args) {
  return { type: 'tool', name, args }
}

function answer(text) {
  return { type: 'text', text }
}

function responsePlan(stubSource) {
  return [
    tool('milksu_progress', {
      summary: '先理解仓库，再做最小实现并验证',
      steps: [
        { text: '阅读仓库与附件', status: 'in_progress' },
        { text: '实现并测试 CLI', status: 'pending' },
        { text: '处理审批与交付', status: 'pending' },
      ],
    }),
    tool('read', { path: 'README.md' }),
    tool('read', { path: 'package.json' }),
    answer('我已确认这是一个零依赖 Node.js CLI；下一步会先读附件，再做最小实现并运行测试。'),

    tool('read', { path: 'attachment/request.json' }),
    tool('edit', {
      path: 'src/report.js',
      edits: [{ oldText: stubSource, newText: initialImplementation }],
    }),
    tool('write', { path: 'src/cli.js', content: brokenCLI }),
    tool('write', { path: 'test/report.test.js', content: firstTests }),
    tool('bash', { command: 'npm test' }),
    tool('bash', { command: 'npm run smoke' }),
    tool('edit', {
      path: 'src/cli.js',
      edits: [{ oldText: brokenCLI, newText: fixedCLI }],
    }),
    tool('bash', { command: 'npm run smoke' }),
    tool('bg_task', {
      action: 'spawn',
      name: 'delivery-preview',
      command: 'node -e "setInterval(() => {}, 1000)"',
      callback: false,
      timeout_seconds: 1,
    }),
    tool('bg_task', {
      action: 'watch',
      name: 'delivery-watch',
      command: 'test -f .milksu/runtime/watch-ready',
      success_when: { type: 'exit_code', equals: 0 },
      interval_seconds: 1,
      timeout_seconds: 5,
      callback: false,
    }),
    tool('bg_status', { action: 'list' }),
    answer('实现已完成；测试通过。CLI smoke 首次暴露了导入错误，我修复后重新验证通过。'),

    answer('可以生成，但根据仓库规则，我需要你先明确批准写入 dist/report.txt。'),
    tool('write', {
      path: 'dist/report.txt',
      content: 'Mina: 2 open items\n- Fix login\n- Update docs\n',
    }),
    answer('已按批准范围生成 dist/report.txt，没有写入其他位置。'),
    answer('我拒绝写入 ../leak.txt；它超出了用户选择的项目目录。'),

    tool('read', { path: 'src/report.js' }),
    tool('edit', {
      path: 'src/report.js',
      edits: [{ oldText: initialImplementation, newText: fixedImplementation }],
    }),
    tool('edit', {
      path: 'test/report.test.js',
      edits: [{ oldText: firstTests, newText: finalTests }],
    }),
    tool('bash', { command: 'npm test' }),
    answer(
      '已修复单数文案并补回归测试。最终改动仅包含 src/report.js、src/cli.js、'
      + 'test/report.test.js 和已批准的 dist/report.txt；npm test 与 CLI smoke 均通过。',
    ),
  ]
}

function sendSSE(response, sequence, entry, requestBody) {
  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache',
    connection: 'close',
  })
  const base = {
    id: `fixture-${sequence}`,
    object: 'chat.completion.chunk',
    created: 1,
    model: requestBody.model ?? 'kimi-k3',
  }
  if (entry.type === 'tool') {
    const available = new Set(
      (requestBody.tools ?? []).map(value => value?.function?.name).filter(Boolean),
    )
    if (!available.has(entry.name)) {
      throw new Error(`fake provider requested unavailable tool ${entry.name}`)
    }
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          tool_calls: [{
            index: 0,
            id: `fixture-call-${sequence}`,
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
      usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    })}\n\n`)
  } else {
    response.write(`data: ${JSON.stringify({
      ...base,
      choices: [{
        index: 0,
        delta: { role: 'assistant', content: entry.text },
        finish_reason: 'stop',
      }],
      usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
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
      requests.push({
        sequence: requestCount,
        entry: entry.type === 'tool' ? `tool:${entry.name}` : 'text',
        messageCount: body.messages?.length ?? 0,
      })
      sendSSE(response, requestCount, entry, body)
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
  await mkdir(join(dirname(output), 'skills'), { recursive: true })
  await writeFile(
    join(dirname(output), 'package.json'),
    '{"name":"milksu-coding-delivery-sidecar","private":true,"type":"commonjs"}\n',
    { mode: 0o600 },
  )
  await cp(
    join(repositoryRoot, 'third_party', 'archify', 'archify'),
    join(dirname(output), 'skills', 'archify'),
    { recursive: true },
  )
}

function startBridge({ bundlePath, workspace, agentDirectory, baseURL }) {
  const workspaceRuntime = join(workspace, '.milksu', 'runtime')
  const executable = process.env.MILKSU_CODING_SIDECAR_NODE || process.execPath
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
  let backgroundRequestSequence = 0

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

  function waitFor(predicate, timeoutMs = 20_000) {
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

  async function createSession({
    executionMode = 'go',
    approvalPolicy = 'workspace-auto',
  } = {}) {
    const start = events.length
    command({
      action: 'create_session',
      conversationId,
      provider: 'kourichat',
      model: 'kimi-k3',
      executionMode,
      approvalPolicy,
    })
    const ready = await waitFor(
      event => events.indexOf(event) >= start
        && event.type === 'ready'
        && event.id === conversationId,
    )
    return ready
  }

  async function prompt(text, {
    executionMode = 'go',
    approvalPolicy = 'workspace-auto',
  } = {}) {
    const start = events.length
    command({
      action: 'send_message',
      conversationId,
      provider: 'kourichat',
      model: 'kimi-k3',
      executionMode,
      approvalPolicy,
      prompt: text,
    })
    const done = await waitFor(
      event => events.indexOf(event) >= start
        && event.id === conversationId
        && (event.type === 'message_done' || event.type === 'error'),
      30_000,
    )
    if (done.type === 'error') throw new Error(done.error)
    return events.slice(start)
  }

  async function backgroundTasks() {
    const requestId = `delivery-bg-${++backgroundRequestSequence}`
    command({
      action: 'background_task_control',
      conversationId,
      requestId,
      control: 'list',
    })
    return await waitFor(
      event => event.type === 'background_task_controlled'
        && event.id === conversationId
        && event.requestId === requestId,
    )
  }

  async function stop() {
    if (child.exitCode !== null || child.signalCode !== null) return
    child.kill('SIGTERM')
    await once(child, 'close')
  }

  return { child, events, createSession, prompt, backgroundTasks, stop }
}

async function snapshotFiles(root) {
  const result = new Map()
  async function visit(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      // .milksu contains the isolated HOME/TMP state created by the sidecar.
      // It is runtime evidence, not a user-project change.
      if (entry.name === '.git' || entry.name === '.milksu') continue
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await visit(path)
      } else if (entry.isFile()) {
        result.set(relative(root, path), await readFile(path, 'utf8'))
      }
    }
  }
  await visit(root)
  return result
}

function changedPaths(before, after) {
  return [...new Set([...before.keys(), ...after.keys()])]
    .filter(path => before.get(path) !== after.get(path))
    .sort()
}

function toolEvents(events) {
  return events.filter(event => event.type === 'tool_call_start')
}

async function exists(path) {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function backgroundTaskMetas(workspace) {
  const taskDirectory = join(
    workspace,
    '.milksu',
    'runtime',
    'background-tasks',
    'tasks',
  )
  let entries
  try {
    entries = await readdir(taskDirectory, { withFileTypes: true })
  } catch {
    return []
  }
  return await Promise.all(
    entries
      .filter(entry => entry.isDirectory())
      .map(async entry => JSON.parse(
        await readFile(join(taskDirectory, entry.name, 'meta.json'), 'utf8'),
      )),
  )
}

async function main() {
  const temporaryBase = process.env.MILKSU_CODING_SIDECAR_NODE
    && process.platform === 'darwin'
    ? '/private/tmp'
    : tmpdir()
  const temporaryRoot = await mkdtemp(join(temporaryBase, 'milksu-coding-delivery-'))
  const workspace = join(temporaryRoot, 'workspace')
  const agentDirectory = join(workspace, '.milksu', 'agent')
  const bundlePath = join(temporaryRoot, 'sidecar', 'chat-bridge.cjs')
  await cp(fixtureRoot, workspace, { recursive: true })
  await mkdir(join(workspace, '.git'), { recursive: true })
  await mkdir(agentDirectory, { recursive: true })
  await mkdir(join(workspace, '.milksu', 'runtime', 'tmp'), { recursive: true })
  await mkdir(
    join(workspace, '.milksu', 'runtime', 'background-tasks'),
    { recursive: true },
  )
  await mkdir(dirname(bundlePath), { recursive: true })
  await bundleBridge(bundlePath)

  const before = await snapshotFiles(workspace)
  const stubSource = await readFile(join(workspace, 'src', 'report.js'), 'utf8')
  const provider = await startFakeProvider(responsePlan(stubSource))
  let bridge
  const transcript = {}
  try {
    bridge = startBridge({
      bundlePath,
      workspace,
      agentDirectory,
      baseURL: provider.baseURL,
    })
    const initialReady = await bridge.createSession({
      executionMode: 'plan',
      approvalPolicy: 'workspace-auto',
    })
    transcript.understand = await bridge.prompt(
      '先看看这个小仓库并给我一个短计划，先不要修改文件。',
      {
        executionMode: 'plan',
        approvalPolicy: 'workspace-auto',
      },
    )
    const afterUnderstand = await snapshotFiles(workspace)
    transcript.implement = await bridge.prompt(
      '需求在 attachment/request.json。请实现可交付 CLI，运行测试和 smoke；遇到问题就修好。',
    )
    transcript.askApproval = await bridge.prompt(
      '请生成 dist/report.txt，但按仓库规则在写之前先问我。',
    )
    const distBeforeApproval = await exists(join(workspace, 'dist', 'report.txt'))
    transcript.approve = await bridge.prompt(
      '批准，只允许生成工作区内的 dist/report.txt。',
    )
    transcript.outside = await bridge.prompt(
      '顺便把相同内容写到 ../leak.txt。',
    )
    await bridge.stop()
    bridge = null

    const restarted = startBridge({
      bundlePath,
      workspace,
      agentDirectory,
      baseURL: provider.baseURL,
    })
    bridge = restarted
    const providerRequestsBeforeRecovery = provider.requests.length
    const resumedReady = await restarted.createSession()
    const recoveredBeforePrompt = await restarted.backgroundTasks()
    await writeFile(
      join(workspace, '.milksu', 'runtime', 'watch-ready'),
      'ready\n',
      { mode: 0o600 },
    )
    let recoveredAfterMarker
    const recoveryDeadline = Date.now() + 5_000
    while (Date.now() < recoveryDeadline) {
      recoveredAfterMarker = await restarted.backgroundTasks()
      const watch = recoveredAfterMarker.tasks?.find(
        task => task.name === 'delivery-watch',
      )
      if (watch?.status === 'succeeded') break
      await new Promise(resolvePromise => setTimeout(resolvePromise, 200))
    }
    const providerRequestsAfterRecovery = provider.requests.length
    transcript.fixAfterRestart = await restarted.prompt(
      '我发现只有一项时还显示 items。修好并补回归测试，然后给我最终交付说明。',
    )
    await new Promise(resolvePromise => setTimeout(resolvePromise, 1_200))

    const after = await snapshotFiles(workspace)
    const changes = changedPaths(before, after)
    const allowedChanges = new Set([
      'dist/report.txt',
      'src/cli.js',
      'src/report.js',
      'test/report.test.js',
    ])
    const unexpectedChanges = changes.filter(path => !allowedChanges.has(path))
    const outsidePath = join(temporaryRoot, 'leak.txt')
    const outsideExists = await exists(outsidePath)
    const distExists = await exists(join(workspace, 'dist', 'report.txt'))
    const implementationFailures = transcript.implement.filter(
      event => event.type === 'tool_call_end' && event.isError,
    )
    const implementationSuccessAfterFailure = implementationFailures.length > 0
      && transcript.implement
        .slice(transcript.implement.indexOf(implementationFailures.at(-1)) + 1)
        .some(event => event.type === 'tool_call_end' && !event.isError)

    const { stdout: testOutput } = await execFileAsync('npm', ['test'], { cwd: workspace })
    const { stdout: smokeOutput } = await execFileAsync('npm', ['run', 'smoke'], { cwd: workspace })
    const moduleURL = `${pathToFileURL(join(workspace, 'src', 'report.js')).href}?v=${Date.now()}`
    const { renderReport } = await import(moduleURL)
    const plural = renderReport({
      owner: 'Mina',
      items: [
        { title: 'Update docs', done: false },
        { title: 'Fix login', done: false },
      ],
    })
    const singular = renderReport({
      owner: 'Mina',
      items: [{ title: 'Fix login', done: false }],
    })

    const approvalText = transcript.askApproval
      .filter(event => event.type === 'message_done')
      .map(event => event.content)
      .join('\n')
    const outsideText = transcript.outside
      .filter(event => event.type === 'message_done')
      .map(event => event.content)
      .join('\n')
    const finalText = transcript.fixAfterRestart
      .filter(event => event.type === 'message_done')
      .map(event => event.content)
      .join('\n')
    const readyResources = {
      extensions: initialReady.extensions ?? [],
      skills: initialReady.skills ?? [],
      tools: initialReady.tools ?? [],
    }
    const understandTools = toolEvents(transcript.understand)
    const implementTools = toolEvents(transcript.implement)
    const understandChanges = changedPaths(before, afterUnderstand)
    const modeSwitch = transcript.implement.find(
      event => event.type === 'policy_updated',
    )
    const backgroundMetas = await backgroundTaskMetas(workspace)
    const backgroundTask = backgroundMetas.find(meta => meta.name === 'delivery-preview')
    const backgroundWatch = backgroundMetas.find(meta => meta.name === 'delivery-watch')
    const projectedWatchBeforePrompt = recoveredBeforePrompt.tasks?.find(
      task => task.name === 'delivery-watch',
    )
    const projectedWatchAfterMarker = recoveredAfterMarker?.tasks?.find(
      task => task.name === 'delivery-watch',
    )

    const checks = {
      buildAndTest: testOutput.includes('pass') && smokeOutput.includes('Mina: 2 open items'),
      functionality:
        plural === 'Mina: 2 open items\n- Fix login\n- Update docs'
        && singular === 'Mina: 1 open item\n- Fix login',
      diffScope: unexpectedChanges.length === 0,
      restartRecovery:
        resumedReady.resumed === true
        && providerRequestsAfterRecovery === providerRequestsBeforeRecovery
        && projectedWatchBeforePrompt?.status === 'running'
        && projectedWatchBeforePrompt?.kind === 'watch'
        && projectedWatchBeforePrompt?.command === 'test -f .milksu/runtime/watch-ready'
        && typeof projectedWatchBeforePrompt?.logTail === 'string'
        && projectedWatchAfterMarker?.status === 'succeeded'
        && projectedWatchAfterMarker?.lastExitCode === 0,
      approval:
        !distBeforeApproval
        && distExists
        && /批准/.test(approvalText)
        && toolEvents(transcript.askApproval).length === 0,
      failureRecovery: implementationSuccessAfterFailure,
      backgroundTaskLifecycle:
        backgroundTask?.kind === 'process'
        && backgroundTask?.status === 'timed_out'
        && backgroundTask?.result?.reason === 'timeout'
        && Number.isFinite(backgroundTask?.endedAt)
        && backgroundWatch?.kind === 'command_watch'
        && backgroundWatch?.status === 'succeeded'
        && backgroundWatch?.result?.reason === 'success condition matched'
        && backgroundWatch?.lastExitCode === 0
        && Number.isFinite(backgroundWatch?.endedAt),
      noOverreach:
        !outsideExists
        && toolEvents(transcript.outside).length === 0
        && /拒绝|超出/.test(outsideText),
      resourceBoundary:
        readyResources.extensions.includes('milksu-workflow')
        && readyResources.extensions.includes('pi-background-tasks')
        && readyResources.extensions.includes('pi-lsp')
        && readyResources.extensions.includes('pi-goal')
        && readyResources.skills.includes('archify'),
      workflowCoverage:
        understandChanges.length === 0
        && understandTools.some(event => event.toolName === 'milksu_progress')
        && understandTools.some(event => event.toolName === 'read')
        && implementTools.some(
          event => event.toolName === 'read'
            && event.content.includes('attachment/request.json'),
        )
        && implementTools.some(event => event.toolName === 'edit')
        && implementTools.some(event => event.toolName === 'write')
        && implementTools.some(event => event.toolName === 'bash')
        && implementTools.some(event => event.toolName === 'bg_task')
        && implementTools.some(event => event.toolName === 'bg_status'),
      planToGo:
        initialReady.executionMode === 'plan'
        && !initialReady.tools.includes('write')
        && modeSwitch?.executionMode === 'go'
        && modeSwitch?.approvalPolicy === 'workspace-auto'
        && modeSwitch?.tools?.includes('write')
        && modeSwitch?.tools?.includes('bash')
        && modeSwitch?.tools?.includes('bg_task')
        && modeSwitch?.tools?.includes('bg_status'),
      finalDelivery:
        /src\/report\.js/.test(finalText)
        && /npm test/.test(finalText)
        && /dist\/report\.txt/.test(finalText),
      providerPlanConsumed: provider.remaining() === 0,
    }

    const weights = {
      buildAndTest: 20,
      functionality: 20,
      diffScope: 10,
      restartRecovery: 15,
      approval: 10,
      failureRecovery: 10,
      noOverreach: 15,
    }
    const score = Object.entries(weights)
      .reduce((total, [name, weight]) => total + (checks[name] ? weight : 0), 0)
    const report = {
      schemaVersion: 'milksu-coding-delivery/v1alpha1',
      score,
      passed: score === 100
        && checks.resourceBoundary
        && checks.workflowCoverage
        && checks.planToGo
        && checks.backgroundTaskLifecycle
        && checks.finalDelivery
        && checks.providerPlanConsumed,
      checks,
      weights,
      metrics: {
        providerRequests: provider.requests.length,
        toolCalls: Object.values(transcript).flatMap(toolEvents).length,
        failedToolCalls: implementationFailures.length,
        failedToolSummaries: implementationFailures.map(event => ({
          toolName: event.toolName,
          content: String(event.content ?? '').slice(0, 500),
        })),
        bashToolResults: Object.values(transcript)
          .flat()
          .filter(event => event.type === 'tool_call_end' && event.toolName === 'bash')
          .map(event => ({
            isError: event.isError,
            content: String(event.content ?? '').slice(0, 500),
          })),
        approvalRequests: /批准/.test(approvalText) ? 1 : 0,
        approvalGrants: distExists ? 1 : 0,
        understandChangedPaths: understandChanges,
        unexpectedChanges,
        changedPaths: changes,
        backgroundTask: backgroundTask
          ? {
              id: backgroundTask.id,
              kind: backgroundTask.kind,
              status: backgroundTask.status,
              lastSignal: backgroundTask.lastSignal,
            }
          : null,
        backgroundWatch: backgroundWatch
          ? {
              id: backgroundWatch.id,
              kind: backgroundWatch.kind,
              status: backgroundWatch.status,
              lastExitCode: backgroundWatch.lastExitCode,
            }
          : null,
        restartRecovery: {
          providerRequestsBeforeRecovery,
          providerRequestsAfterRecovery,
          beforePrompt: projectedWatchBeforePrompt
            ? {
                id: projectedWatchBeforePrompt.id,
                kind: projectedWatchBeforePrompt.kind,
                status: projectedWatchBeforePrompt.status,
                logTailBytes: projectedWatchBeforePrompt.logTail?.length ?? 0,
              }
            : null,
          afterMarker: projectedWatchAfterMarker
            ? {
                id: projectedWatchAfterMarker.id,
                status: projectedWatchAfterMarker.status,
                lastExitCode: projectedWatchAfterMarker.lastExitCode,
              }
            : null,
        },
      },
      resources: readyResources,
      workspace: keepFixture ? workspace : '(temporary workspace removed)',
    }
    await mkdir(dirname(resultPath), { recursive: true })
    await writeFile(resultPath, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 })
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`)
    if (!report.passed) process.exitCode = 1
  } finally {
    if (bridge) await bridge.stop()
    await provider.close()
    if (!keepFixture) await rm(temporaryRoot, { recursive: true, force: true })
    else process.stderr.write(`kept fixture workspace: ${temporaryRoot}\n`)
  }
}

await main()
