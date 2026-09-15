#!/usr/bin/env node
/**
 * Product-regression coordinator (issue #96 family B).
 * Observes the product through official Desktop RPC / existing tests.
 * Not Settings → 评测 (evalsuite / FrontierHarness). Not imported by App startup.
 *
 *   npm run test:product-loop -- --list
 *   npm run test:product-loop -- --suite stop-scope,chat-pin
 *   npm run test:product-loop -- --gui --suite all
 *   npm run test:product-loop -- --bridge --suite dsh
 */

import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { redactProcessText } from '../sidecar/dsh/redact.js'
import { GuiDriver, repositoryRoot } from './lib/desktop-gui-driver.mjs'
import {
  pickComputerUseTarget,
  usedComputerUseTools,
  usedIsolatedBrowserTools,
} from './lib/product-loop-desktop-surface.mjs'
import {
  DEFAULT_SUITES,
  PRODUCT_LOOP_SCHEMA,
  SUITES,
  TOKENFLUX_BASE_URL,
  parseProductLoopArgs,
  suiteRunnable,
} from './lib/product-loop-catalog.mjs'

const resultPath = join(repositoryRoot, 'build', 'test-results', 'product-loop.json')
const FILE_TOOL_PATTERN = /(read|write|edit|apply_patch|glob|grep|ls|list_dir|read_file|write_file|str_replace|bash|shell)/i
const PLAYWRIGHT_OFFICIAL_PREFIX = 'mcp__playwright-mcp__'

const TASK_COMPUTER_PROMPT = [
  '当前权限档是 workspace-auto。请用 Computer Use 观察本机已经打开的「计算器」窗口。',
  '不要改系统设置，不要点辅助功能 / 屏幕录制权限对话框，不要安装驱动，不要点用户自己的 Chrome / Edge。',
  '把你实际看到的窗口标题或计算器显示内容写进工作区 SURFACE.md，并说明用了 Computer Use。',
  '如果看不到窗口或没有权限，直接说明原因并结束，不要重试绕过 TCC。',
].join('\n')

function browserSurfacePrompt(url) {
  return [
    '请使用本产品的隔离浏览器访问这个本机页面（只走 127.0.0.1，不要打开用户自己的 Chrome / Edge）：',
    url,
    '页面上有一段标记字符串。请读取该标记，把它原样写进工作区 SURFACE.md，并在回复里引用该标记。',
    `优先使用官方 Playwright MCP 工具（名称通常带 ${PLAYWRIGHT_OFFICIAL_PREFIX} 前缀），或产品内置的隔离浏览器 / milksu_workspace 浏览器动作。`,
    '不要启动第二只用户日常浏览器，不要做 Browser Use 配对。',
  ].join('\n')
}

const TASK_A_PROMPT = [
  '你在当前工作区里做一次真实的文件循环，不要只聊天回复。',
  '1. 先列出工作区根目录和已有文件，确认这是一个临时仓库。',
  '2. 新建 NOTES.md，写入：你看到了哪些文件、各自一两句说明，以及今天的日期。',
  '3. 再把 NOTES.md 读回来，核对自己刚写的内容，并在回复里引用其中一行。',
  '完成标准：工作区必须出现 NOTES.md，且你实际调用了文件类工具（列出/写入/读取），不要只用纯文本假装写过。',
].join('\n')

function delay(ms) {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms))
}

function collectToolNames(events) {
  const names = []
  for (const event of events ?? []) {
    const name = String(event?.toolName ?? event?.title ?? event?.kind ?? '')
    if (name) names.push(name)
  }
  return [...new Set(names)]
}

async function runCommand(command, args, options = {}) {
  return new Promise(resolveRun => {
    const child = spawn(command, args, {
      cwd: options.cwd || repositoryRoot,
      env: { ...process.env, ...options.env },
      stdio: options.stdio || ['ignore', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', chunk => {
      stdout += chunk.toString('utf8')
    })
    child.stderr?.on('data', chunk => {
      stderr += chunk.toString('utf8')
    })
    child.on('close', (code, signal) => {
      resolveRun({
        code: code ?? 1,
        signal: signal || '',
        stdout: redactProcessText(stdout, 8_000),
        stderr: redactProcessText(stderr, 4_000),
      })
    })
  })
}

async function writeReceipt(receipt) {
  await mkdir(dirname(resultPath), { recursive: true })
  await writeFile(resultPath, `${JSON.stringify(receipt, null, 2)}\n`)
}

function printHelp() {
  console.log(`MilkSU product-regression loop

  node scripts/verify-product-loop.mjs --list
  node scripts/verify-product-loop.mjs --suite stop-scope,chat-pin
  node scripts/verify-product-loop.mjs --gui --suite all
  node scripts/verify-product-loop.mjs --bridge --suite dsh

套件：
${DEFAULT_SUITES.map(id => `  ${id.padEnd(12)} ${SUITES[id].title}  (${SUITES[id].from})`).join('\n')}

--gui     启动或附着 Stable（禁止 Beta）。pi-files / dsh 走 Desktop RPC。
--bridge  只跑不需要窗口的套件，并把 dsh 交给 verify-dsh-complete-loop --bridge。
缺 Key 的套件 SKIP 且不把整次运行打成失败。
回执 ${resultPath}
这不是 Settings 评测，也不写模型 Pass@1。
用法：docs/developer/product-regression-loop.md
`)
}

function printList() {
  for (const id of DEFAULT_SUITES) {
    const suite = SUITES[id]
    console.log(`${suite.id}\t${suite.title}\t${suite.from}\t${suite.detail}`)
  }
}

async function runStopScope() {
  const vitest = await runCommand(
    'npx',
    ['vitest', 'run', 'src/composables/useConversationsAbortSteering.test.ts', '-t', 'engine stop scoping'],
    { cwd: join(repositoryRoot, 'app') },
  )
  if (vitest.code !== 0) {
    return {
      result: 'FAIL',
      detail: 'useConversationsAbortSteering engine stop scoping 未过',
      stdout: vitest.stdout.slice(-1_200),
      stderr: vitest.stderr.slice(-800),
    }
  }
  return {
    result: 'PASS',
    detail: 'engine.stopped 带 sessions 才清运行态；无身份不广播',
  }
}

async function runChatPinLogic() {
  const store = await runCommand(
    'go',
    ['test', './internal/conversation', '-count=1', '-run', 'TestStoreRoundTripsPinnedOrder'],
  )
  if (store.code !== 0) {
    return {
      result: 'FAIL',
      detail: 'conversation store 钉选往返未过',
      stderr: store.stderr.slice(-800),
    }
  }
  const pinning = await runCommand(
    'npx',
    ['vitest', 'run', 'src/composables/useConversationsPinning.test.ts', 'src/lib/codingConversationGroups.test.ts'],
    { cwd: join(repositoryRoot, 'app') },
  )
  if (pinning.code !== 0) {
    return {
      result: 'FAIL',
      detail: '钉选 / 分组状态机未过',
      stdout: pinning.stdout.slice(-1_200),
      stderr: pinning.stderr.slice(-800),
    }
  }
  return {
    result: 'PASS',
    detail: 'store 与钉选状态机通过。草稿仍是 Composer 内存，没有 Desktop RPC。',
  }
}

async function runChatPinPersist(driver) {
  const prefix = `loop-pin-${Date.now().toString(36)}`
  const first = await driver.createConversation({
    id: `${prefix}-a`,
    title: `${prefix}-a`,
    pinned: true,
    pinnedOrder: 0,
    kernel: 'pi',
  })
  const second = await driver.createConversation({
    id: `${prefix}-b`,
    title: `${prefix}-b`,
    pinned: true,
    pinnedOrder: 1,
    kernel: 'pi',
  })
  const listed = await driver.listConversations()
  const byId = new Map(listed.map(item => [String(item.id ?? item.ID ?? ''), item]))
  const savedA = byId.get(first.id)
  const savedB = byId.get(second.id)
  const pinnedA = savedA?.pinned === true || savedA?.Pinned === true
  const pinnedB = savedB?.pinned === true || savedB?.Pinned === true
  const orderA = Number(savedA?.pinnedOrder ?? savedA?.PinnedOrder)
  const orderB = Number(savedB?.pinnedOrder ?? savedB?.PinnedOrder)
  if (!pinnedA || !pinnedB || orderA !== 0 || orderB !== 1) {
    return {
      result: 'FAIL',
      detail: `SaveConversation/ListConversations 钉选未往返 a=${pinnedA}/${orderA} b=${pinnedB}/${orderB}`,
    }
  }
  return {
    result: 'PASS',
    detail: 'GUI SaveConversation / ListConversations 钉选顺序往返',
    conversationIds: [first.id, second.id],
  }
}

async function preparePiWorkspace() {
  const root = await mkdtemp(join(repositoryRoot, 'build', 'test-results', 'product-loop-pi-'))
  await runCommand('git', ['init'], { cwd: root })
  await writeFile(join(root, 'README.md'), 'product-loop pi-files workspace\n')
  return root
}

async function runPiFiles(driver, options) {
  const workspace = await preparePiWorkspace()
  try {
    const conversation = await driver.createConversation({
      title: 'product-loop pi-files',
      workspacePath: workspace,
      kernel: 'pi',
      approvalPolicy: 'workspace-auto',
    })
    await driver.sendMessage(conversation.id, TASK_A_PROMPT, workspace)
    const turn = await driver.waitForTurn(conversation.id, options.taskTimeoutMs)
    const notesPath = join(workspace, 'NOTES.md')
    let notes = false
    try {
      await readFile(notesPath)
      notes = true
    } catch {
      notes = false
    }
    const toolNames = collectToolNames(turn.events)
    const usedFiles = toolNames.some(name => FILE_TOOL_PATTERN.test(name))
    if (!notes || !usedFiles || turn.timeout) {
      return {
        result: 'FAIL',
        detail: `NOTES.md=${notes} fileTools=${usedFiles} timeout=${Boolean(turn.timeout)}`,
        toolNames,
      }
    }
    return {
      result: 'PASS',
      detail: 'Pi 写出 NOTES.md 且出现文件工具',
      toolNames,
    }
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
  }
}

async function startMarkerServer() {
  const marker = `MILKSU_SURFACE_${Date.now().toString(36)}`
  const html = `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>MilkSU product-loop fixture</title></head>
  <body>
    <h1>隔离浏览器降级页</h1>
    <p id="marker">${marker}</p>
  </body>
</html>
`
  const server = createServer((request, response) => {
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(html)
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}/`,
    marker,
    close() {
      return new Promise(resolveClose => server.close(() => resolveClose()))
    },
  }
}

async function fileContains(path, needle) {
  try {
    const text = await readFile(path, 'utf8')
    return text.includes(needle)
  } catch {
    return false
  }
}

async function runDesktopSurface(driver, options) {
  const workspace = await mkdtemp(join(repositoryRoot, 'build', 'test-results', 'product-loop-surface-'))
  await runCommand('git', ['init'], { cwd: workspace })
  await writeFile(join(workspace, 'README.md'), 'product-loop desktop-surface workspace\n')
  const fixture = await startMarkerServer()
  const surfacePath = join(workspace, 'SURFACE.md')
  try {
    const targets = await driver.listComputerUseTargets()
    const picked = pickComputerUseTarget(targets)
    if (picked.available) {
      const conversation = await driver.createConversation({
        title: 'product-loop computer-use',
        workspacePath: workspace,
        kernel: 'pi',
        approvalPolicy: 'workspace-auto',
      })
      await driver.sendMessage(conversation.id, TASK_COMPUTER_PROMPT, workspace)
      const turn = await driver.waitForTurn(conversation.id, options.taskTimeoutMs)
      const toolNames = collectToolNames(turn.events)
      let hasSurface = false
      try {
        const text = await readFile(surfacePath, 'utf8')
        hasSurface = text.trim().length > 0
      } catch {
        hasSurface = false
      }
      if (!turn.timeout && usedComputerUseTools(toolNames) && hasSurface) {
        return {
          result: 'PASS',
          detail: `Computer Use 观察了计算器并写下 SURFACE.md`,
          surface: 'computer-use',
          degraded: false,
          toolNames,
        }
      }
      return {
        result: 'FAIL',
        detail: `Computer Use 可用但未完成观察 timeout=${Boolean(turn.timeout)} tools=${usedComputerUseTools(toolNames)} surface=${hasSurface}`,
        surface: 'computer-use',
        degraded: false,
        toolNames,
      }
    }

    const conversation = await driver.createConversation({
      title: 'product-loop isolated-browser',
      workspacePath: workspace,
      kernel: 'pi',
      approvalPolicy: 'workspace-auto',
    })
    await driver.ensureCodingBrowser(conversation.id)
    await driver.sendMessage(conversation.id, browserSurfacePrompt(fixture.url), workspace)
    const turn = await driver.waitForTurn(conversation.id, options.taskTimeoutMs)
    const toolNames = collectToolNames(turn.events)
    const hasMarker = await fileContains(surfacePath, fixture.marker)
    if (!turn.timeout && usedIsolatedBrowserTools(toolNames) && hasMarker) {
      return {
        result: 'PASS',
        detail: `Computer Use 不可用（${picked.reason}），已降级隔离浏览器 CDP 并读到标记`,
        surface: 'isolated-browser',
        degraded: true,
        toolNames,
      }
    }
    return {
      result: 'FAIL',
      detail: `降级隔离浏览器失败 timeout=${Boolean(turn.timeout)} browser=${usedIsolatedBrowserTools(toolNames)} marker=${hasMarker}`,
      surface: 'isolated-browser',
      degraded: true,
      toolNames,
    }
  } finally {
    await fixture.close()
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
  }
}

async function runDshDelegate(mode) {
  const result = await runCommand(
    process.execPath,
    [join(repositoryRoot, 'scripts', 'verify-dsh-complete-loop.mjs'), mode === 'bridge' ? '--bridge' : '--gui'],
    { stdio: 'inherit' },
  )
  let nested
  try {
    nested = JSON.parse(await readFile(join(repositoryRoot, 'build', 'test-results', 'dsh-complete-loop.json'), 'utf8'))
  } catch (error) {
    return {
      result: result.code === 0 ? 'PASS' : 'FAIL',
      detail: `dsh 委托结束 code=${result.code}，读不到回执：${redactProcessText(error instanceof Error ? error.message : error, 200)}`,
    }
  }
  if (nested.skipped) {
    return {
      result: 'SKIP',
      detail: nested.skipReason || 'dsh complete-loop skipped',
      nestedResult: nested.result,
    }
  }
  return {
    result: nested.result === 'PASS' ? 'PASS' : 'FAIL',
    detail: `dsh complete-loop ${nested.result} tasks=${(nested.tasks ?? []).map(task => `${task.id}:${task.result}`).join(',')}`,
    nestedResult: nested.result,
  }
}

function baseReceipt(options) {
  return {
    schemaVersion: PRODUCT_LOOP_SCHEMA,
    mode: options.mode,
    startedAt: new Date().toISOString(),
    finishedAt: '',
    result: 'FAIL',
    tokenfluxBaseURL: TOKENFLUX_BASE_URL,
    family: 'product-regression',
    not: 'settings-evalsuite',
    gaps: [
      '协调器在 scripts/，不进 App 启动、不暴露测试专用 Desktop RPC。',
      'Settings → 评测仍是模型能力 bench（evalsuite / #82），不要和本回执混读。',
      '草稿按对话隔离没有 Desktop RPC，chat-pin 只覆盖钉选落盘。',
      'desktop-surface 优先 Computer Use 观察计算器；不可用才降级隔离浏览器 CDP。不点用户 Chrome。',
      '禁止 desktop:start:beta / MilkSU Beta。',
    ],
    suites: [],
    humanReview: [],
    eventsNote: 'no Provider keys; nested dsh receipt is separately redacted',
  }
}

async function main() {
  const options = parseProductLoopArgs(process.argv.slice(2))
  if (options.help) {
    printHelp()
    return
  }
  if (options.list) {
    printList()
    return
  }

  const receipt = baseReceipt(options)
  let driver = null

  try {
    async function ensureDriver() {
      if (driver?.cdp || options.mode !== 'gui') return driver
      driver = new GuiDriver()
      const attached = await driver.attachOrStart(options.desktopReadyMs)
      if (!attached) receipt.gaps.push(...driver.gaps)
      return driver
    }

    for (const id of options.suites) {
      const suite = SUITES[id]
      const runnable = suiteRunnable(suite, options.mode)
      process.stdout.write(`SUITE ${id} start ${suite.title}\n`)
      let outcome
      if (!runnable.ok) {
        outcome = { result: 'SKIP', detail: runnable.reason }
      } else if (id === 'stop-scope') {
        outcome = await runStopScope()
      } else if (id === 'chat-pin') {
        const logic = await runChatPinLogic()
        if (logic.result !== 'PASS') {
          outcome = logic
        } else if (options.mode === 'gui') {
          await ensureDriver()
          if (driver?.cdp) {
            const persist = await runChatPinPersist(driver)
            outcome = persist.result === 'PASS'
              ? { result: 'PASS', detail: `${logic.detail}；${persist.detail}` }
              : persist
          } else {
            outcome = {
              result: 'PASS',
              detail: `${logic.detail} GUI 落盘未附着窗口。`,
            }
          }
        } else {
          outcome = {
            result: 'PASS',
            detail: `${logic.detail} GUI 落盘未跑（mode=${options.mode}）。`,
          }
        }
      } else if (id === 'pi-files') {
        await ensureDriver()
        if (!driver?.cdp) {
          outcome = { result: 'SKIP', detail: '需要 --gui 且已附着产品窗口' }
        } else {
          const creds = await driver.credentialPresent()
          if (creds === 'none') {
            outcome = { result: 'SKIP', detail: '没有账户会话或 Provider Key，跳过 Pi 文件循环' }
          } else {
            outcome = await runPiFiles(driver, options)
          }
        }
      } else if (id === 'desktop-surface') {
        await ensureDriver()
        if (!driver?.cdp) {
          outcome = { result: 'SKIP', detail: '需要 --gui 且已附着产品窗口' }
        } else {
          const creds = await driver.credentialPresent()
          if (creds === 'none') {
            outcome = { result: 'SKIP', detail: '没有账户会话或 Provider Key，跳过桌面执行面' }
          } else {
            outcome = await runDesktopSurface(driver, options)
          }
        }
      } else if (id === 'dsh') {
        if (driver) {
          await driver.close()
          driver = null
          await delay(1_500)
        }
        outcome = await runDshDelegate(options.mode)
      } else {
        outcome = { result: 'FAIL', detail: `no runner for ${id}` }
      }

      const record = {
        id,
        title: suite.title,
        from: suite.from,
        result: outcome.result,
        detail: redactProcessText(outcome.detail || '', 500),
        toolNames: outcome.toolNames,
        surface: outcome.surface,
        degraded: outcome.degraded,
      }
      receipt.suites.push(record)
      process.stdout.write(`SUITE ${id} ${record.result} ${record.detail}\n`)
    }
  } catch (error) {
    receipt.humanReview.push(redactProcessText(error instanceof Error ? error.message : error, 400))
  } finally {
    if (driver) await driver.close()
  }

  receipt.finishedAt = new Date().toISOString()
  const failed = receipt.suites.filter(item => item.result === 'FAIL')
  receipt.result = failed.length ? 'FAIL' : 'PASS'
  if (!receipt.suites.length && receipt.humanReview.length) receipt.result = 'FAIL'
  await writeReceipt(receipt)
  console.log(`${receipt.result} mode=${options.mode} suites=${receipt.suites.length}`)
  console.log(`receipt ${resultPath}`)
  process.exitCode = receipt.result === 'PASS' ? 0 : 1
}

const invoked = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)
if (invoked) {
  await main()
}
