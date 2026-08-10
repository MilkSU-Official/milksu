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
 * Choose the System Settings privacy pane to open for an explicit user action.
 * @param {{ accessibility?: boolean, screenRecording?: boolean }} permissions
 * @returns {string}
 */
function computerUsePermissionsSettingsURL(permissions = {}) {
  if (permissions.accessibility && !permissions.screenRecording) {
    return 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture'
  }
  return 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
}

module.exports = {
  probeComputerUsePermissions,
  computerUsePermissionsSettingsURL,
}
