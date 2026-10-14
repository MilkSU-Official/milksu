import { registerOwnedHandlers } from '../domains.ts'
import type { HandlerContext } from '../handlers.ts'
import type { CompanionRuntime } from '../companion/runtime.ts'
import type { TranscriptCursor } from '../companion/jsonl.ts'
import type { CompanionAttachment } from '../companion/types.ts'

function arg<T>(args: unknown[] | undefined, index: number, fallback: T): T {
  if (!args || index >= args.length || args[index] === undefined || args[index] === null) {
    return fallback
  }
  return args[index] as T
}

function requireCompanion(ctx: HandlerContext): CompanionRuntime {
  if (!ctx.companion) throw new Error('companion runtime is not configured')
  return ctx.companion
}

registerOwnedHandlers({
  EnsureCompanion(ctx) {
    return requireCompanion(ctx).ensure()
  },
  SendCompanionMessage(ctx, args) {
    return requireCompanion(ctx).send(
      arg(args, 0, ''),
      arg<CompanionAttachment[]>(args, 1, []),
    )
  },
  async AbortCompanionTurn(ctx) {
    if (!ctx.companion) return null
    await ctx.companion.abortTurn()
    return null
  },
  GetCompanionStatus(ctx) {
    if (!ctx.companion) {
      return { ready: false, provider: '', model: '', error: 'companion runtime is not configured' }
    }
    return ctx.companion.status()
  },
  async StopCompanion(ctx) {
    if (!ctx.companion) return null
    await ctx.companion.stop()
    return null
  },
  GetCompanionBoard(ctx) {
    if (!ctx.companion) return { sessions: [], todos: [] }
    return ctx.companion.boardSnapshot()
  },
  ListCompanionTranscript(ctx, args) {
    return requireCompanion(ctx).transcript(
      Number(arg(args, 0, 40)),
      arg<TranscriptCursor | null>(args, 1, null),
      arg(args, 2, true),
    )
  },
  async ArchiveCompanionTranscript(ctx) {
    try {
      return await requireCompanion(ctx).archiveTranscript()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (message.includes('sidecar is not running')) {
        return { name: '', size: 0, modified: 0, exportable: false }
      }
      throw error
    }
  },
  async ListCompanionArchives(ctx) {
    if (!ctx.companion) return []
    return ctx.companion.archives()
  },
  DeleteCompanionArchive(ctx, args) {
    return requireCompanion(ctx).deleteArchive(arg(args, 0, ''))
  },
  GetCompanionMemory(ctx) {
    if (!ctx.companion) return { pending: [], approved: [] }
    return ctx.companion.memorySnapshot()
  },
  ApproveCompanionMemory(ctx, args) {
    return requireCompanion(ctx).approveMemory(arg(args, 0, ''))
  },
  ForgetCompanionMemory(ctx, args) {
    return requireCompanion(ctx).forgetMemory(arg(args, 0, ''))
  },
  ConfirmCompanionDispatch(ctx, args) {
    return requireCompanion(ctx).confirmDispatch(
      arg(args, 0, ''),
      arg(args, 1, ''),
      arg(args, 2, ''),
      arg(args, 3, ''),
      arg(args, 4, ''),
      arg(args, 5, ''),
      Boolean(arg(args, 6, false)),
    )
  },
})
