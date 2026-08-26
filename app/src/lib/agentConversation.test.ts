import { describe, expect, it } from 'vitest'
import { agentFileDiffChips, agentToolChip, formatDemoElapsed, messageSourceChips, parseDiffPreview, thinkingSummary } from './agentConversation'
import type { ChatActivityEntry } from './chatActivity'

function entry(toolName: string, content: string): ChatActivityEntry {
  return {
    id: 'tool:1',
    toolName,
    request: {
      id: '1',
      role: 'tool',
      content,
      timestamp: 1,
      toolName,
      status: 'done',
    },
    running: false,
  }
}

describe('agent conversation chips', () => {
  it('turns edit stats into a file pill', () => {
    expect(agentToolChip(entry('edit', 'src/greet.ts +12 -4'))).toEqual({
      verb: 'Edit',
      pill: 'greet.ts',
      add: 12,
      del: 4,
    })
  })

  it('uses the command as the bash pill', () => {
    expect(agentToolChip(entry('bash', '$ npm test')).pill).toBe('npm test')
  })

  it('labels progress tools as Plan and truncates long pills', () => {
    const chip = agentToolChip(entry('milksu_progress', '只调查仓库根目录与 README 开头，确认项目定位，不修改任何文件。'))
    expect(chip.verb).toBe('Plan')
    expect(chip.pill.length).toBeLessThanOrEqual(64)
  })

  it('only lifts https markdown links into source chips', () => {
    expect(messageSourceChips('see [docs](https://vitest.dev/guide/) and http://insecure.example')).toEqual([
      { href: 'https://vitest.dev/guide/', label: 'vitest.dev' },
    ])
  })

  it('labels thinking duration without leaking thresholds', () => {
    expect(thinkingSummary(6000)).toContain('6.0s')
    expect(thinkingSummary(undefined, true)).toBe('正在思考')
  })

  it('formats Beautiful UI elapsed tenths then minutes', () => {
    expect(formatDemoElapsed(0)).toBe('0.0s')
    expect(formatDemoElapsed(100)).toBe('0.1s')
    expect(formatDemoElapsed(61200)).toBe('1m 1.2s')
  })

  it('lifts edit tools into file-diff chips with a hover preview', () => {
    expect(parseDiffPreview('--- a\n+++ b\n@@\n-old hero\n+new hero\n keep')).toEqual([
      { text: 'old hero', tone: 'del' },
      { text: 'new hero', tone: 'add' },
      { text: 'keep', tone: 'ctx' },
    ])
    const chips = agentFileDiffChips([{
      id: 'tool:edit',
      toolName: 'edit',
      request: {
        id: '1',
        role: 'tool',
        content: 'src/greet.ts +2 -1\n-hello\n+hello world',
        timestamp: 1,
        toolName: 'edit',
        status: 'done',
      },
      running: false,
    }])
    expect(chips).toEqual([{
      path: 'greet.ts',
      add: 2,
      del: 1,
      lines: [
        { text: 'hello', tone: 'del' },
        { text: 'hello world', tone: 'add' },
      ],
    }])
  })
})
