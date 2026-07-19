import type { AppSettings } from './types'

type CommandArgs = Record<string, unknown>
type UnlistenFn = () => void
type EventEnvelope<T> = { payload: T }

interface WailsAppBindings {
  GetSettings(): Promise<AppSettings>
  SaveSettingsCmd(settings: AppSettings): Promise<void>
  ListConversations(): Promise<unknown>
  SaveConversation(conversation: unknown): Promise<void>
  DeleteConversation(id: string): Promise<void>
  SendMessage(conversationId: string, prompt: string): Promise<void>
  GetRuntimeStatus(): Promise<unknown>
}

declare global {
  interface Window {
    go?: { main?: { App?: WailsAppBindings } }
    runtime?: {
      EventsOn(event: string, callback: (...data: unknown[]) => void): UnlistenFn
    }
  }
}

const SETTINGS_KEY = 'milksu.dev.settings'
const CONVERSATIONS_KEY = 'milksu.dev.conversations'

const DEFAULT_SETTINGS: AppSettings = {
  active_provider: 'deepseek',
  active_model: 'deepseek-v4-flash',
  providers: {},
}

function getWailsApp() {
  return window.go?.main?.App
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
  const app = getWailsApp()
  if (app) {
    switch (command) {
      case 'get_settings':
        return app.GetSettings() as Promise<T>
      case 'save_settings_cmd':
        return app.SaveSettingsCmd(args?.newSettings as AppSettings) as Promise<T>
      case 'list_conversations':
        return app.ListConversations() as Promise<T>
      case 'save_conversation':
        return app.SaveConversation(args?.conversation) as Promise<T>
      case 'delete_conversation':
        return app.DeleteConversation(args?.id as string) as Promise<T>
      case 'send_message':
        return app.SendMessage(args?.conversationId as string, args?.prompt as string) as Promise<T>
      case 'get_runtime_status':
        return app.GetRuntimeStatus() as Promise<T>
      default:
        throw new Error(`Unsupported desktop command: ${command}`)
    }
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
      writeJson(CONVERSATIONS_KEY, [
        conversation,
        ...conversations.filter(item => item.id !== conversation.id),
      ])
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
      throw new Error('Agent bridge requires the Wails desktop runtime.')
    default:
      throw new Error(`Unsupported browser-preview command: ${command}`)
  }
}

export async function listenEvent<T>(
  event: string,
  handler: (event: EventEnvelope<T>) => void,
): Promise<UnlistenFn> {
  if (!window.runtime) return () => undefined
  return window.runtime.EventsOn(event, (...data) => {
    handler({ payload: data[0] as T })
  })
}
