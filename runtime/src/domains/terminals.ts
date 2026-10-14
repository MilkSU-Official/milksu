import { registerOwnedHandlers } from '../domains.ts'
import type { HandlerContext } from '../handlers.ts'
import { TerminalManager } from '../codingenv/terminals.ts'

const bound = new Map<string, TerminalManager>()

function arg<T>(args: unknown[] | undefined, index: number, fallback: T): T {
  if (!args || index >= args.length || args[index] === undefined || args[index] === null) {
    return fallback
  }
  return args[index] as T
}

export function bindTerminals(home: string, manager: TerminalManager): void {
  bound.set(home, manager)
}

function managerFor(ctx: HandlerContext): TerminalManager {
  const existing = bound.get(ctx.home)
  if (existing) return existing
  throw new Error('Coding terminal runtime is unavailable')
}

registerOwnedHandlers({
  async ListCodingTerminals(ctx, args) {
    return managerFor(ctx).list(arg(args, 0, ''))
  },
  async StartCodingTerminal(ctx, args) {
    return managerFor(ctx).start(
      arg(args, 0, ''),
      arg(args, 1, ''),
      Number(arg(args, 2, 0)),
      Number(arg(args, 3, 0)),
    )
  },
  async WriteCodingTerminal(ctx, args) {
    await managerFor(ctx).write(arg(args, 0, ''), arg(args, 1, ''), arg(args, 2, ''))
    return null
  },
  async ResizeCodingTerminal(ctx, args) {
    return managerFor(ctx).resize(
      arg(args, 0, ''),
      arg(args, 1, ''),
      Number(arg(args, 2, 0)),
      Number(arg(args, 3, 0)),
    )
  },
  async StopCodingTerminal(ctx, args) {
    return managerFor(ctx).stop(arg(args, 0, ''), arg(args, 1, ''))
  },
  async CloseCodingTerminal(ctx, args) {
    await managerFor(ctx).closeSession(arg(args, 0, ''), arg(args, 1, ''))
    return null
  },
})
