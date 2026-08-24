'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { pluginFrameScriptHeaders, rendererHeaders, rendererMimeType } = require('./renderer-protocol.cjs')

test('serves renderer files with stable MIME types', () => {
  assert.equal(rendererMimeType('/renderer/index.html'), 'text/html; charset=utf-8')
  assert.equal(rendererMimeType('/renderer/assets/profile.js'), 'text/javascript; charset=utf-8')
  assert.equal(rendererMimeType('/renderer/plugins/settings.mjs'), 'text/javascript; charset=utf-8')
  assert.equal(rendererMimeType('/renderer/assets/profile.css'), 'text/css; charset=utf-8')
  assert.equal(rendererMimeType('/renderer/file.bin'), 'application/octet-stream')
})

test('does not reuse renderer resources across packaged app builds', () => {
  const headers = rendererHeaders('/renderer/index.html')
  assert.equal(headers['cache-control'], 'no-store')
  assert.match(headers['content-security-policy'], /default-src 'self'/)
  assert.match(headers['content-security-policy'], /frame-src 'self'/)
  assert.match(headers['content-security-policy'], /frame-ancestors 'none'/)
  assert.match(headers['content-security-policy'], /form-action 'none'/)
  assert.doesNotMatch(headers['content-security-policy'], /script-src[^;]*unsafe-inline/)
  assert.equal(headers['x-content-type-options'], 'nosniff')
})

test('allows only the isolated plugin frame scripts to cross the opaque sandbox origin', () => {
  const headers = pluginFrameScriptHeaders('/renderer/plugin-frame-bootstrap.js')
  assert.equal(headers['content-type'], 'text/javascript; charset=utf-8')
  assert.equal(headers['access-control-allow-origin'], '*')
  assert.equal(headers['cross-origin-resource-policy'], 'cross-origin')
  assert.doesNotMatch(headers['content-security-policy'], /script-src[^;]*unsafe-inline/)
})
