import { Archive } from 'lucide-react'
import { Badge, Button, SettingsSection } from '@/components/ui'
import MarkdownContent from '@/components/MarkdownContent'
import { redactProviderCredentials } from '@/lib/redaction'
import { useT } from '@/hooks/useUiLocale'
import type { CTFTrainingMemory, CTFTrainingMemoryEvidenceLink } from '@/ctfTypes'

export default function CTFMemoryRecall({
  memories,
  loading = false,
  onArchive,
  onInspectEvidence,
}: {
  memories: CTFTrainingMemory[]
  loading?: boolean
  onArchive?: (memory: CTFTrainingMemory) => void
  onInspectEvidence?: (evidence: CTFTrainingMemoryEvidenceLink) => void
}) {
  const t = useT()

  function verificationLabel(memory: CTFTrainingMemory) {
    if (memory.verification === 'judge-verified') return t('Judge 验证', 'Judge verified')
    if (memory.verification === 'user-confirmed') return t('用户确认', 'User confirmed')
    if (memory.verification === 'failure-observed') return t('失败观察', 'Failure observed')
    return t('旧记录 · 未分级', 'Legacy · ungraded')
  }

  function actorLabel(memory: CTFTrainingMemory) {
    if (memory.actor === 'user') return t('用户完成', 'Completed by user')
    if (memory.actor === 'agent') return t('Agent 代做', 'Completed by Agent')
    if (memory.actor === 'shared') return t('共同完成', 'Completed together')
    return t('贡献不可追溯', 'Attribution unknown')
  }

  function assistanceLabel(memory: CTFTrainingMemory) {
    if (memory.assistance === 'none') return t('无协助', 'No assistance')
    if (memory.assistance === 'hint') return t('依赖提示', 'Used hints')
    if (memory.assistance === 'copilot') return t('搭档协作', 'Copilot collaboration')
    return t('代理/未归属', 'Delegate / unattributed')
  }

  function fallbackEvidence(ref: string) {
    const separator = ref.indexOf(':')
    const kind = separator > 0 ? ref.slice(0, separator) : 'evidence'
    const id = separator > 0 ? ref.slice(separator + 1) : ref
    return { kind, id, label: ref }
  }

  function evidenceLinks(memory: CTFTrainingMemory) {
    return memory.recall?.evidence?.length
      ? memory.recall.evidence
      : memory.evidenceRefs.slice(0, 8).map(fallbackEvidence)
  }

  function redactMemoryText(value: string) {
    return redactProviderCredentials(value)
  }

  function redactedEvidence(evidence: CTFTrainingMemoryEvidenceLink) {
    return {
      ...evidence,
      kind: redactMemoryText(evidence.kind),
      id: redactMemoryText(evidence.id),
      label: redactMemoryText(evidence.label),
    }
  }

  return (
    <SettingsSection
      title={t('解题记忆', 'Solving memory')}
      actions={memories.length ? <Badge variant="outline">{memories.length}</Badge> : null}
    >
      <div className="px-5 py-4">
        <p className="text-caption text-muted-foreground">
          {loading
            ? t('正在匹配', 'Matching')
            : memories.length
              ? t(`${memories.length} 条待验证先验`, `${memories.length} priors pending verification`)
              : t('没有匹配的旧题技法', 'No matching prior techniques')}
        </p>
        {memories.length ? (
          <div className="space-y-3">
            {memories.map(memory => (
              <article key={memory.id} className="rounded-lg bg-muted/40 p-3">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-1 text-control font-medium">{redactMemoryText(memory.title)}</p>
                    <MarkdownContent
                      className="mt-1 line-clamp-3 text-caption leading-5 text-muted-foreground"
                      content={redactMemoryText(memory.summary)}
                      compact
                    />
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    title={t('停用', 'Disable')}
                    aria-label={t(`停用记忆：${redactMemoryText(memory.title)}`, `Disable memory: ${redactMemoryText(memory.title)}`)}
                    onClick={() => onArchive?.(memory)}
                  >
                    <Archive className="size-3.5" />
                  </Button>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5">
                  <Badge variant="outline">{verificationLabel(memory)}</Badge>
                  <Badge variant="outline">{actorLabel(memory)} · {assistanceLabel(memory)}</Badge>
                  <Badge variant="outline">{t(`置信 ${Math.round(memory.confidence * 100)}%`, `Confidence ${Math.round(memory.confidence * 100)}%`)}</Badge>
                  {memory.tags.slice(0, 2).map(tag => (
                    <Badge key={tag} variant="secondary">{redactMemoryText(tag)}</Badge>
                  ))}
                </div>
                {memory.recall?.reasons?.length || evidenceLinks(memory).length ? (
                  <div className="mt-3 rounded-md border border-border bg-background/60 p-2 text-caption leading-5 text-muted-foreground">
                    {memory.recall?.reasons?.length ? (
                      <p>
                        {t(`推荐依据：${memory.recall.reasons.slice(0, 2).join('；')}`, `Recall reasons: ${memory.recall.reasons.slice(0, 2).join('; ')}`)}
                      </p>
                    ) : null}
                    {evidenceLinks(memory).length ? (
                      <p className="mt-1">
                        {t('可核对证据：', 'Checkable evidence:')}
                        {evidenceLinks(memory).slice(0, 4).map((evidence, index) => {
                          const redacted = redactedEvidence(evidence)
                          return (
                            <button
                              key={`${evidence.kind}:${evidence.id}`}
                              type="button"
                              className="rounded-sm text-left underline decoration-dotted underline-offset-2 transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                              title={`${redacted.kind}:${redacted.id}`}
                              data-evidence-kind={redacted.kind}
                              data-evidence-id={redacted.id}
                              onClick={() => onInspectEvidence?.(redacted)}
                            >
                              {index ? '；' : null}{redacted.label}
                            </button>
                          )
                        })}
                      </p>
                    ) : null}
                  </div>
                ) : null}
              </article>
            ))}
          </div>
        ) : null}
      </div>
    </SettingsSection>
  )
}
