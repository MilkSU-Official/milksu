import { describe, expect, it } from 'vitest'
import { labBriefing } from './researchBriefing'

describe('researchBriefing', () => {
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
