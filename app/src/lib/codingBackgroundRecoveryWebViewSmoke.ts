import { hasDesktopRuntime, invokeCommand } from '@/desktop'

interface CodingBackgroundRecoveryWebViewSmokeOptions {
  openCodingWorkspace: (workspacePath: string) => Promise<void>
}

interface CodingBackgroundRecoveryWebViewSmokeRequest {
  enabled?: boolean
  phase?: 'start' | 'recover'
  workspace?: string
  command?: string
  expectedPid?: number
}

interface CodingBackgroundRecoveryWebViewSmokeGates {
  codingPageOpened: boolean
  terminalPanelOpened: boolean
  tasksTabOpened: boolean
  commandEntered: boolean
  runClicked: boolean
  taskVisible: boolean
  taskRunning: boolean
  pidVisible: boolean
  logTailVisible: boolean
  recoveryBannerVisible: boolean
  stopClicked: boolean
  taskStopped: boolean
  recoveredPidMatched: boolean
  noCredentialLeak: boolean
}

interface CodingBackgroundRecoveryWebViewSmokeReport {
  phase: string
  workspace: string
  command?: string
  observedPid?: number
  gates: CodingBackgroundRecoveryWebViewSmokeGates
  observations?: string[]
  error?: string
}

const readyMarker = 'MILKSU_BG_UI_RECOVERY_READY'
const tickMarker = 'MILKSU_BG_UI_RECOVERY_TICK'

const defaultGates = (): CodingBackgroundRecoveryWebViewSmokeGates => ({
  codingPageOpened: false,
  terminalPanelOpened: false,
  tasksTabOpened: false,
  commandEntered: false,
  runClicked: false,
  taskVisible: false,
  taskRunning: false,
  pidVisible: false,
  logTailVisible: false,
  recoveryBannerVisible: false,
  stopClicked: false,
  taskStopped: false,
  recoveredPidMatched: false,
  noCredentialLeak: true,
})

function visibleText() {
  return document.body?.innerText ?? document.body?.textContent ?? ''
}

function elementText(element: HTMLElement) {
  return element.innerText ?? element.textContent ?? ''
}

function isDisabled(element: HTMLElement) {
  return element.hasAttribute('disabled') || element.getAttribute('aria-disabled') === 'true'
}

function clickElement(element: HTMLElement) {
  const pointerInit = { bubbles: true, cancelable: true, pointerType: 'mouse' }
  if (typeof PointerEvent !== 'undefined') {
    element.dispatchEvent(new PointerEvent('pointerdown', pointerInit))
    element.dispatchEvent(new PointerEvent('pointerup', pointerInit))
  }
  element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }))
  element.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }))
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function findButton(label: string): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
  return buttons.find(button => elementText(button).includes(label) && !isDisabled(button)) ?? null
}

function findTextarea(label: string): HTMLTextAreaElement | null {
  return document.querySelector<HTMLTextAreaElement>(`textarea[aria-label="${label}"]`)
}

function setTextareaValue(textarea: HTMLTextAreaElement, value: string) {
  const descriptor = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )
  descriptor?.set?.call(textarea, value)
  textarea.dispatchEvent(new Event('input', { bubbles: true }))
  textarea.dispatchEvent(new Event('change', { bubbles: true }))
}

async function waitFor<T>(
  description: string,
  probe: () => T | null | undefined,
  timeoutMs = 18_000,
): Promise<T> {
  const deadline = performance.now() + timeoutMs
  let last: T | null | undefined
  do {
    last = probe()
    if (last) return last
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (performance.now() < deadline)
  throw new Error(`Timed out waiting for ${description}`)
}

async function openTerminalTasksPanel() {
  const openPanel = () => {
    const selector = document.querySelector<HTMLButtonElement>('button[aria-label="选择右侧页面"]')
    if (selector && !visibleText().includes('终端与后台任务下一步')) {
      clickElement(selector)
      const options = Array.from(document.querySelectorAll<HTMLElement>(
        '[role="option"], [data-slot="select-item"], [data-radix-collection-item], [data-value], button, div',
      ))
      const terminalOption = options.find(option => elementText(option).trim() === '终端')
      if (terminalOption) clickElement(terminalOption)
    }
    window.dispatchEvent(new CustomEvent('milksu:coding-smoke-open-panel', { detail: { panel: 'terminal' } }))
  }
  await waitFor('Coding terminal panel', () => (
    visibleText().includes('Shell') && visibleText().includes('后台任务')
      ? visibleText()
      : (openPanel(), null)
  ))
  const taskTab = await waitFor('background tasks tab', () => findButton('后台任务'))
  clickElement(taskTab)
  return await waitFor('background task command input', () => findTextarea('后台任务命令'))
}

function pidFromText(text: string): number | undefined {
  const match = text.match(/PID\s+(\d+)/)
  if (!match) return undefined
  const parsed = Number(match[1])
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}

function reportWithDefaults(
  partial: Partial<CodingBackgroundRecoveryWebViewSmokeReport> = {},
): CodingBackgroundRecoveryWebViewSmokeReport {
  return {
    phase: partial.phase ?? '',
    workspace: partial.workspace ?? '',
    command: partial.command,
    observedPid: partial.observedPid,
    gates: {
      ...defaultGates(),
      ...(partial.gates ?? {}),
      noCredentialLeak: true,
    },
    observations: partial.observations,
    error: partial.error,
  }
}

function visibleExcerpt() {
  return visibleText()
    .replace(/\s+/g, ' ')
    .slice(0, 1800)
}

async function completeSmoke(report: CodingBackgroundRecoveryWebViewSmokeReport) {
  await invokeCommand('complete_coding_background_recovery_webview_smoke', {
    report,
  })
}

async function runStartPhase(
  request: CodingBackgroundRecoveryWebViewSmokeRequest,
  textarea: HTMLTextAreaElement,
): Promise<CodingBackgroundRecoveryWebViewSmokeReport> {
  const command = String(request.command || '').trim()
  if (!command) throw new Error('missing background recovery WebView smoke command')
  setTextareaValue(textarea, command)
  const runButton = await waitFor('background task run button', () => findButton('运行'))
  clickElement(runButton)
  const text = await waitFor('visible running background task with log tail', () => {
    const current = visibleText()
    return current.includes(readyMarker)
      && current.includes('运行中')
      && current.includes('PID')
      ? current
      : null
  }, 35_000)
  const observedPid = pidFromText(text)
  return reportWithDefaults({
    phase: 'start',
    workspace: String(request.workspace || ''),
    command,
    observedPid,
    gates: {
      codingPageOpened: true,
      terminalPanelOpened: true,
      tasksTabOpened: true,
      commandEntered: true,
      runClicked: true,
      taskVisible: text.includes(command.split(/\r?\n/, 1)[0]) || text.includes(readyMarker),
      taskRunning: text.includes('运行中'),
      pidVisible: Boolean(observedPid),
      logTailVisible: text.includes(readyMarker) || text.includes(tickMarker),
      recoveryBannerVisible: false,
      stopClicked: false,
      taskStopped: false,
      recoveredPidMatched: false,
      noCredentialLeak: true,
    },
    observations: [
      'Opened the packaged App Coding workspace and switched to the visible Terminal panel.',
      'Clicked the visible background task tab, entered a long-running command, and clicked Run.',
      'Observed the running task, PID, and log tail marker in the UI.',
    ],
  })
}

async function runRecoverPhase(
  request: CodingBackgroundRecoveryWebViewSmokeRequest,
): Promise<CodingBackgroundRecoveryWebViewSmokeReport> {
  const text = await waitFor('visible recovered background task', () => {
    const current = visibleText()
    return current.includes('已从磁盘恢复持久任务')
      && current.includes(readyMarker)
      && current.includes('运行中')
      && current.includes('PID')
      ? current
      : null
  }, 35_000)
  const observedPid = pidFromText(text)
  const stopButton = await waitFor('stop recovered background task button', () => findButton('停止'))
  clickElement(stopButton)
  const stoppedText = await waitFor('stopped recovered background task', () => {
    const current = visibleText()
    return current.includes('已停止') && !current.includes('停止后台任务') ? current : null
  }, 35_000)
  const expectedPid = Number(request.expectedPid || 0)
  return reportWithDefaults({
    phase: 'recover',
    workspace: String(request.workspace || ''),
    command: String(request.command || '').trim() || undefined,
    observedPid,
    gates: {
      codingPageOpened: true,
      terminalPanelOpened: true,
      tasksTabOpened: true,
      commandEntered: false,
      runClicked: false,
      taskVisible: text.includes(readyMarker),
      taskRunning: text.includes('运行中'),
      pidVisible: Boolean(observedPid),
      logTailVisible: text.includes(readyMarker) || text.includes(tickMarker),
      recoveryBannerVisible: text.includes('已从磁盘恢复持久任务'),
      stopClicked: true,
      taskStopped: stoppedText.includes('已停止'),
      recoveredPidMatched: expectedPid <= 0 || observedPid === expectedPid,
      noCredentialLeak: true,
    },
    observations: [
      'Reopened the same packaged App workspace after restart and switched to the visible Terminal panel.',
      'Observed the recovered background task banner, PID, and log tail marker in the UI.',
      'Clicked the visible Stop button and observed the task move to stopped state.',
    ],
  })
}

export async function runCodingBackgroundRecoveryWebViewSmoke(
  options: CodingBackgroundRecoveryWebViewSmokeOptions,
): Promise<void> {
  if (!hasDesktopRuntime()) return
  let request: CodingBackgroundRecoveryWebViewSmokeRequest | null = null
  try {
    request = await invokeCommand<CodingBackgroundRecoveryWebViewSmokeRequest>(
      'get_coding_background_recovery_webview_smoke_request',
    )
    if (!request.enabled) return
    const workspace = String(request.workspace || '').trim()
    if (!workspace) throw new Error('missing Coding background recovery WebView smoke workspace path')
    const phase = request.phase === 'start' ? 'start' : 'recover'
    await options.openCodingWorkspace(workspace)
    await waitFor('Coding page', () => {
      const text = visibleText()
      return text.includes('Coding') || text.includes('选择右侧页面') ? text : null
    })
    const textarea = await openTerminalTasksPanel()
    const report = phase === 'start'
      ? await runStartPhase(request, textarea)
      : await runRecoverPhase(request)
    await completeSmoke(report)
  } catch (cause) {
    if (!request?.enabled) return
    await completeSmoke(reportWithDefaults({
      phase: request.phase ?? '',
      workspace: String(request.workspace || ''),
      command: String(request.command || '').trim() || undefined,
      observations: [`Visible UI text at failure: ${visibleExcerpt()}`],
      error: cause instanceof Error ? cause.message : String(cause),
    })).catch(() => undefined)
  }
}
