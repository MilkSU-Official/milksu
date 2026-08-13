'use strict'

/**
 * Host-attributed Computer Use TCC probes for the Electron shell.
 *
 * MilkSU embeds cua-driver under host attribution. Accessibility / Screen
 * Recording grants must therefore be read from the Electron app identity
 * (com.milksu.app / com.milksu.app.beta), not from the Go runtime binary's
 * separate codesign principal.
 */

/**
 * @param {{
 *   isTrustedAccessibilityClient?: (prompt: boolean) => boolean,
 *   getMediaAccessStatus?: (mediaType: string) => string,
 * }} prefs Electron systemPreferences-like facade
 * @param {{ prompt?: boolean }} [options]
 * @returns {{
 *   accessibility: boolean,
 *   screenRecording: boolean,
 *   screenStatus: string,
 * }}
 */
function probeComputerUsePermissions(prefs, options = {}) {
  const prompt = Boolean(options.prompt)
  let accessibility = false
  try {
    accessibility = Boolean(prefs?.isTrustedAccessibilityClient?.(prompt))
  } catch {
    accessibility = false
  }

  let screenStatus = 'unknown'
  try {
    const raw = prefs?.getMediaAccessStatus?.('screen')
    screenStatus = String(raw ?? 'unknown').trim() || 'unknown'
  } catch {
    screenStatus = 'unknown'
  }
  // Only an explicit granted status counts. never invent true from unknown/denied.
  const screenRecording = screenStatus === 'granted'
  return {
    accessibility,
    screenRecording,
    screenStatus,
  }
}

/**
 * Choose the exact System Settings privacy pane for an explicit user action.
 * Keeping this selector explicit prevents Accessibility and Screen Recording
 * from collapsing into one ambiguous button.
 * @param {'accessibility' | 'screen-recording' | string} permission
 * @returns {string}
 */
function computerUsePermissionsSettingsURL(permission) {
  if (permission === 'screen-recording') {
    return 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
  }
  if (permission === 'accessibility') {
    return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
  }
  throw new Error(`unsupported Computer Use permission ${JSON.stringify(permission)}`)
}

/**
 * Register the currently running, signed Electron host with macOS before
 * opening System Settings. A fresh install otherwise may land on a privacy
 * pane that does not contain MilkSU yet.
 *
 * Screen Recording has no Electron askForMediaAccess API. The caller supplies
 * a renderer-backed getDisplayMedia request because desktopCapturer.getSources
 * only enumerates sources and does not register a fresh host in macOS TCC.
 * @param {{
 *   isTrustedAccessibilityClient?: (prompt: boolean) => boolean,
 *   getMediaAccessStatus?: (mediaType: string) => string,
 * }} prefs
 * @param {(() => Promise<unknown>) | undefined} requestScreenRecording
 * @param {'accessibility' | 'screen-recording' | string} permission
 */
async function primeComputerUsePermission(prefs, requestScreenRecording, permission) {
  if (permission === 'accessibility') {
    try {
      prefs?.isTrustedAccessibilityClient?.(true)
    } catch {
      // The exact privacy pane still gives the user a recoverable path.
    }
    return probeComputerUsePermissions(prefs, { prompt: false })
  }
  if (permission === 'screen-recording') {
    const before = probeComputerUsePermissions(prefs, { prompt: false })
    if (!before.screenRecording) {
      try {
        await requestScreenRecording?.()
      } catch {
        // Denied/restricted systems are handled by the exact Settings pane.
      }
    }
    return probeComputerUsePermissions(prefs, { prompt: false })
  }
  throw new Error(`unsupported Computer Use permission ${JSON.stringify(permission)}`)
}

/**
 * A Screen Recording grant may ask macOS to quit the app. MilkSU performs an
 * asynchronous backend shutdown, so the system's immediate reopen can race the
 * existing single-instance lock. Arm an Electron-owned relaunch only for the
 * short window in which an ungranted screen permission became granted.
 * @param {{ openedAt?: number, previousStatus?: string } | null} arm
 * @param {string} currentStatus
 * @param {number} [now]
 * @returns {boolean}
 */
function shouldRelaunchAfterScreenRecordingGrant(arm, currentStatus, now = Date.now()) {
  const openedAt = Number(arm?.openedAt)
  if (!Number.isFinite(openedAt) || openedAt <= 0) return false
  if (now < openedAt || now - openedAt > 10 * 60 * 1000) return false
  return String(arm?.previousStatus ?? '') !== 'granted'
    && String(currentStatus ?? '') === 'granted'
}

module.exports = {
  probeComputerUsePermissions,
  computerUsePermissionsSettingsURL,
  primeComputerUsePermission,
  shouldRelaunchAfterScreenRecordingGrant,
}
