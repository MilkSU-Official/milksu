import { describe, expect, it, vi } from 'vitest'
import { codingContinuityPresentation } from '@/lib/codingContinuityPresentation'

describe('Coding continuity presentation', () => {
  it('shows disconnected sessions as not compactable', () => {
    const presentation = codingContinuityPresentation({
      sessionReady: false,
      resumed: false,
      compacting: false,
      running: false,
    })

    expect(presentation.badges).toEqual(['待连接'])
    expect(presentation.title).toContain('尚未连接 Pi 会话')
    expect(presentation.compactDisabled).toBe(true)
    expect(presentation.compactTitle).toContain('连接 Pi 会话后才能整理')
    expect(presentation.compactLabel).toBe('整理上下文')
  })

  it('does not show a stale compaction timestamp before the Pi session reconnects', () => {
    const presentation = codingContinuityPresentation({
      sessionReady: false,
      resumed: true,
      compacting: false,
      compactedAt: Date.now(),
      running: false,
    })

    expect(presentation.badges).toEqual(['待连接'])
    expect(presentation.title).toContain('尚未连接 Pi 会话')
    expect(presentation.compactDisabled).toBe(true)
  })

  it('distinguishes resumed Pi sessions from new sessions', () => {
    const resumed = codingContinuityPresentation({
      sessionReady: true,
      resumed: true,
      compacting: false,
      running: false,
    })
    const fresh = codingContinuityPresentation({
      sessionReady: true,
      resumed: false,
      compacting: false,
      running: false,
    })

    expect(resumed.badges).toEqual(['从持久会话恢复'])
    expect(resumed.title).toContain('持久化的 Pi 会话恢复')
    expect(fresh.badges).toEqual(['新会话'])
    expect(fresh.title).toContain('本任务是新会话')
  })

  it('keeps compaction disabled while a turn or compaction is running', () => {
    const running = codingContinuityPresentation({
      sessionReady: true,
      resumed: false,
      compacting: false,
      running: true,
    })
    const compacting = codingContinuityPresentation({
      sessionReady: true,
      resumed: false,
      compacting: true,
      running: false,
    })

    expect(running.compactDisabled).toBe(true)
    expect(running.compactTitle).toContain('当前回合结束')
    expect(compacting.badges).toEqual(['整理中'])
    expect(compacting.compactDisabled).toBe(true)
    expect(compacting.compactLabel).toBe('整理中…')
  })

  it('shows the latest successful compaction timestamp without hiding resumed state', () => {
    vi.useFakeTimers()
    try {
      vi.setSystemTime(new Date('2026-08-03T12:00:00Z'))
      const presentation = codingContinuityPresentation({
        sessionReady: true,
        resumed: true,
        compacting: false,
        compactedAt: Date.now(),
        running: false,
      })

      expect(presentation.badges[0]).toBe('从持久会话恢复')
      expect(presentation.badges[1]).toMatch(/^已整理 /)
      expect(presentation.compactDisabled).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
