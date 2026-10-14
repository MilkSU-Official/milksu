import { describe, expect, it } from 'vitest'
import {
  buildCVEDomainTaskContext,
  normalizeDomainTaskContext,
  presentDomainTaskContext,
  sharedCodingSessionKind,
} from './domainTaskContext'

describe('domainTaskContext', () => {
  it('builds CVE structured context with source evidence, assets and safe research boundary', () => {
    const context = buildCVEDomainTaskContext({
      cveId: 'CVE-2023-46604',
      title: 'ActiveMQ RCE',
      sourceEvidence: [
        { sourceName: 'NVD', cacheState: 'imported', digest: 'abc' },
        { sourceName: 'CISA KEV', cacheState: 'cached' },
      ],
      assets: [
        { name: 'broker-a', status: 'affected', environment: 'lab', address: '10.0.0.8' },
      ],
      researchScope: 'vendor/product · 当前会话与用户所选项目',
      safetyBoundary: '沿用 Coding Agent 当前权限档',
      practiceScope: 'vulhub · host-only · confirmed',
    })
    const view = presentDomainTaskContext(context)
    expect(view.subtitle).toBe('CVE-2023-46604')
    expect(view.facts.find(item => item.label === '来源')?.value).toContain('NVD')
    expect(view.facts.find(item => item.label === '研究范围')?.value).toContain('vulhub')
    expect(view.facts.find(item => item.label === '安全边界')?.value).toContain('Coding Agent 当前权限档')
    expect(view.returnLabel).toBe('返回 CVE')
    expect(view.ownership).toBe('')
  })

  it('presents a laboratory job without authorization-test copy', () => {
    const view = presentDomainTaskContext({
      kind: 'lab',
      jobId: 'job-1',
      title: '本机练习机',
      scope: 'local',
      request: '扫一下本机进程',
    })
    expect(view.moduleLabel).toBe('实验室')
    expect(view.returnLabel).toBe('返回实验室')
    expect(view.objective).toBe('本地')
    expect(view.facts[0]?.value).toBe('本地')
    expect(view.brief).toBe('扫一下本机进程')
    expect(JSON.stringify(view)).not.toContain('授权测试')
    expect(JSON.stringify(view)).not.toContain('授权靶')
  })

  it('maps session flags onto one shared Coding/Pi surface', () => {
    expect(sharedCodingSessionKind(true)).toBe('cve')
    expect(sharedCodingSessionKind(false)).toBe('coding')
    expect(normalizeDomainTaskContext({
      kind: 'ctf',
      jobId: 'job-1',
      challengeTitle: 'legacy',
    })).toBeUndefined()
    expect(presentDomainTaskContext({
      kind: 'lab',
      jobId: 'job-2',
      title: 'Juice Shop',
      scope: 'local',
      request: '练 XSS',
    }).returnAriaLabel).toBe('返回实验室')
  })
})
