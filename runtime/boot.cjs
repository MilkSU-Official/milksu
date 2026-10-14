'use strict'

const { randomUUID } = require('node:crypto')

function resolveHomeRoot(env = process.env) {
  const explicit = String(env.MILKSU_HOME ?? '').trim()
    || String(env.MILKSU_APPDATA_DIR ?? '').trim()
  if (explicit) return explicit
  const home = String(env.HOME ?? env.USERPROFILE ?? '').trim()
  return home ? `${home}/.milksu` : ''
}

function logRuntimeBootStub(env = process.env) {
  const home = resolveHomeRoot(env)
  const bootTrace = `trc_${randomUUID()}`
  console.error(`[${bootTrace}] runtime boot stub loaded home=${home || '(unset)'}`)
}

module.exports = { logRuntimeBootStub, resolveHomeRoot }
