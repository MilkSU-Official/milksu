'use strict'

function electronNodeEnvironment(platform = process.platform, environment = process.env) {
  const result = { ELECTRON_RUN_AS_NODE: '1' }
  if (platform !== 'win32') return result

  const systemRoot = String(environment.SystemRoot ?? '').trim()
  if (!systemRoot) {
    throw new Error('Windows SystemRoot is required to start the private DevTools port probe')
  }
  result.SystemRoot = systemRoot
  return result
}

function desktopBackendEnvironment(environment = process.env, options = {}) {
  const hostPid = Number(options.hostPid)
  if (!Number.isSafeInteger(hostPid) || hostPid <= 1) {
    throw new Error('MilkSU desktop host PID must be a positive process id')
  }
  return {
    ...environment,
    MILKSU_CHANNEL: String(options.channel ?? ''),
    MILKSU_DESKTOP_APP_ID: String(options.appId ?? ''),
    // Runtime compatibility checks use the application version, not the
    // independently-built Go helper version.
    MILKSU_APP_VERSION: String(options.appVersion ?? ''),
    // Always replace caller input with the actual Electron main-process PID.
    // The Go runtime uses it only to exclude the controlling MilkSU window.
    MILKSU_DESKTOP_HOST_PID: String(hostPid),
  }
}

module.exports = { desktopBackendEnvironment, electronNodeEnvironment }
