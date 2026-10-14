import { KERNEL_PI, normalizeKernel } from '../conversations.ts'
import { registerOwnedHandlers } from '../domains.ts'
import type { HandlerContext } from '../handlers.ts'
import { publicRun, publicSnapshot, publicSource } from '../research/types.ts'

function arg<T>(args: unknown[] | undefined, index: number, fallback: T): T {
  if (!args || index >= args.length || args[index] === undefined || args[index] === null) {
    return fallback
  }
  return args[index] as T
}

async function requirePersistedPi(ctx: HandlerContext, conversationId: string): Promise<string> {
  const id = String(conversationId ?? '').trim()
  if (!id) throw new Error('research conversation is unavailable')
  const stored = await ctx.conversations.get(id)
  if (normalizeKernel(stored.kernel) !== KERNEL_PI) {
    throw new Error('Deep Research runs require a Pi conversation')
  }
  return id
}

registerOwnedHandlers({
  async ListResearchRuns(ctx, args) {
    const conversationId = await requirePersistedPi(ctx, arg(args, 0, ''))
    const runs = await ctx.research.list(conversationId)
    return runs.map((run) => publicRun(run))
  },
  async GetResearchRun(ctx, args) {
    const conversationId = await requirePersistedPi(ctx, arg(args, 0, ''))
    return publicSnapshot(await ctx.research.get(conversationId, arg(args, 1, '')))
  },
  async ReadResearchSource(ctx, args) {
    const conversationId = await requirePersistedPi(ctx, arg(args, 0, ''))
    const { source, extract } = await ctx.research.readSource(conversationId, arg(args, 1, ''))
    return { source: publicSource(source), extract }
  },
  async ReadResearchReport(ctx, args) {
    const conversationId = await requirePersistedPi(ctx, arg(args, 0, ''))
    return ctx.research.readReport(conversationId, arg(args, 1, ''))
  },
  async CancelResearchRun(ctx, args) {
    const conversationId = await requirePersistedPi(ctx, arg(args, 0, ''))
    return publicRun(await ctx.engine.cancelResearchRun(conversationId, arg(args, 1, '')))
  },
  async DropResearchForConversation(ctx, args) {
    if (ctx.invokeSource !== 'electron_host') {
      throw new Error(`desktop method DropResearchForConversation is unavailable to ${ctx.invokeSource}`)
    }
    await ctx.research.deleteConversation(arg(args, 0, ''))
    return null
  },
})
