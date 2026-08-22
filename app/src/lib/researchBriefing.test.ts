import { describe, expect, it } from 'vitest'
import { cveBriefing, labBriefing } from './researchBriefing'

describe('researchBriefing', () => {
  it('asks the CVE agent for a first-pass public analysis without scanning', () => {
    const briefing = cveBriefing('CVE-2024-3400')
    expect(briefing.visible).toBe('先整理 CVE-2024-3400 的公开情况和接下来怎么验证。')
    expect(briefing.prompt).toContain('report.md')
    expect(briefing.prompt).toContain('related.md')
    expect(briefing.prompt).toContain('不要扫描未授权目标')
    expect(briefing.visible).not.toContain('related.md')
  })

  it('sends a local laboratory request for the agent to structure', () => {
    const briefing = labBriefing({
      scope: 'local',
      request: '扫一下本机进程和监听端口',
    })
    expect(briefing.visible).toBe('扫一下本机进程和监听端口')
    expect(briefing.prompt).toContain('作业范围：本地')
    expect(briefing.prompt).toContain('report.md')
    expect(briefing.prompt).toContain('只看本机进程')
    expect(briefing.visible).not.toContain('report.md')
  })

  it('keeps a remote laboratory job on the named target', () => {
    const briefing = labBriefing({
      scope: 'remote',
      request: '看 10.0.0.8:8080 的 HTTP 入口',
    })
    expect(briefing.visible).toBe('看 10.0.0.8:8080 的 HTTP 入口')
    expect(briefing.prompt).toContain('作业范围：远程')
    expect(briefing.prompt).toContain('只看用户点名的远程目标')
  })
})
