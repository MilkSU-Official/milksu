import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen, type Event } from '@tauri-apps/api/event'
import type { AppSettings, Engagement, EngagementHost, EngagementSummary } from './types'

type CommandArgs = Record<string, unknown>
type UnlistenFn = () => void

const SETTINGS_KEY = 'milksu.dev.settings'
const CONVERSATIONS_KEY = 'milksu.dev.conversations'
const ENGAGEMENTS_KEY = 'milksu.dev.engagements'
const ENGAGEMENT_TIMELINES_KEY = 'milksu.dev.engagements.timelines'

const DEFAULT_SETTINGS: AppSettings = {
  active_provider: 'deepseek',
  active_model: 'deepseek-v4-flash',
  providers: {},
}

function hasTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const value = window.localStorage.getItem(key)
    return value ? JSON.parse(value) as T : fallback
  } catch {
    return fallback
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value))
  } catch {
    // Browser preview persistence is best-effort only.
  }
}

function createBrowserId() {
  return crypto.randomUUID()
}

function nowIso() {
  return new Date().toISOString()
}

function summarizeEngagement(engagement: Engagement): EngagementSummary {
  const host_count = engagement.targets.reduce((count, target) => count + target.hosts.length, 0)
  const vuln_count = engagement.targets.reduce(
    (count, target) => count + target.hosts.reduce((hostCount, host) => hostCount + host.vulnerabilities.length, 0),
    0,
  )

  return {
    id: engagement.id,
    name: engagement.name,
    status: engagement.status,
    updated: engagement.updated,
    host_count,
    vuln_count,
    cred_count: engagement.credentials.length,
  }
}

function readEngagements() {
  return readJson<Engagement[]>(ENGAGEMENTS_KEY, [])
}

function writeEngagements(engagements: Engagement[]) {
  writeJson(ENGAGEMENTS_KEY, engagements)
}

function commandArg<T>(args: CommandArgs | undefined, camelName: string, snakeName?: string): T | undefined {
  const value = args?.[camelName] ?? (snakeName ? args?.[snakeName] : undefined)
  return value as T | undefined
}

export async function invokeCommand<T = unknown>(command: string, args?: CommandArgs): Promise<T> {
  if (hasTauriRuntime()) {
    return tauriInvoke<T>(command, args)
  }

  switch (command) {
    case 'get_settings':
      return readJson(SETTINGS_KEY, DEFAULT_SETTINGS) as T
    case 'save_settings_cmd':
      writeJson(SETTINGS_KEY, args?.newSettings ?? DEFAULT_SETTINGS)
      return undefined as T
    case 'list_conversations':
      return readJson(CONVERSATIONS_KEY, []) as T
    case 'save_conversation': {
      const conversation = args?.conversation as { id?: string } | undefined
      if (!conversation?.id) return undefined as T
      const conversations = readJson<Array<{ id: string }>>(CONVERSATIONS_KEY, [])
      const next = [
        conversation,
        ...conversations.filter(item => item.id !== conversation.id),
      ]
      writeJson(CONVERSATIONS_KEY, next)
      return undefined as T
    }
    case 'delete_conversation': {
      const id = args?.id
      if (typeof id !== 'string') return undefined as T
      const conversations = readJson<Array<{ id: string }>>(CONVERSATIONS_KEY, [])
      writeJson(CONVERSATIONS_KEY, conversations.filter(item => item.id !== id))
      return undefined as T
    }
    case 'create_engagement': {
      const name = args?.name
      const scope = args?.scope
      if (typeof name !== 'string' || !Array.isArray(scope)) {
        throw new Error('create_engagement requires name and scope.')
      }

      const timestamp = nowIso()
      const engagement: Engagement = {
        id: createBrowserId(),
        name,
        scope: scope.filter(item => typeof item === 'string'),
        status: 'active',
        created: timestamp,
        updated: timestamp,
        conversation_ids: [],
        targets: [],
        credentials: [],
        attack_paths: [],
        notes: [],
      }
      writeEngagements([engagement, ...readEngagements()])
      return engagement as T
    }
    case 'get_engagement': {
      const id = args?.id
      if (typeof id !== 'string') throw new Error('get_engagement requires id.')

      const engagement = readEngagements().find(item => item.id === id)
      if (!engagement) throw new Error(`Engagement not found: ${id}`)
      return engagement as T
    }
    case 'update_engagement': {
      const engagement = args?.engagement as Engagement | undefined
      if (!engagement?.id) throw new Error('update_engagement requires engagement.')

      const engagements = readEngagements()
      const next = [
        engagement,
        ...engagements.filter(item => item.id !== engagement.id),
      ]
      writeEngagements(next)
      return undefined as T
    }
    case 'list_engagements': {
      const summaries = readEngagements()
        .map(summarizeEngagement)
        .sort((a, b) => b.updated.localeCompare(a.updated))
      return summaries as T
    }
    case 'delete_engagement': {
      const id = args?.id
      if (typeof id !== 'string') return undefined as T

      writeEngagements(readEngagements().filter(item => item.id !== id))
      const timelines = readJson<Record<string, unknown[]>>(ENGAGEMENT_TIMELINES_KEY, {})
      delete timelines[id]
      writeJson(ENGAGEMENT_TIMELINES_KEY, timelines)
      return undefined as T
    }
    case 'append_timeline_entry': {
      const engagementId = commandArg<string>(args, 'engagementId', 'engagement_id')
      if (typeof engagementId !== 'string') throw new Error('append_timeline_entry requires engagementId.')

      const timelines = readJson<Record<string, unknown[]>>(ENGAGEMENT_TIMELINES_KEY, {})
      timelines[engagementId] = [...(timelines[engagementId] ?? []), args?.entry]
      writeJson(ENGAGEMENT_TIMELINES_KEY, timelines)
      return undefined as T
    }
    case 'merge_hosts': {
      const engagementId = commandArg<string>(args, 'engagementId', 'engagement_id')
      const hosts = args?.hosts
      if (typeof engagementId !== 'string' || !Array.isArray(hosts)) {
        throw new Error('merge_hosts requires engagementId and hosts.')
      }

      const engagements = readEngagements()
      const engagement = engagements.find(item => item.id === engagementId)
      if (!engagement) throw new Error(`Engagement not found: ${engagementId}`)

      for (const newHost of hosts as EngagementHost[]) {
        let existing: EngagementHost | undefined
        for (const target of engagement.targets) {
          existing = target.hosts.find(host => host.ip === newHost.ip)
          if (existing) break
        }

        if (existing) {
          for (const service of newHost.services) {
            const known = existing.services.some(item => item.port === service.port && item.protocol === service.protocol)
            if (!known) existing.services.push(service)
          }
          for (const vulnerability of newHost.vulnerabilities) {
            if (!existing.vulnerabilities.some(item => item.id === vulnerability.id)) {
              existing.vulnerabilities.push(vulnerability)
            }
          }
          if (newHost.os !== null) existing.os = newHost.os
        } else {
          if (engagement.targets.length === 0) {
            engagement.targets.push({
              id: createBrowserId(),
              type: 'subnet',
              value: 'discovered',
              authorized: true,
              hosts: [],
            })
          }
          engagement.targets[0]?.hosts.push(newHost)
        }
      }

      engagement.updated = nowIso()
      writeEngagements([
        engagement,
        ...engagements.filter(item => item.id !== engagement.id),
      ])
      return undefined as T
    }
    case 'send_message':
      throw new Error('Agent bridge requires the Tauri desktop runtime.')
    default:
      throw new Error(`Unsupported browser-preview command: ${command}`)
  }
}

export async function listenEvent<T>(
  event: string,
  handler: (event: Event<T>) => void,
): Promise<UnlistenFn> {
  if (hasTauriRuntime()) {
    return tauriListen<T>(event, handler)
  }

  return () => undefined
}

export async function createEngagement(name: string, scope: string[]): Promise<Engagement> {
  return invokeCommand<Engagement>('create_engagement', { name, scope })
}

export async function getEngagement(id: string): Promise<Engagement> {
  return invokeCommand<Engagement>('get_engagement', { id })
}

export async function updateEngagement(engagement: Engagement): Promise<void> {
  return invokeCommand<void>('update_engagement', { engagement })
}

export async function listEngagements(): Promise<EngagementSummary[]> {
  return invokeCommand<EngagementSummary[]>('list_engagements')
}

export async function deleteEngagement(id: string): Promise<void> {
  return invokeCommand<void>('delete_engagement', { id })
}
