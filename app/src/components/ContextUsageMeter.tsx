import { useMemo, useState } from 'react'
import { Button, Popover, PopoverContent, PopoverTrigger } from '@/components/ui'
import { X } from 'lucide-react'
import type { ContextUsagePresentation } from '@/lib/sessionTurnStatus'
import { useT } from '@/hooks/useUiLocale'

const METER_STYLES = `
.context-usage-panel {
  border-radius: 8px !important;
  background: var(--popover, var(--background));
}
.context-usage-meter__cache { stroke: var(--muted-foreground); }
.context-usage-meter__fresh { stroke: var(--foreground); }
.context-usage-meter__track {
  display: flex;
  width: 100%;
  height: 0.375rem;
  overflow: hidden;
  border-radius: 8px;
  background: var(--hover-2, var(--muted));
}
.context-usage-meter__seg { display: block; height: 100%; min-width: 0; }
.context-usage-meter__seg--occupied { background: var(--primary, #4aabea); }
.context-usage-meter__seg--warning { background: var(--warning, #d97706); }
.context-usage-meter__seg--system { background: var(--muted-foreground); }
.context-usage-meter__seg--tools { background: #7c6cf0; }
.context-usage-meter__seg--skills { background: #c9864a; }
.context-usage-meter__seg--mcp { background: #c44b8a; }
.context-usage-meter__seg--subagent { background: #3b82c4; }
.context-usage-meter__seg--conversation { background: #d4544a; }
.context-usage-meter__swatch { width: 0.45rem; height: 0.45rem; border-radius: 2px; }
.context-usage-meter__swatch--fresh { background: var(--foreground); }
.context-usage-meter__swatch--cache { background: var(--muted-foreground); }
.context-usage-meter__swatch--system { background: var(--muted-foreground); }
.context-usage-meter__swatch--tools { background: #7c6cf0; }
.context-usage-meter__swatch--skills { background: #c9864a; }
.context-usage-meter__swatch--mcp { background: #c44b8a; }
.context-usage-meter__swatch--subagent { background: #3b82c4; }
.context-usage-meter__swatch--conversation { background: #d4544a; }
`

export default function ContextUsageMeter({
  usage,
  size = 'sm',
  running,
  compacting,
  defaultOpen,
  onCompactContext,
  onHandoffContext,
}: {
  usage: ContextUsagePresentation
  size?: 'sm' | 'md'
  running?: boolean
  compacting?: boolean
  defaultOpen?: boolean
  onCompactContext?: () => void
  onHandoffContext?: () => void
}) {
  const t = useT()
  const [panelOpen, setPanelOpen] = useState(Boolean(defaultOpen))
  const radius = size === 'md' ? 9 : 7
  const stroke = size === 'md' ? 2.5 : 2
  const viewBox = useMemo(() => {
    const pad = radius + stroke
    return { dim: pad * 2, center: pad }
  }, [radius, stroke])
  const circumference = 2 * Math.PI * radius
  const dashOffset = circumference * (1 - Math.min(100, Math.max(0, usage.percent ?? 0)) / 100)
  const cacheLength = circumference * Math.min(100, Math.max(0, usage.cachePercent ?? 0)) / 100
  const uncachedLength = circumference * Math.min(100, Math.max(0, usage.uncachedPercent ?? 0)) / 100
  const hasCategories = (usage.categories?.length ?? 0) > 0
  const hasSplit = !hasCategories && (usage.cachePercent ?? 0) > 0 && (usage.uncachedPercent ?? 0) > 0
  const cacheOnly = !hasCategories && (usage.cachePercent ?? 0) > 0 && (usage.uncachedPercent ?? 0) <= 0
  const hasRing = usage.percent !== undefined
  const used = usage.usedLabel?.trim()
  const ratio = usage.tokenRatioLabel?.trim()
  const triggerLabel = used && ratio ? `${used} ${ratio}` : used || ratio || usage.strip
  const occupancyBarPercent = Math.min(100, Math.max(0, usage.percent ?? 0))
  const categorySegments = useMemo(() => {
    const cats = usage.categories ?? []
    if (!cats.length) return []
    const windowTokens = usage.windowTokens
    const estimated = usage.estimatedTokens || cats.reduce((sum, item) => sum + item.tokens, 0)
    if (windowTokens && windowTokens > 0) {
      return cats.map(item => ({ id: item.id, barPercent: (item.tokens / windowTokens) * 100 }))
    }
    if (estimated <= 0) return []
    const scale = (usage.percent ?? 100) / 100
    return cats.map(item => ({ id: item.id, barPercent: (item.tokens / estimated) * scale * 100 }))
  }, [usage.categories, usage.windowTokens, usage.estimatedTokens, usage.percent])
  const showOccupancyBar = hasCategories || usage.percent !== undefined
  const showBilled = Boolean(usage.last)
  const compactDisabled = Boolean(compacting || usage.compacting)
  const handoffDisabled = Boolean(running || compactDisabled)

  function closePanel() {
    setPanelOpen(false)
  }

  function runCompact() {
    if (compactDisabled) return
    closePanel()
    onCompactContext?.()
  }

  function runHandoff() {
    if (handoffDisabled) return
    closePanel()
    onHandoffContext?.()
  }

  return (
    <>
      <style>{METER_STYLES}</style>
      <Popover open={panelOpen} onOpenChange={setPanelOpen}>
        <PopoverTrigger asChild>
          <button
            type="button"
            className={`context-usage-meter inline-flex items-center gap-1.5 rounded-md px-0.5 py-0.5 text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring${usage.nearLimit ? ' text-warning' : ''}`}
            data-testid="context-usage-meter"
            aria-label={triggerLabel}
            aria-expanded={panelOpen}
          >
            {hasRing ? (
              <svg
                width={viewBox.dim}
                height={viewBox.dim}
                viewBox={`0 0 ${viewBox.dim} ${viewBox.dim}`}
                className="shrink-0 -rotate-90"
                aria-hidden="true"
              >
                <circle cx={viewBox.center} cy={viewBox.center} r={radius} fill="none" className="stroke-border" strokeWidth={stroke} />
                {!hasSplit ? (
                  <circle
                    cx={viewBox.center}
                    cy={viewBox.center}
                    r={radius}
                    fill="none"
                    className={usage.nearLimit ? 'stroke-warning' : cacheOnly ? 'context-usage-meter__cache' : 'stroke-primary'}
                    strokeWidth={stroke}
                    strokeLinecap="round"
                    strokeDasharray={circumference}
                    strokeDashoffset={dashOffset}
                  />
                ) : null}
                {hasSplit ? (
                  <>
                    <circle
                      cx={viewBox.center}
                      cy={viewBox.center}
                      r={radius}
                      fill="none"
                      className="context-usage-meter__cache"
                      strokeWidth={stroke}
                      strokeLinecap="butt"
                      strokeDasharray={`${cacheLength} ${circumference}`}
                    />
                    <circle
                      cx={viewBox.center}
                      cy={viewBox.center}
                      r={radius}
                      fill="none"
                      className="context-usage-meter__fresh"
                      strokeWidth={stroke}
                      strokeLinecap="butt"
                      strokeDasharray={`${uncachedLength} ${circumference}`}
                      strokeDashoffset={-cacheLength}
                    />
                  </>
                ) : null}
              </svg>
            ) : (
              <span
                className={`size-1.5 shrink-0 rounded-full${usage.nearLimit ? ' bg-warning' : ' bg-muted-foreground'}`}
                aria-hidden="true"
              />
            )}
            <span className="font-mono text-caption tabular-nums">
              {usage.compacting ? t('整理中', 'Compacting') : hasRing ? `${usage.percent}%` : usage.ioLabel}
            </span>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="end"
          sideOffset={8}
          className="context-usage-panel w-80 p-3"
          data-testid="context-usage-panel"
        >
          <div className="flex items-start justify-between gap-2">
            <p className="text-caption font-medium">{t('上下文用量', 'Context Usage')}</p>
            <button
              type="button"
              className="inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
              aria-label={t('关闭', 'Close')}
              onClick={closePanel}
            >
              <X className="size-3.5" />
            </button>
          </div>
          {usage.usedLabel || usage.tokenRatioLabel ? (
            <div className="mt-2 flex items-baseline justify-between gap-3">
              <p className="text-caption">{usage.usedLabel}</p>
              <p className="font-mono text-caption tabular-nums text-muted-foreground">{usage.tokenRatioLabel}</p>
            </div>
          ) : null}
          {usage.compacting && usage.usedLabel !== t('整理中', 'Compacting') ? (
            <p className="mt-1 text-caption text-muted-foreground">{t('整理中', 'Compacting')}</p>
          ) : null}
          {showOccupancyBar ? (
            <div className="context-usage-meter__track mt-2">
              {hasCategories ? (
                categorySegments.map(segment => (
                  <span
                    key={segment.id}
                    className={`context-usage-meter__seg context-usage-meter__seg--${segment.id}`}
                    style={{ width: `${segment.barPercent}%` }}
                  />
                ))
              ) : (
                <span
                  className={`context-usage-meter__seg ${usage.nearLimit ? 'context-usage-meter__seg--warning' : 'context-usage-meter__seg--occupied'}`}
                  style={{ width: `${occupancyBarPercent}%` }}
                />
              )}
            </div>
          ) : null}
          {hasCategories ? (
            <ul className="mt-3 space-y-1.5">
              {usage.categories?.map(category => (
                <li
                  key={category.id}
                  className="flex items-center justify-between gap-3"
                  data-testid="context-usage-category"
                  data-category={category.id}
                >
                  <span className="flex min-w-0 items-center gap-1.5 text-caption">
                    <span className={`context-usage-meter__swatch context-usage-meter__swatch--${category.id}`} />
                    <span className="truncate">{category.label}</span>
                  </span>
                  <span className="font-mono text-caption tabular-nums">{category.tokenLabel}</span>
                </li>
              ))}
            </ul>
          ) : null}
          {showBilled ? (
            <p className="mt-3 text-caption text-muted-foreground">{t('本轮计费', 'Billed this turn')}</p>
          ) : null}
          {usage.last ? (
            <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <span className="context-usage-meter__swatch context-usage-meter__swatch--fresh" />
                {t('未命中输入', 'Uncached input')}
                <span className="font-mono tabular-nums">{usage.last.uncachedLabel}</span>
              </span>
              <span className="inline-flex items-center gap-1.5">
                <span className="context-usage-meter__swatch context-usage-meter__swatch--cache" />
                {t('缓存命中', 'Cache hits')}
                <span className="font-mono tabular-nums">{usage.last.cacheReadLabel}</span>
              </span>
            </div>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <Button type="button" variant="outline" size="sm" data-testid="context-usage-compact" disabled={compactDisabled} onClick={runCompact}>
              {t('整理上下文', 'Compact context')}
            </Button>
            <Button type="button" variant="outline" size="sm" data-testid="context-usage-handoff" disabled={handoffDisabled} onClick={runHandoff}>
              {t('接到新会话', 'Handoff')}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
    </>
  )
}
