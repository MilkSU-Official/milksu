import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { normalizeUiFontSize } from '@/lib/uiFonts'
import { useT } from '@/hooks/useUiLocale'

/**
 * 对话字号的 px 输入框。失焦或回车时归一化（11–18，非法值回默认 14）并提交；
 * Esc 放弃草稿。输入过程只收数字。
 */
export default function ConversationSizeInput({
  value,
  ariaLabel,
  onCommit,
}: {
  value: string
  ariaLabel: string
  onCommit: (size: string) => void
}) {
  const t = useT()
  const [draft, setDraft] = useState(value)
  useEffect(() => {
    setDraft(value)
  }, [value])

  function commit() {
    const next = normalizeUiFontSize(draft)
    setDraft(next)
    if (next !== value) onCommit(next)
  }

  return (
    <div className="flex items-center gap-1.5">
      <Input
        className="h-7 w-16 border-border bg-transparent px-2 text-right text-sm tabular-nums shadow-none"
        inputMode="numeric"
        value={draft}
        aria-label={ariaLabel}
        onChange={event => setDraft(event.target.value.replace(/[^\d]/g, '').slice(0, 2))}
        onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') {
            event.preventDefault()
            commit()
          }
          if (event.key === 'Escape') setDraft(value)
        }}
      />
      <span className="text-caption text-muted-foreground">{t('px', 'px')}</span>
    </div>
  )
}
