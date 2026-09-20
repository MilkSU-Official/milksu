import { useEffect, useMemo } from 'react'
import companionDecide from '@/assets/companion/decide.png'
import companionIdle from '@/assets/companion/idle.png'
import companionTalk from '@/assets/companion/talk.png'
import { useCompanion } from '@/composables/useCompanion'
import { invokeCommand } from '@/desktop'
import { useT, useUiLocale } from '@/hooks/useUiLocale'
import { companionPetSprite, resolveCompanionPetMotion } from '@/lib/companionPetMotion'

const sprites = {
  idle: companionIdle,
  talk: companionTalk,
  decide: companionDecide,
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
    if (input.confirm.text.trim()) return input.confirm.text.trim()
    if (input.confirm.targetTitle.trim()) return input.confirm.targetTitle.trim()
    return input.t('这次操作需要你点头', 'This action needs your confirmation')
  }
  if (input.error.trim()) return input.error.trim()
  return ''
}

export default function CompanionPetWindow() {
  const t = useT()
  const locale = useUiLocale()
  const companion = useCompanion()
  const motion = resolveCompanionPetMotion({
    confirm: Boolean(companion.confirm),
    error: Boolean(companion.error.trim()),
    streaming: Boolean(companion.streaming),
    busy: companion.busy,
    complete: companion.complete,
  })
  const bubble = useMemo(
    () => attentionText({ confirm: companion.confirm, error: companion.error, t }),
    [companion.confirm, companion.error, t],
  )

  useEffect(() => {
    document.documentElement.classList.add('companion-surface')
    document.body.classList.add('companion-surface')
    return () => {
      document.documentElement.classList.remove('companion-surface')
      document.body.classList.remove('companion-surface')
    }
  }, [])

  return (
    <div
      className={`companion-pet companion-pet-${motion}`}
      onContextMenu={event => {
        event.preventDefault()
        void invokeCommand('set_companion_pet_hidden', { hidden: true, locale })
      }}
      onClick={() => {
        if (motion !== 'decide') return
        void invokeCommand('show_companion_main_window')
      }}
    >
      {bubble ? (
        <div className="companion-pet-bubble" role="status">
          {bubble}
        </div>
      ) : null}
      <div className="companion-pet-body" aria-hidden={true}>
        <img
          className="companion-pet-sprite"
          src={sprites[companionPetSprite(motion)]}
          alt=""
          draggable={false}
        />
        <div className="companion-pet-mark">
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
}
