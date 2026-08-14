import { describe, expect, it } from 'vitest'
import {
  activityCalendar,
  buildPersonalProfileSnapshot,
  profileAvatarFileProblem,
  qualitativeStage,
} from './personalProfile'
import type { CTFSummary } from '@/ctfTypes'
import type { Conversation } from '@/types'
import type { VulnerabilityIntel } from '@/vulnerabilityIntel'

const now = Date.parse('2026-08-11T12:00:00+08:00')

describe('personal profile projection', () => {
  it('counts user tasks and domain records without counting tool calls as growth', () => {
    const conversations: Conversation[] = [{
      id: 'coding-1', title: '修复桌面回归', createdAt: now - 1000, messages: [
        { id: 'u1', role: 'user', content: '修一下', timestamp: now - 900 },
        { id: 't1', role: 'tool', content: 'tool result', timestamp: now - 200 },
        { id: 'a1', role: 'assistant', content: '修复和测试已完成。', timestamp: now - 100, status: 'done' },
      ],
      domainTaskContext: {
        kind: 'cve', cveId: 'CVE-2026-1000', title: '测试条目', vendor: 'Test', product: 'Widget',
        sourceEvidenceState: '已有资料', sourceEvidenceCount: 1, assetMatchState: '未检查', assetCount: 0,
        researchScope: '仅本地学习', safetyBoundary: '不接触外部资产', roleLabel: '研究助手',
      },
    }, {
      id: 'tool-only', title: '内部工具轨迹', createdAt: now - 500, messages: [
        { id: 't2', role: 'tool', content: 'tool result', timestamp: now - 100 },
      ],
    }]
    const ctfJobs = [{ id: 'ctf-1', title: 'Baby RE', category: 'reverse', status: 'succeeded', experimentCount: 1, verdict: 'pass', pendingSubmission: false, pendingJudge: false, updatedAt: '2026-08-10T10:00:00+08:00' }] as CTFSummary[]
    const vulnerabilities = [{
      id: 'CVE-2026-1000', title: 'Android 反序列化', vendor: 'Test', product: 'Widget',
      cvss: 8, epss: 10, severity: 'high', status: '研究中', assetCount: 0, updated: '本地资料',
      kev: false, affected: '1.x', maturity: '研究中', summary: '测试条目', references: [], assets: [], timeline: [],
    }] as VulnerabilityIntel[]

    const profile = buildPersonalProfileSnapshot(conversations, ctfJobs, vulnerabilities, now)
    expect(profile.modules.map(item => item.count)).toEqual([1, 1, 1])
    expect(profile.activities).toHaveLength(3)
    expect(profile.activities.find(item => item.module === 'ctf')?.detail).toContain('独立验证')
    expect(profile.activities.filter(item => item.confirmed).map(item => item.module)).toEqual(['coding', 'ctf'])
    expect(profile.activeDays).toBe(2)
  })

  it('does not call an ended CTF task confirmed without a Judge pass', () => {
    const ctfJobs = [{
      id: 'ctf-ended', title: 'No receipt', category: 'web', status: 'succeeded', experimentCount: 1,
      pendingSubmission: false, pendingJudge: false, updatedAt: '2026-08-10T10:00:00+08:00',
    }] as CTFSummary[]

    const profile = buildPersonalProfileSnapshot([], ctfJobs, [], now)
    expect(profile.activities).toHaveLength(1)
    expect(profile.activities[0]?.confirmed).toBe(false)
  })

  it('uses honest qualitative stages and a 53-week activity grid', () => {
    expect([0, 1, 5, 16].map(qualitativeStage)).toEqual(['尚未开始', '刚开始', '持续练习', '比较熟悉'])
    expect(activityCalendar({}, now)).toHaveLength(371)
  })

  it('accepts only a small local profile image', () => {
    expect(profileAvatarFileProblem({ type: 'image/png', size: 1024 })).toBe('')
    expect(profileAvatarFileProblem({ type: 'image/svg+xml', size: 1024 })).toContain('PNG')
    expect(profileAvatarFileProblem({ type: 'image/jpeg', size: 2 * 1024 * 1024 })).toContain('1 MB')
  })
})
