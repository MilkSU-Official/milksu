import assert from 'node:assert/strict'
import test from 'node:test'
import {
  SIDECAR_MALFORMED_LINE_LIMIT,
  createSidecarLineReader,
  renderSidecarDiagnosticLine,
} from './sidecar.ts'

// The bundled MCP client SDK logs capability notices with console.debug, and
// Node writes console.debug to stdout — the same stream the sidecar JSON
// protocol uses. These tests pin the reader contract: one stray diagnostic
// line must not fabricate an engine error; only sustained non-JSON output is
// a protocol error, and even then the stream keeps being read so later
// recovery still reaches the sessions.

const POLLUTION_LINE = 'Client.listResources() called but server does not advertise resources capability - returning empty list'

test('renderSidecarDiagnosticLine redacts credential material and keeps the useful text', () => {
  const rendered = renderSidecarDiagnosticLine(
    'sk-abcdefghijklmnop123456 api_key=hunter2secret token: leak-me http://relay/?api_key=leak-me Client.listResources() called',
  )
  for (const secret of ['abcdefghijklmnop123456', 'hunter2secret', 'leak-me']) {
    assert.ok(!rendered.includes(secret), `diagnostics must redact ${secret}, got ${rendered}`)
  }
  assert.ok(rendered.includes('Client.listResources() called'), `useful text must survive, got ${rendered}`)
})

test('renderSidecarDiagnosticLine bounds length and stays on one physical line', () => {
  const overlong = renderSidecarDiagnosticLine('a'.repeat(16 * 1024))
  assert.ok([...overlong].length <= 512 + 32, `overlong lines must be truncated, got ${[...overlong].length} characters`)
  const multiline = renderSidecarDiagnosticLine('line\u0000with\u000bcontrol\tchars')
  assert.ok(!multiline.includes('\n'), `rendered diagnostics must stay on one line, got ${multiline}`)
})

test('a stray non-JSON line is skipped and logged, not turned into an error event', () => {
  const lines: unknown[] = []
  const errors: string[] = []
  const originalError = console.error
  console.error = (...args: unknown[]) => { errors.push(String(args[0])) }
  try {
    const read = createSidecarLineReader({ kernel: 'pi', workspace: '/ws/a', onLine: (value) => lines.push(value) })
    read('{"type":"ready","id":"session-1"}')
    read(POLLUTION_LINE)
    read('{"type":"queue_update","id":"session-1"}')
  } finally {
    console.error = originalError
  }
  assert.equal(lines.length, 2, `valid events around the stray line must be forwarded, got ${JSON.stringify(lines)}`)
  assert.ok(!lines.some((value) => (value as { type?: string }).type === 'error'), 'a stray line must not fabricate an error event')
  const logged = errors.join('\n')
  assert.ok(logged.includes('Client.listResources()'), 'the skip log must carry the raw polluted line')
})

test('sustained malformed output declares the protocol error exactly once, then keeps reading', () => {
  const lines: unknown[] = []
  const read = createSidecarLineReader({ kernel: 'pi', workspace: '/ws/a', onLine: (value) => lines.push(value) })
  for (let i = 0; i < SIDECAR_MALFORMED_LINE_LIMIT + 1; i += 1) {
    read('definitely not json')
  }
  read('{"type":"ready","id":"session-1"}')
  const protocolErrors = lines.filter(
    (value) => (value as { type?: string }).type === 'error',
  )
  assert.equal(protocolErrors.length, 1, `the burst must declare the protocol error exactly once, got ${JSON.stringify(lines)}`)
  const message = (protocolErrors[0] as { error?: string }).error ?? ''
  assert.ok(message.includes(`${SIDECAR_MALFORMED_LINE_LIMIT} consecutive non-JSON lines`), `the error must name the sustained corruption, got ${message}`)
  assert.ok(message.includes('definitely not json'), `the error must carry the last malformed line, got ${message}`)
  assert.ok(lines.some((value) => (value as { type?: string }).type === 'ready'), 'a stream that recovers after the burst must still deliver later events')
})

test('blank separator lines are noise and do not count toward the limit', () => {
  const lines: unknown[] = []
  const read = createSidecarLineReader({ kernel: 'pi', workspace: '/ws/a', onLine: (value) => lines.push(value) })
  for (let i = 0; i < SIDECAR_MALFORMED_LINE_LIMIT; i += 1) {
    read('')
    read('   ')
  }
  read('still just one malformed line')
  read('{"type":"ready","id":"session-1"}')
  assert.ok(!lines.some((value) => (value as { type?: string }).type === 'error'), 'blank lines must not count toward the malformed limit')
  assert.ok(lines.some((value) => (value as { type?: string }).type === 'ready'), 'events after blank lines must still be delivered')
})
