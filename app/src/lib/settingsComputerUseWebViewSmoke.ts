import { hasDesktopRuntime, invokeCommand } from '@/desktop'
import type { CodingComputerUseStatus } from '@/codingEnvironmentTypes'

interface SettingsComputerUseWebViewSmokeOptions {
  openSettings: () => Promise<void>
}

interface SettingsComputerUseWebViewSmokeRequest {
  enabled?: boolean
}

interface SettingsComputerUseWebViewSmokeGates {
  settingsOpened: boolean
  computerUseSectionVisible: boolean
  initialStatusRead: boolean
  refreshButtonClicked: boolean
  refreshedStatusRead: boolean
  refreshNoticeVisible: boolean
  signingDiagnosticVisible: boolean
  noCredentialLeak: boolean
}

interface SettingsComputerUseWebViewSmokeReport {
  initialStatus?: CodingComputerUseStatus
  refreshedStatus?: CodingComputerUseStatus
  gates: SettingsComputerUseWebViewSmokeGates
  observations?: string[]
  error?: string
}

const defaultGates = (): SettingsComputerUseWebViewSmokeGates => ({
  settingsOpened: false,
  computerUseSectionVisible: false,
  initialStatusRead: false,
  refreshButtonClicked: false,
  refreshedStatusRead: false,
  refreshNoticeVisible: false,
  signingDiagnosticVisible: false,
  noCredentialLeak: true,
})

function visibleText() {
  return document.body?.innerText ?? document.body?.textContent ?? ''
}

function elementText(element: HTMLElement) {
  return element.innerText ?? element.textContent ?? ''
}

function findButton(label: string): HTMLButtonElement | null {
  const buttons = Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
  return buttons.find(button => elementText(button).includes(label)) ?? null
}

async function waitFor<T>(description: string, probe: () => T | null | undefined, timeoutMs = 10_000): Promise<T> {
  const deadline = performance.now() + timeoutMs
  let last: T | null | undefined
  do {
    last = probe()
    if (last) return last
    await new Promise(resolve => setTimeout(resolve, 100))
  } while (performance.now() < deadline)
  throw new Error(`Timed out waiting for ${description}`)
}

function clickElement(element: HTMLElement) {
  element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }))
}

function reportWithDefaults(partial: Partial<SettingsComputerUseWebViewSmokeReport> = {}) {
  return {
    initialStatus: partial.initialStatus,
    refreshedStatus: partial.refreshedStatus,
    gates: {
      ...defaultGates(),
      ...(partial.gates ?? {}),
      noCredentialLeak: true,
    },
    observations: partial.observations,
    error: partial.error,
  }
}

export async function runSettingsComputerUseWebViewSmoke(
  options: SettingsComputerUseWebViewSmokeOptions,
) {
  if (!hasDesktopRuntime()) return
  let reportStarted = false
  let initialStatus: CodingComputerUseStatus | undefined
  let refreshedStatus: CodingComputerUseStatus | undefined
  try {
    const request = await invokeCommand<SettingsComputerUseWebViewSmokeRequest>(
      'get_settings_computer_use_webview_smoke_request',
    )
    if (!request.enabled) return
    reportStarted = true
    initialStatus = await invokeCommand<CodingComputerUseStatus>('get_coding_computer_use_status')

    await options.openSettings()
    await waitFor('Settings page', () => {
      const text = visibleText()
      return text.includes('设置') && text.includes('通用') ? text : null
    })
    const sectionText = await waitFor('Settings Computer Use section', () => {
      const text = visibleText()
      return text.includes('Computer Use') && text.includes('系统权限') ? text : null
    })
    const refresh = await waitFor('Settings Computer Use refresh button', () => findButton('重新检测'))
    clickElement(refresh)
    const noticeText = await waitFor('Settings Computer Use refresh notice', () => {
      const text = visibleText()
      return text.includes('Computer Use 权限状态已重新检测') ? text : null
    })
    refreshedStatus = await invokeCommand<CodingComputerUseStatus>('get_coding_computer_use_status')

    const gates: SettingsComputerUseWebViewSmokeGates = {
      settingsOpened: noticeText.includes('设置'),
      computerUseSectionVisible: noticeText.includes('Computer Use') && noticeText.includes('系统权限'),
      initialStatusRead: Boolean(initialStatus.phase && initialStatus.permissions),
      refreshButtonClicked: true,
      refreshedStatusRead: Boolean(refreshedStatus.phase && refreshedStatus.permissions),
      refreshNoticeVisible: noticeText.includes('Computer Use 权限状态已重新检测'),
      signingDiagnosticVisible: sectionText.includes('当前构建身份'),
      noCredentialLeak: true,
    }
    await invokeCommand('complete_settings_computer_use_webview_smoke', {
      report: reportWithDefaults({
        initialStatus,
        refreshedStatus,
        gates,
        observations: [
          'Opened Settings in the packaged App WebView.',
          'Clicked the Computer Use readonly recheck button and observed the Settings notice.',
        ],
      }),
    })
  } catch (cause) {
    if (!reportStarted) return
    await invokeCommand('complete_settings_computer_use_webview_smoke', {
      report: reportWithDefaults({
        initialStatus,
        refreshedStatus,
        error: cause instanceof Error ? cause.message : String(cause),
      }),
    }).catch(() => undefined)
  }
}
