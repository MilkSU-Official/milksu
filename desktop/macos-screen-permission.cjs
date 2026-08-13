'use strict'

/**
 * Thin adapter around the macOS CoreGraphics request loaded into Electron's
 * main process. Keeping injection here makes the decision logic unit-testable
 * without prompting from a test runner identity.
 * @param {{ preflight?: () => boolean, request?: () => boolean } | null} native
 * @returns {boolean}
 */
function requestMacOSScreenPermission(native) {
  if (!native || typeof native.preflight !== 'function' || typeof native.request !== 'function') {
    throw new Error('macOS screen permission bridge is unavailable')
  }
  if (native.preflight()) return true
  return Boolean(native.request())
}

module.exports = { requestMacOSScreenPermission }
