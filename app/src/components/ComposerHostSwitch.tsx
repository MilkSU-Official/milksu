import { Button } from '@/components/ui'
import { Cloud, Monitor } from 'lucide-react'
import { useT } from '@/hooks/useUiLocale'
import type { ConversationHost } from '@/lib/conversationHost'
import { normalizeConversationHost } from '@/lib/conversationHost'

export default function ComposerHostSwitch({
  host,
  disabled,
  hasStarted,
  migrating,
  onChangeHost,
}: {
  host: ConversationHost
  disabled?: boolean
  /** True once the conversation has at least one user/assistant turn. */
  hasStarted?: boolean
  /** True while copy-then-delete migrate is in flight. */
  migrating?: boolean
  onChangeHost?: (next: ConversationHost) => void
}) {
  const t = useT()
  const current = normalizeConversationHost(host)
  const label = migrating
    ? t('迁移中', 'Migrating')
    : current === 'cloud'
      ? t('云', 'Cloud')
      : t('本地', 'Local')
  const next: ConversationHost = current === 'cloud' ? 'local' : 'cloud'
  const title = migrating
    ? t('正在复制到另一端，成功后再切换', 'Copying to the other host; switch completes after success')
    : hasStarted
      ? t('切换会先复制到另一端，成功后再删除这边', 'Switch copies to the other host first, then deletes this side after success')
      : t('选择新对话开在本地还是云', 'Choose whether new turns run locally or in the cloud')

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="composer-control composer-permission justify-start"
      disabled={disabled || migrating}
      aria-label={t('本地或云', 'Local or cloud')}
      title={title}
      onClick={() => onChangeHost?.(next)}
    >
      {current === 'cloud'
        ? <Cloud className="size-3.5 shrink-0" />
        : <Monitor className="size-3.5 shrink-0" />}
      <span className="composer-permission__label">{label}</span>
    </Button>
  )
}
