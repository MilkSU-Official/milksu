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

module.exports = { electronNodeEnvironment }
