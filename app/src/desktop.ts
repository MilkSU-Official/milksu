import type { AppSettings } from './types'
import type { JobProjection, JobSummary } from './runtimeTypes'
import type { CTFChallengeRequest, CTFLearningRecordRequest, CTFProjection, CTFSummary } from './ctfTypes'

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
  StartWalkingSkeleton(title: string): Promise<JobProjection>
  ListJobs(): Promise<JobSummary[]>
  GetJob(id: string): Promise<JobProjection>
  CancelJob(id: string): Promise<void>
  StartSampleCTF(): Promise<CTFProjection>
  StartCTFChallenge(request: CTFChallengeRequest): Promise<CTFProjection>
  ListCTFJobs(): Promise<CTFSummary[]>
  GetCTFJob(id: string): Promise<CTFProjection>
  CancelCTFJob(id: string): Promise<void>
  RecordCTFLearning(id: string, request: CTFLearningRecordRequest): Promise<CTFProjection>
  ContinueCTFJob(id: string): Promise<CTFProjection>
  ReviewCTFSubmission(id: string, accepted: boolean, summary: string): Promise<CTFProjection>
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

function withoutCredentials(settings: AppSettings): AppSettings {
  const providers = Object.fromEntries(Object.entries(settings.providers).map(([name, provider]) => [
    name,
    {
      ...provider,
      api_key: '',
      has_api_key: provider.has_api_key || !!provider.api_key,
      remove_api_key: false,
    },
  ]))
  const relay = settings.relay
    ? {
        ...settings.relay,
        key: '',
        has_key: settings.relay.has_key || !!settings.relay.key,
        remove_key: false,
      }
    : undefined
  return { ...settings, providers, relay }
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
      case 'start_walking_skeleton':
        return app.StartWalkingSkeleton(args?.title as string) as Promise<T>
      case 'list_jobs':
        return app.ListJobs() as Promise<T>
      case 'get_job':
        return app.GetJob(args?.id as string) as Promise<T>
      case 'cancel_job':
        return app.CancelJob(args?.id as string) as Promise<T>
      case 'start_sample_ctf':
        return app.StartSampleCTF() as Promise<T>
      case 'start_ctf_challenge':
        return app.StartCTFChallenge(args?.request as CTFChallengeRequest) as Promise<T>
      case 'list_ctf_jobs':
        return app.ListCTFJobs() as Promise<T>
      case 'get_ctf_job':
        return app.GetCTFJob(args?.id as string) as Promise<T>
      case 'cancel_ctf_job':
        return app.CancelCTFJob(args?.id as string) as Promise<T>
      case 'record_ctf_learning':
        return app.RecordCTFLearning(args?.id as string, args?.request as CTFLearningRecordRequest) as Promise<T>
      case 'continue_ctf_job':
        return app.ContinueCTFJob(args?.id as string) as Promise<T>
      case 'review_ctf_submission':
        return app.ReviewCTFSubmission(args?.id as string, args?.accepted as boolean, args?.summary as string) as Promise<T>
      default:
        throw new Error(`Unsupported desktop command: ${command}`)
    }
  }

  switch (command) {
    case 'get_settings':
      return readJson(SETTINGS_KEY, DEFAULT_SETTINGS) as T
    case 'save_settings_cmd':
      writeJson(SETTINGS_KEY, withoutCredentials((args?.newSettings as AppSettings | undefined) ?? DEFAULT_SETTINGS))
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
    case 'list_jobs':
    case 'list_ctf_jobs':
      return [] as T
    case 'start_walking_skeleton':
    case 'get_job':
    case 'cancel_job':
    case 'start_sample_ctf':
    case 'start_ctf_challenge':
    case 'get_ctf_job':
    case 'cancel_ctf_job':
    case 'record_ctf_learning':
    case 'continue_ctf_job':
    case 'review_ctf_submission':
      throw new Error('Task Runtime requires the Wails desktop runtime.')
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
