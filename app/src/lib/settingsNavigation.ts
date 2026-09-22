import { t } from '@/lib/uiLocale'

export type SettingsCategory =
  | 'general'
  | 'coding'
  | 'skills'
  | 'mcp'
  | 'apikeys'
  | 'browser'
  | 'cve'
  | 'lab'
  | 'chats'
  | 'security-tools'
  | 'ctf'
  | 'eval'
  | 'companion'
  | 'plugins'

export type NormalizedSettingsCategory = Exclude<SettingsCategory, 'security-tools' | 'coding'>

export function normalizeSettingsCategory(value: SettingsCategory): NormalizedSettingsCategory {
  if (value === 'security-tools') return 'mcp'
  if (value === 'coding') return 'skills'
  return value
}

export const SETTINGS_SIDEBAR_ITEMS = [
  { value: 'general' as const, label: () => t('通用', 'General') },
  { value: 'apikeys' as const, label: () => t('模型', 'Models') },
  { value: 'ctf' as const, label: () => 'CTF' },
  { value: 'cve' as const, label: () => 'CVE' },
  { value: 'lab' as const, label: () => 'Lab' },
  { value: 'skills' as const, label: () => 'Skills' },
  { value: 'mcp' as const, label: () => 'MCP' },
  { value: 'chats' as const, label: () => t('归档聊天', 'Archived chats') },
  { value: 'browser' as const, label: () => t('浏览器控制', 'Browser') },
  { value: 'eval' as const, label: () => t('评测', 'Eval') },
  { value: 'companion' as const, label: () => t('看板娘', 'Companion') },
  { value: 'plugins' as const, label: () => t('插件', 'Plugins') },
] as const satisfies ReadonlyArray<{
  value: NormalizedSettingsCategory
  label: () => string
}>

export function settingsCategoryLabel(value: NormalizedSettingsCategory) {
  return SETTINGS_SIDEBAR_ITEMS.find(item => item.value === value)?.label() ?? value
}
