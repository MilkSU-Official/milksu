import { describe, expect, it } from 'vitest'
import {
  formatSubagentYield,
  normalizeSubagentTasks,
  subagentTasksForActivity,
} from './subagentRoster'
import type { Message, SubagentTask } from '@/types'

function tool(id: string, extra: Partial<Message> = {}): Message {
  return {
    id,
    role: 'tool',
    content: 'scout',
    timestamp: 1,
    toolName: 'subagent',
    toolCallId: 'call-1',
    status: 'running',
    ...extra,
  }
}

describe('subagent roster helpers', () => {
  it('keeps only a complete roster row', () => {
    const tasks = normalizeSubagentTasks([
      { id: 'call-1', role: 'scout', status: 'start' },
      { id: '', role: 'worker', status: 'succeeded' },
      { role: 'scout', status: 'running' },
    ])
    expect(tasks).toHaveLength(1)
    expect(tasks[0]).toMatchObject({ id: 'call-1', role: 'scout', status: 'start' })
  })

  it('matches roster rows to the activity that owns the tool call', () => {
    const tasks: SubagentTask[] = [
      { id: 'call-1', role: 'scout', status: 'running', toolCallId: 'call-1' },
      { id: 'call-2', role: 'worker', status: 'start', toolCallId: 'call-2' },
    ]
    expect(subagentTasksForActivity(tasks, [tool('t1')]).map(task => task.id)).toEqual(['call-1'])
    expect(subagentTasksForActivity(tasks, [tool('t2', { toolName: 'bash' })])).toEqual([])
    expect(subagentTasksForActivity([], [tool('t1')])).toEqual([])
  })

  it('formats yield as field lines', () => {
    expect(formatSubagentYield({
      status: 'succeeded',
      worktreeId: 'writer-1',
      files: ['a.ts'],
      findings: [{ path: 'a.ts', note: 'renamed' }],
      exitCode: 0,
    })).toContain('files[0]=a.ts')
  })
})
