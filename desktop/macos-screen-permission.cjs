'use strict'

/**
 * Thin adapter around the macOS CoreGraphics request loaded into Electron's
 * main process. Keeping injection here makes the decision logic unit-testable
 * without prompting from a test runner identity.
 * The native request runs on a libuv worker because macOS may wait for a user
 * decision; blocking Electron's main thread prevents the permission UI and the
 * MilkSU window from processing events.
 * @param {{ preflight?: () => boolean, request?: () => boolean | Promise<boolean> } | null} native
 * @returns {Promise<boolean>}
 */
async function requestMacOSScreenPermission(native) {
  if (!native || typeof native.preflight !== 'function' || typeof native.request !== 'function') {
    throw new Error('macOS screen permission bridge is unavailable')
  }
  if (native.preflight()) return true
  return Boolean(await native.request())
}

module.exports = { requestMacOSScreenPermission }
