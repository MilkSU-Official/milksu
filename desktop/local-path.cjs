'use strict'

const path = require('node:path')

async function resolveLocalPath(target, stat) {
  const resolved = String(target ?? '').trim()
  if (!resolved || !path.isAbsolute(resolved)) {
    throw new Error('local path must be absolute')
  }

  let metadata
  try {
    metadata = await stat(resolved)
  } catch (error) {
    throw new Error(`local path is unavailable: ${error.message}`)
  }
  if (!metadata.isDirectory() && !metadata.isFile()) {
    throw new Error('local path is not a file or directory')
  }
  return resolved
}

async function openLocalPath(target, { stat, openPath }) {
  const resolved = await resolveLocalPath(target, stat)
  const errorMessage = await openPath(resolved)
  if (errorMessage) throw new Error(`open local path: ${errorMessage}`)
}

// revealLocalPath shows the entry in the platform file manager with the entry
// itself selected. Opening it instead would launch a file in its default
// application, which is not what revealing a snapshot or an evidence file means.
async function revealLocalPath(target, { stat, showItemInFolder }) {
  const resolved = await resolveLocalPath(target, stat)
  await showItemInFolder(resolved)
}

module.exports = { openLocalPath, revealLocalPath }
