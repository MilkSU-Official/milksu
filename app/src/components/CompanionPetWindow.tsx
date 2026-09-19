import { useCompanion } from '@/composables/useCompanion'
import { useT } from '@/hooks/useUiLocale'

export default function CompanionPetWindow() {
  const t = useT()
  const companion = useCompanion()
  const last = companion.entries.at(-1)
  return (
    <div className="flex h-full min-h-0 flex-col bg-transparent text-foreground">
      <div className="app-drag flex-1" />
      <div className="app-no-drag rounded-md bg-popover px-3 py-2 text-caption">
        <p className="font-medium">{t('桌宠', 'Companion')}</p>
        <p className="line-clamp-3 text-muted-foreground">{last?.text || companion.status.model}</p>
      </div>
    </div>
  )
}
