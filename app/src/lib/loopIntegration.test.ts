import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { resolveModelContextWindow } from '@/lib/knownContextWindow'
import {
  applySessionContextComposition,
  applySessionUsageAfterCompaction,
  applySessionUsageRecorded,
  compositionFromStoredUsage,
  emptySessionTurnSnapshot,
  presentContextUsage,
  readContextCompositionFromEvent,
} from '@/lib/sessionTurnStatus'
import { normalizeSubagentTasks, subagentTasksForActivity } from '@/lib/subagentRoster'
import type { Message } from '@/types'

const fixture = JSON.parse(readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), '../../../tests/fixtures/loop-context-integration/turn.json'),
  'utf8',
)) as {
  provider: string
  model: string
  catalogWindow: number
  overrideWindow: number
  billedPromptTokens: number
  usage: {
    inputTokens: number
    cacheReadTokens: number
    outputTokens: number
    totalTokens: number
  }
  contextComposition: {
    estimatedTokens: number
    contextWindow: number
    categories: { id: string; tokens: number }[]
  }
  storedUsage: Record<string, unknown>
  subagentTasks: unknown[]
  forbidden: string[]
}

describe('loop context integration fixture', () => {
  it('projects one Sidecar turn into the meter, roster, and persist shape', () => {
    const window = resolveModelContextWindow(
      fixture.model,
      fixture.catalogWindow,
      fixture.overrideWindow,
    )
    expect(window).toBe(fixture.overrideWindow)

    let snapshot = emptySessionTurnSnapshot()
    snapshot = applySessionUsageRecorded(snapshot, {
      ...fixture.usage,
      model: fixture.model,
      provider: fixture.provider,
    })
    const fromEvent = readContextCompositionFromEvent({
      type: 'context.composition',
      contextComposition: fixture.contextComposition,
    })
    snapshot = applySessionContextComposition(snapshot, fromEvent)

    const presented = presentContextUsage(snapshot)
    expect(presented).not.toBeNull()
    expect(presented?.usedLabel).toBe('6% 已用')
    expect(presented?.tokenRatioLabel).toContain('~')
    expect(presented?.tokenRatioLabel).toContain('200K')
    expect(presented?.categories?.map(item => item.id)).toEqual([
      'system',
      'tools',
      'skills',
      'subagent',
      'conversation',
    ])
    expect(presented?.categories?.reduce((sum, item) => sum + item.tokens, 0))
      .toBe(fixture.billedPromptTokens)
    expect(presented?.occupancy).toBeUndefined()

    const stored = compositionFromStoredUsage(fixture.storedUsage)
    expect(stored?.estimatedTokens).toBe(fixture.billedPromptTokens)
    expect(stored?.categories.map(item => item.id)).toEqual(
      fixture.contextComposition.categories.map(item => item.id),
    )

    const compacted = applySessionUsageAfterCompaction(snapshot, 1800)
    expect(compacted.composition).toBeUndefined()
    expect(presentContextUsage(compacted)?.categories).toBeUndefined()

    const tasks = normalizeSubagentTasks(fixture.subagentTasks)
    const messages: Message[] = [{
      id: 'tool-1',
      role: 'tool',
      content: 'files[0]=a.ts',
      timestamp: 1,
      toolName: 'subagent',
      toolCallId: 'call-1',
      status: 'done',
    }]
    const visible = subagentTasksForActivity(tasks, messages)
    expect(visible).toHaveLength(1)
    expect(visible[0]?.yield?.files[0]).toBe('a.ts')
    expect(subagentTasksForActivity(tasks, [])).toEqual([])

    const serialized = JSON.stringify({ presented, stored, tasks })
    for (const needle of fixture.forbidden) {
      expect(serialized).not.toContain(needle)
    }
  })
})
