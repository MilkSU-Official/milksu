'use strict'

const http = require('node:http')
const { WebSocket, WebSocketServer } = require('ws')

function jsonResponse(response, status, value) {
  const body = Buffer.from(JSON.stringify(value))
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': String(body.length),
    'cache-control': 'no-store',
  })
  response.end(body)
}

async function fetchJSON(url) {
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`DevTools endpoint returned ${response.status}`)
  return response.json()
}

function targetID(value) {
  return String(value?.targetId ?? value?.targetID ?? '')
}

const SCOPE_CHANGING_METHODS = new Set([
  'Target.createTarget',
  'Target.createBrowserContext',
  'Target.disposeBrowserContext',
  'Browser.close',
])

class ScopedCDPProxy {
  constructor(options) {
    this.upstreamEndpoint = options.upstreamEndpoint
    this.allowedTargetId = options.targetId
    this.server = undefined
    this.webSocketServer = new WebSocketServer({ noServer: true })
    this.port = 0
  }

  setAllowedTarget(targetId) {
    this.allowedTargetId = String(targetId ?? '')
  }

  async start() {
    this.server = http.createServer((request, response) => {
      void this.handleHTTP(request, response)
    })
    this.server.on('upgrade', (request, socket, head) => {
      this.webSocketServer.handleUpgrade(request, socket, head, client => {
        void this.handleWebSocket(request, client)
      })
    })
    await new Promise((resolve, reject) => {
      this.server.once('error', reject)
      this.server.listen(0, '127.0.0.1', resolve)
    })
    this.port = this.server.address().port
    return `http://127.0.0.1:${this.port}`
  }

  async target() {
    const targets = await fetchJSON(`${this.upstreamEndpoint}/json/list`)
    return targets.find(item => item.id === this.allowedTargetId)
  }

  async handleHTTP(request, response) {
    try {
      const requestURL = new URL(request.url, `http://127.0.0.1:${this.port}`)
      const pathname = requestURL.pathname.replace(/\/+$/u, '') || '/'
      if (pathname === '/json/version') {
        const version = await fetchJSON(`${this.upstreamEndpoint}/json/version`)
        version.webSocketDebuggerUrl = `ws://127.0.0.1:${this.port}/devtools/browser`
        jsonResponse(response, 200, version)
        return
      }
      if (pathname === '/json/list' || pathname === '/json') {
        const target = await this.target()
        if (!target) throw new Error('approved browser target is unavailable')
        target.webSocketDebuggerUrl = `ws://127.0.0.1:${this.port}/devtools/page/${this.allowedTargetId}`
        jsonResponse(response, 200, [target])
        return
      }
      jsonResponse(response, 404, { error: 'not found' })
    } catch (error) {
      jsonResponse(response, 503, { error: error.message })
    }
  }

  async handleWebSocket(request, client) {
    const pendingClientMessages = []
    let upstream
    let state
    let upstreamReady = false
    const closeUpstream = () => {
      if (!upstream) return
      if (upstream.readyState === WebSocket.CONNECTING) upstream.terminate()
      else if (upstream.readyState === WebSocket.OPEN) upstream.close()
    }
    client.on('message', data => {
      if (!upstreamReady || !upstream || !state) {
        pendingClientMessages.push(Buffer.from(data))
        return
      }
      this.forwardClientMessage(data, client, upstream, state)
    })
    client.on('close', closeUpstream)
    client.on('error', closeUpstream)
    try {
      const target = await this.target()
      if (!target) throw new Error('approved browser target is unavailable')
      const pagePath = `/devtools/page/${this.allowedTargetId}`
      let upstreamURL
      let browserConnection = false
      if (request.url === pagePath) {
        upstreamURL = target.webSocketDebuggerUrl
      } else if (request.url === '/devtools/browser') {
        const version = await fetchJSON(`${this.upstreamEndpoint}/json/version`)
        upstreamURL = version.webSocketDebuggerUrl
        browserConnection = true
      } else {
        client.close(1008, 'target is outside the approved browser scope')
        return
      }
      upstream = new WebSocket(upstreamURL)
      state = {
        browserConnection,
        methods: new Map(),
        allowedSessions: new Set(),
		internalIDs: new Set(),
      }
      upstream.on('open', () => {
        upstreamReady = true
        for (const data of pendingClientMessages) {
          this.forwardClientMessage(data, client, upstream, state)
        }
        pendingClientMessages.length = 0
      })
      upstream.on('message', data => this.forwardUpstreamMessage(data, client, upstream, state))
      upstream.on('close', (code, reason) => client.close(code || 1000, reason))
      upstream.on('error', () => client.close(1011, 'DevTools connection failed'))
    } catch (error) {
      client.close(1011, error.message)
    }
  }

  forwardClientMessage(data, client, upstream, state) {
    let message
    try {
      message = JSON.parse(data.toString())
    } catch {
      return
    }
    const requestedTarget = targetID(message.params)
    if (requestedTarget && requestedTarget !== this.allowedTargetId) {
		this.reject(client, message.id, 'target is outside the approved browser scope')
      return
    }
    if (SCOPE_CHANGING_METHODS.has(message.method)) {
      this.reject(client, message.id, 'operation is outside the approved browser scope')
      return
    }
    if (!state.browserConnection) {
      upstream.send(JSON.stringify(message))
      return
    }
    if (message.sessionId && !state.allowedSessions.has(message.sessionId)) {
      this.reject(client, message.id, 'session is outside the approved browser scope')
      return
    }
    if (message.id) state.methods.set(message.id, message.method)
    upstream.send(JSON.stringify(message))
  }

  reject(client, id, reason) {
    if (id && client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ id, error: { code: -32000, message: reason } }))
    }
  }

  forwardUpstreamMessage(data, client, upstream, state) {
    if (!state.browserConnection) {
      client.send(data)
      return
    }
    let message
    try {
      message = JSON.parse(data.toString())
    } catch {
      return
    }
    if (message.method === 'Target.attachedToTarget') {
      const info = message.params?.targetInfo
      if (targetID(info) !== this.allowedTargetId) {
        const sessionId = message.params?.sessionId
        if (sessionId) {
		  const internalID = -Date.now()
		  state.internalIDs.add(internalID)
          upstream.send(JSON.stringify({
			id: internalID,
            method: 'Target.detachFromTarget',
            params: { sessionId },
          }))
        }
        return
      }
      state.allowedSessions.add(message.params.sessionId)
    }
    if (message.method === 'Target.detachedFromTarget') {
      if (!state.allowedSessions.has(message.params?.sessionId)) return
      state.allowedSessions.delete(message.params.sessionId)
    }
    if (message.method?.startsWith('Target.target')) {
      const info = message.params?.targetInfo
      const id = targetID(info) || targetID(message.params)
      if (id && id !== this.allowedTargetId) return
    }
    if (message.sessionId && !state.allowedSessions.has(message.sessionId)) return
	if (state.internalIDs.has(message.id)) {
		state.internalIDs.delete(message.id)
		return
	}
    const method = state.methods.get(message.id)
    if (message.id) state.methods.delete(message.id)
    if (method === 'Target.getTargets' && Array.isArray(message.result?.targetInfos)) {
      message.result.targetInfos = message.result.targetInfos.filter(
        info => targetID(info) === this.allowedTargetId,
      )
    }
    client.send(JSON.stringify(message))
  }

  async close() {
    for (const client of this.webSocketServer.clients) client.terminate()
    await new Promise(resolve => this.webSocketServer.close(resolve))
    if (this.server) {
      await new Promise(resolve => this.server.close(resolve))
    }
  }
}

module.exports = { ScopedCDPProxy }
