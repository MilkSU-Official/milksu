import { describe, expect, it } from 'vitest'
import {
  CTF_CONTEXT_ITEMS,
  ctfContextItemLabel,
  isDomainWorkspace,
  settingsReturnSection,
  showsCodingHistory,
  WORKSPACE_RAIL_ITEMS,
  WORKSPACE_SIDEBAR_ITEMS,
  workspaceContextLabel,
} from './workspaceNavigation'

describe('workspace navigation', () => {
  it('keeps the global rail in the product order', () => {
    expect(WORKSPACE_RAIL_ITEMS.map(item => item.label)).toEqual(['CTF', 'CVE', 'Lab', 'Coding'])
    expect(WORKSPACE_RAIL_ITEMS.map(item => item.id)).toEqual(['ctf', 'vuln', 'lab', 'chat'])
  })

  it('shows coding history only inside the Coding context', () => {
    expect(showsCodingHistory('chat')).toBe(true)
    expect(showsCodingHistory('ctf')).toBe(true)
    expect(showsCodingHistory('vuln')).toBe(true)
    expect(showsCodingHistory('lab')).toBe(true)
    expect(isDomainWorkspace('chat')).toBe(false)
    expect(isDomainWorkspace('ctf')).toBe(true)
    expect(WORKSPACE_SIDEBAR_ITEMS.map(item => item.id)).toEqual(['chat', 'ctf', 'vuln', 'lab'])
    expect(WORKSPACE_SIDEBAR_ITEMS[0].label()).toBe('主页')
  })

  it('keeps the laboratory as a peer rail, not a CTF catalog row', () => {
    expect(CTF_CONTEXT_ITEMS.map(item => item.id)).toEqual(['catalog'])
    expect(ctfContextItemLabel('catalog')).toBe('题库')
    expect(workspaceContextLabel('lab')).toBe('Lab')
  })

  it('maps internal section ids to the shortest product labels', () => {
    expect(workspaceContextLabel('ctf')).toBe('CTF')
    expect(workspaceContextLabel('vuln')).toBe('CVE')
    expect(workspaceContextLabel('lab')).toBe('Lab')
    expect(workspaceContextLabel('chat')).toBe('Coding')
  })

  it('returns from settings to the module that opened it', () => {
    expect(settingsReturnSection('ctf')).toBe('ctf')
    expect(settingsReturnSection('vuln')).toBe('vuln')
    expect(settingsReturnSection('lab')).toBe('lab')
    expect(settingsReturnSection('chat')).toBe('chat')
    expect(settingsReturnSection('profile')).toBe('profile')
    expect(settingsReturnSection('settings', 'vuln')).toBe('vuln')
  })
})
