import { describe, expect, it } from 'vitest'
import type { Message } from '@/types'
import {
  STALE_PARENT_RUN_MS,
  composerAllowsFollowupSend,
  composerParentTurnActive,
  composerRunPhase,
  composerShowsStop,
  parentHasActiveTurnResidue,
  parentHasBlockingToolResidue,
  shouldClearParentRun,
} from '@/lib/composerRunState'

function message(partial: Partial<Message>): Message {
  return {
    id: partial.id ?? 'm',
    role: partial.role ?? 'assistant',
    content: partial.content ?? '',
    timestamp: 1,
    status: partial.status,
    toolName: partial.toolName,
    approvalRequestId: partial.approvalRequestId,
  }
}

describe('composer run state', () => {
  it('treats DSH subagent tool rows as Working, not parent residue', () => {
    expect(parentHasActiveTurnResidue([
      message({ role: 'tool', status: 'running', toolName: 'subagent' }),
    ], 'dsh')).toBe(false)
    expect(parentHasActiveTurnResidue([
      message({ role: 'tool', status: 'running', toolName: 'subagent' }),
    ], 'pi')).toBe(true)
    expect(parentHasActiveTurnResidue([
      message({ role: 'assistant', status: 'running', content: '...' }),
    ], 'dsh')).toBe(true)
    expect(parentHasBlockingToolResidue([
      message({ role: 'tool', status: 'running', toolName: 'bash' }),
    ], 'dsh')).toBe(true)
  })

  it('does not treat a DSH assistant waiting on live Working as parent residue', () => {
    expect(parentHasActiveTurnResidue([
      message({ role: 'assistant', status: 'running', content: 'delegating' }),
      message({ role: 'tool', status: 'running', toolName: 'subagent' }),
    ], 'dsh', { liveWorkingCount: 2 })).toBe(false)
    expect(parentHasActiveTurnResidue([
      message({ role: 'assistant', status: 'running', content: 'delegating' }),
    ], 'dsh', { workingJustEmptied: true })).toBe(false)
    expect(parentHasActiveTurnResidue([
      message({ role: 'assistant', status: 'running', content: 'delegating' }),
      message({ role: 'tool', status: 'running', toolName: 'bash' }),
    ], 'dsh', { liveWorkingCount: 1 })).toBe(true)
  })

  it('keeps a just-started parent turn even before the first token', () => {
    expect(shouldClearParentRun({
      parentMarkedRunning: true,
      compacting: false,
      aborting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      msSinceRunStart: 200,
    })).toBe(false)
    expect(composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: true,
      aborting: false,
      compacting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      msSinceRunStart: 200,
    })).toBe('parent')
  })

  it('clears a parent run with roster evidence, but never on marker age alone', () => {
    // 边沿路径：在跑工作项从非空变空（引擎 roster 事件驱动），事件本身即证据 ⇒ 立即清。
    expect(shouldClearParentRun({
      parentMarkedRunning: true,
      compacting: false,
      aborting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      workingJustEmptied: true,
      msSinceRunStart: 80,
    })).toBe(true)
    // 计时器路径（β.196 收口）：本回合观测到过在跑工作项（runHadWorkingItems）才放行；
    // 宽限内（< 2s）不清，给下一个工作项入场留时间。
    expect(shouldClearParentRun({
      parentMarkedRunning: true,
      compacting: false,
      aborting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      runHadWorkingItems: true,
      msSinceRunStart: STALE_PARENT_RUN_MS - 1,
    })).toBe(false)
    expect(shouldClearParentRun({
      parentMarkedRunning: true,
      compacting: false,
      aborting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      runHadWorkingItems: true,
      msSinceRunStart: STALE_PARENT_RUN_MS,
    })).toBe(true)
    // 没有工作项证据：运行标记的年龄单独不构成清扫理由。慢 TTFB / 长工具静默 /
    // 恢复中的会话都是引擎说了算的静默，等引擎终局事件或读者动作（β.196 kunbot 案）。
    expect(shouldClearParentRun({
      parentMarkedRunning: true,
      compacting: false,
      aborting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      msSinceRunStart: STALE_PARENT_RUN_MS,
    })).toBe(false)
    expect(shouldClearParentRun({
      parentMarkedRunning: true,
      compacting: false,
      aborting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      msSinceRunStart: 120_000,
    })).toBe(false)
    // 证据在场也翻不过消息残留：回合还有自己的产出在跑就不算完。
    expect(shouldClearParentRun({
      parentMarkedRunning: true,
      compacting: false,
      aborting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: true,
      runHadWorkingItems: true,
      workingJustEmptied: true,
      msSinceRunStart: 80,
    })).toBe(false)
    // 视图口径（composerRunPhase 不掌握 runtime 的工作项证据）⇒ 计时器路径恒假，
    // Stop/Send 跟随 running 标记的真实生死，不再预演清扫结果。
    expect(composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: true,
      aborting: false,
      compacting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      msSinceRunStart: STALE_PARENT_RUN_MS,
    })).toBe('parent')
    expect(composerShowsStop('parent')).toBe(true)
    expect(composerAllowsFollowupSend('parent')).toBe(false)
    // runtime 清掉 running 之后（引擎终局或带证据的清扫）⇒ 视图照常回落 idle。
    expect(composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: false,
      aborting: false,
      compacting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
      msSinceRunStart: 0,
    })).toBe('idle')
    expect(composerShowsStop('idle')).toBe(false)
    expect(composerAllowsFollowupSend('idle')).toBe(true)
  })

  it('does not show the composer stop while only DSH background Working is live', () => {
    const phase = composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: true,
      aborting: false,
      compacting: false,
      liveWorkingCount: 3,
      parentHasActiveTurnResidue: false,
      msSinceRunStart: 8_000,
    })
    expect(phase).toBe('working')
    expect(composerShowsStop(phase)).toBe(false)
    expect(composerAllowsFollowupSend(phase)).toBe(true)
    expect(composerParentTurnActive(phase)).toBe(false)
  })

  it('keeps Stop while the parent is still streaming or running bash', () => {
    expect(composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: true,
      aborting: false,
      compacting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: true,
      msSinceRunStart: 8_000,
    })).toBe('parent')
    expect(composerShowsStop('parent')).toBe(true)
    expect(composerAllowsFollowupSend('parent')).toBe(false)
  })

  it('keeps Pi blocked on the parent stop while its subagent tool is running', () => {
    const phase = composerRunPhase({
      kernel: 'pi',
      parentMarkedRunning: true,
      aborting: false,
      compacting: false,
      liveWorkingCount: 2,
      parentHasActiveTurnResidue: true,
      msSinceRunStart: 8_000,
    })
    expect(phase).toBe('parent')
    expect(composerShowsStop(phase)).toBe(true)
    expect(composerParentTurnActive(phase)).toBe(true)
  })

  it('keeps stop during compact and abort', () => {
    expect(composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: true,
      aborting: false,
      compacting: true,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
    })).toBe('compacting')
    expect(composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: true,
      aborting: true,
      compacting: false,
      liveWorkingCount: 0,
      parentHasActiveTurnResidue: false,
    })).toBe('aborting')
    expect(composerShowsStop('compacting')).toBe(true)
    expect(composerShowsStop('aborting')).toBe(true)
    expect(composerAllowsFollowupSend('compacting')).toBe(false)
    expect(composerAllowsFollowupSend('aborting')).toBe(false)
  })

  it('keeps Multitask children in the Working phase with Send, not Stop', () => {
    const phase = composerRunPhase({
      kernel: 'dsh',
      parentMarkedRunning: false,
      aborting: false,
      compacting: false,
      liveWorkingCount: 1,
      parentHasActiveTurnResidue: false,
    })
    expect(phase).toBe('working')
    expect(composerShowsStop(phase)).toBe(false)
    expect(composerAllowsFollowupSend(phase)).toBe(true)
  })
})
