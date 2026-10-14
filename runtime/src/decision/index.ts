import type { AppSettings } from '../config/settings-store.ts'

const JEV_ENDPOINT = 'https://openrouter.ai/api/alpha/decisions'
const JEV_MODEL = 'typesafe/jev-1.13'

export const DECISION_UNAVAILABLE = 'decision layer unavailable'

export async function judgeApprovalRisk(command: string, key: string): Promise<number> {
  command = String(command ?? '').trim()
  if (!command) throw new Error('command is required')
  const credential = String(key ?? '').trim()
  if (!credential) throw new Error(DECISION_UNAVAILABLE)
  const payload = {
    model: JEV_MODEL,
    state: { command },
    questions: {
      gate: {
        type: 'noul',
        instructions: '用户即将在自己的工作区执行这条 shell 命令。判断它是否可能破坏或泄露用户数据：不可逆删除/覆盖、向外部发送凭据或文件、修改系统关键配置。只读探查（ls、find、cat、grep、git status 等）一律不算高危。',
      },
    },
  }
  const response = await fetch(JEV_ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${credential}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(6000),
  })
  if (!response.ok) throw new Error(DECISION_UNAVAILABLE)
  const decoded = await response.json() as { answers?: { gate?: { type?: string; noul?: number } } }
  const answer = decoded.answers?.gate
  if (!answer || answer.type !== 'noul' || typeof answer.noul !== 'number') {
    throw new Error(DECISION_UNAVAILABLE)
  }
  return answer.noul
}

export function jevKeyFromSettings(settings: AppSettings): string {
  return String(settings.jev?.api_key ?? '').trim()
}

export type ModelProbeResult = {
  provider: string
  model: string
  ready: boolean
  latencyMs: number
}

export async function probeAgentModel(settings: AppSettings): Promise<ModelProbeResult> {
  const provider = String(settings.active_provider ?? '').trim()
  const model = String(settings.active_model ?? '').trim()
  if (!provider || !model) throw new Error('active provider and model are required')
  const { url, key } = resolveProbeEndpoint(settings)
  if (!url) throw new Error('model endpoint is not configured')
  if (!key) throw new Error('model credential is not configured')
  const started = Date.now()
  const endpoint = `${url.replace(/\/$/u, '')}/chat/completions`
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: 'Reply with exactly OK.' }],
      max_tokens: 8,
      stream: false,
    }),
    signal: AbortSignal.timeout(45_000),
  })
  await response.arrayBuffer()
  if (!response.ok) throw new Error(`model verification failed: HTTP ${response.status}`)
  return { provider, model, ready: true, latencyMs: Date.now() - started }
}

function resolveProbeEndpoint(settings: AppSettings): { url: string; key: string } {
  if (settings.relay?.enabled && String(settings.relay.key ?? '').trim()) {
    return {
      url: String(settings.relay.url ?? '').trim() || 'https://tokenflux.dev/v1',
      key: String(settings.relay.key ?? '').trim(),
    }
  }
  const providerId = String(settings.active_provider ?? '').trim()
  const configured = settings.providers?.[providerId]
  const key = String(configured?.api_key ?? '').trim()
  let url = String(configured?.base_url ?? '').trim()
  if (!url && providerId === 'tokenflux') url = 'https://tokenflux.dev/v1'
  if (!url && providerId === 'custom-relay-deepseek') url = 'https://api.deepseek.com'
  return { url, key }
}
