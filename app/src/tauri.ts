import { invoke as tauriInvoke } from '@tauri-apps/api/core'
import { listen as tauriListen, type Event } from '@tauri-apps/api/event'
import type { AppSettings } from './types'

type CommandArgs = Record<string, unknown>
type UnlistenFn = () => void

const SETTINGS_KEY = 'milksu.dev.settings'
const CONVERSATIONS_KEY = 'milksu.dev.conversations'

const DEFAULT_SETTINGS: AppSettings = {
  active_provider: 'deepseek',
  active_model: 'deepseek-chat',
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
