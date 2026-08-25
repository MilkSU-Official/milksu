import { describe, expect, it } from 'vitest'
import { agentToolChip, messageSourceChips, thinkingSummary } from './agentConversation'
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
    expect(thinkingSummary(6000)).toContain('6')
    expect(thinkingSummary(undefined, true)).toBe('正在思考')
  })
})
