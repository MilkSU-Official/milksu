import { useEffect, useId, useState } from 'react'
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

const BATTERY_VB_W = 40
const BATTERY_VB_H = 18
const BATTERY_BODY = { x: 0, y: 0, w: 36.6, h: 18, rx: 5 }
const BATTERY_NUB = { x: 35.2, y: 6.15, w: 2.9, h: 5.7, rx: 0.95 }
const BATTERY_INSET_X = 2.4
// CSS draws the capsule at 14px. Marks scale up by the viewBox/CSS ratio so
// the digits and bolt keep the size they had when the capsule was 16px tall.
const MARK_SCALE = BATTERY_VB_H / 14
const FONT_SIZE = 9.93 * MARK_SCALE
const FIGURE_CAP_RATIO = 0.71
const DIGIT_ADVANCE = 6.35 * MARK_SCALE
const BOLT_GAP = 0.9 * MARK_SCALE
const BOLT_PATH = 'M6.4 0 L0.6 6.2 H3.8 L2.2 12 L10.2 4.8 H6.6 L8.2 0 Z'
const BOLT_PATH_BOX = { x: 0.6, y: 0, w: 9.6, h: 12 }

function batteryNubPath(x: number, y: number, w: number, h: number, r: number) {
  const radius = Math.min(r, w, h / 2)
  return [
    `M ${x} ${y}`,
    `H ${x + w - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + w} ${y + radius}`,
    `V ${y + h - radius}`,
    `A ${radius} ${radius} 0 0 1 ${x + w - radius} ${y + h}`,
    `H ${x}`,
    'Z',
  ].join(' ')
}

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
  const midY = BATTERY_BODY.y + BATTERY_BODY.h / 2
  const capH = FONT_SIZE * FIGURE_CAP_RATIO
  const innerLeft = BATTERY_BODY.x + BATTERY_INSET_X
  const innerW = BATTERY_BODY.w - BATTERY_INSET_X * 2
  const boltH = showBolt ? capH : 0
  const boltW = showBolt ? capH * (BOLT_PATH_BOX.w / BOLT_PATH_BOX.h) : 0
  const gap = showBolt && digits ? BOLT_GAP : 0
  const textW = digits ? digits.length * DIGIT_ADVANCE : 0
  const groupW = textW + gap + boltW
  const groupX = innerLeft + Math.max(0, (innerW - groupW) / 2)
  const textY = midY + capH / 2
  const boltX = groupX + textW + gap
  const boltY = midY - capH / 2
  const boltScaleX = boltW / BOLT_PATH_BOX.w
  const boltScaleY = boltH / BOLT_PATH_BOX.h

  function shell(opacity: number) {
    return (
      <g fill="currentColor" opacity={opacity}>
        <rect
          x={BATTERY_BODY.x}
          y={BATTERY_BODY.y}
          width={BATTERY_BODY.w}
          height={BATTERY_BODY.h}
          rx={BATTERY_BODY.rx}
        />
        <path d={batteryNubPath(BATTERY_NUB.x, BATTERY_NUB.y, BATTERY_NUB.w, BATTERY_NUB.h, BATTERY_NUB.rx)} />
      </g>
    )
  }

  function marks(fill: string) {
    if (!digits && !showBolt) return null
    return (
      <g fill={fill}>
        {digits ? (
          <text
            className="companion-chat-battery-digits"
            x={groupX}
            y={textY}
            textAnchor="start"
            dominantBaseline="alphabetic"
            fontSize={FONT_SIZE}
            fontWeight="600"
            fontFamily="inherit"
            style={{ fontVariantNumeric: 'tabular-nums' }}
          >
            {digits}
          </text>
        ) : null}
        {showBolt ? (
          <path
            d={BOLT_PATH}
            transform={`translate(${boltX - BOLT_PATH_BOX.x * boltScaleX} ${boltY - BOLT_PATH_BOX.y * boltScaleY}) scale(${boltScaleX} ${boltScaleY})`}
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
        <clipPath id={`${uid}-body`}>
          <rect
            x={BATTERY_BODY.x}
            y={BATTERY_BODY.y}
            width={BATTERY_BODY.w}
            height={BATTERY_BODY.h}
            rx={BATTERY_BODY.rx}
          />
        </clipPath>
        <clipPath id={`${uid}-fill`}>
          <rect x="0" y="0" width={fillEnd} height={BATTERY_VB_H} />
        </clipPath>
        <clipPath id={`${uid}-rest`}>
          <rect x={fillEnd} y="0" width={Math.max(0, BATTERY_VB_W - fillEnd)} height={BATTERY_VB_H} />
        </clipPath>
      </defs>
      {full ? shell(1) : (
        <g clipPath={`url(#${uid}-rest)`}>
          {shell(0.38)}
        </g>
      )}
      {fillEnd > 0 && !full ? (
        <g clipPath={`url(#${uid}-fill)`}>
          {shell(1)}
        </g>
      ) : null}
      <g clipPath={`url(#${uid}-body)`}>
        {fillEnd > 0 ? (
          <g clipPath={`url(#${uid}-fill)`}>
            {marks('var(--companion-page)')}
          </g>
        ) : null}
        {full ? null : (
          <g clipPath={`url(#${uid}-rest)`}>
            {marks('currentColor')}
          </g>
        )}
      </g>
    </svg>
  )
}

function CompanionWifiGlyph({ off }: { off?: boolean }) {
  return (
    <svg className="companion-chat-wifi" viewBox="0 1.5 16 11" aria-hidden="true">
      <circle cx="8" cy="11.15" r="1.05" fill="currentColor" />
      <path
        d="M4.15 8.05a5.15 5.15 0 0 1 7.7 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      <path
        d="M1.55 5.15a8.85 8.85 0 0 1 12.9 0"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      {off ? (
        <path
          d="M2.4 2.35 L13.5 11.7"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
      ) : null}
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
            <span className="companion-chat-statusbar-glyph" role="img" aria-label={t('无线网络', 'Wi-Fi')}>
              <CompanionWifiGlyph />
            </span>
          ) : (
            <span className="companion-chat-statusbar-glyph" role="img" aria-label={t('无网络', 'No network')}>
              <CompanionWifiGlyph off />
            </span>
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
