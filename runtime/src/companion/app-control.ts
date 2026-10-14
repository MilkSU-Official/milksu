import {
  defaultSettings,
  type AppSettings,
} from '../config/settings-store.ts'
import { companionReplyStyle } from './auth.ts'
import type { AppControl, AppOutcome, ConversationExcerpt } from './types.ts'
import { asObject, boolValue, intValue, trimString } from './util.ts'

const MAX_EXCERPT_MESSAGES = 8
const MAX_EXCERPT_RUNES = 400

export function projectSettings(settings: AppSettings): Record<string, unknown> {
  const providers: Record<string, unknown> = {}
  for (const [name, provider] of Object.entries(settings.providers ?? {})) {
    providers[name] = {
      enabled: Boolean(provider.enabled),
      has_api_key: Boolean(provider.has_api_key || trimString(provider.api_key)),
      name: provider.name ?? '',
      custom: Boolean(provider.custom),
    }
  }
  const view: Record<string, unknown> = {
    active_provider: settings.active_provider ?? '',
    active_model: settings.active_model ?? '',
    default_kernel: settings.default_kernel ?? '',
    busy_send: settings.busy_send ?? '',
    locale: settings.locale ?? '',
    worker_provider: settings.worker_provider ?? '',
    worker_model: settings.worker_model ?? '',
    worker_source: settings.worker_source ?? '',
    companion_provider: settings.companion_provider ?? '',
    companion_model: settings.companion_model ?? '',
    companion_source: settings.companion_source ?? '',
    companion_dispatch_enabled: settings.companion_dispatch_enabled !== false,
    companion_memory_enabled: settings.companion_memory_enabled !== false,
    companion_float_enabled: settings.companion_float_enabled !== false,
    companion_skin_id: settings.companion_skin_id ?? '',
    companion_teaching: settings.companion_teaching ?? '',
    companion_reply_style: companionReplyStyle(settings),
    preferred_external_editor: settings.preferred_external_editor ?? '',
    conversation_font_size: settings.conversation_font_size ?? '',
    ui_emphasis: settings.ui_emphasis ?? '',
    providers,
  }
  if (settings.relay) {
    view.relay = {
      enabled: Boolean(settings.relay.enabled),
      url: settings.relay.url ?? '',
      has_key: Boolean(settings.relay.has_key || trimString(settings.relay.key)),
    }
  }
  return view
}

function credentialSetting(name: string): boolean {
  const folded = name.toLowerCase().trim()
  switch (folded) {
    case 'providers':
    case 'relay':
    case 'api_key':
    case 'key':
    case 'token':
    case 'password':
    case 'secret':
      return true
    default:
      return folded.includes('api_key') || folded.includes('token')
        || folded.includes('secret') || folded.includes('password')
  }
}

function requiredBool(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('expected boolean')
  return value
}

export function applySettingsPatch(
  current: AppSettings,
  patch: Record<string, unknown>,
): { next: AppSettings; keys: string[] } {
  const next: AppSettings = { ...current, providers: { ...(current.providers ?? {}) } }
  if (current.relay) next.relay = { ...current.relay }
  const keys: string[] = []
  for (const [key, value] of Object.entries(patch)) {
    const name = key.trim()
    if (credentialSetting(name)) throw new Error('companion cannot change credentials')
    switch (name) {
      case 'active_provider':
        next.active_provider = trimString(value)
        break
      case 'active_model':
        next.active_model = trimString(value)
        break
      case 'default_kernel':
        next.default_kernel = trimString(value)
        break
      case 'busy_send':
        next.busy_send = trimString(value)
        break
      case 'locale':
        next.locale = trimString(value)
        break
      case 'worker_provider':
        next.worker_provider = trimString(value)
        break
      case 'worker_model':
        next.worker_model = trimString(value)
        break
      case 'worker_source':
        next.worker_source = trimString(value)
        break
      case 'companion_provider':
        next.companion_provider = trimString(value)
        break
      case 'companion_model':
        next.companion_model = trimString(value)
        break
      case 'companion_source':
        next.companion_source = trimString(value)
        break
      case 'companion_dispatch_enabled':
        next.companion_dispatch_enabled = requiredBool(value)
        break
      case 'companion_memory_enabled':
        next.companion_memory_enabled = requiredBool(value)
        break
      case 'companion_float_enabled':
        next.companion_float_enabled = requiredBool(value)
        break
      case 'companion_skin_id':
        next.companion_skin_id = trimString(value)
        break
      case 'companion_teaching':
        next.companion_teaching = trimString(value)
        break
      case 'companion_reply_style':
        next.companion_reply_style = trimString(value) === 'chat' ? 'chat' : 'markdown'
        break
      case 'preferred_external_editor':
        next.preferred_external_editor = trimString(value)
        break
      case 'conversation_font_size':
        next.conversation_font_size = trimString(value)
        break
      case 'ui_emphasis':
        next.ui_emphasis = trimString(value)
        break
      default:
        throw new Error(`companion cannot change setting ${JSON.stringify(name)}`)
    }
    keys.push(name)
  }
  if (!keys.length) throw new Error('patch_settings requires patch')
  return { next, keys }
}

export function excerptFromMessages(
  id: string,
  title: string,
  roles: string[],
  contents: string[],
  limit: number,
): ConversationExcerpt {
  let keepLimit = limit
  if (keepLimit <= 0 || keepLimit > MAX_EXCERPT_MESSAGES) keepLimit = MAX_EXCERPT_MESSAGES
  const kept: Array<{ role: string; text: string }> = []
  let truncated = false
  for (let i = 0; i < roles.length; i += 1) {
    const role = roles[i]!.trim()
    if (role !== 'user' && role !== 'assistant') continue
    let text = contents[i] ?? ''
    const runes = [...text]
    if (runes.length > MAX_EXCERPT_RUNES) {
      text = runes.slice(0, MAX_EXCERPT_RUNES).join('')
      truncated = true
    }
    kept.push({ role, text })
  }
  let messages = kept
  if (messages.length > keepLimit) {
    messages = messages.slice(messages.length - keepLimit)
    truncated = true
  }
  return { id, title, messages, truncated }
}

export async function handleApp(
  control: AppControl | undefined,
  input: Record<string, unknown>,
  currentSettings?: () => AppSettings,
): Promise<AppOutcome> {
  if (!control) throw new Error('companion app control is not configured')
  const action = trimString(input.action)
  const confirmed = boolValue(input.confirmed)
  switch (action) {
    case 'open_main_window':
      try {
        await control.openMainWindow()
        return { ok: true, summary: 'main window opened' }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    case 'focus_conversation': {
      const id = trimString(input.conversationId)
      if (!id) return { ok: false, error: 'focus_conversation requires conversationId' }
      try {
        await control.focusConversation(id)
        return { ok: true, summary: id }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    case 'read_conversation': {
      const id = trimString(input.conversationId)
      if (!id) return { ok: false, error: 'read_conversation requires conversationId' }
      let limit = intValue(input.limit)
      if (limit <= 0 || limit > MAX_EXCERPT_MESSAGES) limit = MAX_EXCERPT_MESSAGES
      try {
        const excerpt = await control.readConversation(id, limit)
        return { ok: true, excerpt }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    case 'get_settings':
      try {
        const current = currentSettings?.() ?? defaultSettings()
        return { ok: true, settings: projectSettings(current) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    case 'patch_settings': {
      const patch = asObject(input.patch)
      if (!Object.keys(patch).length) return { ok: false, error: 'patch_settings requires patch' }
      try {
        const current = currentSettings?.() ?? defaultSettings()
        const { next, keys } = applySettingsPatch(current, patch)
        if (!confirmed) return { ok: false, needsConfirmation: true, summary: keys.join(', ') }
        await control.saveSettings(next)
        return { ok: true, summary: keys.join(', '), settings: projectSettings(next) }
      } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) }
      }
    }
    case 'quit':
      if (!confirmed) return { ok: false, needsConfirmation: true, summary: 'quit' }
      return { ok: true, summary: 'quit', then: 'quit' }
    case 'relaunch':
      if (!confirmed) return { ok: false, needsConfirmation: true, summary: 'relaunch' }
      return { ok: true, summary: 'relaunch', then: 'relaunch' }
    default:
      throw new Error(`unknown companion_app action ${JSON.stringify(action)}`)
  }
}

export async function runAfter(control: AppControl | undefined, outcome: AppOutcome): Promise<void> {
  if (!control || !outcome.then) return
  if (outcome.then === 'quit') await control.quit()
  if (outcome.then === 'relaunch') await control.relaunch()
}
