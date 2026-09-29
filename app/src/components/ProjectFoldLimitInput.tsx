import { useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { normalizeProjectFoldLimit } from '@/lib/projectFoldLimit'

/**
 * 项目文件夹折叠阈值的条数输入框。失焦或回车时归一化（1–20，非法值回默认 5）
 * 并提交；Esc 放弃草稿。输入过程只收数字。
 */
export default function ProjectFoldLimitInput({
  value,
  ariaLabel,
  onCommit,
}: {
  value: number
  ariaLabel: string
  onCommit: (limit: number) => void
}) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => {
    setDraft(String(value))
  }, [value])

  function commit() {
    const next = normalizeProjectFoldLimit(draft)
    setDraft(String(next))
    if (next !== value) onCommit(next)
  }

  return (
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
        if (event.key === 'Escape') setDraft(String(value))
      }}
    />
  )
}
