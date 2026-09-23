import { describe, expect, it } from 'vitest'
import { groupCodingConversations, groupWorkspaceConversations } from './codingConversationGroups'
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
      '最近',
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
      name: '最近',
      path: null,
      paths: [],
    })
  })

  it('groups product-generated scratch directories as no-project tasks', () => {
    const groups = groupCodingConversations([
      conversation('legacy-scratch', '旧任务', 20, {
        workspacePath: '/Users/milksu/Documents/MilkSU/Coding/新编码任务-deadbeef',
      }),
      conversation('current-scratch', '当前任务', 30, {
        workspacePath: '/Users/milksu/Documents/MilkSU/Coding/临时任务-cafebabe',
      }),
      conversation('internal-scratch', '内部任务', 40, {
        workspacePath: '/Users/milksu/Library/Application Support/com.milksu.app/agent-workspaces/Coding/无项目任务-feedface',
      }),
      conversation('not-started', '尚未开始', 10),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0]).toMatchObject({
      key: 'temporary',
      name: '最近',
      path: null,
      paths: [],
      temporary: true,
    })
    expect(groups[0].conversations.map(item => item.id)).toEqual([
      'internal-scratch',
      'current-scratch',
      'legacy-scratch',
      'not-started',
    ])
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

  it('pins no-project tasks below every real project regardless of activity', () => {
    const groups = groupCodingConversations([
      conversation('scratch-hot', '刚写的草稿', 10, {
        messages: [
          { id: 'message-scratch', role: 'user', content: '最新', timestamp: 2000 },
        ],
      }),
      conversation('quiet-project', '安静项目', 100, {
        workspacePath: '/Users/milksu/code/quiet',
        messages: [
          { id: 'message-quiet', role: 'assistant', content: '旧', timestamp: 50 },
        ],
      }),
      conversation('hot-project', '活跃项目', 80, {
        workspacePath: '/Users/milksu/code/hot',
        messages: [
          { id: 'message-hot', role: 'assistant', content: '中间', timestamp: 900 },
        ],
      }),
    ])

    expect(groups.map(group => group.name)).toEqual(['hot', 'quiet', '最近'])
    expect(groups.at(-1)).toMatchObject({ temporary: true, name: '最近' })
  })

  it('shows one newest Coding row for one CVE domain task', () => {
    const context = {
      kind: 'cve' as const,
      cveId: 'CVE-2024-3400',
      title: 'PAN-OS',
      sourceEvidenceState: '3 条材料',
      sourceEvidenceCount: 3,
      assetMatchState: '3 项资产',
      assetCount: 3,
      researchScope: '当前会话与用户所选项目/材料',
      safetyBoundary: '沿用 Coding Agent 当前权限档',
      roleLabel: 'CVE 研究接力',
    }
    const groups = groupCodingConversations([
      conversation('legacy-old', 'CVE-2024-3400 研究接力', 10, {
        // Pre-domain-context build: only the strict legacy title identifies it.
      }),
      conversation('legacy-new', 'CVE-2024-3400 研究接力', 20, {
        domainTaskContext: context,
        messages: [{ id: 'm', role: 'assistant', content: '已有研究结论', timestamp: 30 }],
      }),
    ])

    expect(groups).toHaveLength(1)
    expect(groups[0].conversations.map(item => item.id)).toEqual(['legacy-new'])
  })

  it('partitions Home / CTF / CVE / Lab chats so each workspace list stays local', () => {
    const cve = conversation('cve-1', 'CVE-2024-3400 复现', 70, {
      domainTaskContext: {
        kind: 'cve',
        cveId: 'CVE-2024-3400',
        title: 'PAN-OS',
        sourceEvidenceState: '',
        sourceEvidenceCount: 0,
        assetMatchState: '',
        assetCount: 0,
        researchScope: 'local',
        safetyBoundary: '',
        roleLabel: 'CVE',
      },
    })
    const lab = conversation('lab-1', 'Juice Shop', 80, {
      domainTaskContext: {
        kind: 'lab',
        jobId: 'job-1',
        title: 'Juice Shop',
        scope: 'local',
        request: '',
      },
    })
    const mixed = [...conversations, cve, lab]

    expect(groupWorkspaceConversations(mixed, 'chat').flatMap(group => group.conversations).map(item => item.id))
      .toEqual(['milk-new', 'milk-old', 'interview', 'scratch'])
    expect(groupWorkspaceConversations(mixed, 'ctf').map(group => group.conversations.map(item => item.id)))
      .toEqual([['ctf-solver']])
    expect(groupWorkspaceConversations(mixed, 'vuln').map(group => group.name)).toEqual(['CVE-2024-3400'])
    expect(groupWorkspaceConversations(mixed, 'lab').map(group => group.name)).toEqual(['Juice Shop'])
  })

  it('lists draw chats in one flat group under the sidebar header', () => {
    const groups = groupWorkspaceConversations([
      conversation('draw', '打招呼开启对话', 10, { workspaceHome: 'image' }),
      conversation('code', '写代码', 20, { workspaceHome: 'chat' }),
    ], 'image')
    expect(groups).toEqual([expect.objectContaining({
      key: 'image',
      name: '',
      flat: true,
    })])
    expect(groups[0]?.conversations.map(item => item.id)).toEqual(['draw'])
  })

  it('keeps unbound CTF chats in a Chats group instead of a bound challenge', () => {
    const groups = groupWorkspaceConversations([
      conversation('loose', '整理题库', 90, { workspaceHome: 'ctf' }),
      conversation('bound', '诸神的三世链', 80, {
        ctfJobId: 'job-gods',
        domainTaskContext: {
          kind: 'ctf',
          jobId: 'job-gods',
          challengeId: 'gods',
          challengeTitle: '诸神的三世链',
          role: 'solver',
          roleLabel: '解题 Agent',
          materialStatus: '',
          materialCount: 0,
          authorizedScope: '',
          evidenceCount: 0,
          artifactCount: 0,
          judgeState: '',
        },
      }),
    ], 'ctf')
    expect(groups.map(group => group.name)).toEqual(['会话', '诸神的三世链'])
    expect(groups.find(group => group.name === '会话')?.conversations.map(item => item.id))
      .toEqual(['loose'])
  })
})

describe('Pinned conversations', () => {
  it('puts pinned chats in one section at the top, ordered by hand', () => {
    const groups = groupCodingConversations([
      conversation('a', 'A', 10, { pinned: true, pinnedOrder: 1, workspacePath: '/p/a' }),
      conversation('b', 'B', 20, { pinned: true, pinnedOrder: 0, workspacePath: '/p/b' }),
      conversation('c', 'C', 30, { workspacePath: '/p/c' }),
    ])

    expect(groups[0]?.key).toBe('pinned')
    expect(groups[0]?.name).toBe('钉选')
    expect(groups[0]?.conversations.map(item => item.id)).toEqual(['b', 'a'])
    const rest = groups.slice(1).flatMap(group => group.conversations.map(item => item.id))
    expect(rest).toContain('c')
    expect(rest).not.toContain('a')
  })

  it('does not reorder pinned chats when one becomes the most recent', () => {
    const before = groupCodingConversations([
      conversation('a', 'A', 10, { pinned: true, pinnedOrder: 0 }),
      conversation('b', 'B', 20, { pinned: true, pinnedOrder: 1 }),
    ])
    const after = groupCodingConversations([
      conversation('a', 'A', 10, {
        pinned: true,
        pinnedOrder: 0,
        messages: [{ id: 'm', role: 'assistant', content: 'x', timestamp: 999, status: 'done' }],
      }),
      conversation('b', 'B', 20, { pinned: true, pinnedOrder: 1 }),
    ])

    expect(before[0]?.conversations.map(item => item.id)).toEqual(['a', 'b'])
    expect(after[0]?.conversations.map(item => item.id)).toEqual(['a', 'b'])
  })

  it('matches the previous grouping exactly when nothing is pinned', () => {
    const withFlag = groupCodingConversations([
      conversation('a', 'A', 10, { pinned: false }),
      conversation('b', 'B', 20),
    ])
    const withoutFlag = groupCodingConversations([
      conversation('a', 'A', 10),
      conversation('b', 'B', 20),
    ])

    expect(withFlag.map(group => [group.key, group.conversations.map(item => item.id)]))
      .toEqual(withoutFlag.map(group => [group.key, group.conversations.map(item => item.id)]))
  })
})
