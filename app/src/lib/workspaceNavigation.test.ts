import { describe, expect, it } from 'vitest'
import {
  CTF_CONTEXT_ITEMS,
  settingsReturnSection,
  showsCodingHistory,
  WORKSPACE_RAIL_ITEMS,
  workspaceContextLabel,
} from './workspaceNavigation'

describe('workspace navigation', () => {
  it('keeps the global rail in the product order', () => {
    expect(WORKSPACE_RAIL_ITEMS.map(item => item.label)).toEqual(['CTF', 'CVE', 'Coding'])
    expect(WORKSPACE_RAIL_ITEMS.map(item => item.id)).toEqual(['ctf', 'vuln', 'chat'])
  })

  it('shows coding history only inside the Coding context', () => {
    expect(showsCodingHistory('chat')).toBe(true)
    expect(showsCodingHistory('ctf')).toBe(false)
    expect(showsCodingHistory('vuln')).toBe(false)
  })

  it('keeps paused lab work out of the current CTF navigation', () => {
    expect(CTF_CONTEXT_ITEMS.map(item => item.label)).toEqual(['题库'])
  })

  it('maps internal section ids to the shortest product labels', () => {
    expect(workspaceContextLabel('ctf')).toBe('CTF')
    expect(workspaceContextLabel('vuln')).toBe('CVE')
    expect(workspaceContextLabel('chat')).toBe('Coding')
  })

  it('returns from settings to the module that opened it', () => {
    expect(settingsReturnSection('ctf')).toBe('ctf')
    expect(settingsReturnSection('vuln')).toBe('vuln')
    expect(settingsReturnSection('chat')).toBe('chat')
    expect(settingsReturnSection('settings', 'vuln')).toBe('vuln')
  })
})
