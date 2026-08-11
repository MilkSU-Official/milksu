'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { rendererHeaders, rendererMimeType } = require('./renderer-protocol.cjs')

test('serves renderer files with stable MIME types', () => {
  assert.equal(rendererMimeType('/renderer/index.html'), 'text/html; charset=utf-8')
  assert.equal(rendererMimeType('/renderer/assets/profile.js'), 'text/javascript; charset=utf-8')
  assert.equal(rendererMimeType('/renderer/assets/profile.css'), 'text/css; charset=utf-8')
  assert.equal(rendererMimeType('/renderer/file.bin'), 'application/octet-stream')
})

test('does not reuse renderer resources across packaged app builds', () => {
  const headers = rendererHeaders('/renderer/index.html')
  assert.equal(headers['cache-control'], 'no-store')
  assert.match(headers['content-security-policy'], /default-src 'self'/)
  assert.equal(headers['x-content-type-options'], 'nosniff')
})
