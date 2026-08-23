import { describe, expect, it } from 'vitest'
import { latestCodingPlan, parseCodingPlanContent, settleIdleCodingPlan } from '@/lib/codingPlan'
import type { Message } from '@/types'

function tool(id: string, content: string, status: Message['status'] = 'done'): Message {
  return {
    id,
    role: 'tool',
    content,
    timestamp: 1,
    toolName: 'milksu_progress',
    status,
  }
}

describe('codingPlan', () => {
  it('parses the milksu_progress checklist payload', () => {
    const plan = parseCodingPlanContent([
      '先摸清仓库再改构建',
      '[x] 读取 package.json',
      '[>] 定位失败脚本',
      '[ ] 提交最小修复',
    ].join('\n'))
    expect(plan).toEqual({
      summary: '先摸清仓库再改构建',
      steps: [
        { text: '读取 package.json', status: 'completed' },
        { text: '定位失败脚本', status: 'in_progress' },
        { text: '提交最小修复', status: 'pending' },
      ],
    })
  })

  it('parses JSON args shown while the tool call is running', () => {
    const plan = parseCodingPlanContent(JSON.stringify({
      summary: '验证登录流',
      steps: [
        { text: '打开设置页', status: 'in_progress' },
        { text: '检查账户行', status: 'pending' },
      ],
    }, null, 2))
    expect(plan?.summary).toBe('验证登录流')
    expect(plan?.steps).toHaveLength(2)
    expect(plan?.steps[0]?.status).toBe('in_progress')
  })

  it('returns null for unrelated tool output', () => {
    expect(parseCodingPlanContent('$ npm test')).toBeNull()
    expect(parseCodingPlanContent('')).toBeNull()
  })

  it('reads the latest plan from conversation messages', () => {
    const messages: Message[] = [
      tool('old', [
        '旧计划',
        '[x] 一步',
      ].join('\n')),
      {
        id: 'bash',
        role: 'tool',
        content: '$ ls',
        timestamp: 2,
        toolName: 'bash',
        status: 'done',
      },
      tool('new', [
        '新计划',
        '[>] 正在做',
        '[ ] 下一步',
      ].join('\n')),
    ]
    expect(latestCodingPlan(messages)?.summary).toBe('新计划')
    expect(latestCodingPlan(messages)?.steps.map(step => step.status))
      .toEqual(['in_progress', 'pending'])
  })

  it('stops spinning in-progress steps after the Agent turn has ended', () => {
    const plan = parseCodingPlanContent([
      '复现已知洞',
      '[>] 正在把只读研究结论写入工作区交付',
      '[ ] 整理网络证据',
    ].join('\n'))
    expect(settleIdleCodingPlan(plan!).steps.map(step => step.status))
      .toEqual(['completed', 'pending'])
  })
})
