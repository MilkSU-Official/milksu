export const WORKSPACE_VIEW_STATE_STORAGE_KEY = 'milksu.workspace-view-state'

export type PersistedWorkspaceSection = 'chat' | 'image' | 'vuln' | 'lab' | 'reverse' | 'companion' | 'profile' | 'settings'

export interface WorkspaceViewState {
  version: 1
  section: PersistedWorkspaceSection
  activeConversationId: string | null
  codingHistoryOpen: boolean
  settingsReturnTarget: Exclude<PersistedWorkspaceSection, 'settings'>
}

const sections = new Set<PersistedWorkspaceSection>(['chat', 'image', 'vuln', 'lab', 'reverse', 'companion', 'profile', 'settings'])
const returnSections = new Set<Exclude<PersistedWorkspaceSection, 'settings'>>(['chat', 'image', 'vuln', 'lab', 'reverse', 'companion', 'profile'])
// The settings category is not persisted: SettingsPage owns that state locally and
// never reports the user's in-page navigation back, so a stored value would only
// ever replay a programmatic entry point.

function normalizePersistedSection(value: unknown): PersistedWorkspaceSection | null {
  if (value === 'ctf' || value === 'companion') return 'chat'
  if (typeof value === 'string' && sections.has(value as PersistedWorkspaceSection)) {
    return value as PersistedWorkspaceSection
  }
  return null
}

function normalizeReturnTarget(value: unknown): Exclude<PersistedWorkspaceSection, 'settings'> {
  if (value === 'ctf' || value === 'companion' || value === 'settings') return 'chat'
  if (typeof value === 'string' && returnSections.has(value as Exclude<PersistedWorkspaceSection, 'settings'>)) {
    return value as Exclude<PersistedWorkspaceSection, 'settings'>
  }
  return 'chat'
}

export function readWorkspaceViewState(
  storage: Storage | null = safeStorage(),
): WorkspaceViewState | null {
  if (!storage) return null
  try {
    const value = JSON.parse(storage.getItem(WORKSPACE_VIEW_STATE_STORAGE_KEY) ?? '') as Partial<WorkspaceViewState> & {
      ctfSection?: unknown
    }
    if (value.version !== 1) return null
    const section = normalizePersistedSection(value.section)
    if (!section) return null
    return {
      version: 1,
      section,
      activeConversationId: typeof value.activeConversationId === 'string' && value.activeConversationId
        ? value.activeConversationId
        : null,
      codingHistoryOpen: value.codingHistoryOpen !== false,
      settingsReturnTarget: normalizeReturnTarget(value.settingsReturnTarget),
    }
  } catch {
    return null
  }
}

export function writeWorkspaceViewState(
  value: WorkspaceViewState,
  storage: Storage | null = safeStorage(),
) {
  if (!storage) return
  try {
    storage.setItem(WORKSPACE_VIEW_STATE_STORAGE_KEY, JSON.stringify(value))
  } catch {
    // The desktop renderer can run with storage disabled in tests or restricted profiles.
  }
}

function safeStorage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}
