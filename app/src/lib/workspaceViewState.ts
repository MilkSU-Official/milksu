export const WORKSPACE_VIEW_STATE_STORAGE_KEY = 'milksu.workspace-view-state'

export type PersistedWorkspaceSection = 'chat' | 'ctf' | 'vuln' | 'profile' | 'settings'
export type PersistedCTFSection = 'catalog'

export interface WorkspaceViewState {
  version: 1
  section: PersistedWorkspaceSection
  activeConversationId: string | null
  codingHistoryOpen: boolean
  ctfSection: PersistedCTFSection
  settingsReturnTarget: Exclude<PersistedWorkspaceSection, 'settings'>
}

const sections = new Set<PersistedWorkspaceSection>(['chat', 'ctf', 'vuln', 'profile', 'settings'])
const ctfSections = new Set<PersistedCTFSection>(['catalog'])
const returnSections = new Set<Exclude<PersistedWorkspaceSection, 'settings'>>(['chat', 'ctf', 'vuln', 'profile'])
// The settings category is not persisted: SettingsPage owns that state locally and
// never reports the user's in-page navigation back, so a stored value would only
// ever replay a programmatic entry point.

export function readWorkspaceViewState(
  storage: Storage | null = safeStorage(),
): WorkspaceViewState | null {
  if (!storage) return null
  try {
    const value = JSON.parse(storage.getItem(WORKSPACE_VIEW_STATE_STORAGE_KEY) ?? '') as Partial<WorkspaceViewState>
    if (value.version !== 1 || !sections.has(value.section as PersistedWorkspaceSection)) return null
    return {
      version: 1,
      section: value.section as PersistedWorkspaceSection,
      activeConversationId: typeof value.activeConversationId === 'string' && value.activeConversationId
        ? value.activeConversationId
        : null,
      codingHistoryOpen: value.codingHistoryOpen !== false,
      ctfSection: ctfSections.has(value.ctfSection as PersistedCTFSection)
        ? value.ctfSection as PersistedCTFSection
        : 'catalog',
      settingsReturnTarget: returnSections.has(value.settingsReturnTarget as Exclude<PersistedWorkspaceSection, 'settings'>)
        ? value.settingsReturnTarget as Exclude<PersistedWorkspaceSection, 'settings'>
        : 'ctf',
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
