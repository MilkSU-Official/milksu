'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')
const { parseURL } = require('./parse-url.cjs')

test('parseURL returns null for malformed input and preserves valid URLs', () => {
  assert.equal(parseURL('not a URL'), null)
  assert.equal(parseURL('http://['), null)
  assert.equal(parseURL(''), null)
  assert.equal(parseURL('https://example.org/path')?.href, 'https://example.org/path')
  assert.equal(parseURL('milksu://app/index.html')?.host, 'app')
})
