import { t } from '@/lib/uiLocale'

export type WorkspaceSection = 'vuln' | 'lab' | 'chat' | 'image' | 'companion' | 'reverse'
export type AppSection = WorkspaceSection | 'profile' | 'settings'

export const WORKSPACE_RAIL_ITEMS = [
  { id: 'vuln', label: 'CVE' },
  { id: 'lab', label: 'Lab' },
  { id: 'chat', label: 'Coding' },
] as const satisfies ReadonlyArray<{
  id: WorkspaceSection
  label: string
}>

export function showsCodingHistory(section: WorkspaceSection) {
  return section === 'chat' || section === 'image' || section === 'vuln' || section === 'lab' || section === 'reverse'
}

export function isDomainWorkspace(section: AppSection) {
  return section === 'vuln' || section === 'lab'
}

export const WORKSPACE_SIDEBAR_ITEMS = [
  { id: 'chat', label: () => t('新聊天', 'New chat') },
  { id: 'image', label: () => t('画图', 'Draw') },
  { id: 'reverse', label: () => t('逆向', 'Reverse') },
  { id: 'vuln', label: () => 'CVE' },
  { id: 'lab', label: () => 'Lab' },
] as const satisfies ReadonlyArray<{
  id: Exclude<WorkspaceSection, 'companion'>
  label: () => string
}>

export function workspaceContextLabel(section: WorkspaceSection) {
  return WORKSPACE_RAIL_ITEMS.find(item => item.id === section)?.label ?? 'MilkSU'
}

export function settingsReturnSection(
  currentSection: AppSection,
  fallback: Exclude<AppSection, 'settings'> = 'chat',
): Exclude<AppSection, 'settings'> {
  return currentSection === 'settings' ? fallback : currentSection
}
