// @vitest-environment jsdom

import { createApp, nextTick, type App } from 'vue'
import { afterEach, describe, expect, it } from 'vitest'
import CTFEndpointAuthorization from './CTFEndpointAuthorization.vue'
import type {
  CTFEndpointRequest,
  CTFEndpointRequestInput,
  CTFScopeGrant,
} from '@/ctfTypes'

const mountedApps: App[] = []

afterEach(() => {
  for (const app of mountedApps.splice(0)) app.unmount()
  document.body.innerHTML = ''
})

function scope(
  id: string,
  kind: 'lab' | 'origin' | 'socket' | 'ssh',
  value: string,
): CTFScopeGrant {
  return {
    id,
    source: 'test',
    purpose: 'test',
    targets: [{ kind, value }],
    grantedBy: 'local-user',
    createdAt: '2026-08-03T00:00:00Z',
    expiresAt: '2026-08-03T08:00:00Z',
    revocable: true,
  }
}

describe('CTFEndpointAuthorization', () => {
  it('shows review evidence and emits only an explicit item decision', async () => {
    const approved: string[] = []
    const denied: string[] = []
    const request: CTFEndpointRequest = {
      id: 'endpoint_pending',
      protocol: 'ssh',
      host: 'challenge.example.test',
      port: 2222,
      target: { kind: 'ssh', value: 'challenge.example.test:2222' },
      source: 'Agent 从题目附件中发现',
      purpose: '只读检查 SSH 服务标识',
      requestedBy: 'agent',
      status: 'pending',
      requestedAt: '2026-08-03T00:10:00Z',
    }
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CTFEndpointAuthorization, {
      sourceScope: scope('scope_source', 'lab', 'offline-intake'),
      networkScopes: [scope('scope_http', 'origin', 'https://approved.example.test')],
      requests: [request],
      onApprove: (id: string) => approved.push(id),
      onDeny: (id: string) => denied.push(id),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    expect(host.textContent).toContain('SSH')
    expect(host.textContent).toContain('challenge.example.test:2222')
    expect(host.textContent).toContain('Agent 从题目附件中发现')
    expect(host.textContent).toContain('只读检查 SSH 服务标识')
    expect(host.textContent).toContain('通用 Shell 始终禁网')
    expect(host.textContent).toContain('https://approved.example.test')

    const approve = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('仅批准此 Endpoint'),
    )
    const deny = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('拒绝'),
    )
    approve?.click()
    deny?.click()
    await nextTick()
    expect(approved).toEqual(['endpoint_pending'])
    expect(denied).toEqual(['endpoint_pending'])
  })

  it('collects protocol, exact target, source, and purpose as a pending request', async () => {
    const submitted: CTFEndpointRequestInput[] = []
    const host = document.createElement('div')
    document.body.append(host)
    const app = createApp(CTFEndpointAuthorization, {
      sourceScope: scope('scope_source', 'lab', 'offline-intake'),
      networkScopes: [],
      requests: [],
      onRequest: (request: CTFEndpointRequestInput) => submitted.push(request),
    })
    app.mount(host)
    mountedApps.push(app)
    await nextTick()

    const endpoint = host.querySelector<HTMLInputElement>(
      'input[placeholder="https://challenge.example"]',
    )
    const source = host.querySelector<HTMLInputElement>(
      'input[placeholder*="题目页面"]',
    )
    const purpose = host.querySelector<HTMLInputElement>(
      'input[placeholder*="为什么需要"]',
    )
    const submit = [...host.querySelectorAll<HTMLButtonElement>('button')].find(
      button => button.textContent?.includes('提交授权申请'),
    )
    if (!endpoint || !source || !purpose || !submit) {
      throw new Error('missing Endpoint request controls')
    }
    expect(submit.disabled).toBe(true)
    for (const [input, value] of [
      [endpoint, 'https://challenge.example.test:8443'],
      [source, '题目页面动态实例'],
      [purpose, '读取 HTTP 基线'],
    ] as const) {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    await nextTick()
    expect(submit.disabled).toBe(false)
    submit.click()
    await nextTick()
    expect(submitted).toEqual([{
      protocol: 'https',
      endpoint: 'https://challenge.example.test:8443',
      source: '题目页面动态实例',
      purpose: '读取 HTTP 基线',
    }])
  })
})
