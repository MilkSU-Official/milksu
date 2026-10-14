import { describe, expect, it } from 'vitest'
import {
  acpGuestConfigured,
  acpGuestUnavailableReason,
  formatAcpGuestArgs,
  normalizeAcpGuest,
  parseAcpGuestArgs,
  parseAcpGuestEnv,
  selectableAgentKernel,
} from './acpGuest'

const t = (zh: string, en: string) => `${zh}/${en}`

describe('acpGuest', () => {
  it('requires a command before the guest is selectable', () => {
    expect(normalizeAcpGuest({ command: '  ' })).toBeUndefined()
    expect(acpGuestConfigured(undefined)).toBe(false)
    expect(selectableAgentKernel('dsh')).toBe('pi')
    expect(selectableAgentKernel('acp', { command: '/usr/bin/guest' })).toBe('dsh')
  })

  it('parses space-separated and JSON args the same way as DSH ACP args', () => {
    expect(parseAcpGuestArgs('--profile acp')).toEqual(['--profile', 'acp'])
    expect(parseAcpGuestArgs('["--profile","acp"]')).toEqual(['--profile', 'acp'])
    expect(formatAcpGuestArgs(['--profile', 'acp'])).toBe('--profile acp')
  })

  it('drops provider-key env names before settings persist', () => {
    expect(parseAcpGuestEnv('PATH=/usr/bin\nTOKENFLUX_API_KEY=sk-test\nFOO=bar')).toEqual({
      PATH: '/usr/bin',
      FOO: 'bar',
    })
  })

  it('gives bilingual reasons for protocol gaps', () => {
    expect(acpGuestUnavailableReason('ask', t)).toContain('Ask')
    expect(acpGuestUnavailableReason('durable-research', t)).toContain('durable')
    expect(acpGuestUnavailableReason('milksu-workspace', t)).toContain('milksu_workspace')
  })
})
