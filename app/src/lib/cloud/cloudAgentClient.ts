/**
 * Desktop Connect client for MilkSU Cloud Agent.
 * Production path: Electron main `CloudAgentInvoke` attaches Bearer.
 * Test path: optional getAccessToken + fetchImpl (never used by product UI).
 */

export type CloudKernel = 'pi' | 'dsh'

export interface CloudSession {
  id: string
  title: string
  kernel: string
  model: string
  status: string
  /** Present on GetSession — JSON array of {role, content}. */
  transcript_json?: string
}

export type CloudAgentCall = (method: string, body: unknown) => Promise<unknown>

export interface CloudAgentClientOptions {
  /** Preferred: desktop RPC / injected transport (no token in renderer). */
  call?: CloudAgentCall
  /** Test-only direct Connect-JSON. Product UI must not pass a real token. */
  baseUrl?: string
  getAccessToken?: () => Promise<string | null>
  fetchImpl?: typeof fetch
}

const SERVICE = 'milksu.cloud.v1.CloudSessionService'

function fetchCall(options: {
  baseUrl: string
  getAccessToken: () => Promise<string | null>
  fetchImpl: typeof fetch
}): CloudAgentCall {
  return async (method, body) => {
    const token = await options.getAccessToken()
    if (!token) {
      throw new Error('Cloud Agent requires a signed-in MilkSU account')
    }
    const res = await options.fetchImpl(`${options.baseUrl}/${SERVICE}/${method}`, {
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
    return json
  }
}

export class CloudAgentClient {
  private readonly call: CloudAgentCall

  constructor(options: CloudAgentClientOptions) {
    if (typeof options.call === 'function') {
      this.call = options.call
      return
    }
    if (typeof options.getAccessToken !== 'function') {
      throw new Error('CloudAgentClient requires call or getAccessToken')
    }
    this.call = fetchCall({
      baseUrl: (options.baseUrl ?? defaultCloudAgentBaseUrl()).replace(/\/$/, ''),
      getAccessToken: options.getAccessToken,
      fetchImpl: options.fetchImpl ?? fetch.bind(globalThis),
    })
  }

  async listSessions(): Promise<CloudSession[]> {
    const body = await this.call('ListSessions', {}) as { sessions?: CloudSession[] }
    return body.sessions ?? []
  }

  async createSession(input: {
    kernel?: CloudKernel
    model?: string
    title?: string
    credentialId?: string
  }): Promise<CloudSession> {
    return this.call('CreateSession', {
      kernel: input.kernel ?? 'pi',
      model: input.model ?? '',
      title: input.title ?? '',
      credential_id: input.credentialId ?? '',
    }) as Promise<CloudSession>
  }

  async getSession(sessionId: string): Promise<CloudSession> {
    return this.call('GetSession', { session_id: sessionId }) as Promise<CloudSession>
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
    }) as Promise<{ target_session_id: string; ok: boolean; error: string }>
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
    }) as Promise<{ ok: boolean; error: string }>
  }

  async sendTurn(input: {
    sessionId: string
    text: string
    attachmentIds?: string[]
  }): Promise<{ turn_id: string }> {
    return this.call('SendTurn', {
      session_id: input.sessionId,
      text: input.text,
      attachment_ids: input.attachmentIds ?? [],
    }) as Promise<{ turn_id: string }>
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.call('DeleteSession', { session_id: sessionId })
  }

  /** Write-only: api_key never returned by the cloud API. */
  async upsertCredential(input: {
    id?: string
    label: string
    baseUrl: string
    apiKey: string
  }): Promise<{ id: string }> {
    return this.call('UpsertCredential', {
      id: input.id ?? '',
      label: input.label,
      base_url: input.baseUrl,
      api_key: input.apiKey,
    }) as Promise<{ id: string }>
  }
}

export function defaultCloudAgentBaseUrl(): string {
  return 'https://agent.milksu.org'
}

/** Product UI entry: Bearer never enters the renderer. */
export function desktopCloudAgentCall(): CloudAgentCall {
  return async (method, body) => {
    const { invokeCommand } = await import('@/desktop')
    return invokeCommand('cloud_agent_invoke', { method, body })
  }
}

export function desktopCloudAgentClient(): CloudAgentClient {
  return new CloudAgentClient({ call: desktopCloudAgentCall() })
}
