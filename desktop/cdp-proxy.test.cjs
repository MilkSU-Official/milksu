'use strict'

const assert = require('node:assert/strict')
const http = require('node:http')
const test = require('node:test')
const { WebSocket, WebSocketServer } = require('ws')
const { ScopedCDPProxy } = require('./cdp-proxy.cjs')

function listen(server) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
}

function close(server) {
  return new Promise(resolve => server.close(resolve))
}

test('accepts the trailing slash used by Playwright for json/version', async () => {
  const upstream = http.createServer((request, response) => {
    if (request.url !== '/json/version') {
      response.writeHead(404).end()
      return
    }
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({
      Browser: 'Chrome/1',
      webSocketDebuggerUrl: 'ws://127.0.0.1:1/devtools/browser/upstream',
    }))
  })
  await listen(upstream)
  const upstreamPort = upstream.address().port
  const proxy = new ScopedCDPProxy({
    upstreamEndpoint: `http://127.0.0.1:${upstreamPort}`,
    targetId: 'approved-target',
  })

  try {
    const endpoint = await proxy.start()
    const response = await fetch(`${endpoint}/json/version/`)
    assert.equal(response.status, 200)
    const document = await response.json()
    assert.match(document.webSocketDebuggerUrl, /\/devtools\/browser$/u)
  } finally {
    await proxy.close()
    await close(upstream)
  }
})

test('buffers the first browser command until the upstream socket is open', { timeout: 5000 }, async () => {
  const upstreamSockets = new WebSocketServer({ noServer: true })
  let upstreamPort = 0
  const upstream = http.createServer((request, response) => {
    if (request.url === '/json/version') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify({
        Browser: 'Chrome/1',
        webSocketDebuggerUrl: `ws://127.0.0.1:${upstreamPort}/devtools/browser/upstream`,
      }))
      return
    }
    if (request.url === '/json/list') {
      response.setHeader('content-type', 'application/json')
      response.end(JSON.stringify([{
        id: 'approved-target',
        type: 'page',
        webSocketDebuggerUrl: `ws://127.0.0.1:${upstreamPort}/devtools/page/approved-target`,
      }]))
      return
    }
    response.writeHead(404).end()
  })
  upstream.on('upgrade', (request, socket, head) => {
    upstreamSockets.handleUpgrade(request, socket, head, client => {
      upstreamSockets.emit('connection', client, request)
    })
  })
  upstreamSockets.on('connection', client => {
    client.on('message', data => {
      const message = JSON.parse(data.toString())
      client.send(JSON.stringify({
        id: message.id,
        result: { product: 'Chrome/1' },
      }))
    })
  })
  await listen(upstream)
  upstreamPort = upstream.address().port
  const proxy = new ScopedCDPProxy({
    upstreamEndpoint: `http://127.0.0.1:${upstreamPort}`,
    targetId: 'approved-target',
  })
  let client

  try {
    const endpoint = await proxy.start()
    const port = new URL(endpoint).port
    client = new WebSocket(`ws://127.0.0.1:${port}/devtools/browser`)
    const response = await new Promise((resolve, reject) => {
      client.once('error', reject)
      client.once('open', () => {
        client.send(JSON.stringify({ id: 1, method: 'Browser.getVersion' }))
      })
      client.once('message', data => resolve(JSON.parse(data.toString())))
    })
    assert.deepEqual(response, { id: 1, result: { product: 'Chrome/1' } })
  } finally {
    client?.terminate()
    await proxy.close()
    for (const socket of upstreamSockets.clients) socket.terminate()
    upstreamSockets.close()
    await close(upstream)
  }
})

test('rejects scope-changing commands on a direct page connection', () => {
  const proxy = new ScopedCDPProxy({
    upstreamEndpoint: 'http://127.0.0.1:1',
    targetId: 'approved-target',
  })
  const clientMessages = []
  const upstreamMessages = []
  const client = {
    readyState: WebSocket.OPEN,
    send(value) { clientMessages.push(JSON.parse(value)) },
  }
  const upstream = {
    send(value) { upstreamMessages.push(JSON.parse(value)) },
  }
  const state = {
    browserConnection: false,
    methods: new Map(),
    allowedSessions: new Set(),
    internalIDs: new Set(),
  }

  proxy.forwardClientMessage(Buffer.from(JSON.stringify({
    id: 7,
    method: 'Target.createTarget',
    params: { url: 'https://example.test' },
  })), client, upstream, state)

  assert.deepEqual(upstreamMessages, [])
  assert.deepEqual(clientMessages, [{
    id: 7,
    error: {
      code: -32000,
      message: 'operation is outside the approved browser scope',
    },
  }])
})
