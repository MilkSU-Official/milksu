import { t } from '@/lib/uiLocale'

export type WorkspaceSection = 'ctf' | 'vuln' | 'lab' | 'chat'
export type CTFWorkspaceSection = 'catalog'
export type AppSection = WorkspaceSection | 'profile' | 'settings'

export const WORKSPACE_RAIL_ITEMS = [
  { id: 'ctf', label: 'CTF' },
  { id: 'vuln', label: 'CVE' },
  { id: 'lab', label: 'Lab' },
  { id: 'chat', label: 'Coding' },
] as const satisfies ReadonlyArray<{
  id: WorkspaceSection
  label: string
}>

export const CTF_CONTEXT_ITEMS = [
  { id: 'catalog' },
] as const satisfies ReadonlyArray<{
  id: CTFWorkspaceSection
}>

export function ctfContextItemLabel(id: CTFWorkspaceSection) {
  if (id === 'catalog') return t('题库', 'Catalog')
  return id
}

export function showsCodingHistory(section: WorkspaceSection) {
  return section === 'chat' || section === 'ctf' || section === 'vuln' || section === 'lab'
}

export function isDomainWorkspace(section: AppSection) {
  return section === 'ctf' || section === 'vuln' || section === 'lab'
}

export const WORKSPACE_SIDEBAR_ITEMS = [
  { id: 'chat', label: () => t('主页', 'Home') },
  { id: 'ctf', label: () => 'CTF' },
  { id: 'vuln', label: () => 'CVE' },
  { id: 'lab', label: () => 'Lab' },
] as const satisfies ReadonlyArray<{
  id: WorkspaceSection
  label: () => string
}>

export function workspaceContextLabel(section: WorkspaceSection) {
  return WORKSPACE_RAIL_ITEMS.find(item => item.id === section)?.label ?? 'MilkSU'
}

export function settingsReturnSection(
  currentSection: AppSection,
  fallback: Exclude<AppSection, 'settings'> = 'ctf',
): Exclude<AppSection, 'settings'> {
  return currentSection === 'settings' ? fallback : currentSection
}
