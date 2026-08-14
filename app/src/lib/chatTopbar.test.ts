import { describe, expect, it } from 'vitest'
import { chatTopbarPresentation } from './chatTopbar'

describe('chatTopbarPresentation', () => {
  it('uses the current Coding conversation as the chat title', () => {
    expect(chatTopbarPresentation({
      ctfSession: false,
      conversationTitle: '修复导航',
      workspacePath: '/Users/milksu/code/milksu',
      codingPolicyLabel: 'Go · 项目自动',
    })).toEqual({
      title: '修复导航',
      subtitle: '/Users/milksu/code/milksu',
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
      title: '新编码任务',
      subtitle: '临时工作区 · Go · 完全访问',
    })
  })

  it('does not expose a generated scratch directory as a user project', () => {
    expect(chatTopbarPresentation({
      ctfSession: false,
      conversationTitle: '检查登录回调',
      workspacePath: '/Users/milksu/Documents/MilkSU/Coding/临时任务-deadbeef',
      codingPolicyLabel: 'Go · 项目自动',
    })).toEqual({
      title: '检查登录回调',
      subtitle: '临时工作区 · Go · 项目自动',
    })
  })

  it('labels CVE handoff conversations with the CVE module title', () => {
    expect(chatTopbarPresentation({
      ctfSession: false,
      vulnerabilitySession: true,
      conversationTitle: 'CVE-2023-46604 研究接力',
      workspacePath: '/Users/milksu/code/milksu',
      codingPolicyLabel: 'Go · 项目自动',
    })).toEqual({
      title: 'CVE',
      subtitle: 'CVE-2023-46604 研究接力 · /Users/milksu/code/milksu',
    })
  })

  it('keeps empty CVE handoff tasks explicit about temporary workspace policy', () => {
    expect(chatTopbarPresentation({
      ctfSession: false,
      vulnerabilitySession: true,
      codingPolicyLabel: 'Go · 项目自动',
    })).toEqual({
      title: 'CVE',
      subtitle: 'CVE 接力 · 临时工作区 · Go · 项目自动',
    })
  })
})
