import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import companionDecide from '@/assets/companion/decide.png'
import companionIdle from '@/assets/companion/idle.png'
import companionTalk from '@/assets/companion/talk.png'
import CompanionPage from '@/components/CompanionPage'
import { CompanionPetBang, CompanionPetSpinner } from '@/components/CompanionPetGlyph'
import { Toaster } from '@/components/ui'
import { useCompanion } from '@/composables/useCompanion'
import { hasDesktopRuntime, invokeCommand, listenEvent } from '@/desktop'
import { toast } from '@/lib/appToast'
import { companionAccountModelAlignedNotice } from '@/lib/companionUserError'
import { useT, useUiLocale } from '@/hooks/useUiLocale'
import {
  COMPANION_FORM_MS,
  COMPANION_PET_BUBBLE_LEAVE_MS,
  companionAttentionText,
  companionPetShowsError,
  companionPetSprite,
  companionPrefersUiMotion,
  resolveCompanionPetMotion,
  stepCompanionThinkClock,
} from '@/lib/companionPetMotion'
import { COMPANION_PHONE_HEIGHT, COMPANION_PHONE_WIDTH } from '@/lib/companionOverlayState'
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
  const [yielding, setYielding] = useState(false)
  const [phoneHeld, setPhoneHeld] = useState(false)
  const [irisSettled, setIrisSettled] = useState(false)
  const [thinkStartedAt, setThinkStartedAt] = useState<number | null>(null)
  const chatWasOpen = useRef(chatOpen)
  const phoneShown = useRef(chatOpen)
  // Set when the closing phone unmounts, so the pet unit does not replay
  // the opacity-0 entrance under a still phone-sized window.
  const handoffPet = useRef(false)
  const phoneKey = useRef(0)
  const prevChatOpen = useRef(chatOpen)
  const phoneOpening = (chatOpen || previewPhone) && !prevChatOpen.current
  if (phoneOpening) phoneKey.current += 1
  prevChatOpen.current = chatOpen || previewPhone
  const motion = resolveCompanionPetMotion({
    confirm: Boolean(companion.confirm),
    error: companionPetShowsError(companion.error),
    streaming: Boolean(companion.streaming),
    busy: companion.busy,
    complete: companion.complete,
  })
  const bubble = useMemo(
    () => companionAttentionText({ confirm: companion.confirm, error: companion.error, t }),
    [companion.confirm, companion.error, t],
  )
  const nextThinkStartedAt = stepCompanionThinkClock(
    thinkStartedAt,
    motion,
    motion === 'think' && thinkStartedAt == null ? Date.now() : 0,
    companion.busy,
  )
  if (nextThinkStartedAt !== thinkStartedAt) setThinkStartedAt(nextThinkStartedAt)

  useEffect(() => {
    if (!hasDesktopRuntime()) return undefined
    let stop: (() => void) | undefined
    void listenEvent('companion-model-aligned', () => {
      toast(companionAccountModelAlignedNotice())
    }).then(unlisten => {
      stop = unlisten
    })
    return () => stop?.()
  }, [])

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
    document.title = t('看板娘', 'Companion')
  }, [t])

  useEffect(() => {
    if (!chatOpen) return
    applyThemeMode(readThemeMode())
  }, [chatOpen])

  useEffect(() => {
    if (!chatOpen) {
      chatWasOpen.current = false
      setYielding(false)
      return
    }
    if (chatWasOpen.current || previewPhone || !companionPrefersUiMotion()) {
      chatWasOpen.current = true
      return
    }
    chatWasOpen.current = true
    setYielding(true)
    const timer = window.setTimeout(() => setYielding(false), COMPANION_FORM_MS)
    return () => {
      window.clearTimeout(timer)
      chatWasOpen.current = false
    }
  }, [chatOpen, previewPhone])

  useEffect(() => {
    const visible = chatOpen || previewPhone
    if (!visible || !companionPrefersUiMotion()) {
      setIrisSettled(true)
      return
    }
    setIrisSettled(false)
    const timer = window.setTimeout(() => setIrisSettled(true), COMPANION_FORM_MS)
    return () => window.clearTimeout(timer)
  }, [chatOpen, previewPhone])

  useEffect(() => {
    if (chatOpen || previewPhone) {
      phoneShown.current = true
      handoffPet.current = false
      setPhoneHeld(false)
      return
    }
    if (!phoneShown.current || !companionPrefersUiMotion()) {
      handoffPet.current = false
      setPhoneHeld(false)
      return
    }
    setPhoneHeld(true)
    const timer = window.setTimeout(() => {
      phoneShown.current = false
      handoffPet.current = true
      setPhoneHeld(false)
    }, COMPANION_FORM_MS)
    return () => window.clearTimeout(timer)
  }, [chatOpen, previewPhone])

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

  const showPhone = chatOpen || phoneHeld
  // The close handoff mounts a new unit while the shell still holds phone
  // bounds. Skip the entrance fade and the sprite's starting opacity so
  // this frame is the pet, not another transparent layer.
  const petArrived = handoffPet.current && !showPhone
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
          style={petArrived ? { opacity: 1, transition: 'none' } : undefined}
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
          <CompanionPetSpinner className="companion-pet-spinner" />
          <CompanionPetBang tone="yellow" className="companion-pet-bang companion-pet-bang-yellow" />
          <CompanionPetBang tone="green" className="companion-pet-bang companion-pet-bang-green" />
        </div>
      </div>
      <span className="sr-only">{t('看板娘', 'Companion')}</span>
    </div>
  )
  if (showPhone) {
    const phone = (
      <div
          key={phoneKey.current}
          className={['companion-phone', phoneHeld && !chatOpen ? 'is-closing' : '', irisSettled && !phoneOpening ? 'is-settled' : ''].filter(Boolean).join(' ')}
          data-testid="companion-phone"
          data-form="phone"
          data-chat={chatOpen ? 'open' : 'closing'}
          data-preview={previewPhone ? 'true' : undefined}
          style={previewPhone ? { width: COMPANION_PHONE_WIDTH, height: COMPANION_PHONE_HEIGHT } : undefined}
          onPointerDown={event => {
            const target = event.target as HTMLElement
            if (target.closest('button, textarea, input, [contenteditable="true"]')) return
            if (target.closest('.companion-chat-log, .companion-phone-settings-scroll')) return
            beginDrag(event, false)
          }}
        >
          <div className="companion-phone-screen">
            <CompanionPage embedded thinkStartedAt={nextThinkStartedAt} />
          </div>
        </div>
    )
    return (
      <>
        {previewPhone ? <div className="companion-unit">{phone}</div> : phone}
        {yielding || phoneHeld ? <div className="companion-pet-yield">{pet}</div> : null}
        <Toaster />
      </>
    )
  }

  return (
    <div
      className="companion-unit"
      data-form="pet"
      data-chat="closed"
      style={petArrived ? { animation: 'none' } : undefined}
    >
      {pet}
    </div>
  )
}
