import { useEffect, useId, useState } from 'react'
import { Wifi, WifiOff } from 'lucide-react'
import { CompanionPetBang, CompanionPetSpinner } from '@/components/CompanionPetGlyph'
import { hasDesktopRuntime, invokeCommand } from '@/desktop'
import { useT } from '@/hooks/useUiLocale'
import {
  clampCompanionBatteryPercent,
  formatCompanionPhoneClock,
  mergeCompanionPhoneStatus,
  resolveCompanionPhoneNetwork,
  type CompanionPhoneStatus,
} from '@/lib/companionPhoneStatus'
import {
  formatCompanionThinkElapsed,
  type CompanionIslandKind,
} from '@/lib/companionPetMotion'

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

const BATTERY_VB_W = 31.2
const BATTERY_VB_H = 13
const BATTERY_BODY = { x: 0.55, y: 0.7, w: 27.6, h: 11.6, rx: 3.5 }
const BATTERY_NUB = { x: 27.85, y: 4.15, w: 2.05, h: 4.15, rx: 0.95 }
const BATTERY_STROKE = 0.8
const BOLT_PATH = 'M7.2 0.2 L1.1 6.4 H4.6 L3.1 12.6 L11.4 5.2 H7.6 L9.2 0.2 Z'

function CompanionBatteryGlyph({
  percent,
  charging,
}: {
  percent: number | null
  charging: boolean
}) {
  const uid = `bat${useId().replace(/:/g, '')}`
  const level = percent == null ? null : Math.min(100, Math.max(0, Math.round(percent)))
  const digits = level == null ? '' : String(level)
  const showBolt = charging
  const full = level === 100
  const fillEnd = level == null || level <= 0
    ? 0
    : full
      ? BATTERY_VB_W
      : BATTERY_BODY.x + BATTERY_BODY.w * (level / 100)
  const fontSize = 7.35
  const textW = digits.length * fontSize * 0.58
  const boltW = 4.05
  const boltH = 7.05
  const gap = showBolt && digits ? 0.45 : 0
  const groupW = textW + (showBolt ? gap + boltW : 0)
  const groupX = BATTERY_BODY.x + (BATTERY_BODY.w - groupW) / 2
  const textY = BATTERY_BODY.y + BATTERY_BODY.h / 2 + 0.35
  const boltX = groupX + textW + gap
  const boltY = BATTERY_BODY.y + (BATTERY_BODY.h - boltH) / 2
  const boltScaleX = boltW / 10.3
  const boltScaleY = boltH / 12.4

  function marks(fill: string) {
    if (!digits && !showBolt) return null
    return (
      <g fill={fill}>
        {digits ? (
          <text
            x={groupX}
            y={textY}
            textAnchor="start"
            dominantBaseline="central"
            fontSize={fontSize}
            fontWeight="700"
            fontFamily="inherit"
            textLength={textW}
            lengthAdjust="spacingAndGlyphs"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {digits}
          </text>
        ) : null}
        {showBolt ? (
          <path
            d={BOLT_PATH}
            transform={`translate(${boltX - 1.1 * boltScaleX} ${boltY - 0.2 * boltScaleY}) scale(${boltScaleX} ${boltScaleY})`}
          />
        ) : null}
      </g>
    )
  }

  return (
    <svg
      className="companion-chat-battery-svg"
      viewBox={`0 0 ${BATTERY_VB_W} ${BATTERY_VB_H}`}
      aria-hidden="true"
    >
      <defs>
        <clipPath id={`${uid}-fill`}>
          <rect x="0" y="0" width={fillEnd} height={BATTERY_VB_H} />
        </clipPath>
        <clipPath id={`${uid}-rest`}>
          <rect x={fillEnd} y="0" width={Math.max(0, BATTERY_VB_W - fillEnd)} height={BATTERY_VB_H} />
        </clipPath>
      </defs>
      {full ? null : (
        <g
          clipPath={`url(#${uid}-rest)`}
          fill="none"
          stroke="currentColor"
          strokeWidth={BATTERY_STROKE}
          strokeLinejoin="round"
          opacity="0.42"
        >
          <rect
            x={BATTERY_BODY.x}
            y={BATTERY_BODY.y}
            width={BATTERY_BODY.w}
            height={BATTERY_BODY.h}
            rx={BATTERY_BODY.rx}
          />
          <rect
            x={BATTERY_NUB.x}
            y={BATTERY_NUB.y}
            width={BATTERY_NUB.w}
            height={BATTERY_NUB.h}
            rx={BATTERY_NUB.rx}
          />
        </g>
      )}
      {fillEnd > 0 ? (
        <g clipPath={`url(#${uid}-fill)`} strokeLinejoin="round">
          <rect
            x={BATTERY_BODY.x}
            y={BATTERY_BODY.y}
            width={BATTERY_BODY.w}
            height={BATTERY_BODY.h}
            rx={BATTERY_BODY.rx}
            fill="currentColor"
            stroke="currentColor"
            strokeWidth={BATTERY_STROKE}
          />
          {full ? (
            <rect
              x={BATTERY_NUB.x}
              y={BATTERY_NUB.y}
              width={BATTERY_NUB.w}
              height={BATTERY_NUB.h}
              rx={BATTERY_NUB.rx}
              fill="currentColor"
              stroke="currentColor"
              strokeWidth={BATTERY_STROKE}
            />
          ) : null}
          {marks('var(--companion-page)')}
        </g>
      ) : null}
      {full ? null : (
        <g clipPath={`url(#${uid}-rest)`}>
          {marks('currentColor')}
        </g>
      )}
    </svg>
  )
}

function useThinkNow(active: boolean) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!active) return undefined
    const timer = window.setInterval(() => setTick(count => count + 1), 200)
    return () => window.clearInterval(timer)
  }, [active])
  return Date.now()
}

function CompanionPhoneIsland({
  island,
  attention,
  thinkStartedAt,
}: {
  island: CompanionIslandKind
  attention: string
  thinkStartedAt: number | null
}) {
  const t = useT()
  const [expanded, setExpanded] = useState(false)
  const [tracked, setTracked] = useState(island)
  const ticking = island === 'think'
  const now = useThinkNow(ticking && thinkStartedAt != null)
  if (tracked !== island) {
    setTracked(island)
    if (island === 'none') setExpanded(false)
  }
  if (island === 'none') return null

  const elapsed = formatCompanionThinkElapsed(
    thinkStartedAt == null ? 0 : Math.max(0, now - thinkStartedAt),
  )
  const confirmLabel = t('确认', 'Confirm')
  const errorLabel = t('出错', 'Error')
  const doneLabel = t('完成', 'Done')
  const thinkingLabel = t('思考中', 'Thinking')
  const sentence = attention.trim() || confirmLabel
  const label = island === 'think'
    ? `${thinkingLabel} ${elapsed}`
    : island === 'confirm'
      ? sentence
      : island === 'error'
        ? errorLabel
        : doneLabel

  return (
    <button
      type="button"
      className={expanded ? 'companion-island is-open' : 'companion-island'}
      aria-expanded={expanded}
      aria-label={label}
      onPointerDown={event => event.stopPropagation()}
      onClick={() => setExpanded(open => !open)}
    >
      <span className="companion-island-compact" aria-hidden="true">
        {island === 'think' ? (
          <>
            <CompanionPetSpinner className="companion-island-spinner" />
            <span className="companion-island-readout">{elapsed}</span>
          </>
        ) : null}
        {island === 'confirm' ? (
          <>
            <CompanionPetBang tone="yellow" className="companion-island-bang" />
            <span>{confirmLabel}</span>
          </>
        ) : null}
        {island === 'error' ? (
          <>
            <CompanionPetBang tone="yellow" className="companion-island-bang" />
            <span>{errorLabel}</span>
          </>
        ) : null}
        {island === 'complete' ? (
          <>
            <CompanionPetBang tone="green" className="companion-island-bang" />
            <span>{doneLabel}</span>
          </>
        ) : null}
      </span>
      <span className="companion-island-detail" aria-hidden="true">
        {island === 'think' ? (
          <>
            <p className="companion-island-title">{thinkingLabel}</p>
            <p className="companion-island-duration">{elapsed}</p>
          </>
        ) : null}
        {island === 'confirm' ? (
          <>
            <CompanionPetBang tone="yellow" className="companion-island-bang" />
            <p className="companion-island-sentence">{sentence}</p>
          </>
        ) : null}
        {island === 'error' ? (
          <>
            <CompanionPetBang tone="yellow" className="companion-island-bang" />
            <p className="companion-island-title">{errorLabel}</p>
          </>
        ) : null}
        {island === 'complete' ? (
          <>
            <CompanionPetBang tone="green" className="companion-island-bang" />
            <p className="companion-island-title">{doneLabel}</p>
          </>
        ) : null}
      </span>
    </button>
  )
}

export default function CompanionPhoneStatusBar({
  island = 'none',
  attention = '',
  thinkStartedAt = null,
}: {
  island?: CompanionIslandKind
  attention?: string
  thinkStartedAt?: number | null
}) {
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
    <div className="companion-chat-statusbar">
      <div className="companion-chat-statusbar-facts" role="status" aria-label={t('状态栏', 'Status bar')}>
        <p className="companion-chat-statusbar-time">{status.time || formatCompanionPhoneClock()}</p>
        <div className="companion-chat-statusbar-end">
          {status.wifi ? (
            <Wifi className="companion-chat-statusbar-glyph" aria-label={t('无线网络', 'Wi-Fi')} />
          ) : (
            <WifiOff className="companion-chat-statusbar-glyph" aria-label={t('无网络', 'No network')} />
          )}
          <span className="companion-chat-battery" aria-label={batteryLabel(status, t)}>
            <CompanionBatteryGlyph
              percent={status.batteryPercent}
              charging={status.charging === true}
            />
          </span>
        </div>
      </div>
      <div className="companion-island-slot" data-live={island === 'none' ? undefined : 'true'}>
        <CompanionPhoneIsland
          island={island}
          attention={attention}
          thinkStartedAt={thinkStartedAt}
        />
      </div>
    </div>
  )
}
