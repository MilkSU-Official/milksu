import { describe, expect, it } from 'vitest'
import { groupCodingConversations } from './codingConversationGroups'
import type { Conversation } from '@/types'

function conversation(
  id: string,
  title: string,
  createdAt: number,
  extras: Partial<Conversation> = {},
): Conversation {
  return {
    id,
    title,
    createdAt,
    messages: [],
    ...extras,
  }
}

describe('Coding conversation groups', () => {
  const conversations = [
    conversation('milk-new', '修复设置页', 50, { workspacePath: '/Users/milksu/code/milksu/' }),
    conversation('ctf-solver', 'CTF · 第五空间', 60, {
      workspacePath: '/Users/milksu/Library/Application Support/MilkSU/ctf/1',
      ctfJobId: 'job-1',
      ctfRole: 'solver',
    }),
    conversation('interview', '整理面试 Wiki', 40, {
      workspacePath: '/Users/milksu/code/milksu-interview',
    }),
    conversation('milk-old', '补充单元测试', 30, {
      workspacePath: '/Users/milksu/code/milksu',
    }),
    conversation('scratch', '试验一个脚本', 20),
  ]

  it('groups regular Coding tasks by normalized workspace and excludes CTF-owned sessions', () => {
    const groups = groupCodingConversations(conversations)

    expect(groups.map(group => group.name)).toEqual([
      'milksu',
      'milksu-interview',
      '临时沙盒',
    ])
    expect(groups[0].conversations.map(item => item.id)).toEqual(['milk-new', 'milk-old'])
    expect(groups.flatMap(group => group.conversations).map(item => item.id))
      .not.toContain('ctf-solver')
  })

  it('matches repository paths and task titles without leaking unrelated tasks', () => {
    expect(groupCodingConversations(conversations, 'interview')[0].conversations)
      .toHaveLength(1)
    expect(groupCodingConversations(conversations, '单元测试')[0].conversations)
      .toEqual([expect.objectContaining({ id: 'milk-old' })])
  })

  it('keeps conversations without a workspace in a dedicated temporary group', () => {
    const group = groupCodingConversations(conversations)
      .find(item => item.temporary)

    expect(group).toMatchObject({
      key: 'temporary',
      name: '临时沙盒',
      path: null,
      paths: [],
    })
  })

  it('collapses historical path variants with the same project name into one visible project', () => {
    const groups = groupCodingConversations([
      conversation('main', '当前任务', 30, {
        workspacePath: '/Users/milksu/code/milksu',
      }),
      conversation('symlinked', '历史任务', 20, {
        workspacePath: '/Volumes/dev/milksu/',
      }),
      conversation('tmp', '本机临时任务', 10, {
        workspacePath: '/private/tmp/milksu',
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].name).toBe('milksu')
    expect(groups[0].path).toBeNull()
    expect(groups[0].paths).toHaveLength(3)
    expect(groups[0].paths).toEqual(expect.arrayContaining([
      '/Users/milksu/code/milksu',
      '/Volumes/dev/milksu',
      '/tmp/milksu',
    ]))
    expect(groups[0].conversations.map(item => item.id)).toEqual([
      'main',
      'symlinked',
      'tmp',
    ])
  })

  it('orders tasks and projects by last message activity instead of creation time only', () => {
    const groups = groupCodingConversations([
      conversation('milk-new-created', '顶部新建', 500, {
        workspacePath: '/Users/milksu/code/milksu',
        messages: [],
      }),
      conversation('milk-older-active', '底部继续', 100, {
        workspacePath: '/Users/milksu/code/milksu',
        messages: [
          { id: 'message-1', role: 'assistant', content: '最新进展', timestamp: 900 },
        ],
      }),
      conversation('other-active', '另一个项目', 200, {
        workspacePath: '/Users/milksu/code/other',
        messages: [
          { id: 'message-2', role: 'user', content: '稍早继续', timestamp: 800 },
        ],
      }),
    ])

    expect(groups.map(group => group.name)).toEqual(['milksu', 'other'])
    expect(groups[0].lastActiveAt).toBe(900)
    expect(groups[0].conversations.map(item => item.id))
      .toEqual(['milk-older-active', 'milk-new-created'])
  })
})
