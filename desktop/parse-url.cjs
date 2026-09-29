'use strict'

function parseURL(value) {
  try {
    return new URL(value)
  } catch {
    return null
  }
}

module.exports = { parseURL }
