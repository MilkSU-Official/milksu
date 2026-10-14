import readline from 'node:readline'
import type { Readable, Writable } from 'node:stream'

export const MAX_RPC_MESSAGE_BYTES = 128 << 20

export type RpcSource = 'renderer' | 'electron_host'

export type RpcMessage = {
  type: string
  id?: string
  source?: RpcSource | string
  method?: string
  event?: string
  args?: unknown[]
  payload?: unknown
  result?: unknown
  error?: string
}

export function parseRpcLine(line: string): RpcMessage {
  if (Buffer.byteLength(line) > MAX_RPC_MESSAGE_BYTES) {
    throw new Error('desktop RPC message too large')
  }
  const value = JSON.parse(line) as RpcMessage
  if (!value || typeof value !== 'object' || typeof value.type !== 'string') {
    throw new Error('invalid desktop RPC message')
  }
  return value
}

export class JsonlPort {
  private writeChain: Promise<void> = Promise.resolve()
  readonly input: Readable
  readonly output: Writable

  constructor(input: Readable, output: Writable) {
    this.input = input
    this.output = output
  }

  onLine(handler: (message: RpcMessage, raw: string) => void): readline.Interface {
    const lines = readline.createInterface({ input: this.input, crlfDelay: Infinity })
    lines.on('line', (line: string) => {
      try {
        handler(parseRpcLine(line), line)
      } catch (error) {
        handler({
          type: 'protocol_error',
          error: error instanceof Error ? error.message : 'invalid desktop RPC message',
        }, line)
      }
    })
    return lines
  }

  write(message: RpcMessage): Promise<void> {
    const encoded = `${JSON.stringify(message)}\n`
    const job = this.writeChain.then(
      () => new Promise<void>((resolve, reject) => {
        this.output.write(encoded, (error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
    )
    this.writeChain = job.catch(() => {})
    return job
  }

  writeRawLine(line: string): Promise<void> {
    const payload = line.endsWith('\n') ? line : `${line}\n`
    const job = this.writeChain.then(
      () => new Promise<void>((resolve, reject) => {
        this.output.write(payload, (error) => {
          if (error) reject(error)
          else resolve()
        })
      }),
    )
    this.writeChain = job.catch(() => {})
    return job
  }
}

export class DesktopHost {
  private seq = 0
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()

  private readonly write: (message: RpcMessage) => Promise<void>

  constructor(write: (message: RpcMessage) => Promise<void>) {
    this.write = write
  }

  call(method: string, payload?: unknown): Promise<unknown> {
    const id = `runtime-host-${++this.seq}`
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      void this.write({ type: 'host_request', id, method, payload: payload ?? {} }).catch((error) => {
        this.pending.delete(id)
        reject(error instanceof Error ? error : new Error(String(error)))
      })
    })
  }

  settle(message: RpcMessage): boolean {
    const id = String(message.id ?? '')
    const pending = this.pending.get(id)
    if (!pending) return false
    this.pending.delete(id)
    if (message.error) pending.reject(new Error(message.error))
    else pending.resolve(message.result ?? null)
    return true
  }
}
