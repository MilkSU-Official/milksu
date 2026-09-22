import { describe, expect, it, vi } from 'vitest'
import { CloudAgentClient } from './cloudAgentClient'

describe('CloudAgentClient', () => {
  it('posts Connect-JSON ListSessions with bearer (test transport)', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ sessions: [] }), { status: 200 }),
    ) as unknown as typeof fetch
    const client = new CloudAgentClient({
      baseUrl: 'https://agent.example',
      getAccessToken: async () => 'tok',
      fetchImpl,
    })
    await expect(client.listSessions()).resolves.toEqual([])
    expect(fetchImpl).toHaveBeenCalledOnce()
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toContain('/milksu.cloud.v1.CloudSessionService/ListSessions')
    expect((init.headers as Record<string, string>)['connect-protocol-version']).toBe('1')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok')
  })

  it('uses injected call without touching fetch (desktop RPC shape)', async () => {
    const call = vi.fn(async () => ({ sessions: [{ id: 'c1', title: '', kernel: 'pi', model: '', status: 'ready' }] }))
    const client = new CloudAgentClient({ call })
    await expect(client.listSessions()).resolves.toEqual([
      { id: 'c1', title: '', kernel: 'pi', model: '', status: 'ready' },
    ])
    expect(call).toHaveBeenCalledWith('ListSessions', {})
  })
})
