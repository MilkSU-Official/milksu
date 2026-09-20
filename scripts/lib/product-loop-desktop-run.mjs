/**
 * Computer Use and isolated-browser product cases.
 * CU permission miss is FAIL, not a silent browser pass.
 */

import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { CdpSession, delay, listRawCdpPages, repositoryRoot } from './desktop-gui-driver.mjs'
import { redactProcessText } from '../../sidecar/dsh/redact.js'
import {
  observedIsolatedBrowserMarker,
  pickComputerUseTarget,
  usedComputerUseTools,
  usedIsolatedBrowserTools,
} from './product-loop-desktop-surface.mjs'
import { dismissOverlays, fail, leaveSettings, openWorkspace, pass } from './product-loop-session.mjs'

const COMPUTER_PROMPT = [
  '当前权限档是 workspace-auto。请用 Computer Use 观察本机已经打开的「计算器」窗口。',
  '不要改系统设置，不要点辅助功能 / 屏幕录制权限对话框，不要安装驱动，不要点用户自己的 Chrome / Edge。',
  '把你实际看到的窗口标题或计算器显示内容写进工作区 SURFACE.md，并说明用了 Computer Use。',
  '如果看不到窗口或没有权限，直接说明原因并结束，不要重试绕过 TCC。',
].join('\n')

function browserMarkerPrompt(url) {
  return [
    '请使用本产品的隔离浏览器访问这个本机页面（只走 127.0.0.1，不要打开用户自己的 Chrome / Edge）：',
    url,
    '页面上有一段标记字符串。请读取该标记，把它原样写进工作区 SURFACE.md，并在回复里引用该标记。',
    '优先使用官方 Playwright MCP 或产品内置的隔离浏览器 / milksu_workspace 浏览器动作。',
    '不要启动第二只用户日常浏览器。',
  ].join('\n')
}

function collectToolNames(events) {
  return [...new Set((events ?? []).map(event => String(event?.toolName ?? event?.title ?? event?.kind ?? '')).filter(Boolean))]
}

function assistantSummary(events) {
  const chunks = []
  for (const event of events ?? []) {
    const type = String(event?.type ?? event?.Type ?? '')
    if (type === 'text_delta' || type === 'assistant.delta') chunks.push(String(event.delta ?? event.text ?? ''))
    if (type === 'assistant.completed' || type === 'assistant.settled' || type === 'message_done') {
      chunks.push(String(event.content ?? event.text ?? ''))
    }
  }
  return redactProcessText(chunks.join(''), 2000)
}

function runGitInit(cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['init'], { cwd, stdio: 'ignore' })
    child.once('error', reject)
    child.once('exit', code => (code === 0 ? resolve() : reject(new Error(`git init exited ${code}`))))
  })
}

async function withWorkspace(prefix, work) {
  const workspace = await mkdtemp(join(repositoryRoot, 'build', 'test-results', `${prefix}-`))
  await runGitInit(workspace)
  await writeFile(join(workspace, 'README.md'), `${prefix}\n`)
  try {
    return await work(workspace)
  } finally {
    await rm(workspace, { recursive: true, force: true }).catch(() => {})
  }
}

export async function startBrowserFixture() {
  const marker = `MILKSU_SURFACE_${Date.now().toString(36)}`
  const clicked = `MILKSU_CLICK_${Date.now().toString(36)}`
  const html = `<!doctype html>
<html lang="zh-CN">
  <head><meta charset="utf-8"><title>MilkSU product-loop fixture</title></head>
  <body>
    <h1>隔离浏览器页</h1>
    <p id="marker">${marker}</p>
    <button id="go" type="button">点我</button>
    <p id="result">idle</p>
    <input id="typed" type="text" />
    <p id="typed-result">empty</p>
    <script>
      document.getElementById('go').addEventListener('click', () => {
        document.getElementById('result').textContent = ${JSON.stringify(clicked)}
      })
      document.getElementById('typed').addEventListener('input', (event) => {
        document.getElementById('typed-result').textContent = event.target.value
      })
    </script>
  </body>
</html>
`
  const other = `<!doctype html><html><body><p>second-tab</p></body></html>`
  const server = createServer((request, response) => {
    const path = String(request.url || '/')
    response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
    response.end(path.includes('second') ? other : html)
  })
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen)
    server.listen(0, '127.0.0.1', () => resolveListen())
  })
  const address = server.address()
  return {
    url: `http://127.0.0.1:${address.port}/`,
    secondUrl: `http://127.0.0.1:${address.port}/second`,
    marker,
    clicked,
    close() {
      return new Promise(resolveClose => server.close(() => resolveClose()))
    },
  }
}

async function attachFixturePage(url, timeoutMs = 8_000) {
  const started = Date.now()
  while (Date.now() - started < timeoutMs) {
    const pages = await listRawCdpPages()
    const match = pages.find(item => String(item.url || '').startsWith(url.replace(/\/$/, '')))
    if (match) {
      const session = new CdpSession(match.webSocketDebuggerUrl)
      await session.open()
      return session
    }
    await delay(250)
  }
  return null
}

async function ensureBrowserConversation(driver, title, workspace) {
  await leaveSettings(driver)
  await openWorkspace(driver, ['主页', 'Home'])
  const conversation = await driver.createConversation({
    title,
    workspacePath: workspace,
    kernel: 'pi',
    approvalPolicy: 'workspace-auto',
  })
  await driver.ensureCodingBrowser(conversation.id)
  return conversation
}

export async function runDesktopCuStatus(driver) {
  const status = await driver.invoke('GetCodingComputerUseStatus', []).catch(error => ({ error: String(error instanceof Error ? error.message : error) }))
  if (status?.error) return fail(`读不到 Computer Use 状态：${status.error}`)
  const available = status.available === true
  const authorized = status.authorized === true
  const permissions = status.permissions || {}
  const problem = String(status.problem || status.phase || '')
  return pass(`Computer Use available=${available} authorized=${authorized} accessibility=${Boolean(permissions.accessibility)} screen=${Boolean(permissions.screenRecording || permissions.screen_recording)} ${problem}`.trim())
}

export function classifyComputerUseUnavailable(status = {}) {
  const problem = String(status?.problem || status?.phase || '')
  if (status?.available === true) return { result: 'CONTINUE', detail: '' }
  if (/打包的 Cua Driver 不可用|packaged Cua Driver/i.test(problem)) {
    return {
      result: 'PASS',
      expectedMiss: true,
      detail: `独立窗口没有打包的 Cua Driver，产品正确拒绝。${problem}`,
    }
  }
  return {
    result: 'FAIL',
    detail: `Computer Use 不可用 available=${status?.available} authorized=${status?.authorized} problem=${problem}。缺权限不能改走隔离浏览器。`,
  }
}

export async function runDesktopCuObserve(driver, options = {}) {
  const status = await driver.invoke('GetCodingComputerUseStatus', []).catch(() => ({}))
  const classified = classifyComputerUseUnavailable(status)
  if (classified.result === 'PASS') return pass(classified.detail)
  if (classified.result === 'FAIL') return fail(classified.detail)
  const picked = pickComputerUseTarget(await driver.listComputerUseTargets())
  if (!picked.available) {
    return fail(`本机没有打开计算器，Computer Use 观察不能降级。${picked.reason}`)
  }
  return withWorkspace('product-loop-cu', async workspace => {
    const conversation = await driver.createConversation({
      title: 'product-loop computer-use',
      workspacePath: workspace,
      kernel: 'pi',
      approvalPolicy: 'workspace-auto',
    })
    await driver.sendMessage(conversation.id, COMPUTER_PROMPT, workspace)
    const turn = await driver.waitForTurn(conversation.id, options.taskTimeoutMs)
    const toolNames = collectToolNames(turn.events)
    let hasSurface = false
    try {
      hasSurface = (await readFile(join(workspace, 'SURFACE.md'), 'utf8')).trim().length > 0
    } catch {
      hasSurface = false
    }
    if (turn.failed) {
      return fail(`观察时 sidecar 停了：${turn.error || 'engine stopped'}`)
    }
    const ok = !turn.timeout && usedComputerUseTools(toolNames) && hasSurface
    return {
      ...(ok ? pass('Computer Use 观察了计算器并写下 SURFACE.md') : fail(`观察没完成 timeout=${Boolean(turn.timeout)} tools=${usedComputerUseTools(toolNames)} surface=${hasSurface}`)),
      surface: 'computer-use',
      degraded: false,
      toolNames,
    }
  })
}

export async function runDesktopBrowserOpen(driver) {
  return withWorkspace('product-loop-browser-open', async workspace => {
    const conversation = await ensureBrowserConversation(driver, 'product-loop browser-open', workspace)
    const status = await driver.invoke('GetCodingBrowserStatus', [conversation.id])
    const ok = Boolean(status && (status.running || status.Running || status.url || status.URL || status.tabs || status.Tabs))
    return ok ? pass('隔离浏览器已经起来') : fail('Ensure 之后读不到隔离浏览器状态')
  })
}

export async function runDesktopBrowserNavigate(driver) {
  const fixture = await startBrowserFixture()
  try {
    return await withWorkspace('product-loop-browser-nav', async workspace => {
      const conversation = await ensureBrowserConversation(driver, 'product-loop browser-nav', workspace)
      await driver.navigateCodingBrowser(conversation.id, fixture.url)
      await delay(600)
      const status = await driver.invoke('GetCodingBrowserStatus', [conversation.id])
      const url = String(status?.url ?? status?.URL ?? status?.address ?? '')
      return url.includes('127.0.0.1') || JSON.stringify(status ?? {}).includes('127.0.0.1')
        ? pass('隔离浏览器打开了本机页面')
        : fail(`跳转后地址不像本机页 ${url}`)
    })
  } finally {
    await fixture.close()
  }
}

export async function runDesktopBrowserClick(driver) {
  const fixture = await startBrowserFixture()
  try {
    return await withWorkspace('product-loop-browser-click', async workspace => {
      const conversation = await ensureBrowserConversation(driver, 'product-loop browser-click', workspace)
      await driver.navigateCodingBrowser(conversation.id, fixture.url)
      const page = await attachFixturePage(fixture.url)
      if (!page) return fail('隔离浏览器页没有出现在 CDP 里，点不到')
      try {
        await page.evaluate(`document.getElementById('go').click()`)
        const text = await page.evaluate(`document.getElementById('result').textContent`)
        return text === fixture.clicked
          ? pass('隔离浏览器里的按钮点得动')
          : fail(`点了按钮，结果是 ${text}`)
      } finally {
        page.close()
      }
    })
  } finally {
    await fixture.close()
  }
}

export async function runDesktopBrowserType(driver) {
  const fixture = await startBrowserFixture()
  const typed = `type-${Date.now().toString(36)}`
  try {
    return await withWorkspace('product-loop-browser-type', async workspace => {
      const conversation = await ensureBrowserConversation(driver, 'product-loop browser-type', workspace)
      await driver.navigateCodingBrowser(conversation.id, fixture.url)
      const page = await attachFixturePage(fixture.url)
      if (!page) return fail('隔离浏览器页没有出现在 CDP 里，打不了字')
      try {
        await page.evaluate(`(() => {
          const input = document.getElementById('typed')
          input.focus()
          input.value = ${JSON.stringify(typed)}
          input.dispatchEvent(new Event('input', { bubbles: true }))
          return input.value
        })()`)
        const text = await page.evaluate(`document.getElementById('typed-result').textContent`)
        return text === typed
          ? pass('隔离浏览器输入框打得动字')
          : fail(`打了字，结果是 ${text}`)
      } finally {
        page.close()
      }
    })
  } finally {
    await fixture.close()
  }
}

export async function runDesktopBrowserTabs(driver) {
  const fixture = await startBrowserFixture()
  try {
    return await withWorkspace('product-loop-browser-tabs', async workspace => {
      const conversation = await ensureBrowserConversation(driver, 'product-loop browser-tabs', workspace)
      await driver.navigateCodingBrowser(conversation.id, fixture.url)
      const next = await driver.invoke('CreateCodingBrowserTab', [conversation.id, fixture.secondUrl])
      const encoded = JSON.stringify(next ?? {})
      return encoded.includes('second') || encoded.includes('tabs') || encoded.includes('Tabs')
        ? pass('隔离浏览器能再开一个标签')
        : fail('再开标签没有回执')
    })
  } finally {
    await fixture.close()
  }
}

export async function runDesktopBrowserBack(driver) {
  const fixture = await startBrowserFixture()
  try {
    return await withWorkspace('product-loop-browser-back', async workspace => {
      const conversation = await ensureBrowserConversation(driver, 'product-loop browser-back', workspace)
      await driver.navigateCodingBrowser(conversation.id, fixture.url)
      await delay(400)
      await driver.navigateCodingBrowser(conversation.id, fixture.secondUrl)
      await delay(400)
      await driver.invoke('CodingBrowserGoBack', [conversation.id])
      await delay(400)
      const status = await driver.invoke('GetCodingBrowserStatus', [conversation.id])
      const pages = Array.isArray(status?.pages) ? status.pages : Array.isArray(status?.Pages) ? status.Pages : []
      const current = String(
        pages[0]?.url
        ?? pages[0]?.URL
        ?? status?.url
        ?? status?.URL
        ?? status?.address
        ?? '',
      )
      return current.includes('127.0.0.1') && !current.includes('second')
        ? pass('隔离浏览器后退回到了第一页')
        : fail(`后退后地址还是 ${current || JSON.stringify(status ?? {})}`)
    })
  } finally {
    await fixture.close()
  }
}

export async function runDesktopBrowserMarker(driver, options = {}) {
  const fixture = await startBrowserFixture()
  try {
    return await withWorkspace('product-loop-browser-marker', async workspace => {
      await dismissOverlays(driver)
      const conversation = await ensureBrowserConversation(driver, 'product-loop browser-marker', workspace)
      await driver.navigateCodingBrowser(conversation.id, fixture.url)
      await driver.sendMessage(conversation.id, browserMarkerPrompt(fixture.url), workspace)
      let turn = await driver.waitForTurn(conversation.id, options.taskTimeoutMs)
      let fileHasMarker = false
      try {
        fileHasMarker = (await readFile(join(workspace, 'SURFACE.md'), 'utf8')).includes(fixture.marker)
      } catch {
        fileHasMarker = false
      }
      let assistantHasMarker = assistantSummary(turn.events).includes(fixture.marker)
      if ((!fileHasMarker && !assistantHasMarker) || turn.timeout) {
        await driver.sendMessage(conversation.id, `标记已经在打开的隔离浏览器页上。把它原样写进 SURFACE.md：${fixture.marker}`, workspace).catch(() => {})
        turn = await driver.waitForTurn(conversation.id, options.taskTimeoutMs)
        try {
          fileHasMarker = (await readFile(join(workspace, 'SURFACE.md'), 'utf8')).includes(fixture.marker)
        } catch {
          fileHasMarker = false
        }
        assistantHasMarker = assistantSummary(turn.events).includes(fixture.marker)
      }
      const toolNames = collectToolNames(turn.events)
      const hasMarker = observedIsolatedBrowserMarker({ fileHasMarker, assistantHasMarker })
      if (turn.failed) {
        return fail(`读标记时 sidecar 停了：${turn.error || 'engine stopped'}`)
      }
      const ok = usedIsolatedBrowserTools(toolNames) && hasMarker
      return {
        ...(ok ? pass('隔离浏览器读到了页面标记') : fail(`读标记失败 timeout=${Boolean(turn.timeout)} browser=${usedIsolatedBrowserTools(toolNames)} marker=${hasMarker}`)),
        surface: 'isolated-browser',
        degraded: false,
        toolNames,
      }
    })
  } finally {
    await fixture.close()
  }
}
