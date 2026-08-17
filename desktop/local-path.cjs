'use strict'

const path = require('node:path')

async function openLocalPath(target, { stat, openPath }) {
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

  const errorMessage = await openPath(resolved)
  if (errorMessage) throw new Error(`open local path: ${errorMessage}`)
}

module.exports = { openLocalPath }
