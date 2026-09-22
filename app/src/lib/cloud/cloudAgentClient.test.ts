import { describe, expect, it, vi } from 'vitest'
import { CloudAgentClient } from './cloudAgentClient'

describe('CloudAgentClient', () => {
  it('posts Connect-JSON ListSessions with bearer', async () => {
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
})
