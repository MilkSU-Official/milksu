import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown, Plus, Shield, Target } from 'lucide-react'
import type { EngagementSummary, TaskType } from '../types'
import { createEngagement, listEngagements } from '../tauri'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { Card, CardContent } from './ui/card'
import { Input } from './ui/input'
import { cn } from '@/lib/utils'

interface Props {
  taskType: TaskType
  engagements: EngagementSummary[]
  selectedEngagementId: string | null
  onEngagementChange: (id: string | null) => void
  onEngagementsChange: (engagements: EngagementSummary[]) => void
}

function statusVariant(status: EngagementSummary['status']): 'default' | 'secondary' | 'outline' | 'ghost' {
  if (status === 'active') return 'secondary'
  if (status === 'completed') return 'outline'
  return 'ghost'
}

export function EngagementSelector({
  taskType,
  engagements,
  selectedEngagementId,
  onEngagementChange,
  onEngagementsChange,
}: Props) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [scope, setScope] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }

    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  if (taskType === 'chat') return null

  const selected = engagements.find(engagement => engagement.id === selectedEngagementId)

  const refreshEngagements = async () => {
    setLoading(true)
    setError(null)
    try {
      onEngagementsChange(await listEngagements())
    } catch (err) {
      setError(t('engagement.loadError', { error: String(err) }))
    } finally {
      setLoading(false)
    }
  }

  const handleToggle = () => {
    const nextOpen = !open
    setOpen(nextOpen)
    if (nextOpen) void refreshEngagements()
  }

  const handleCreate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()

    const trimmedName = name.trim()
    if (!trimmedName) return

    const parsedScope = scope
      .split(',')
      .map(item => item.trim())
      .filter(Boolean)

    setLoading(true)
    setError(null)
    try {
      const engagement = await createEngagement(trimmedName, parsedScope)
      onEngagementChange(engagement.id)
      onEngagementsChange(await listEngagements())
      setName('')
      setScope('')
      setCreating(false)
      setOpen(false)
    } catch (err) {
      setError(t('engagement.createError', { error: String(err) }))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="relative" ref={ref}>
      <Button
        type="button"
        variant="outline"
        size="sm"
        aria-expanded={open}
        onClick={handleToggle}
        className="max-w-[260px] justify-start"
      >
        <Shield data-icon="inline-start" />
        <span className="min-w-0 truncate">{selected?.name ?? t('engagement.selectEngagement')}</span>
        <ChevronDown data-icon="inline-end" className={cn('ml-auto transition-transform', open && 'rotate-180')} />
      </Button>

      {open && (
        <Card className="absolute left-0 top-full z-50 mt-2 w-80 rounded-md py-0 shadow-lg" size="sm">
          <CardContent className="flex flex-col gap-1 p-2">
            <div className="max-h-72 overflow-y-auto">
              {loading && engagements.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">{t('engagement.loadingEngagements')}</p>
              ) : engagements.length === 0 ? (
                <p className="px-2 py-3 text-xs text-muted-foreground">{t('engagement.noEngagements')}</p>
              ) : (
                <div className="flex flex-col gap-1">
                  {selectedEngagementId && (
                    <button
                      type="button"
                      onClick={() => {
                        onEngagementChange(null)
                        setOpen(false)
                      }}
                      className="rounded-md px-2 py-2 text-left text-xs text-muted-foreground hover:bg-muted"
                    >
                      {t('engagement.noEngagement')}
                    </button>
                  )}
                  {engagements.map(engagement => (
                    <button
                      key={engagement.id}
                      type="button"
                      onClick={() => {
                        onEngagementChange(engagement.id)
                        setOpen(false)
                      }}
                      className={cn(
                        'flex w-full flex-col gap-1 rounded-md px-2 py-2 text-left transition-colors hover:bg-muted',
                        selectedEngagementId === engagement.id && 'bg-muted',
                      )}
                    >
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="truncate text-sm font-medium">{engagement.name}</span>
                        <Badge variant={statusVariant(engagement.status)}>
                          {t(`engagement.status.${engagement.status}`)}
                        </Badge>
                      </span>
                      <span className="flex items-center gap-2 text-xs text-muted-foreground">
                        <Target className="size-3" />
                        <span>{t('engagement.hostCount', { count: engagement.host_count })}</span>
                        <span>{t('engagement.vulnCount', { count: engagement.vuln_count })}</span>
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="border-t pt-2">
              {creating ? (
                <form onSubmit={handleCreate} className="flex flex-col gap-2">
                  <Input
                    value={name}
                    onChange={event => setName(event.target.value)}
                    placeholder={t('engagement.engagementName')}
                    aria-label={t('engagement.engagementName')}
                    autoFocus
                  />
                  <Input
                    value={scope}
                    onChange={event => setScope(event.target.value)}
                    placeholder={t('engagement.scopePlaceholder')}
                    aria-label={t('engagement.engagementScope')}
                  />
                  {error && <p className="text-xs text-destructive">{error}</p>}
                  <div className="flex justify-end gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setCreating(false)
                        setError(null)
                      }}
                    >
                      {t('engagement.cancel')}
                    </Button>
                    <Button type="submit" size="sm" disabled={loading || !name.trim()}>
                      <Plus data-icon="inline-start" />
                      {t('engagement.create')}
                    </Button>
                  </div>
                </form>
              ) : (
                <>
                  {error && <p className="mb-2 px-2 text-xs text-destructive">{error}</p>}
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start"
                    onClick={() => setCreating(true)}
                  >
                    <Plus data-icon="inline-start" />
                    {t('engagement.newEngagement')}
                  </Button>
                </>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
