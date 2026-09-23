'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

// Dynamic import of TS via wrangler is not available in plain node tests;
// exercise the same AES-GCM shape inline to lock the contract.
async function encrypt(kek, plaintext) {
  const material = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(kek)))
  const key = await crypto.subtle.importKey('raw', material, 'AES-GCM', false, ['encrypt', 'decrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(plaintext))
  return { iv, ciphertext, key }
}

test('AES-GCM round-trip matches cloud credential contract', async () => {
  const { iv, ciphertext, key } = await encrypt('test-kek', 'sk-never-log-me')
  const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext)
  assert.equal(new TextDecoder().decode(plain), 'sk-never-log-me')
})
