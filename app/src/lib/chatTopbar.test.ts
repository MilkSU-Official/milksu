import { describe, expect, it } from 'vitest'
import { chatTopbarPresentation } from './chatTopbar'

describe('chatTopbarPresentation', () => {
  it('keeps normal Coding conversations under the Coding module title', () => {
    expect(chatTopbarPresentation({
      ctfSession: false,
      conversationTitle: '修复导航',
      workspacePath: '/Users/milksu/code/milksu',
      codingPolicyLabel: 'Go · 项目自动',
    })).toEqual({
      title: 'Coding',
      subtitle: '修复导航 · /Users/milksu/code/milksu',
    })
  })

  it('labels CTF Agent conversations as CTF instead of Coding', () => {
    expect(chatTopbarPresentation({
      ctfSession: true,
      conversationTitle: 'NSSCTF P3879',
      codingPolicyLabel: 'Go · 项目自动',
      ctfMode: 'coach',
    })).toEqual({
      title: 'CTF',
      subtitle: 'NSSCTF P3879 · 教练',
    })
  })

  it('keeps empty Coding tasks explicit about temporary workspace policy', () => {
    expect(chatTopbarPresentation({
      ctfSession: false,
      codingPolicyLabel: 'Go · 完全访问',
    })).toEqual({
      title: 'Coding',
      subtitle: '新编码任务 · 临时工作区 · Go · 完全访问',
    })
  })

  it('marks CVE handoff conversations as Coding tasks with CVE source context', () => {
    expect(chatTopbarPresentation({
      ctfSession: false,
      vulnerabilitySession: true,
      conversationTitle: 'CVE-2023-46604 研究接力',
      workspacePath: '/Users/milksu/code/milksu',
      codingPolicyLabel: 'Go · 项目自动',
    })).toEqual({
      title: 'Coding',
      subtitle: 'CVE-2023-46604 研究接力 · CVE 接力 · /Users/milksu/code/milksu',
    })
  })
})
