'use strict'

/**
 * Connect streaming envelope helpers
 * (https://connectrpc.com/docs/protocol/ — Enveloped-Message).
 *
 * flags bit0 = compressed, bit1 = end-stream.
 */

const FLAG_COMPRESSED = 0x01
const FLAG_END_STREAM = 0x02

function encodeEnvelope(message, flags = 0) {
  const payload = Buffer.from(
    typeof message === 'string' ? message : JSON.stringify(message ?? {}),
    'utf8',
  )
  const header = Buffer.alloc(5)
  header.writeUInt8(flags & 0xff, 0)
  header.writeUInt32BE(payload.length, 1)
  return Buffer.concat([header, payload])
}

function encodeEndStream(error = null) {
  const body = error && typeof error === 'object'
    ? { error }
    : {}
  return encodeEnvelope(body, FLAG_END_STREAM)
}

/**
 * Parse a byte buffer into complete envelopes; return remainder.
 * @returns {{ envelopes: Array<{ flags: number, json: any }>, rest: Buffer }}
 */
function decodeEnvelopes(buffer) {
  let offset = 0
  const envelopes = []
  while (offset + 5 <= buffer.length) {
    const flags = buffer.readUInt8(offset)
    const length = buffer.readUInt32BE(offset + 1)
    if (offset + 5 + length > buffer.length) break
    const slice = buffer.subarray(offset + 5, offset + 5 + length)
    offset += 5 + length
    let json = {}
    try {
      json = JSON.parse(slice.toString('utf8') || '{}')
    } catch {
      json = {}
    }
    envelopes.push({ flags, json, endStream: Boolean(flags & FLAG_END_STREAM) })
  }
  return { envelopes, rest: buffer.subarray(offset) }
}

module.exports = {
  FLAG_COMPRESSED,
  FLAG_END_STREAM,
  encodeEnvelope,
  encodeEndStream,
  decodeEnvelopes,
}
