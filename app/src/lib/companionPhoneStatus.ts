export type CompanionPhoneStatus = {
  time: string
  batteryPercent: number | null
  charging: boolean | null
  online: boolean
  wifi: boolean
}

export function formatCompanionPhoneClock(now: Date = new Date()): string {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  }).format(now)
}

export function clampCompanionBatteryPercent(value: unknown): number | null {
  if (value == null || value === '') return null
  const percent = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(percent)) return null
  return Math.min(100, Math.max(0, Math.round(percent)))
}

export function resolveCompanionPhoneNetwork(input: {
  online?: boolean
  connectionType?: string
}): { online: boolean; wifi: boolean } {
  const type = String(input.connectionType ?? '').trim().toLowerCase()
  if (input.online === false || type === 'none') {
    return { online: false, wifi: false }
  }
  if (type === 'cellular' || type === 'bluetooth') {
    return { online: true, wifi: false }
  }
  return { online: true, wifi: true }
}

export function normalizeCompanionPhoneStatus(
  input?: Partial<CompanionPhoneStatus> | null,
): CompanionPhoneStatus {
  const online = input?.online !== false
  return {
    time: typeof input?.time === 'string' && input.time.trim()
      ? input.time
      : formatCompanionPhoneClock(),
    batteryPercent: clampCompanionBatteryPercent(input?.batteryPercent),
    charging: typeof input?.charging === 'boolean' ? input.charging : null,
    online,
    wifi: online && input?.wifi !== false,
  }
}

export function mergeCompanionPhoneStatus(
  renderer?: Partial<CompanionPhoneStatus> | null,
  host?: Partial<CompanionPhoneStatus> | null,
): CompanionPhoneStatus {
  return normalizeCompanionPhoneStatus({
    time: formatCompanionPhoneClock(),
    batteryPercent: renderer?.batteryPercent ?? host?.batteryPercent ?? null,
    charging: renderer?.charging ?? host?.charging ?? null,
    online: renderer?.online ?? host?.online,
    wifi: renderer?.wifi ?? host?.wifi,
  })
}
