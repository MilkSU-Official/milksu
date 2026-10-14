import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import readline from 'node:readline'
import { JsonlPort, type RpcMessage } from './rpc.ts'

export type NativeHelperOptions = {
  command: string
  args?: string[]
  env?: NodeJS.ProcessEnv
  onEvent?: (event: string, payload: unknown) => void
  onHostRequest?: (message: RpcMessage) => void
  onProtocolError?: (error: string) => void
}

export function resolveNativeHelperPath(env: NodeJS.ProcessEnv = process.env): string {
  const helper = String(env.MILKSU_NATIVE_HELPER ?? '').trim()
  if (helper) return helper
  return String(env.MILKSU_BACKEND_PATH ?? '').trim()
}

export class NativeHelper {
  private child: ChildProcessWithoutNullStreams | null = null
  private port: JsonlPort | null = null
  private ready = false
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
  }>()

  private readonly options: NativeHelperOptions

  constructor(options: NativeHelperOptions) {
    this.options = options
  }

  get running(): boolean {
    return this.child !== null && this.child.exitCode === null
  }

  async start(): Promise<void> {
    if (this.running && this.ready) return
    const child = spawn(this.options.command, this.options.args ?? [], {
      stdio: ['pipe', 'pipe', 'pipe'],
      env: this.options.env ?? process.env,
    })
    this.child = child
    child.stderr.pipe(process.stderr)
    this.port = new JsonlPort(child.stdout, child.stdin)

    const ready = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('native helper ready timed out')), 20_000)
      const lines = readline.createInterface({ input: child.stdout, crlfDelay: Infinity })
      const onExit = (code: number | null, signal: NodeJS.Signals | null) => {
        clearTimeout(timer)
        reject(new Error(`native helper exited before ready code=${code} signal=${signal}`))
      }
      child.once('error', (error) => {
        clearTimeout(timer)
        reject(error)
      })
      child.once('exit', onExit)
      lines.on('line', (line: string) => {
        let message: RpcMessage
        try {
          message = JSON.parse(line) as RpcMessage
        } catch {
          this.options.onProtocolError?.('native helper returned an unreadable message')
          return
        }
        if (message.type === 'ready' && !this.ready) {
          this.ready = true
          clearTimeout(timer)
          child.off('exit', onExit)
          resolve()
          return
        }
        this.handleMessage(message, line)
      })
    })

    child.once('exit', () => {
      this.ready = false
      const error = new Error('native helper exited')
      for (const [, pending] of this.pending) pending.reject(error)
      this.pending.clear()
    })

    await ready
  }

  private handleMessage(message: RpcMessage, raw: string): void {
    if (message.type === 'result') {
      const pending = this.pending.get(String(message.id ?? ''))
      if (!pending) return
      this.pending.delete(String(message.id ?? ''))
      if (message.error) pending.reject(new Error(message.error))
      else pending.resolve(message.result ?? null)
      return
    }
    if (message.type === 'event') {
      this.options.onEvent?.(String(message.event ?? ''), message.payload)
      return
    }
    if (message.type === 'host_request') {
      this.options.onHostRequest?.(message)
      return
    }
    if (message.type === 'protocol_error') {
      this.options.onProtocolError?.(String(message.error ?? 'native helper protocol error'))
    }
    void raw
  }

  async invoke(message: RpcMessage): Promise<unknown> {
    if (!this.port || !this.ready) throw new Error('native helper is not ready')
    const id = String(message.id ?? '')
    if (!id) throw new Error('desktop invoke id is required')
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.port!.write(message).catch((error) => {
        this.pending.delete(id)
        reject(error)
      })
    })
  }

  async forwardRaw(message: RpcMessage): Promise<void> {
    if (!this.port || !this.ready) throw new Error('native helper is not ready')
    await this.port.write(message)
  }

  async shutdown(timeoutMs = 2000): Promise<void> {
    const child = this.child
    if (!child || child.exitCode !== null) return
    try {
      await this.port?.write({ type: 'shutdown' })
    } catch {
      // helper stdin may already be closed
    }
    await Promise.race([
      new Promise<void>((resolve) => child.once('exit', () => resolve())),
      new Promise<void>((resolve) => setTimeout(resolve, timeoutMs)),
    ])
    if (child.exitCode === null) {
      try { child.kill('SIGTERM') } catch { /* ignore */ }
      await Promise.race([
        new Promise<void>((resolve) => child.once('exit', () => resolve())),
        new Promise<void>((resolve) => setTimeout(resolve, 500)),
      ])
    }
    if (child.exitCode === null) {
      try { child.kill('SIGKILL') } catch { /* ignore */ }
    }
  }
}
