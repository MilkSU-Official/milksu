import { describe, expect, it } from 'vitest'
import {
  clampCompanionBatteryPercent,
  formatCompanionPhoneClock,
  mergeCompanionPhoneStatus,
  normalizeCompanionPhoneStatus,
  resolveCompanionPhoneNetwork,
} from './companionPhoneStatus'

describe('companionPhoneStatus', () => {
  it('formats the status clock with the system hour cycle', () => {
    const morning = new Date(2026, 8, 21, 8, 5, 0)
    const expected = new Intl.DateTimeFormat(undefined, {
      hour: 'numeric',
      minute: '2-digit',
    }).format(morning)
    expect(formatCompanionPhoneClock(morning)).toBe(expected)
  })

  it('clamps battery percent and drops unknown values', () => {
    expect(clampCompanionBatteryPercent(64.4)).toBe(64)
    expect(clampCompanionBatteryPercent(140)).toBe(100)
    expect(clampCompanionBatteryPercent(-3)).toBe(0)
    expect(clampCompanionBatteryPercent('')).toBeNull()
    expect(clampCompanionBatteryPercent(undefined)).toBeNull()
  })

  it('treats wifi as the connected glyph and cellular or offline as the other', () => {
    expect(resolveCompanionPhoneNetwork({ online: true, connectionType: 'wifi' })).toEqual({
      online: true,
      wifi: true,
    })
    expect(resolveCompanionPhoneNetwork({ online: true })).toEqual({
      online: true,
      wifi: true,
    })
    expect(resolveCompanionPhoneNetwork({ online: true, connectionType: 'cellular' })).toEqual({
      online: true,
      wifi: false,
    })
    expect(resolveCompanionPhoneNetwork({ online: false })).toEqual({
      online: false,
      wifi: false,
    })
  })

  it('prefers renderer battery and network over the host snapshot', () => {
    const merged = mergeCompanionPhoneStatus(
      { batteryPercent: 41, charging: false, online: true, wifi: true },
      { batteryPercent: 99, charging: true, online: false, wifi: false, time: 'ignore' },
    )
    expect(merged.batteryPercent).toBe(41)
    expect(merged.charging).toBe(false)
    expect(merged.online).toBe(true)
    expect(merged.wifi).toBe(true)
    expect(merged.time).toBe(formatCompanionPhoneClock())
  })

  it('falls back to host charging when the renderer has no battery API', () => {
    const merged = mergeCompanionPhoneStatus(
      { online: true, wifi: true },
      { charging: true, online: true, wifi: true },
    )
    expect(merged.batteryPercent).toBeNull()
    expect(merged.charging).toBe(true)
    expect(normalizeCompanionPhoneStatus(null).wifi).toBe(true)
  })
})
