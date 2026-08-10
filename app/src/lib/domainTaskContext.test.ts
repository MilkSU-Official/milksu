import { describe, expect, it } from 'vitest'
import {
  buildCTFDomainTaskContext,
  buildCVEDomainTaskContext,
  formatAuthorizedScope,
  mergeAuthorizedScopes,
  presentDomainTaskContext,
  refreshCTFDomainTaskContext,
  sharedCodingSessionKind,
} from './domainTaskContext'

describe('domainTaskContext', () => {
  it('describes an empty material projection without claiming the challenge has no attachment', () => {
    const context = buildCTFDomainTaskContext({
      jobId: 'job-empty',
      challengeId: 'ch-empty',
      challengeTitle: 'Attachment pending',
      materials: [],
    })
    expect(context.materialStatus).toBe('无已挂载附件 / 无本地材料')
  })

  it('builds CTF structured context with exact scope, materials and judge state', () => {
    const context = buildCTFDomainTaskContext({
      jobId: 'job-1',
      challengeId: 'ch-42',
      challengeTitle: 'NSSCTF P3879',
      role: 'solver',
      materials: [{ name: 'dist.zip' }, { name: 'readme.md' }],
      networkScopes: [{
        id: 'scope-http-1',
        purpose: 'challenge endpoint',
        targets: [{ kind: 'origin', value: 'https://lab.example:8443' }],
      }],
      evidenceCount: 2,
      artifactCount: 1,
      judgeReceipts: [{ platform: 'NSSCTF', status: 'accepted', correct: true }],
    })
    expect(context.challengeId).toBe('ch-42')
    expect(context.challengeTitle).toBe('NSSCTF P3879')
    expect(context.materialStatus).toContain('dist.zip')
    expect(context.authorizedScope).toContain('scope-http-1')
    expect(context.authorizedScope).toContain('origin:https://lab.example:8443')
    expect(context.judgeState).toContain('NSSCTF')
    expect(context.judgeState).toContain('已验证正确')

    const view = presentDomainTaskContext(context)
    expect(view.facts.map(item => item.label)).toEqual([
      '题目 ID', '题目标题', '材料/附件', '授权 Scope', '证据', '制品', 'Judge', '角色',
    ])
    expect(view.returnAriaLabel).toBe('返回 CTF 工作台')
    expect(view.ownership).toContain('CTF 工作台持有')
    expect(view.ownership).toContain('同一 Coding/Pi 会话')
  })

  it('refreshes CTF panel from live domain projection without dropping handoff identity', () => {
    const base = buildCTFDomainTaskContext({
      jobId: 'job-1',
      challengeId: 'ch-42',
      challengeTitle: 'Old title',
      materials: [],
      networkScopes: [],
    })
    const refreshed = refreshCTFDomainTaskContext(base, {
      challengeTitle: 'Live title',
      materials: [{ name: 'flag.txt' }],
      networkScopes: [{
        id: 'scope-2',
        purpose: 'ssh lab',
        targets: [{ kind: 'ssh', value: 'user@10.0.0.3:22' }],
      }],
      evidenceCount: 4,
      artifactCount: 2,
      judgeReceipts: [{ platform: 'local', status: 'wrong', correct: false }],
    })
    expect(refreshed?.challengeId).toBe('ch-42')
    expect(refreshed?.challengeTitle).toBe('Live title')
    expect(refreshed?.materialStatus).toContain('flag.txt')
    expect(refreshed?.authorizedScope).toContain('ssh:user@10.0.0.3:22')
    expect(refreshed?.evidenceCount).toBe(4)
    expect(refreshed?.judgeState).toContain('未通过')
  })

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
      researchScope: 'vendor/product · 仅授权仓库只读',
      safetyBoundary: '学习与追踪 only',
      practiceScope: 'vulhub · host-only · confirmed',
    })
    const view = presentDomainTaskContext(context)
    expect(view.facts.find(item => item.label === 'CVE ID')?.value).toBe('CVE-2023-46604')
    expect(view.facts.find(item => item.label === '来源证据')?.value).toContain('NVD')
    expect(view.facts.find(item => item.label === '资产匹配')?.value).toContain('affected')
    expect(view.facts.find(item => item.label === '研究 Scope')?.value).toContain('vulhub')
    expect(view.facts.find(item => item.label === '安全边界')?.value).toContain('学习与追踪')
    expect(view.returnLabel).toBe('返回 CVE')
    expect(view.ownership).toContain('CVE 工作台持有')
  })

  it('maps session flags onto one shared Coding/Pi surface', () => {
    expect(sharedCodingSessionKind(true, false)).toBe('ctf')
    expect(sharedCodingSessionKind(false, true)).toBe('cve')
    expect(sharedCodingSessionKind(false, false)).toBe('coding')
  })

  it('while Agent running=true, live projection still yields exact id/title/scope/materials/judge', () => {
    // Simulates startCTFAgent → send with running=true before first paint:
    // handoff snapshot only has jobId fallback until get_ctf_job returns.
    const handoffSnapshot = buildCTFDomainTaskContext({
      jobId: 'job-running',
      challengeId: 'job-running',
      challengeTitle: 'CTF · Pending title',
      materials: [],
      networkScopes: [],
      evidenceCount: 0,
      judgeReceipts: [],
    })
    const agentRunning = true
    expect(agentRunning).toBe(true)

    const projectionReturned = {
      challengeId: 'ch-exact-42',
      challengeTitle: 'Exact live challenge',
      materials: [{ name: 'challenge.bin' }, { name: 'hint.txt' }],
      // Base grant from challenge.source.scope must not be dropped when networkScopes also exist.
      sourceScope: {
        id: 'source-grant-base',
        purpose: 'challenge origin',
        targets: [{ kind: 'origin', value: 'https://challenge.example' }],
      },
      networkScopes: [{
        id: 'scope-exact',
        purpose: 'authorized lab',
        targets: [{ kind: 'origin', value: 'https://live.lab:8443' }],
      }],
      evidenceCount: 5,
      artifactCount: 2,
      judgeReceipts: [{ platform: 'NSSCTF', status: 'accepted', correct: true }],
    }
    const merged = refreshCTFDomainTaskContext(handoffSnapshot, projectionReturned)
    const view = presentDomainTaskContext(merged!)
    const scopeText = view.facts.find(f => f.label === '授权 Scope')?.value ?? ''

    expect(view.facts.find(f => f.label === '题目 ID')?.value).toBe('ch-exact-42')
    expect(view.facts.find(f => f.label === '题目标题')?.value).toBe('Exact live challenge')
    expect(view.facts.find(f => f.label === '材料/附件')?.value).toContain('challenge.bin')
    expect(scopeText).toContain('source-grant-base')
    expect(scopeText).toContain('https://challenge.example')
    expect(scopeText).toContain('scope-exact')
    expect(scopeText).toContain('https://live.lab:8443')
    expect(view.facts.find(f => f.label === '证据')?.value).toBe('5')
    expect(view.facts.find(f => f.label === 'Judge')?.value).toContain('已验证正确')
    // Must not remain stuck on handoff jobId-as-challengeId fallback.
    expect(view.facts.find(f => f.label === '题目 ID')?.value).not.toBe('job-running')
    expect(scopeText).not.toBe('未授权 Scope')
  })

  it('merges challenge.source.scope with approved network scopes and drops revoked/duplicates', () => {
    const scopes = mergeAuthorizedScopes(
      {
        id: 'source-1',
        purpose: 'base challenge',
        targets: [{ kind: 'origin', value: 'https://base.example' }],
      },
      [
        {
          id: 'source-1',
          purpose: 'base challenge',
          targets: [{ kind: 'origin', value: 'https://base.example' }],
        },
        {
          id: 'net-revoked',
          purpose: 'old endpoint',
          revokedAt: '2026-01-01T00:00:00Z',
          targets: [{ kind: 'origin', value: 'https://revoked.example' }],
        },
        {
          id: 'net-active',
          purpose: 'approved endpoint',
          targets: [{ kind: 'origin', value: 'https://api.example' }],
        },
      ],
    )
    expect(scopes.map(scope => scope.id)).toEqual(['source-1', 'net-active'])
    const text = formatAuthorizedScope(scopes)
    expect(text).toContain('source-1')
    expect(text).toContain('https://base.example')
    expect(text).toContain('net-active')
    expect(text).toContain('https://api.example')
    expect(text).not.toContain('revoked.example')
  })
})
