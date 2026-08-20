'use strict'

const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

test('Cmd+Q does not intercept Electron quit to wait for Go teardown', () => {
  const source = readFileSync(join(__dirname, 'main.cjs'), 'utf8')
  const match = source.match(/app\.on\('before-quit',[\s\S]*?process\.on\('SIGTERM'/)
  assert.ok(match, 'missing before-quit handler')
  assert.doesNotMatch(match[0], /event\.preventDefault/)
  assert.doesNotMatch(match[0], /teardownDesktopRuntime/)
  assert.match(match[0], /type: 'shutdown'/)
})
