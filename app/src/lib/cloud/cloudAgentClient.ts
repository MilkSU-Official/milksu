/**
 * Desktop Connect client stub for MilkSU Cloud Agent.
 * Uses Connect-JSON unary POSTs (same wire as CF Worker examples) until
 * generated @connectrpc stubs are checked in.
 */

export type CloudKernel = 'pi' | 'dsh'

export interface CloudSession {
  id: string
  title: string
  kernel: string
  model: string
  status: string
}

export interface CloudAgentClientOptions {
  baseUrl: string
  getAccessToken: () => Promise<string | null>
  fetchImpl?: typeof fetch
}

const SERVICE = 'milksu.cloud.v1.CloudSessionService'

export class CloudAgentClient {
  private readonly baseUrl: string
  private readonly getAccessToken: () => Promise<string | null>
  private readonly fetchImpl: typeof fetch

  constructor(options: CloudAgentClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '')
    this.getAccessToken = options.getAccessToken
    this.fetchImpl = options.fetchImpl ?? fetch.bind(globalThis)
  }

  async listSessions(): Promise<CloudSession[]> {
    const body = await this.call<{ sessions?: CloudSession[] }>('ListSessions', {})
    return body.sessions ?? []
  }

  async createSession(input: {
    kernel?: CloudKernel
    model?: string
    title?: string
    credentialId?: string
  }): Promise<CloudSession> {
    return this.call<CloudSession>('CreateSession', {
      kernel: input.kernel ?? 'pi',
      model: input.model ?? '',
      title: input.title ?? '',
      credential_id: input.credentialId ?? '',
    })
  }

  async migrateCopy(input: {
    sourceSessionId: string
    direction: 'local_to_cloud' | 'cloud_to_local'
    transcriptJson?: string
  }): Promise<{ target_session_id: string; ok: boolean; error: string }> {
    return this.call('MigrateCopy', {
      source_session_id: input.sourceSessionId,
      direction: input.direction,
      transcript_json: input.transcriptJson ?? '',
    })
  }

  async migrateFinalize(input: {
    sourceSessionId: string
    targetSessionId: string
    direction: 'local_to_cloud' | 'cloud_to_local'
  }): Promise<{ ok: boolean; error: string }> {
    return this.call('MigrateFinalize', {
      source_session_id: input.sourceSessionId,
      target_session_id: input.targetSessionId,
      direction: input.direction,
    })
  }

  private async call<T>(method: string, body: unknown): Promise<T> {
    const token = await this.getAccessToken()
    if (!token) {
      throw new Error('Cloud Agent requires a signed-in MilkSU account')
    }
    const res = await this.fetchImpl(`${this.baseUrl}/${SERVICE}/${method}`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'connect-protocol-version': '1',
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(body ?? {}),
    })
    const json = await res.json().catch(() => ({}))
    if (!res.ok) {
      const message = typeof (json as { message?: string }).message === 'string'
        ? (json as { message: string }).message
        : `Cloud Agent ${method} failed (${res.status})`
      throw new Error(message)
    }
    return json as T
  }
}

export function defaultCloudAgentBaseUrl(): string {
  return 'https://agent.milksu.org'
}
