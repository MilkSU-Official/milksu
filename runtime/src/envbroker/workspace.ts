import type { ConversationStore } from '../conversations.ts'
import type { LabJobStore } from '../lab.ts'
import { packageForCVE } from './catalog.ts'
import type { EnvBrokerService } from './service.ts'
import type { Lease, Owner } from './types.ts'

export const ENV_WORKSPACE_ACTIONS = new Set([
  'env_status',
  'env_start',
  'env_reset',
  'env_stop',
])

export function isEnvWorkspaceAction(action: string): boolean {
  return ENV_WORKSPACE_ACTIONS.has(String(action ?? '').trim())
}

export type EnvWorkspaceHost = {
  service: EnvBrokerService
  conversations: ConversationStore
  labJobs?: LabJobStore | null
}

async function decorateLease(host: EnvWorkspaceHost, lease: Lease): Promise<Lease> {
  const occupy = String(lease.occupyOwner ?? '').trim()
  if (!occupy) return lease
  const cut = occupy.indexOf(':')
  if (cut <= 0) return lease
  const kind = occupy.slice(0, cut)
  const id = occupy.slice(cut + 1)
  let occupyTitle = String(lease.occupyTitle ?? '').trim()
  if (kind === 'lab' && host.labJobs) {
    try {
      const job = await host.labJobs.get(id)
      if (job.title.trim()) occupyTitle = job.title.trim()
    } catch {
      // keep existing title
    }
  } else if (kind === 'cve') {
    occupyTitle = id
  }
  if (!occupyTitle) occupyTitle = occupy
  return { ...lease, occupyTitle }
}

async function ownerFromConversation(
  conversations: ConversationStore,
  conversationId: string,
): Promise<Owner> {
  const stored = await conversations.get(conversationId)
  const domain = stored.domainTaskContext
  if (!domain) throw new Error('当前会话没有环境作业')
  const kind = String(domain.kind ?? '').trim()
  if (kind === 'lab') {
    const id = String(domain.jobId ?? '').trim()
    if (!id) throw new Error('当前会话没有实验室作业')
    return { kind: 'lab', id }
  }
  if (kind === 'cve') {
    const id = String(domain.cveId ?? '').trim().toUpperCase()
    if (!id) throw new Error('当前会话没有 CVE 档案')
    return { kind: 'cve', id }
  }
  throw new Error('当前会话没有环境作业')
}

async function boundPackageId(host: EnvWorkspaceHost, owner: Owner): Promise<string> {
  const lease = await host.service.get(owner)
  const fromLease = String(lease.packageId ?? '').trim()
  if (fromLease) return fromLease
  if (owner.kind === 'lab' && host.labJobs) {
    try {
      const job = await host.labJobs.get(owner.id)
      const packageId = String(job.packageId ?? '').trim()
      if (packageId) return packageId
    } catch {
      // job may have been deleted
    }
  }
  if (owner.kind === 'cve') {
    const item = packageForCVE(owner.id)
    if (item) return item.id
  }
  return ''
}

function encodeWorkspaceResult(value: unknown): string {
  return JSON.stringify(value)
}

export async function handleEnvWorkspaceAction(
  host: EnvWorkspaceHost,
  conversationId: string,
  action: string,
): Promise<string> {
  const owner = await ownerFromConversation(host.conversations, conversationId)
  const name = String(action ?? '').trim()
  switch (name) {
    case 'env_status':
      return encodeWorkspaceResult(await decorateLease(host, await host.service.status(owner)))
    case 'env_start': {
      const packageId = await boundPackageId(host, owner)
      if (!packageId) throw new Error('没有绑定练习包。请用户在环境条启动')
      return encodeWorkspaceResult(
        await decorateLease(host, await host.service.start(owner, packageId)),
      )
    }
    case 'env_reset':
      return encodeWorkspaceResult(await decorateLease(host, await host.service.reset(owner)))
    case 'env_stop':
      return encodeWorkspaceResult(await decorateLease(host, await host.service.stop(owner)))
    default:
      throw new Error('unknown environment action')
  }
}
