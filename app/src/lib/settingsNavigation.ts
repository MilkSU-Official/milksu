import { t } from '@/lib/uiLocale'

export type SettingsCategory =
  | 'account'
  | 'appearance'
  | 'general'
  | 'permissions'
  | 'apikeys'
  | 'runtime'
  | 'browser'
  | 'chats'
  | 'memory'
  | 'ctf'
  | 'cve'
  | 'lab'
  | 'skills'
  | 'mcp'
  | 'plugins'
  | 'companion'
  | 'eval'
  | 'security-tools'
  | 'coding'

export type NormalizedSettingsCategory = Exclude<SettingsCategory, 'security-tools' | 'coding'>

export function normalizeSettingsCategory(value: SettingsCategory): NormalizedSettingsCategory {
  if (value === 'security-tools') return 'mcp'
  if (value === 'coding') return 'skills'
  return value
}

export interface SettingsSidebarItem {
  value: NormalizedSettingsCategory
  label: () => string
}

export interface SettingsSidebarGroup {
  id: string
  label: (() => string) | null
  items: readonly SettingsSidebarItem[]
}

export const SETTINGS_SIDEBAR_GROUPS: readonly SettingsSidebarGroup[] = [
  {
    id: 'app',
    label: null,
    items: [
      { value: 'account', label: () => t('账号', 'Account') },
      { value: 'appearance', label: () => t('外观', 'Appearance') },
      { value: 'general', label: () => t('通用', 'General') },
      { value: 'permissions', label: () => t('权限与操控', 'Permissions') },
      { value: 'apikeys', label: () => t('模型', 'Models') },
      { value: 'runtime', label: () => t('运行时', 'Runtime') },
      { value: 'browser', label: () => t('浏览器', 'Browser') },
      { value: 'chats', label: () => t('归档聊天', 'Archived chats') },
      { value: 'memory', label: () => t('记忆', 'Memory') },
    ],
  },
  {
    id: 'workspaces',
    label: () => t('工作区', 'Workspaces'),
    items: [
      { value: 'ctf', label: () => 'CTF' },
      { value: 'cve', label: () => 'CVE' },
      { value: 'lab', label: () => 'Lab' },
    ],
  },
  {
    id: 'agent',
    label: () => 'Agent',
    items: [
      { value: 'skills', label: () => 'Skills' },
      { value: 'mcp', label: () => 'MCP' },
      { value: 'plugins', label: () => t('插件', 'Plugins') },
    ],
  },
  {
    id: 'more',
    label: null,
    items: [
      { value: 'companion', label: () => t('看板娘', 'Companion') },
      { value: 'eval', label: () => t('评测', 'Eval') },
    ],
  },
]

export const SETTINGS_SIDEBAR_ITEMS: readonly SettingsSidebarItem[] =
  SETTINGS_SIDEBAR_GROUPS.flatMap(group => group.items)

export function settingsCategoryLabel(value: NormalizedSettingsCategory) {
  return SETTINGS_SIDEBAR_ITEMS.find(item => item.value === value)?.label() ?? value
}
