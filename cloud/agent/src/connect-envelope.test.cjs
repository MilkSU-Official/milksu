'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  FLAG_END_STREAM,
  encodeEnvelope,
  encodeEndStream,
  decodeEnvelopes,
} = require('./connect-envelope.cjs')

test('encode/decode round-trips a SessionEvent envelope', () => {
  const event = {
    id: 'e1',
    type: 'assistant.delta',
    session_id: 's1',
    turn_id: 't1',
    timestamp_ms: 1,
    json_payload: JSON.stringify({ text: 'hi' }),
  }
  const buf = encodeEnvelope(event, 0)
  const { envelopes, rest } = decodeEnvelopes(buf)
  assert.equal(rest.length, 0)
  assert.equal(envelopes.length, 1)
  assert.equal(envelopes[0].endStream, false)
  assert.deepEqual(envelopes[0].json, event)
})

test('end-stream flag is set on final envelope', () => {
  const buf = Buffer.concat([
    encodeEnvelope({ type: 'session.snapshot' }, 0),
    encodeEndStream(),
  ])
  const { envelopes } = decodeEnvelopes(buf)
  assert.equal(envelopes.length, 2)
  assert.equal(envelopes[0].flags & FLAG_END_STREAM, 0)
  assert.equal(envelopes[1].endStream, true)
})
