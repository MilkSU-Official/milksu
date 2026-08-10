// @vitest-environment jsdom

import { createApp, nextTick, ref, type App } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import DomainTaskContextPanel from './DomainTaskContextPanel.vue'
import {
  buildCTFDomainTaskContext,
  buildCVEDomainTaskContext,
  presentDomainTaskContext,
  refreshCTFDomainTaskContext,
} from '@/lib/domainTaskContext'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

async function mountPanel(props: {
  presentation: ReturnType<typeof presentDomainTaskContext>
  collapsed: boolean
}) {
  const onReturnDomain = vi.fn()
  const onUpdateCollapsed = vi.fn()
  const host = document.createElement('div')
  document.body.append(host)
  const app = createApp(DomainTaskContextPanel, {
    presentation: props.presentation,
    collapsed: props.collapsed,
    onReturnDomain,
    'onUpdate:collapsed': onUpdateCollapsed,
  })
  app.mount(host)
  mountedApps.push(app)
  await nextTick()
  return { host, onReturnDomain, onUpdateCollapsed }
}

describe('DomainTaskContextPanel integration', () => {
  it('renders CTF structured facts and return action from domain handoff snapshot', async () => {
    const context = buildCTFDomainTaskContext({
      jobId: 'job-9',
      challengeId: 'ch-9',
      challengeTitle: 'Web challenge',
      materials: [{ name: 'web.zip' }],
      networkScopes: [{
        id: 'scope-web',
        purpose: 'http lab',
        targets: [{ kind: 'origin', value: 'https://ctf.local' }],
      }],
      evidenceCount: 1,
      judgeReceipts: [{ platform: 'NSSCTF', status: 'pending', correct: false }],
    })
    const { host, onReturnDomain } = await mountPanel({
      presentation: presentDomainTaskContext(context),
      collapsed: false,
    })
    const text = host.textContent ?? ''
    expect(text).toContain('ch-9')
    expect(text).toContain('Web challenge')
    expect(text).toContain('web.zip')
    expect(text).toContain('scope-web')
    expect(text).toContain('https://ctf.local')
    expect(text).toContain('NSSCTF')
    expect(text).toContain('CTF 工作台持有')
    host.querySelector<HTMLButtonElement>('[aria-label="返回 CTF 工作台"]')?.click()
    await nextTick()
    expect(onReturnDomain).toHaveBeenCalledTimes(1)
  })

  it('renders CVE structured facts including source evidence, assets and boundary', async () => {
    const context = buildCVEDomainTaskContext({
      cveId: 'CVE-2024-1234',
      title: 'Example vuln',
      sourceEvidence: [{ sourceName: 'NVD', cacheState: 'imported' }],
      assets: [{ name: 'svc', status: 'not_affected', environment: 'prod' }],
      researchScope: 'vendor/product · read-only repo',
      safetyBoundary: '学习与追踪 only',
    })
    const { host, onReturnDomain } = await mountPanel({
      presentation: presentDomainTaskContext(context),
      collapsed: false,
    })
    const text = host.textContent ?? ''
    expect(text).toContain('CVE-2024-1234')
    expect(text).toContain('NVD')
    expect(text).toContain('not_affected')
    expect(text).toContain('read-only repo')
    expect(text).toContain('学习与追踪 only')
    host.querySelector<HTMLButtonElement>('[aria-label="返回 CVE 工作台"]')?.click()
    await nextTick()
    expect(onReturnDomain).toHaveBeenCalledTimes(1)
  })

  it('supports expand → collapse → reopen and keeps live CTF projection updates', async () => {
    const base = buildCTFDomainTaskContext({
      jobId: 'job-live',
      challengeId: 'ch-live',
      challengeTitle: 'Live challenge',
      materials: [],
      networkScopes: [],
    })
    const live = refreshCTFDomainTaskContext(base, {
      materials: [{ name: 'payload.bin' }],
      networkScopes: [{
        id: 'scope-live',
        purpose: 'tcp',
        targets: [{ kind: 'socket', value: '127.0.0.1:9999' }],
      }],
      evidenceCount: 3,
      judgeReceipts: [{ platform: 'local', status: 'correct', correct: true }],
    })!
    const collapsed = ref(false)
    const presentation = ref(presentDomainTaskContext(live))
    const onReturnDomain = vi.fn()
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp({
      components: { DomainTaskContextPanel },
      setup() {
        return { collapsed, presentation, onReturnDomain }
      },
      template: `
        <DomainTaskContextPanel
          :presentation="presentation"
          :collapsed="collapsed"
          @update:collapsed="value => collapsed = value"
          @return-domain="onReturnDomain"
        />
      `,
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()
    expect(host.textContent).toContain('payload.bin')
    expect(host.textContent).toContain('scope-live')

    host.querySelector<HTMLButtonElement>('[aria-label="折叠为 PiP"]')?.click()
    await nextTick()
    expect(collapsed.value).toBe(true)
    expect(host.textContent).toContain('CTF · ch-live')
    expect(host.querySelector('[data-testid="reopen-domain-from-pip"]')).not.toBeNull()

    host.querySelector<HTMLButtonElement>('[data-testid="reopen-domain-from-pip"]')?.click()
    await nextTick()
    expect(collapsed.value).toBe(false)
    expect(host.textContent).toContain('127.0.0.1:9999')
    expect(host.textContent).toContain('已验证正确')
  })

  it('keeps collapse/return hit targets large enough for constrained packaged width', async () => {
    const presentation = presentDomainTaskContext(buildCTFDomainTaskContext({
      jobId: 'job-w',
      challengeId: 'ch-w',
      challengeTitle: 'Width check',
      sourceScope: {
        id: 'source-w',
        purpose: 'base',
        targets: [{ kind: 'origin', value: 'https://base.example' }],
      },
      networkScopes: [{
        id: 'net-w',
        purpose: 'lab',
        targets: [{ kind: 'origin', value: 'https://lab.example' }],
      }],
    }))
    const { host } = await mountPanel({ presentation, collapsed: false })
    host.style.width = '320px'
    const collapse = host.querySelector<HTMLButtonElement>('[aria-label="折叠为 PiP"]')
    const ret = host.querySelector<HTMLButtonElement>('[aria-label="返回 CTF 工作台"]')
    expect(collapse).not.toBeNull()
    expect(ret).not.toBeNull()
    expect(collapse?.className).toContain('min-h-9')
    expect(ret?.className).toContain('min-h-9')
    expect(host.textContent).toContain('source-w')
    expect(host.textContent).toContain('net-w')
  })
})
