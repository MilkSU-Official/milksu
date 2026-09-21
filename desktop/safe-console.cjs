'use strict'

function isBrokenPipeError(error) {
  const code = error?.code
  return code === 'EPIPE' || code === 'ERR_STREAM_DESTROYED'
}

function ignoreBrokenPipe(stream) {
  if (!stream || typeof stream.on !== 'function' || stream.__milksuPipeGuarded) return
  stream.__milksuPipeGuarded = true
  stream.on('error', error => {
    if (isBrokenPipeError(error)) return
  })
}

function patchConsoleMethod(method) {
  const original = console[method]
  if (typeof original !== 'function' || original.__milksuPipeSafe) return
  const bound = original.bind(console)
  const wrapped = (...args) => {
    try {
      return bound(...args)
    } catch (error) {
      if (isBrokenPipeError(error)) return undefined
      throw error
    }
  }
  wrapped.__milksuPipeSafe = true
  console[method] = wrapped
}

/**
 * Attach once so stdout/stderr EPIPE (product-loop / detached Electron) does not
 * become an uncaughtException dialog from console.info or stream 'error' events.
 */
function installBrokenPipeGuards() {
  ignoreBrokenPipe(process.stdout)
  ignoreBrokenPipe(process.stderr)
  for (const method of ['info', 'log', 'warn', 'error', 'debug']) {
    patchConsoleMethod(method)
  }
}

function safeConsoleInfo(...args) {
  console.info(...args)
}

function safeConsoleError(...args) {
  console.error(...args)
}

function safeConsoleWarn(...args) {
  console.warn(...args)
}

function safeConsoleLog(...args) {
  console.log(...args)
}

module.exports = {
  installBrokenPipeGuards,
  isBrokenPipeError,
  safeConsoleError,
  safeConsoleInfo,
  safeConsoleLog,
  safeConsoleWarn,
}
