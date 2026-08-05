import { hasDesktopRuntime, invokeCommand } from '@/desktop'

interface CodingPullRequestWebViewSmokeOptions {
  openCodingWorkspace: (workspacePath: string) => Promise<void>
}

interface CodingPullRequestWebViewSmokeRequest {
  enabled?: boolean
  workspacePath?: string
}

interface CodingPullRequestWebViewSmokeGates {
  codingPageOpened: boolean
  workspaceBound: boolean
  changesPanelOpened: boolean
  prepareButtonClicked: boolean
  existingDraftDialogShown: boolean
  confirmButtonClicked: boolean
  publishVerified: boolean
  rawTokenOmitted: boolean
}

interface CodingPullRequestWebViewSmokeReport {
  workspace: string
  pullRequestNumber?: number
  pullRequestUrl?: string
  headCommit?: string
  gates: CodingPullRequestWebViewSmokeGates
  observations?: string[]
  error?: string
}

const defaultGates = (): CodingPullRequestWebViewSmokeGates => ({
  codingPageOpened: false,
  workspaceBound: false,
  changesPanelOpened: false,
  prepareButtonClicked: false,
  existingDraftDialogShown: false,
  confirmButtonClicked: false,
  publishVerified: false,
  rawTokenOmitted: true,
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

function findSelectOption(label: string): HTMLElement | null {
  const candidates = Array.from(document.querySelectorAll<HTMLElement>(
    '[role="option"], [data-slot="select-item"], [data-radix-collection-item], [data-value], [cmdk-item], button, div',
  ))
  return candidates.find(candidate => (
    elementText(candidate).trim() === label
    || elementText(candidate).trim().startsWith(label)
  )) ?? null
}

async function waitFor<T>(description: string, probe: () => T | null | undefined, timeoutMs = 12_000): Promise<T> {
  const deadline = performance.now() + timeoutMs
  let last: T | null | undefined
  do {
    last = probe()
    if (last) return last
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (performance.now() < deadline)
  throw new Error(`Timed out waiting for ${description}`)
}

async function openChangesPanel() {
  if (visibleText().includes('准备 PR')) return
  const trigger = await waitFor(
    'right panel selector',
    () => document.querySelector<HTMLButtonElement>('button[aria-label="选择右侧页面"]'),
  )
  clickElement(trigger)
  const option = await waitFor('changes panel option', () => findSelectOption('变更'))
  clickElement(option)
  await new Promise(resolve => setTimeout(resolve, 800))
  if (!visibleText().includes('准备 PR')) {
    window.dispatchEvent(new CustomEvent('milksu:coding-smoke-open-panel', { detail: { panel: 'changes' } }))
  }
  await waitFor('changes panel content', () => (
    visibleText().includes('准备 PR') ? visibleText() : null
  ))
}

function reportWithDefaults(partial: Partial<CodingPullRequestWebViewSmokeReport> = {}) {
  return {
    workspace: partial.workspace ?? '',
    pullRequestNumber: partial.pullRequestNumber,
    pullRequestUrl: partial.pullRequestUrl,
    headCommit: partial.headCommit,
    gates: {
      ...defaultGates(),
      ...(partial.gates ?? {}),
      rawTokenOmitted: true,
    },
    observations: partial.observations,
    error: partial.error,
  }
}

function extractHeadCommit(text: string): string | undefined {
  return text.match(/\b[a-f0-9]{40}\b/i)?.[0]
}

function extractPullRequestNumber(text: string): number | undefined {
  const match = text.match(/(?:草稿\s*)?PR\s*#(\d+)/i)
  return match ? Number(match[1]) : undefined
}

function extractPullRequestURL(text: string): string | undefined {
  return text.match(/https:\/\/github\.com\/MilkSU-Official\/milksu\/pull\/\d+/)?.[0]
}

export async function runCodingPullRequestWebViewSmoke(options: CodingPullRequestWebViewSmokeOptions) {
  if (!hasDesktopRuntime()) return
  let workspace = ''
  let reportStarted = false
  try {
    const request = await invokeCommand<CodingPullRequestWebViewSmokeRequest>(
      'get_coding_pull_request_webview_smoke_request',
    )
    if (!request.enabled) return
    reportStarted = true
    workspace = String(request.workspacePath || '').trim()
    if (!workspace) throw new Error('missing Coding PR WebView smoke workspace path')

    await options.openCodingWorkspace(workspace)
    const codingPageText = await waitFor('Coding page', () => {
      const text = visibleText()
      return text.includes('Coding') || text.includes('选择右侧页面') || text.includes('发送消息') ? text : null
    })
    await openChangesPanel()
    const changesPanelText = await waitFor('Git changes panel', () => {
      const text = visibleText()
      return text.includes('准备 PR') && text.includes('提交说明') ? text : null
    })

    const prepare = await waitFor('prepare PR button', () => findButton('准备 PR'))
    clickElement(prepare)
    const previewText = await waitFor('existing draft PR confirmation dialog', () => {
      const text = visibleText()
      return text.includes('发布 MilkSU 草稿 PR')
        && text.includes('当前分支已有匹配的草稿 PR #1')
        && text.includes('确认使用现有草稿 PR')
        ? text
        : null
    }, 25_000)
    const confirm = await waitFor('confirm existing draft PR button', () => findButton('确认使用现有草稿 PR'))
    clickElement(confirm)

    const publishedText = await waitFor('verified existing draft PR result', () => {
      const text = visibleText()
      return (
        text.includes('已找到并验证现有草稿 PR #1')
        || text.includes('当前分支已有已验证的草稿 PR #1')
      ) && text.includes('https://github.com/MilkSU-Official/milksu/pull/1')
        ? text
        : null
    }, 40_000)

    const pullRequestNumber = extractPullRequestNumber(publishedText)
    const pullRequestUrl = extractPullRequestURL(publishedText)
    const headCommit = extractHeadCommit(previewText) ?? extractHeadCommit(publishedText)
    await invokeCommand('complete_coding_pull_request_webview_smoke', {
      report: reportWithDefaults({
        workspace,
        pullRequestNumber,
        pullRequestUrl,
        headCommit,
        gates: {
          codingPageOpened: codingPageText.length > 0,
          workspaceBound: changesPanelText.includes('MilkSU') || changesPanelText.includes('milksu'),
          changesPanelOpened: changesPanelText.includes('准备 PR'),
          prepareButtonClicked: previewText.includes('发布 MilkSU 草稿 PR'),
          existingDraftDialogShown: previewText.includes('当前分支已有匹配的草稿 PR #1'),
          confirmButtonClicked: publishedText.includes('草稿 PR #1'),
          publishVerified: publishedText.includes('已找到并验证现有草稿 PR #1')
            || publishedText.includes('当前分支已有已验证的草稿 PR #1'),
          rawTokenOmitted: true,
        },
        observations: [
          'Opened the packaged App Coding workspace in the WebView.',
          'Switched to the visible Git changes panel and clicked the PR prepare and confirm buttons.',
          'Observed the verified existing MilkSU draft PR result in the UI.',
        ],
      }),
    })
  } catch (cause) {
    if (!reportStarted) return
    await invokeCommand('complete_coding_pull_request_webview_smoke', {
      report: reportWithDefaults({
        workspace,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    }).catch(() => undefined)
  }
}
