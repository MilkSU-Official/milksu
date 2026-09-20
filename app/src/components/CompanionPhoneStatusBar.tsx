import { useEffect, useState } from 'react'
import { Wifi, WifiOff, Zap } from 'lucide-react'
import { hasDesktopRuntime, invokeCommand } from '@/desktop'
import { useT } from '@/hooks/useUiLocale'
import {
  clampCompanionBatteryPercent,
  formatCompanionPhoneClock,
  mergeCompanionPhoneStatus,
  resolveCompanionPhoneNetwork,
  type CompanionPhoneStatus,
} from '@/lib/companionPhoneStatus'

const REFRESH_MS = 20_000

type BatteryReader = {
  level: number
  charging: boolean
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string, listener: () => void): void
}

type ConnectionReader = {
  type?: string
  addEventListener?(type: string, listener: () => void): void
  removeEventListener?(type: string, listener: () => void): void
}

function navigatorConnection(): ConnectionReader | undefined {
  const nav = navigator as Navigator & {
    connection?: ConnectionReader
    mozConnection?: ConnectionReader
    webkitConnection?: ConnectionReader
  }
  return nav.connection || nav.mozConnection || nav.webkitConnection
}

async function readRendererStatus(): Promise<Partial<CompanionPhoneStatus>> {
  const network = resolveCompanionPhoneNetwork({
    online: navigator.onLine,
    connectionType: navigatorConnection()?.type,
  })
  const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryReader> }
  if (typeof nav.getBattery !== 'function') {
    return network
  }
  try {
    const battery = await nav.getBattery()
    return {
      ...network,
      batteryPercent: clampCompanionBatteryPercent(battery.level * 100),
      charging: Boolean(battery.charging),
    }
  } catch {
    return network
  }
}

function batteryLabel(
  status: CompanionPhoneStatus,
  t: (zh: string, en: string) => string,
) {
  if (status.batteryPercent == null) {
    return status.charging ? t('充电中', 'Charging') : t('电量', 'Battery')
  }
  if (status.charging) {
    return t(`电量 ${status.batteryPercent}% · 充电中`, `Battery ${status.batteryPercent}%, charging`)
  }
  return t(`电量 ${status.batteryPercent}%`, `Battery ${status.batteryPercent}%`)
}

export default function CompanionPhoneStatusBar() {
  const t = useT()
  const [status, setStatus] = useState<CompanionPhoneStatus>(() => mergeCompanionPhoneStatus({
    online: typeof navigator === 'undefined' ? true : navigator.onLine,
    wifi: typeof navigator === 'undefined' ? true : navigator.onLine,
  }))

  useEffect(() => {
    let cancelled = false
    let battery: BatteryReader | null = null
    const connection = navigatorConnection()

    async function refresh() {
      const renderer = await readRendererStatus()
      const host = hasDesktopRuntime()
        ? await invokeCommand<CompanionPhoneStatus>('get_companion_phone_status').catch(() => null)
        : null
      if (cancelled) return
      setStatus(mergeCompanionPhoneStatus(renderer, host))
    }

    void refresh()
    const timer = window.setInterval(() => {
      void refresh()
    }, REFRESH_MS)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('online', refresh)
    window.addEventListener('offline', refresh)
    document.addEventListener('visibilitychange', onVisibility)
    connection?.addEventListener?.('change', refresh)
    const nav = navigator as Navigator & { getBattery?: () => Promise<BatteryReader> }
    if (typeof nav.getBattery === 'function') {
      void nav.getBattery().then(next => {
        if (cancelled) return
        battery = next
        next.addEventListener('levelchange', refresh)
        next.addEventListener('chargingchange', refresh)
      }).catch(() => undefined)
    }

    return () => {
      cancelled = true
      window.clearInterval(timer)
      window.removeEventListener('online', refresh)
      window.removeEventListener('offline', refresh)
      document.removeEventListener('visibilitychange', onVisibility)
      connection?.removeEventListener?.('change', refresh)
      battery?.removeEventListener('levelchange', refresh)
      battery?.removeEventListener('chargingchange', refresh)
    }
  }, [])

  return (
    <div className="companion-chat-statusbar" role="status" aria-label={t('状态栏', 'Status bar')}>
      <p className="companion-chat-statusbar-time">{status.time || formatCompanionPhoneClock()}</p>
      <div className="companion-chat-statusbar-end">
        {status.wifi ? (
          <Wifi className="companion-chat-statusbar-glyph" aria-label={t('无线网络', 'Wi-Fi')} />
        ) : (
          <WifiOff className="companion-chat-statusbar-glyph" aria-label={t('无网络', 'No network')} />
        )}
        <span className="companion-chat-battery" aria-label={batteryLabel(status, t)}>
          <span className="companion-chat-battery-body">
            <span
              className="companion-chat-battery-level"
              style={{ width: `${status.batteryPercent ?? 0}%` }}
            />
          </span>
          <span className="companion-chat-battery-nub" aria-hidden="true" />
          {status.charging ? <Zap className="companion-chat-battery-bolt" aria-hidden="true" /> : null}
        </span>
      </div>
    </div>
  )
}
