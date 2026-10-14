import { createHash, randomBytes } from 'node:crypto'
import { chmodSync, existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo, Socket } from 'node:net'
import { join } from 'node:path'
import { mkdir } from 'node:fs/promises'
import { originTarget } from './origin.ts'
import { findProjectRoot } from '../sidecar.ts'

const MAX_PAGE_TEXT_BYTES = 1_000_000
const WS_GUID = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11'
const EXTENSION_FILES = ['manifest.json', 'popup.html', 'popup.js', 'background.js'] as const

export type SharedPage = {
  id: string
  bridgeSessionId?: string
  adapter?: string
  connected: boolean
  title: string
  url: string
  text: string
  capturedAt: string
  provenance: string
  scope: { targets: Array<{ kind: string; value: string }> }
}

export type BridgeInfo = {
  endpoint: string
  pairingCode: string
  extensionPath: string
  active: boolean
  connected: boolean
  lastSeenAt?: string
}

type PairingState = {
  version: number
  port: number
  token: string
}

type BridgeClient = {
  socket: Socket
  sessionIds: Set<string>
}

export class PairingBridge {
  private server: Server | undefined
  private token = ''
  private port = 0
  private lastSeenAt = ''
  private extensionPath = ''
  private readonly clients = new Set<BridgeClient>()
  private sharedPages: SharedPage[] = []
  private readonly pairingPath: string
  private readonly sharedPath: string
  private readonly root: string

  constructor(root: string) {
    this.root = root
    this.pairingPath = join(root, 'bridge-pairing.json')
    this.sharedPath = join(root, 'shared-pages.json')
  }

  async open(): Promise<void> {
    await mkdir(this.root, { recursive: true, mode: 0o700 })
    this.loadPairing()
    await this.installExtension()
    if (existsSync(this.sharedPath)) {
      try {
        const parsed = JSON.parse(readFileSync(this.sharedPath, 'utf8')) as SharedPage[]
        if (Array.isArray(parsed)) this.sharedPages = parsed
      } catch {
        this.sharedPages = []
      }
    }
  }

  async start(): Promise<BridgeInfo> {
    if (this.server) return this.info()
    const address = this.port > 0 ? `127.0.0.1:${this.port}` : '127.0.0.1:0'
    const server = createServer((request, response) => {
      void this.handleHTTP(request, response)
    })
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject)
      server.listen(listenPort(address), '127.0.0.1', () => {
        server.off('error', reject)
        resolve()
      })
    })
    const bound = server.address() as AddressInfo | null
    if (!bound || bound.address !== '127.0.0.1') {
      server.close()
      throw new Error('browser bridge must bind 127.0.0.1')
    }
    if (!this.token) this.token = randomBytes(24).toString('hex')
    this.port = bound.port
    try {
      this.persistPairing()
    } catch (error) {
      server.close()
      this.token = ''
      this.port = 0
      throw error
    }
    this.server = server
    server.on('upgrade', (request, socket) => {
      this.handleUpgrade(request, socket as Socket)
    })
    return this.info()
  }

  info(): BridgeInfo {
    const endpoint = this.server ? `http://127.0.0.1:${this.port}` : ''
    const pairingCode = Buffer.from(JSON.stringify({ endpoint, token: this.token }), 'utf8').toString('base64url')
    const publicInfo: BridgeInfo = {
      endpoint,
      pairingCode,
      extensionPath: this.extensionPath,
      active: Boolean(this.server),
      connected: this.clients.size > 0,
    }
    if (this.lastSeenAt) publicInfo.lastSeenAt = this.lastSeenAt
    return publicInfo
  }

  // Token stays off public JSON. Tests may authorize ingest without logging it.
  authorize(token: string): boolean {
    return Boolean(this.token) && token === this.token
  }

  pages(): SharedPage[] {
    return this.sharedPages.map((page) => ({
      ...page,
      connected: this.sessionConnected(page.bridgeSessionId ?? ''),
    }))
  }

  close(): Promise<void> {
    const server = this.server
    this.server = undefined
    for (const client of this.clients) {
      try {
        client.socket.destroy()
      } catch {
        // already closed
      }
    }
    this.clients.clear()
    if (!server) return Promise.resolve()
    return new Promise((resolve) => {
      server.close(() => resolve())
    })
  }

  private sessionConnected(sessionId: string): boolean {
    if (!validBridgeSessionId(sessionId)) return false
    for (const client of this.clients) {
      if (client.sessionIds.has(sessionId)) return true
    }
    return false
  }

  private loadPairing(): void {
    if (!existsSync(this.pairingPath)) return
    try {
      const state = JSON.parse(readFileSync(this.pairingPath, 'utf8')) as PairingState
      if (
        state.version !== 1
        || state.port < 1024
        || state.port > 65535
        || !validBridgeToken(state.token)
      ) {
        return
      }
      this.port = state.port
      this.token = state.token
      chmodSync(this.pairingPath, 0o600)
    } catch {
      // ignore corrupt pairing; a new token is minted on start
    }
  }

  private persistPairing(): void {
    if (this.port < 1024 || this.port > 65535 || !validBridgeToken(this.token)) {
      throw new Error('browser bridge pairing state is invalid')
    }
    const temporary = `${this.pairingPath}.tmp`
    writeFileSync(temporary, JSON.stringify({ version: 1, port: this.port, token: this.token }), { mode: 0o600 })
    try {
      renameSync(temporary, this.pairingPath)
    } catch (error) {
      try {
        unlinkSync(temporary)
      } catch {
        // ignore
      }
      throw error
    }
    chmodSync(this.pairingPath, 0o600)
  }

  private async installExtension(): Promise<void> {
    const destination = join(this.root, 'current-tab-extension')
    await mkdir(destination, { recursive: true, mode: 0o700 })
    const source = extensionSourceDir()
    if (!source) throw new Error('install current-tab extension: source is unavailable')
    for (const name of EXTENSION_FILES) {
      const from = join(source, name)
      if (!existsSync(from)) throw new Error(`install current-tab extension: missing ${name}`)
      writeFileSync(join(destination, name), readFileSync(from), { mode: 0o600 })
    }
    this.extensionPath = destination
  }

  private async handleHTTP(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('Access-Control-Allow-Origin', '*')
    response.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/ingest') {
      response.writeHead(404).end()
      return
    }
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end()
      return
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end('method not allowed')
      return
    }
    const header = String(request.headers.authorization ?? '')
    if (!this.token || header !== `Bearer ${this.token}`) {
      response.writeHead(401).end('invalid MilkSU pairing token')
      return
    }
    let raw = ''
    try {
      raw = await readLimited(request, MAX_PAGE_TEXT_BYTES + 4 * 1024 * 1024)
    } catch {
      response.writeHead(400).end('invalid shared page')
      return
    }
    let input: { bridgeSessionId?: string; adapter?: string; title?: string; url?: string; text?: string }
    try {
      input = JSON.parse(raw) as typeof input
    } catch {
      response.writeHead(400).end('invalid shared page')
      return
    }
    let origin: string
    try {
      origin = originTarget(String(input.url ?? ''))
    } catch {
      response.writeHead(400).end('shared page is missing a valid URL, title, or bounded text')
      return
    }
    const title = String(input.title ?? '').trim()
    const text = String(input.text ?? '')
    if (!title || text.length > MAX_PAGE_TEXT_BYTES) {
      response.writeHead(400).end('shared page is missing a valid URL, title, or bounded text')
      return
    }
    if (input.adapter) {
      response.writeHead(400).end('unsupported browser adapter')
      return
    }
    const page: SharedPage = {
      id: `shared_${cryptoRandomId()}`,
      bridgeSessionId: String(input.bridgeSessionId ?? ''),
      adapter: '',
      connected: false,
      title,
      url: String(input.url ?? ''),
      text,
      capturedAt: new Date().toISOString(),
      provenance: 'user-browser-extension:active-tab',
      scope: { targets: [{ kind: 'origin', value: origin }] },
    }
    const previous = this.sharedPages
    this.sharedPages = [page, ...previous].slice(0, 20)
    try {
      writeFileSync(this.sharedPath, `${JSON.stringify(this.sharedPages, null, 2)}\n`, { mode: 0o600 })
    } catch {
      this.sharedPages = previous
      response.writeHead(500).end('persist shared page')
      return
    }
    response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify({ id: page.id }))
  }

  private handleUpgrade(request: IncomingMessage, socket: Socket): void {
    if (request.method !== 'GET') {
      socket.write('HTTP/1.1 405 Method Not Allowed\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    if (url.pathname !== '/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const protocols = String(request.headers['sec-websocket-protocol'] ?? '')
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean)
    if (protocols.length !== 2 || protocols[0] !== 'milksu-bridge-v1' || !this.token || protocols[1] !== this.token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const origin = String(request.headers.origin ?? '')
    if (origin && !origin.startsWith('chrome-extension://') && !origin.startsWith('moz-extension://')) {
      socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const key = String(request.headers['sec-websocket-key'] ?? '')
    if (!key) {
      socket.write('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n')
      socket.destroy()
      return
    }
    const accept = createHash('sha1').update(key + WS_GUID).digest('base64')
    socket.write(
      'HTTP/1.1 101 Switching Protocols\r\n'
      + 'Upgrade: websocket\r\n'
      + 'Connection: Upgrade\r\n'
      + `Sec-WebSocket-Accept: ${accept}\r\n`
      + 'Sec-WebSocket-Protocol: milksu-bridge-v1\r\n'
      + '\r\n',
    )
    const client: BridgeClient = { socket, sessionIds: new Set() }
    this.clients.add(client)
    this.lastSeenAt = new Date().toISOString()
    socket.on('close', () => {
      this.clients.delete(client)
    })
    socket.on('error', () => {
      this.clients.delete(client)
    })
    readTextFrames(socket, (text) => {
      this.lastSeenAt = new Date().toISOString()
      let message: { type?: string; bridgeSessionIds?: string[] }
      try {
        message = JSON.parse(text) as typeof message
      } catch {
        return
      }
      if (message.type === 'hello') {
        const ids = Array.isArray(message.bridgeSessionIds) ? message.bridgeSessionIds : []
        if (ids.length > 24) {
          socket.destroy()
          return
        }
        const sessionIds = new Set<string>()
        for (const id of ids) {
          if (!validBridgeSessionId(id)) {
            socket.destroy()
            return
          }
          sessionIds.add(id)
        }
        client.sessionIds = sessionIds
        writeTextFrame(socket, JSON.stringify({ type: 'hello_ack' }))
        return
      }
      if (message.type === 'ping') {
        writeTextFrame(socket, JSON.stringify({ type: 'pong' }))
      }
    })
  }
}

function listenPort(address: string): number {
  const [, port] = address.split(':')
  return Number.parseInt(port ?? '0', 10) || 0
}

function validBridgeToken(token: string): boolean {
  if (token.length !== 48 || token.toLowerCase() !== token) return false
  return /^[0-9a-f]{48}$/u.test(token)
}

function validBridgeSessionId(value: string): boolean {
  if (value.length < 16 || value.length > 128) return false
  return /^[A-Za-z0-9_-]+$/u.test(value)
}

function cryptoRandomId(): string {
  return randomBytes(16).toString('hex')
}

export function extensionSourceDir(env: NodeJS.ProcessEnv = process.env): string | undefined {
  const roots: string[] = []
  for (const value of [env.MILKSU_ROOT, env.MILKSU_RESOURCES]) {
    const root = String(value ?? '').trim()
    if (root) roots.push(root)
  }
  try {
    roots.push(findProjectRoot(env))
  } catch {
    // packaged runtime without a checkout
  }
  roots.push(process.cwd())
  for (const root of roots) {
    for (const relative of ['browserextension', join('runtime', 'browserextension')]) {
      const candidate = join(root, relative)
      if (existsSync(join(candidate, 'manifest.json'))) return candidate
    }
  }
}

function readLimited(request: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let size = 0
    request.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size > limit) {
        request.destroy()
        reject(new Error('too large'))
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    request.on('error', reject)
  })
}

function readTextFrames(socket: Socket, onText: (text: string) => void): void {
  let buffer = Buffer.alloc(0)
  socket.on('data', (chunk: Buffer) => {
    buffer = Buffer.concat([buffer, chunk])
    while (buffer.length >= 2) {
      const opcode = buffer[0]! & 0x0f
      const masked = (buffer[1]! & 0x80) !== 0
      let length = buffer[1]! & 0x7f
      let offset = 2
      if (length === 126) {
        if (buffer.length < 4) return
        length = buffer.readUInt16BE(2)
        offset = 4
      } else if (length === 127) {
        socket.destroy()
        return
      }
      const maskOffset = offset
      const dataOffset = masked ? offset + 4 : offset
      if (buffer.length < dataOffset + length) return
      let payload = buffer.subarray(dataOffset, dataOffset + length)
      if (masked) {
        const mask = buffer.subarray(maskOffset, maskOffset + 4)
        payload = Buffer.from(payload)
        for (let i = 0; i < payload.length; i += 1) payload[i]! ^= mask[i % 4]!
      }
      buffer = buffer.subarray(dataOffset + length)
      if (opcode === 0x8) {
        socket.end()
        return
      }
      if (opcode === 0x9) {
        writeFrame(socket, 0x0a, payload)
        continue
      }
      if (opcode === 0x1) onText(payload.toString('utf8'))
    }
  })
}

function writeTextFrame(socket: Socket, text: string): void {
  writeFrame(socket, 0x1, Buffer.from(text, 'utf8'))
}

function writeFrame(socket: Socket, opcode: number, payload: Buffer): void {
  let header: Buffer
  if (payload.length < 126) {
    header = Buffer.alloc(2)
    header[0] = 0x80 | opcode
    header[1] = payload.length
  } else {
    header = Buffer.alloc(4)
    header[0] = 0x80 | opcode
    header[1] = 126
    header.writeUInt16BE(payload.length, 2)
  }
  socket.write(Buffer.concat([header, payload]))
}
