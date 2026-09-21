import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import companionDecide from '@/assets/companion/decide.png'
import companionIdle from '@/assets/companion/idle.png'
import companionTalk from '@/assets/companion/talk.png'
import CompanionPage from '@/components/CompanionPage'
import { Toaster } from '@/components/ui'
import { useCompanion } from '@/composables/useCompanion'
import { hasDesktopRuntime, invokeCommand, listenEvent } from '@/desktop'
import { useT, useUiLocale } from '@/hooks/useUiLocale'
import { companionMissingApiKey, companionSidecarDown } from '@/lib/companionUserError'
import {
  COMPANION_PET_BUBBLE_LEAVE_MS,
  companionPetSprite,
  companionPrefersUiMotion,
  resolveCompanionPetMotion,
} from '@/lib/companionPetMotion'
import { applyThemeMode, readThemeMode } from '@/lib/themeMode'
import type { AppSettings, CompanionShellStatus, CompanionSkinResolved } from '@/types'

const factorySprites = {
  idle: companionIdle,
  talk: companionTalk,
  decide: companionDecide,
}

const factorySkin: CompanionSkinResolved = {
  id: 'default',
  source: 'factory',
  factory: true,
  name: { zh: 'Milk', en: 'Milk' },
  overlay: { think: 'spin', decide: 'bang', complete: 'bang' },
  mark: { cx: 0.5, cy: 0.24, size: 0.26 },
  frames: {},
}

function attentionText(input: {
  confirm: { action: string; text: string; targetTitle: string } | null
  error: string
  t: (zh: string, en: string) => string
}) {
  if (input.confirm) {
    if (input.confirm.action === 'stop') {
      return input.t('有一条命令在等你确认', 'A command is waiting for your confirmation')
    }
    if (input.confirm.action === 'quit') {
      return input.t('退出 MilkSU 需要你确认', 'Quitting MilkSU needs your confirmation')
    }
    if (input.confirm.action === 'relaunch') {
      return input.t('重启 MilkSU 需要你确认', 'Relaunching MilkSU needs your confirmation')
    }
    if (input.confirm.action === 'patch_settings') {
      return input.t('有一项设置更改在等你确认', 'A settings change is waiting for your confirmation')
    }
    if (input.confirm.action === 'speak_many') {
      return input.t('有一批转达在等你确认', 'A batch relay is waiting for your confirmation')
    }
    if (input.confirm.text.trim()) return input.confirm.text.trim()
    if (input.confirm.targetTitle.trim()) return input.confirm.targetTitle.trim()
    return input.t('这次操作需要你点头', 'This action needs your confirmation')
  }
  const error = input.error.trim()
  if (!error || companionMissingApiKey(error) || companionSidecarDown(error)) return ''
  return error
}

function spriteSrc(skin: CompanionSkinResolved, motion: ReturnType<typeof resolveCompanionPetMotion>) {
  const key = companionPetSprite(motion, {
    think: Boolean(skin.frames.think),
    complete: Boolean(skin.frames.complete),
  })
  return skin.frames[key]
    || factorySprites[key === 'think' ? 'idle' : key === 'complete' ? 'talk' : key]
}

export default function CompanionPetWindow() {
  const t = useT()
  const locale = useUiLocale()
  const companion = useCompanion()
  const [skin, setSkin] = useState<CompanionSkinResolved>(factorySkin)
  const [dragging, setDragging] = useState(false)
  const [spoken, setSpoken] = useState('')
  const [bubbleLeaving, setBubbleLeaving] = useState(false)
  const [overlay, setOverlay] = useState<{ chatOpen: boolean; chatSide: 'left' | 'right' }>({
    chatOpen: false,
    chatSide: 'left',
  })
  const previewPhone = !hasDesktopRuntime() && (() => {
    try {
      return new URLSearchParams(window.location.search).get('surface') === 'companion-chat'
    } catch {
      return false
    }
  })()
  const chatOpen = overlay.chatOpen || previewPhone
  const motion = resolveCompanionPetMotion({
    confirm: Boolean(companion.confirm),
    error: Boolean(companion.error.trim())
      && !companionMissingApiKey(companion.error)
      && !companionSidecarDown(companion.error),
    streaming: Boolean(companion.streaming),
    busy: companion.busy,
    complete: companion.complete,
  })
  const bubble = useMemo(
    () => attentionText({ confirm: companion.confirm, error: companion.error, t }),
    [companion.confirm, companion.error, t],
  )

  useEffect(() => {
    if (bubble) {
      setSpoken(bubble)
      setBubbleLeaving(false)
      return
    }
    if (!spoken) return
    if (!companionPrefersUiMotion()) {
      setSpoken('')
      setBubbleLeaving(false)
      return
    }
    setBubbleLeaving(true)
    const timer = window.setTimeout(() => {
      setSpoken('')
      setBubbleLeaving(false)
    }, COMPANION_PET_BUBBLE_LEAVE_MS)
    return () => window.clearTimeout(timer)
  }, [bubble, spoken])

  useLayoutEffect(() => {
    if (!hasDesktopRuntime()) return
    void invokeCommand('set_companion_pet_bubble', {
      visible: Boolean(spoken) && !overlay.chatOpen,
    }).catch(() => undefined)
  }, [spoken, overlay.chatOpen])

  useEffect(() => {
    let stop: (() => void) | undefined
    void invokeCommand<CompanionShellStatus>('get_companion_shell_status')
      .then(status => {
        setOverlay({
          chatOpen: Boolean(status?.chatOpen),
          chatSide: status?.overlay?.chatSide === 'right' ? 'right' : 'left',
        })
      })
      .catch(() => undefined)
    void listenEvent<{ chatOpen?: boolean; chatSide?: string }>('companion.overlay', event => {
      setOverlay({
        chatOpen: Boolean(event.payload?.chatOpen),
        chatSide: event.payload?.chatSide === 'right' ? 'right' : 'left',
      })
    }).then(unlisten => {
      stop = unlisten
    })
    return () => stop?.()
  }, [])

  useEffect(() => {
    document.documentElement.classList.add('companion-surface')
    document.body.classList.add('companion-surface')
    return () => {
      document.documentElement.classList.remove('companion-surface')
      document.body.classList.remove('companion-surface')
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function loadSkin(id?: string) {
      try {
        const settings = await invokeCommand<AppSettings>('get_settings')
        const resolved = await invokeCommand<CompanionSkinResolved>('get_companion_skin', {
          id: id || settings.companion_skin_id || 'default',
        })
        if (!cancelled && resolved) setSkin(resolved)
      } catch {
        if (!cancelled) setSkin(factorySkin)
      }
    }
    void loadSkin()
    let stop: (() => void) | undefined
    void listenEvent<{ id?: string }>('companion-skin.changed', event => {
      void loadSkin(event.payload?.id)
    }).then(unlisten => {
      stop = unlisten
    })
    return () => {
      cancelled = true
      stop?.()
    }
  }, [])

  useEffect(() => {
    document.title = t('桌宠', 'Companion')
  }, [t])

  useEffect(() => {
    if (!chatOpen) return
    applyThemeMode(readThemeMode())
  }, [chatOpen])

  const pressRef = useRef<{ x: number; y: number; opensChat: boolean } | null>(null)
  const lastOpenRef = useRef(0)

  function openPetChat() {
    const now = Date.now()
    if (now - lastOpenRef.current < 400) return
    lastOpenRef.current = now
    void invokeCommand('click_companion_pet', { locale })
  }

  function beginDrag(event: ReactPointerEvent<HTMLElement>, opensChat: boolean) {
    if (event.button !== 0 || pressRef.current) return
    pressRef.current = { x: event.screenX, y: event.screenY, opensChat }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Capture is a convenience; the window listener below still ends the drag.
    }
    setDragging(true)
    void invokeCommand('move_companion_pet', { drag: 'begin' })
  }

  useEffect(() => {
    const endDrag = (event: PointerEvent) => {
      const press = pressRef.current
      if (!press || (event.type === 'pointerup' && event.button !== 0)) return
      pressRef.current = null
      setDragging(false)
      void invokeCommand<{ dragged?: boolean }>('move_companion_pet', { drag: 'end' })
        .then(result => {
          if (!press.opensChat || result?.dragged) return
          const dx = event.screenX - press.x
          const dy = event.screenY - press.y
          if ((dx * dx) + (dy * dy) < 25) openPetChat()
        })
        .catch(() => undefined)
    }
    window.addEventListener('pointerup', endDrag, true)
    window.addEventListener('pointercancel', endDrag, true)
    return () => {
      window.removeEventListener('pointerup', endDrag, true)
      window.removeEventListener('pointercancel', endDrag, true)
    }
  }, [locale])

  const pet = (
    <div
      className={[
        'companion-pet',
        dragging ? 'companion-pet-dragging' : '',
        `companion-pet-${motion}`,
        `companion-pet-overlay-think-${skin.overlay.think}`,
        `companion-pet-overlay-decide-${skin.overlay.decide}`,
        `companion-pet-overlay-complete-${skin.overlay.complete}`,
      ].filter(Boolean).join(' ')}
    >
      {spoken ? (
        <div
          className={['companion-pet-bubble', bubbleLeaving ? 'is-leaving' : ''].filter(Boolean).join(' ')}
          role="status"
        >
          {spoken}
        </div>
      ) : null}
      <div
        className="companion-pet-body"
        data-testid="companion-pet-body"
        aria-hidden={true}
        onPointerDown={event => beginDrag(event, true)}
      >
        <img
          key={skin.id}
          className="companion-pet-sprite"
          src={spriteSrc(skin, motion)}
          alt=""
          draggable={false}
        />
        <div
          className="companion-pet-mark"
          style={{
            left: `${skin.mark.cx * 100}%`,
            top: `${skin.mark.cy * 100}%`,
            width: `${skin.mark.size * 100}%`,
            height: `${skin.mark.size * 100}%`,
          }}
        >
          <svg className="companion-pet-spinner" viewBox="-50 -50 100 100" aria-hidden="true">
            <g transform="rotate(16)">
              {Array.from({ length: 8 }, (_, index) => (
                <g key={index} transform={`rotate(${index * 45})`}>
                  <rect x="-7.1" y="-46" width="14.2" height="49" rx="7.1" fill="#f4f2ef" />
                  <rect x="-3.3" y="-36" width="6.6" height="30" rx="3.3" fill="#4a3238" />
                </g>
              ))}
              <circle r="11" fill="#e8eef8" />
              <circle r="6.5" fill="#d4deee" />
            </g>
          </svg>
          <svg className="companion-pet-bang companion-pet-bang-yellow" viewBox="0 0 48 56" aria-hidden="true">
            <rect x="18" y="2" width="12" height="34" rx="6" fill="#fff4c2" />
            <rect x="20.5" y="5" width="7" height="28" rx="3.5" fill="#f0b400" />
            <circle cx="24" cy="46" r="7" fill="#fff4c2" />
            <circle cx="24" cy="46" r="4.6" fill="#f0b400" />
          </svg>
          <svg className="companion-pet-bang companion-pet-bang-green" viewBox="0 0 48 56" aria-hidden="true">
            <rect x="18" y="2" width="12" height="34" rx="6" fill="#d9ffe6" />
            <rect x="20.5" y="5" width="7" height="28" rx="3.5" fill="#2fbf5a" />
            <circle cx="24" cy="46" r="7" fill="#d9ffe6" />
            <circle cx="24" cy="46" r="4.6" fill="#2fbf5a" />
          </svg>
        </div>
      </div>
      <span className="sr-only">{t('桌宠', 'Companion')}</span>
    </div>
  )
  if (chatOpen) {
    const phone = (
      <div
          className="companion-phone"
          data-testid="companion-phone"
          data-form="phone"
          data-chat="open"
          data-preview={previewPhone ? 'true' : undefined}
          style={previewPhone ? { width: 288, height: 604 } : undefined}
          onPointerDown={event => {
            const target = event.target as HTMLElement
            if (target.closest('button, textarea, input, [contenteditable="true"]')) return
            if (target.closest('.companion-chat-log, .companion-phone-settings-scroll')) return
            beginDrag(event, false)
          }}
        >
          <div className="companion-phone-screen">
            <CompanionPage embedded />
          </div>
        </div>
    )
    return (
      <>
        {previewPhone ? <div className="companion-unit">{phone}</div> : phone}
        <Toaster />
      </>
    )
  }

  return (
    <div className="companion-unit" data-form="pet" data-chat="closed">
      {pet}
    </div>
  )
}
