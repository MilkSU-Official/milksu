import {
  MODEL_SOURCE_ACCOUNT,
  MODEL_SOURCE_PERSONAL,
  type AppSettings,
  type ProviderConfig,
} from '../config/settings-store.ts'
import { CREDENTIAL_MISSING_ERROR, DEFAULT_MODEL, DEFAULT_PROVIDER } from './types.ts'
import { trimString } from './util.ts'

export type CompanionModelSelection = {
  provider: string
  model: string
  source: string
}

export class CompanionCredentialError extends Error {
  constructor(message = CREDENTIAL_MISSING_ERROR) {
    super(message)
    this.name = 'CompanionCredentialError'
  }
}

function accountRelayReady(settings: AppSettings): boolean {
  const relay = settings.relay
  return Boolean(relay?.enabled && trimString(relay.key))
}

function resolveCompanionModel(settings: AppSettings): CompanionModelSelection {
  return {
    provider: trimString(settings.companion_provider) || DEFAULT_PROVIDER,
    model: trimString(settings.companion_model) || DEFAULT_MODEL,
    source: trimString(settings.companion_source) || MODEL_SOURCE_ACCOUNT,
  }
}

function companionFactoryAccountWithoutKey(
  settings: AppSettings,
  selection: CompanionModelSelection,
): boolean {
  if (selection.source !== MODEL_SOURCE_ACCOUNT || accountRelayReady(settings)) return false
  return selection.provider === DEFAULT_PROVIDER && selection.model === DEFAULT_MODEL
}

function customProviderPayloadFor(
  settings: AppSettings,
  name: string,
): Record<string, unknown> | null {
  const id = trimString(name)
  if (!id) return null
  const provider = settings.providers?.[id]
  if (!provider?.custom || !provider.enabled) return null
  const baseUrl = trimString(provider.base_url)
  const key = trimString(provider.api_key)
  if (!baseUrl || !key) return null
  return {
    id,
    name: trimString(provider.name),
    key,
    baseUrl,
    api: trimString(provider.api),
  }
}

function providerReady(provider: ProviderConfig | undefined): boolean {
  if (!provider?.enabled) return false
  if (provider.custom) return true
  return Boolean(trimString(provider.api_key))
}

function companionMainWindowRoute(settings: AppSettings): CompanionModelSelection | null {
  const providerName = trimString(settings.active_provider)
  const model = trimString(settings.active_model)
  if (!providerName || !model) return null
  const provider = settings.providers?.[providerName]
  if (!providerReady(provider) || !provider) return null
  let source = MODEL_SOURCE_PERSONAL
  if (provider.custom) {
    source = 'service'
    if (!customProviderPayloadFor(settings, providerName)) return null
  } else if (!trimString(provider.api_key)) {
    return null
  }
  return { provider: providerName, model, source }
}

export function resolveCompanionTurn(settings: AppSettings): CompanionModelSelection {
  const selection = resolveCompanionModel(settings)
  if (!companionFactoryAccountWithoutKey(settings, selection)) return selection
  return companionMainWindowRoute(settings) ?? selection
}

function companionAuthFor(
  settings: AppSettings,
  selection: CompanionModelSelection,
): Record<string, unknown> | null {
  switch (selection.source) {
    case MODEL_SOURCE_ACCOUNT:
      if (!accountRelayReady(settings)) throw new CompanionCredentialError()
      return null
    case MODEL_SOURCE_PERSONAL:
    case 'service': {
      const name = trimString(selection.provider)
      if (!name) throw new CompanionCredentialError()
      const provider = settings.providers?.[name]
      if (!provider?.enabled) throw new CompanionCredentialError()
      if (provider.custom) {
        const payload = customProviderPayloadFor(settings, name)
        if (!payload) throw new CompanionCredentialError()
        return payload
      }
      if (!trimString(provider.api_key)) throw new CompanionCredentialError()
      return null
    }
    default:
      throw new CompanionCredentialError()
  }
}

export function companionTurnAuth(settings: AppSettings): Record<string, unknown> | null {
  return companionAuthFor(settings, resolveCompanionTurn(settings))
}

export function companionDispatchEnabled(settings: AppSettings): boolean {
  return settings.companion_dispatch_enabled !== false
}

export function companionMemoryEnabled(settings: AppSettings): boolean {
  return settings.companion_memory_enabled !== false
}

export function companionMemoryExtract(settings: AppSettings): string {
  const raw = trimString(settings.companion_memory_extract)
  return raw === 'off' || raw === 'idle' ? raw : 'turn'
}

export function companionMemoryExtractIdleMinutes(settings: AppSettings): number {
  switch (settings.companion_memory_extract_idle_minutes) {
    case 5:
    case 10:
    case 15:
    case 30:
    case 60:
      return settings.companion_memory_extract_idle_minutes
    default:
      return 10
  }
}

export function companionReplyStyle(settings: AppSettings): string {
  return trimString(settings.companion_reply_style) === 'chat' ? 'chat' : 'markdown'
}

export function companionTaskEventsEnabled(settings: AppSettings): boolean {
  return settings.companion_proactivity?.task_events !== false
}
