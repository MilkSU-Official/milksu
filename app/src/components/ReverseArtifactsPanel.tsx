import { useDeferredValue, useMemo, useRef, useState } from 'react'
import DOMPurify from 'dompurify'
import hljs from 'highlight.js/lib/core'
import hljsC from 'highlight.js/lib/languages/c'
import { useVirtualizer } from '@tanstack/react-virtual'
import {
  ArrowRight,
  Binary,
  Boxes,
  ChevronRight,
  CircleHelp,
  Copy,
  FileSearch,
  Layers,
  Search,
} from 'lucide-react'
import { Badge } from '@/components/ui'
import { useT } from '@/hooks/useUiLocale'
import { formatRelativeAge } from '@/lib/relativeAge'
import {
  deriveReverseSession,
  reaRunningLabel,
  type ReverseDossier,
  type ReverseFunction,
  type ReverseReference,
} from '@/lib/reverseArtifacts'
import type { Message } from '@/types'
import { cn } from '@/lib/cn'

/**
 * 逆向产物 rail panel. A read-only projection of `milksu-rea` MCP traffic:
 * target card, function browser, decompilation dossier with a pseudocode and
 * an instruction view, evidence timeline, unknowns, and trace steps. All data
 * is derived from the conversation's tool messages; nothing here calls REA.
 */

// markdown.ts registers the same language for chat code blocks; registering
// here keeps the panel self-sufficient when markdown.ts is not loaded.
hljs.registerLanguage('c', hljsC)

function highlightPseudocode(code: string): string {
  try {
    return DOMPurify.sanitize(hljs.highlight(code, { language: 'c', ignoreIllegals: true }).value, {
      ALLOWED_TAGS: ['span'],
      ALLOWED_ATTR: ['class'],
    })
  } catch {
    return ''
  }
}

function PseudocodeView({ code }: { code: string }) {
  const lines = useMemo(() => code.split('\n').filter((line, index, all) => (
    line.trim().length > 0 || (index > 0 && index < all.length - 1)
  )), [code])
  if (lines.length === 0) return null
  return (
    <div className="reverse-code font-mono text-[12px] leading-[1.55] text-foreground/90" data-testid="reverse-pseudocode">
      {lines.map((line, index) => (
        <div className="reverse-code__line" key={index}>
          <span className="reverse-code__lineno">{index + 1}</span>
          <code
            className="reverse-code__text"
            // highlight.js output is sanitized through DOMPurify above.
            dangerouslySetInnerHTML={{ __html: highlightPseudocode(line) || '&nbsp;' }}
          />
        </div>
      ))}
    </div>
  )
}

function AssemblyView({ assembly }: { assembly: string[] }) {
  if (assembly.length === 0) return null
  return (
    <div className="reverse-code font-mono text-[11.5px] leading-[1.5] text-foreground/80" data-testid="reverse-assembly">
      {assembly.map((line, index) => (
        <div className="reverse-code__line" key={index}>
          <span className="reverse-code__lineno" />
          <code className="reverse-code__text whitespace-pre">{line}</code>
        </div>
      ))}
    </div>
  )
}

function ReferenceChips({
  label,
  references,
}: {
  label: string
  references: ReverseReference[]
}) {
  if (references.length === 0) return null
  return (
    <div className="min-w-0">
      <div className="mb-1 text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="flex flex-wrap gap-1">
        {references.slice(0, 8).map((reference, index) => (
          <code
            key={`${reference.address}-${index}`}
            className="max-w-full truncate rounded-[6px] bg-muted px-2 py-[3px] font-mono text-[11px] text-muted-foreground"
            title={reference.name}
          >
            {reference.name || reference.address}
          </code>
        ))}
        {references.length > 8 ? (
          <span className="px-1 py-[3px] text-[10.5px] text-muted-foreground">+{references.length - 8}</span>
        ) : null}
      </div>
    </div>
  )
}

function SectionHeader({ icon, title, count }: { icon: React.ReactNode; title: string; count?: number }) {
  return (
    <div className="mt-1 mb-2 flex items-center gap-1.5 px-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
      {icon}
      <span>{title}</span>
      {count != null ? <span className="tabular-nums">· {count}</span> : null}
    </div>
  )
}

const functionRowHeight = 30

function FunctionList({
  functions,
  selectedAddress,
  onSelect,
}: {
  functions: ReverseFunction[]
  selectedAddress: string
  onSelect: (address: string) => void
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualize = functions.length > 120
  const virtualizer = useVirtualizer({
    count: virtualize ? functions.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => functionRowHeight,
    overscan: 12,
  })
  if (functions.length === 0) return null

  const row = (fn: ReverseFunction, measure: boolean) => {
    const selected = Boolean(selectedAddress) && selectedAddress === fn.address
    return (
      <button
        type="button"
        key={`${fn.address}-${fn.name}`}
        className={cn(
          'group relative flex w-full items-center gap-2 rounded-[7px] px-2.5 py-[5px] text-left transition-colors',
          'hover:bg-muted/60 active:bg-muted',
          selected ? 'bg-muted' : undefined,
          measure ? 'shrink-0' : undefined,
        )}
        style={measure ? { height: `${functionRowHeight}px` } : undefined}
        onClick={() => onSelect(fn.address)}
        data-testid={selected ? 'reverse-function-selected' : undefined}
      >
        {selected ? (
          <span className="absolute left-0 top-[5px] bottom-[5px] w-[3px] rounded-full bg-primary" aria-hidden />
        ) : null}
        <span className={cn(
          'min-w-0 flex-1 truncate font-mono text-[11.5px] group-hover:text-foreground',
          selected ? 'text-foreground' : 'text-foreground/85',
        )}>
          {fn.name || fn.address}
        </span>
        {fn.address ? (
          <span className="shrink-0 font-mono text-[10.5px] tabular-nums text-muted-foreground">{fn.address}</span>
        ) : null}
      </button>
    )
  }

  if (!virtualize) {
    return <div className="flex flex-col gap-0.5 pb-1" data-testid="reverse-function-list">{functions.map(fn => row(fn, false))}</div>
  }
  return (
    <div ref={scrollRef} className="max-h-[380px] overflow-y-auto pb-1" data-testid="reverse-function-list">
      <div style={{ height: `${virtualizer.getTotalSize()}px`, position: 'relative' }}>
        {virtualizer.getVirtualItems().map(item => (
          <div
            key={item.key}
            style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${item.start}px)` }}
          >
            {row(functions[item.index]!, true)}
          </div>
        ))}
      </div>
    </div>
  )
}

export default function ReverseArtifactsPanel({ messages }: { messages: Message[] }) {
  const t = useT()
  const session = useMemo(() => deriveReverseSession(messages), [messages])
  const deferredSession = useDeferredValue(session)
  const [query, setQuery] = useState('')
  const [selectedAddress, setSelectedAddress] = useState('')
  const [dossierTab, setDossierTab] = useState<'pseudocode' | 'assembly'>('pseudocode')

  const functions = useMemo(() => {
    const value = query.trim().toLowerCase()
    if (!value) return deferredSession.functions
    return deferredSession.functions.filter(fn => (
      fn.name.toLowerCase().includes(value) || fn.address.toLowerCase().includes(value)
    ))
  }, [deferredSession.functions, query])

  const selectedDossier: ReverseDossier | null = useMemo(() => {
    if (selectedAddress) {
      const found = deferredSession.dossiers.find(item => item.address === selectedAddress)
      if (found) return found
    }
    return deferredSession.dossiers[0] ?? null
  }, [deferredSession.dossiers, selectedAddress])

  const runningLabel = reaRunningLabel(deferredSession)
  const target = deferredSession.target

  const stats: { value: string; label: string }[] = []
  if (target?.procedureCount != null) stats.push({ value: String(target.procedureCount), label: t('函数', 'Functions') })
  if (target?.stringCount != null) stats.push({ value: String(target.stringCount), label: t('字符串', 'Strings') })
  if (target?.segmentCount != null) stats.push({ value: String(target.segmentCount), label: t('段', 'Segments') })
  if (target?.moduleCount != null) stats.push({ value: String(target.moduleCount), label: t('模块', 'Modules') })
  if (target?.ipcChannelCount != null) stats.push({ value: String(target.ipcChannelCount), label: t('IPC 通道', 'IPC channels') })

  function copyDossier(dossier: ReverseDossier) {
    void navigator.clipboard?.writeText(dossierTab === 'assembly' ? dossier.assembly.join('\n') : dossier.pseudocode)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto p-3 [&>*]:shrink-0" data-testid="reverse-rail-panel">
      <style>{panelCss}</style>

      {runningLabel ? (
        <div className="reverse-running flex items-center gap-2 rounded-md bg-card px-3 py-2 text-[12.5px] text-muted-foreground" data-testid="reverse-running">
          <span className="reverse-running__dot" aria-hidden />
          {runningLabel}
        </div>
      ) : null}

      {target ? (
        <section className="rounded-md bg-card p-3" data-testid="reverse-target-card">
          <div className="flex items-center gap-2.5">
            <span className="flex size-[34px] shrink-0 items-center justify-center rounded-[8px] border border-border bg-gradient-to-b from-muted to-card text-muted-foreground">
              {target.format === 'asar' || target.format === 'javascript' || target.format === 'source-map'
                ? <Boxes className="size-4" />
                : <Binary className="size-4" />}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="truncate text-[13.5px] font-medium text-foreground">{target.name}</span>
                {target.closed ? (
                  <Badge variant="outline" className="shrink-0 text-[10.5px]">{t('已关闭', 'closed')}</Badge>
                ) : null}
              </div>
              <div className="truncate font-mono text-[11px] text-muted-foreground" title={target.path}>{target.path}</div>
            </div>
          </div>
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {target.format ? <Badge variant="outline" className="text-[10.5px]">{target.format}</Badge> : null}
            {target.architecture ? <Badge variant="outline" className="text-[10.5px]">{target.architecture}</Badge> : null}
            {target.providerName ? (
              <Badge variant="outline" className="gap-1.5 text-[10.5px]">
                <span className="size-1 rounded-full bg-emerald-500" aria-hidden />
                {target.providerName}{target.providerVersion ? ` ${target.providerVersion}` : ''}
              </Badge>
            ) : null}
            {target.runId ? (
              <Badge variant="outline" className="font-mono text-[10.5px]" title={target.runId}>
                {t('运行', 'run')} {target.runId.slice(0, 8)}
              </Badge>
            ) : null}
          </div>
          {stats.length > 0 ? (
            <div className="mt-2.5 grid grid-cols-2 gap-x-3 gap-y-1.5 border-t border-border pt-2.5 sm:grid-cols-3">
              {stats.map(stat => (
                <div key={stat.label} className="min-w-0">
                  <div className="truncate text-[15px] font-medium tabular-nums text-foreground">{stat.value}</div>
                  <div className="truncate text-[11px] text-muted-foreground">{stat.label}</div>
                </div>
              ))}
            </div>
          ) : null}
        </section>
      ) : null}

      {deferredSession.traces.length > 0 ? (
        <section data-testid="reverse-trace">
          <SectionHeader icon={<Layers className="size-3.5" />} title={t('追踪', 'Trace')} />
          <div className="rounded-md bg-card px-3 py-2">
            {deferredSession.traces.slice(0, 3).map((trace, traceIndex) => (
              <div key={traceIndex} className={traceIndex > 0 ? 'mt-3 border-t border-border pt-2.5' : undefined}>
                <div className="mb-1.5 truncate text-[12.5px] font-medium text-foreground">{trace.title}</div>
                <ol className="flex flex-col gap-1">
                  {trace.steps.slice(0, 8).map((step, stepIndex) => (
                    <li key={stepIndex} className="flex min-w-0 items-center gap-2">
                      <span className="shrink-0 rounded-[5px] bg-muted px-1.5 py-0.5 font-mono text-[10px] tabular-nums text-muted-foreground">
                        {String(stepIndex + 1).padStart(2, '0')}
                      </span>
                      <span className="min-w-0 truncate font-mono text-[11.5px] text-foreground/85">{step.label}</span>
                      {step.detail ? <span className="hidden truncate text-[10.5px] text-muted-foreground sm:inline">{step.detail}</span> : null}
                      {stepIndex < Math.min(trace.steps.length, 8) - 1 ? (
                        <ChevronRight className="ml-auto size-3 shrink-0 text-muted-foreground/60" aria-hidden />
                      ) : null}
                    </li>
                  ))}
                </ol>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {deferredSession.hasTraffic ? (
        <section className="flex flex-col" data-testid="reverse-functions">
          <SectionHeader icon={<Binary className="size-3.5" />} title={t('函数', 'Functions')} count={functions.length} />
          <div className="rounded-md bg-card p-2">
            <div className="mb-1.5 flex items-center gap-2 rounded-[7px] border border-border/80 bg-card/60 px-2.5 py-1.5 backdrop-blur-xl">
              <Search className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <input
                className="w-full min-w-0 bg-transparent text-[12px] text-foreground outline-none placeholder:text-muted-foreground"
                placeholder={t('筛选函数', 'Filter functions')}
                value={query}
                onChange={event => setQuery(event.target.value)}
                data-testid="reverse-function-search"
              />
            </div>
            <FunctionList
              functions={functions}
              selectedAddress={selectedAddress || selectedDossier?.address || ''}
              onSelect={setSelectedAddress}
            />
          </div>

          {selectedDossier ? (
            <section className="mt-2.5 overflow-hidden rounded-md bg-card" data-testid="reverse-dossier">
              <div className="border-b border-border px-3 pb-2 pt-2.5">
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[12.5px] text-foreground">{selectedDossier.name}</span>
                  <button
                    type="button"
                    className="rounded-[6px] p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                    aria-label={t('复制', 'Copy')}
                    title={t('复制', 'Copy')}
                    onClick={() => copyDossier(selectedDossier)}
                  >
                    <Copy className="size-3.5" />
                  </button>
                </div>
                {selectedDossier.signature ? (
                  <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={selectedDossier.signature}>
                    {selectedDossier.signature}
                  </div>
                ) : null}
                <div className="mt-2 flex flex-col gap-2">
                  <ReferenceChips label={t('被调用 BY', 'Called by')} references={selectedDossier.callers} />
                  <ReferenceChips label={t('调用 TO', 'Calls')} references={selectedDossier.callees} />
                </div>
                <div className="mt-2 flex items-center gap-1">
                  <button
                    type="button"
                    className={cn(
                      'rounded-[6px] px-2 py-1 text-[11px] transition-colors',
                      dossierTab === 'pseudocode' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                    )}
                    onClick={() => setDossierTab('pseudocode')}
                  >
                    {t('伪代码', 'Pseudocode')}
                  </button>
                  {selectedDossier.assembly.length > 0 ? (
                    <button
                      type="button"
                      className={cn(
                        'rounded-[6px] px-2 py-1 text-[11px] transition-colors',
                        dossierTab === 'assembly' ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground',
                      )}
                      onClick={() => setDossierTab('assembly')}
                    >
                      {t('指令', 'Instructions')}
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="max-h-[340px] overflow-y-auto py-2">
                {dossierTab === 'pseudocode' ? (
                  selectedDossier.pseudocode ? (
                    <PseudocodeView code={selectedDossier.pseudocode} />
                  ) : (
                    <div className="px-3 py-4 text-[12px] text-muted-foreground">
                      {selectedDossier.bodyAvailable
                        ? t('此函数没有返回伪代码。', 'No pseudocode was returned for this function.')
                        : selectedDossier.bodyReason ?? t('此函数的函数体范围不可用。', 'Function body ranges are unavailable for this function.')}
                    </div>
                  )
                ) : (
                  <AssemblyView assembly={selectedDossier.assembly} />
                )}
                {selectedDossier.limitations.length > 0 ? (
                  <div className="mt-1 border-t border-border px-3 pt-2">
                    {selectedDossier.limitations.slice(0, 3).map((limitation, index) => (
                      <div key={index} className="py-0.5 text-[11px] leading-relaxed text-muted-foreground">{limitation}</div>
                    ))}
                  </div>
                ) : null}
                {selectedDossier.evidenceId ? (
                  <div className="mt-1 border-t border-border px-3 pt-2 font-mono text-[10.5px] text-muted-foreground">
                    {selectedDossier.evidenceId}
                  </div>
                ) : null}
              </div>
            </section>
          ) : null}
        </section>
      ) : null}

      <section data-testid="reverse-evidence">
        <SectionHeader icon={<FileSearch className="size-3.5" />} title={t('证据', 'Evidence')} count={deferredSession.evidence.length} />
        <div className={deferredSession.evidence.length > 0 ? 'rounded-md bg-card px-1 py-1' : 'hidden'}>
          {deferredSession.evidence.slice(0, 24).map((entry, index) => (
            <div
              key={entry.toolCallId}
              className="relative flex items-center gap-2.5 rounded-[7px] px-2.5 py-2 transition-colors hover:bg-muted/60"
              data-testid="reverse-evidence-row"
            >
              {index > 0 ? <span className="reverse-evidence__link" aria-hidden /> : null}
              <span className={cn(
                'flex size-[26px] shrink-0 items-center justify-center rounded-[7px] border border-border bg-muted',
                entry.isError ? 'text-destructive' : 'text-muted-foreground',
              )}>
                <FileSearch className="size-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-2">
                  <span className="min-w-0 truncate text-[12.5px] text-foreground">{entry.summary}</span>
                  {entry.confidence ? (
                    <span className="shrink-0 text-[10.5px] text-muted-foreground">{entry.confidence}</span>
                  ) : null}
                  {entry.oversized && !entry.isError ? (
                    <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[9.5px]">{t('截断', 'truncated')}</Badge>
                  ) : null}
                </span>
                <span className="mt-0.5 flex items-center gap-2">
                  {entry.evidenceId ? (
                    <span className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground">{entry.evidenceId}</span>
                  ) : (
                    <span className="min-w-0 truncate font-mono text-[10.5px] text-muted-foreground">{entry.operation}</span>
                  )}
                  {entry.parametersText && entry.parametersText !== '{}' ? (
                    <span className="hidden min-w-0 truncate font-mono text-[10.5px] text-muted-foreground/70 md:inline" title={entry.parametersText}>
                      {entry.parametersText.length > 60 ? `${entry.parametersText.slice(0, 60)}…` : entry.parametersText}
                    </span>
                  ) : null}
                </span>
              </span>
              <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                {formatRelativeAge(entry.receivedAt)}
              </span>
            </div>
          ))}
        </div>
      </section>

      {deferredSession.unknowns.length > 0 ? (
        <section data-testid="reverse-unknowns">
          <SectionHeader icon={<CircleHelp className="size-3.5" />} title={t('未知项', 'Unknowns')} count={deferredSession.unknowns.length} />
          <div className="rounded-md bg-card px-1 py-1">
            {deferredSession.unknowns.slice(0, 8).map((unknown, index) => (
              <div key={unknown.unknownId ?? index} className="flex items-start gap-2 rounded-[7px] px-2.5 py-2 transition-colors hover:bg-muted/60">
                <CircleHelp className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] leading-relaxed text-foreground/85">{unknown.question}</span>
                  {unknown.status || unknown.severity ? (
                    <span className="mt-1 inline-flex gap-1.5">
                      {unknown.status ? <Badge variant="outline" className="px-1.5 py-0 text-[9.5px]">{unknown.status}</Badge> : null}
                      {unknown.severity ? <Badge variant="outline" className="px-1.5 py-0 text-[9.5px]">{unknown.severity}</Badge> : null}
                    </span>
                  ) : null}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      {deferredSession.exports.length > 0 ? (
        <section data-testid="reverse-exports">
          <SectionHeader icon={<ArrowRight className="size-3.5" />} title={t('导出', 'Exports')} />
          <div className="rounded-md bg-card px-3 py-2.5">
            {deferredSession.exports.slice(0, 3).map((receipt, index) => (
              <div key={index} className="flex items-baseline justify-between gap-3">
                <span className="min-w-0 truncate font-mono text-[11.5px] text-foreground/85" title={receipt.path}>{receipt.path}</span>
                <span className="shrink-0 text-[10.5px] tabular-nums text-muted-foreground">
                  {receipt.records} {t('条', 'records')} · {formatRelativeAge(receipt.receivedAt)}
                </span>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  )
}

const panelCss = `
.reverse-running__dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: currentColor;
  flex: none;
}
@media (prefers-reduced-motion: no-preference) {
  .reverse-running {
    position: relative;
    overflow: hidden;
  }
  .reverse-running::after {
    content: "";
    position: absolute;
    inset: 0;
    width: 55%;
    background: linear-gradient(90deg, transparent 0%, color-mix(in srgb, currentColor 8%, transparent) 50%, transparent 100%);
    transform: translateX(-100%);
    animation: reverse-sweep 1.7s cubic-bezier(0.65, 0, 0.35, 1) infinite;
    pointer-events: none;
  }
}
@keyframes reverse-sweep {
  0% { transform: translateX(-80%); }
  100% { transform: translateX(260%); }
}

.reverse-code__line {
  display: flex;
  padding: 0 10px 0 0;
  white-space: pre;
}
.reverse-code__lineno {
  flex: none;
  width: 30px;
  padding-right: 10px;
  text-align: right;
  color: color-mix(in srgb, currentColor 38%, transparent);
  font-size: 10.5px;
  user-select: none;
}
.reverse-code__text {
  min-width: 0;
  flex: 1;
}

.reverse-evidence__link {
  position: absolute;
  left: 15px;
  top: -8px;
  height: 16px;
  border-left: 1px solid var(--border);
}
`
