import type { AgentKernel } from '@/lib/agentKernel'
import type { Message } from '@/types'

export type ComposerRunPhase = 'idle' | 'parent' | 'working' | 'compacting' | 'aborting'

/**
 * 计时器清扫的宽限：工作项已清空后再等一会儿，给下一个工作项入场留时间。
 * 只对「本回合观测到过在跑工作项」的 parent 记账生效（见 shouldClearParentRun）；
 * 运行标记的年龄单独不构成清扫证据。
 */
export const STALE_PARENT_RUN_MS = 2_000

export function isBackgroundWorkingTool(toolName?: string) {
  const name = String(toolName ?? '').trim().toLowerCase()
  return name === 'subagent' || name.startsWith('subagent:')
}

function isPendingApproval(message: Message) {
  return Boolean(message.approvalRequestId)
}

function isRunningMessage(message: Message) {
  return message.status === 'running' && !isPendingApproval(message)
}

/** Bash / write / streaming tools that still own the parent turn. */
export function parentHasBlockingToolResidue(
  messages: readonly Message[],
  kernel: AgentKernel,
): boolean {
  return messages.some((message) => {
    if (!isRunningMessage(message) || message.role === 'assistant') return false
    if (kernel === 'dsh' && isBackgroundWorkingTool(message.toolName)) return false
    return true
  })
}

/**
 * Parent is still generating text or running a tool that is not a background
 * DSH subagent. A DSH assistant row can stay `running` until ACP `whenIdle`
 * even after Working empties — that is not parent residue.
 */
export function parentHasActiveTurnResidue(
  messages: readonly Message[],
  kernel: AgentKernel,
  extras?: { liveWorkingCount?: number; workingJustEmptied?: boolean },
): boolean {
  if (parentHasBlockingToolResidue(messages, kernel)) return true
  const assistantRunning = messages.some(message => (
    isRunningMessage(message) && message.role === 'assistant'
  ))
  if (!assistantRunning) return false
  if (
    kernel === 'dsh'
    && ((extras?.liveWorkingCount ?? 0) > 0 || extras?.workingJustEmptied === true)
  ) {
    return false
  }
  return true
}

/**
 * 本地清扫的正当职责是 parent 记账：并行工作项（DSH subagent / jobs、multitask 子会话）
 * 的生命周期由引擎 roster 事件与子会话终局驱动，工作项清空就是回合终局的引擎侧证据，
 * 渲染器据此收回 parent 的运行标记（d6e3fe42 的章程：ACP whenIdle 不结算也不许挂着）。
 *
 * 两条清理路径：
 * - workingJustEmptied 边沿（在跑工作项从非空变空，事件本身即证据）⇒ 立即清；
 * - 计时器路径（runHadWorkingItems 为真：本回合观测到过在跑工作项，现在没了）⇒ 宽限
 *   STALE_PARENT_RUN_MS 后清，覆盖渲染器错过边沿的记账缺口。
 *
 * 没有工作项证据的运行标记属于引擎说了算的静默（慢 TTFB 首字节、长工具执行、恢复中的
 * 会话）：计时器不得只凭「运行标记年龄」收割，否则引擎还在管理的等待期会被掐成「已结束」，
 * 首字节到达后消息诈尸（β.196 kunbot 3.5-4s+ 首字节静默期被回执事件误杀；β.194 同因）。
 * 这些回合的终局只归引擎事件（settled / error / stopped）、读者动作（abort / 重发 / 回退）
 * 与停滞看门狗路径（engine-gone / model-stalled 带可见告警和停止 / 重启出口）。
 */
export function shouldClearParentRun(input: {
  parentMarkedRunning: boolean
  compacting: boolean
  aborting: boolean
  liveWorkingCount: number
  parentHasActiveTurnResidue: boolean
  workingJustEmptied?: boolean
  /** 本回合（同一 runStartedAt）观测到过在跑工作项：计时器路径的记账证据。 */
  runHadWorkingItems?: boolean
  msSinceRunStart: number
}): boolean {
  if (!input.parentMarkedRunning || input.compacting || input.aborting) return false
  if (input.liveWorkingCount > 0) return false
  if (input.parentHasActiveTurnResidue) return false
  if (input.workingJustEmptied) return true
  if (!input.runHadWorkingItems) return false
  return input.msSinceRunStart >= STALE_PARENT_RUN_MS
}

export function composerRunPhase(input: {
  kernel: AgentKernel
  parentMarkedRunning: boolean
  aborting: boolean
  compacting: boolean
  liveWorkingCount: number
  parentHasActiveTurnResidue: boolean
  msSinceRunStart?: number
}): ComposerRunPhase {
  if (input.compacting) return 'compacting'
  if (input.aborting && input.parentMarkedRunning) return 'aborting'
  if (
    // 视图侧不掌握「本回合工作项证据」（那是 runtime 的记账），不传 runHadWorkingItems
    // ⇒ 计时器路径在此恒假：Stop/Send 跟随 running 标记的真实生死（runtime 的清扫与
    // 引擎终局改它），视图不再预演清扫结果。
    shouldClearParentRun({
      parentMarkedRunning: input.parentMarkedRunning,
      compacting: false,
      aborting: false,
      liveWorkingCount: input.liveWorkingCount,
      parentHasActiveTurnResidue: input.parentHasActiveTurnResidue,
      msSinceRunStart: input.msSinceRunStart ?? 0,
    })
  ) {
    return 'idle'
  }
  if (
    input.kernel === 'dsh'
    && input.liveWorkingCount > 0
    && !input.parentHasActiveTurnResidue
  ) {
    return 'working'
  }
  if (input.parentMarkedRunning || input.parentHasActiveTurnResidue) return 'parent'
  return 'idle'
}

export function composerShowsStop(phase: ComposerRunPhase) {
  return phase === 'parent' || phase === 'compacting' || phase === 'aborting'
}

/** Idle or DSH Working: composer Send is a followup / new turn, not parent Stop. */
export function composerAllowsFollowupSend(phase: ComposerRunPhase) {
  return phase === 'idle' || phase === 'working'
}

export function composerParentTurnActive(phase: ComposerRunPhase) {
  return phase === 'parent' || phase === 'aborting'
}
