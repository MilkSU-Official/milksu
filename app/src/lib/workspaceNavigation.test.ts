import { describe, expect, it } from 'vitest'
import {
  isDomainWorkspace,
  settingsReturnSection,
  showsCodingHistory,
  WORKSPACE_RAIL_ITEMS,
  WORKSPACE_SIDEBAR_ITEMS,
  workspaceContextLabel,
} from './workspaceNavigation'

describe('workspace navigation', () => {
  it('keeps the global rail in the product order', () => {
    expect(WORKSPACE_RAIL_ITEMS.map(item => item.label)).toEqual(['CVE', 'Lab', 'Coding'])
    expect(WORKSPACE_RAIL_ITEMS.map(item => item.id)).toEqual(['vuln', 'lab', 'chat'])
  })

  it('shows coding history inside Coding and domain workspaces', () => {
    expect(showsCodingHistory('chat')).toBe(true)
    expect(showsCodingHistory('vuln')).toBe(true)
    expect(showsCodingHistory('lab')).toBe(true)
    expect(showsCodingHistory('image')).toBe(true)
    expect(showsCodingHistory('reverse')).toBe(true)
    expect(isDomainWorkspace('chat')).toBe(false)
    expect(isDomainWorkspace('image')).toBe(false)
    expect(isDomainWorkspace('vuln')).toBe(true)
    expect(isDomainWorkspace('lab')).toBe(true)
    expect(WORKSPACE_SIDEBAR_ITEMS.map(item => item.id)).toEqual(['chat', 'image', 'reverse', 'vuln', 'lab'])
    expect(WORKSPACE_SIDEBAR_ITEMS.find(item => item.id === 'reverse')?.label()).toBe('逆向')
    expect(WORKSPACE_SIDEBAR_ITEMS[0].label()).toBe('新聊天')
    expect(WORKSPACE_SIDEBAR_ITEMS.find(item => item.id === 'image')?.label()).toBe('画图')
  })

  it('maps internal section ids to the shortest product labels', () => {
    expect(workspaceContextLabel('vuln')).toBe('CVE')
    expect(workspaceContextLabel('lab')).toBe('Lab')
    expect(workspaceContextLabel('chat')).toBe('Coding')
  })

  it('returns from settings to the module that opened it', () => {
    expect(settingsReturnSection('vuln')).toBe('vuln')
    expect(settingsReturnSection('lab')).toBe('lab')
    expect(settingsReturnSection('chat')).toBe('chat')
    expect(settingsReturnSection('reverse')).toBe('reverse')
    expect(settingsReturnSection('profile')).toBe('profile')
    expect(settingsReturnSection('companion')).toBe('companion')
    expect(settingsReturnSection('settings')).toBe('chat')
    expect(settingsReturnSection('settings', 'vuln')).toBe('vuln')
  })
})
