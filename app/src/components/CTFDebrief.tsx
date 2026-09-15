import { useEffect, useMemo, useState } from 'react'
import { Badge, Button, SettingsSection, Textarea } from '@/components/ui'
import {
  BrainCircuit,
  Check,
  Circle,
  Copy,
  FileCheck2,
  Handshake,
  Lightbulb,
  LoaderCircle,
  Route,
  Sparkles,
  UserRoundCheck,
  X,
} from 'lucide-react'
import type {
  CTFDebrief,
  CTFHumanOutcome,
  CTFLearningActor,
  CTFLearningAssistance,
} from '@/ctfTypes'
import MarkdownContent from '@/components/MarkdownContent'
import { useT } from '@/hooks/useUiLocale'

export default function CTFDebriefPanel({
  debrief,
  humanOutcome,
  submitting,
  onSubmitIndependentStep,
  onSubmitReflection,
  onSaveMemory,
}: {
  debrief: CTFDebrief
  humanOutcome: CTFHumanOutcome
  submitting?: boolean
  onSubmitIndependentStep?: (content: string) => void
  onSubmitReflection?: (content: string) => void
  onSaveMemory?: () => void
}) {
  const t = useT()
  const [independentStep, setIndependentStep] = useState('')
  const [independentStepConfirmed, setIndependentStepConfirmed] = useState(false)
  const [submittedAtStepCount, setSubmittedAtStepCount] = useState<number | null>(null)
  const [reflection, setReflection] = useState('')
  const [submittedAtCount, setSubmittedAtCount] = useState<number | null>(null)
  const [copyNotice, setCopyNotice] = useState('')

  function userFacingDebriefText(value: string) {
    const text = value.trim()
    if (/CTF engine propose|engine propose|context deadline exceeded|unavailable capability|i\/o timeout/i.test(text)) {
      return t('这一步没有完成', 'This step did not complete')
    }
    return text
  }

  const visibleFailureBranches = useMemo(() => (
    [...new Set(debrief.failureBranches.map(userFacingDebriefText).filter(Boolean))]
  ), [debrief.failureBranches, t])

  const canSaveMemory = debrief.status !== 'in_progress' && debrief.reflectionCount > 0

  function actorLabel(actor: CTFLearningActor) {
    switch (actor) {
      case 'user': return t('用户', 'User')
      case 'agent': return 'Agent'
      case 'shared': return t('用户与 Agent 共同完成', 'Completed together by user and Agent')
      default: return t('尚无可归属证据', 'No attributable evidence yet')
    }
  }

  function assistanceLabel(assistance: CTFLearningAssistance) {
    switch (assistance) {
      case 'none': return t('无协助', 'No assistance')
      case 'hint': return t('依赖提示', 'Used hints')
      case 'copilot': return t('搭档协作', 'Copilot collaboration')
      default: return t('代理完成', 'Delegate completed')
    }
  }

  function statusLabel(status: CTFDebrief['status']) {
    switch (status) {
      case 'succeeded': return t('已完成', 'Completed')
      case 'failed': return t('未完成', 'Not completed')
      case 'cancelled': return t('已中断', 'Interrupted')
      default: return t('进行中', 'In progress')
    }
  }

  function verdictLabel(verdict: string) {
    switch (verdict) {
      case 'pass': return 'Accepted'
      case 'fail': return 'Rejected'
      case 'needs_review': return t('待平台确认', 'Awaiting platform confirmation')
      default: return verdict || t('未判定', 'Not judged')
    }
  }

  const handoffSummary = [
    t('# MilkSU CTF 复盘接力棒', '# MilkSU CTF debrief handoff'),
    t(`- 状态：${statusLabel(debrief.status)}`, `- Status: ${statusLabel(debrief.status)}`),
    t(
      `- Judge：${debrief.candidates.at(-1) ? verdictLabel(debrief.candidates.at(-1)?.verdict ?? '') : t('未判定', 'Not judged')}`,
      `- Judge: ${debrief.candidates.at(-1) ? verdictLabel(debrief.candidates.at(-1)?.verdict ?? '') : t('未判定', 'Not judged')}`,
    ),
    t(
      `- 证据：${debrief.evidenceCount} 条；制品 ${debrief.artifactCount} 个；候选 ${debrief.candidates.length} 个`,
      `- Evidence: ${debrief.evidenceCount}; artifacts ${debrief.artifactCount}; candidates ${debrief.candidates.length}`,
    ),
    t(
      `- 贡献归属：${actorLabel(humanOutcome.contribution.primaryActor)}；${assistanceLabel(humanOutcome.contribution.assistance)}`,
      `- Attribution: ${actorLabel(humanOutcome.contribution.primaryActor)}; ${assistanceLabel(humanOutcome.contribution.assistance)}`,
    ),
    t(
      `- 用户步骤：独立 ${humanOutcome.contribution.userIndependentSteps}；协助 ${humanOutcome.contribution.userAssistedSteps}`,
      `- User steps: independent ${humanOutcome.contribution.userIndependentSteps}; assisted ${humanOutcome.contribution.userAssistedSteps}`,
    ),
    t(
      `- Agent/导入记录：Agent ${humanOutcome.contribution.agentRecords}；导入 ${humanOutcome.contribution.importedRecords}`,
      `- Agent/imported records: Agent ${humanOutcome.contribution.agentRecords}; imported ${humanOutcome.contribution.importedRecords}`,
    ),
    t(
      `- 提示依赖：${debrief.hintCount}；复盘 ${debrief.reflectionCount}`,
      `- Hint dependence: ${debrief.hintCount}; debrief ${debrief.reflectionCount}`,
    ),
    t(
      `- 推荐下一步：${debrief.recommendedNextAction}`,
      `- Recommended next: ${debrief.recommendedNextAction}`,
    ),
  ].join('\n')

  function submit(event: React.FormEvent) {
    event.preventDefault()
    const content = reflection.trim()
    if (!content) return
    setSubmittedAtCount(debrief.reflectionCount)
    onSubmitReflection?.(content)
  }

  function submitIndependentStep(event: React.FormEvent) {
    event.preventDefault()
    const content = independentStep.trim()
    if (!content || !independentStepConfirmed) return
    setSubmittedAtStepCount(
      humanOutcome.contribution.userIndependentSteps + humanOutcome.contribution.userAssistedSteps,
    )
    onSubmitIndependentStep?.(content)
  }

  async function copyHandoffSummary() {
    setCopyNotice('')
    try {
      if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
      await navigator.clipboard.writeText(handoffSummary)
      setCopyNotice(t('已复制', 'Copied'))
    } catch {
      setCopyNotice(t('复制失败，请手动选择摘要', 'Copy failed; select the summary manually'))
    }
  }

  useEffect(() => {
    if (submittedAtCount !== null && debrief.reflectionCount > submittedAtCount) {
      setReflection('')
      setSubmittedAtCount(null)
    }
  }, [debrief.reflectionCount, submittedAtCount])

  useEffect(() => {
    const count = humanOutcome.contribution.userIndependentSteps + humanOutcome.contribution.userAssistedSteps
    if (submittedAtStepCount !== null && count > submittedAtStepCount) {
      setIndependentStep('')
      setIndependentStepConfirmed(false)
      setSubmittedAtStepCount(null)
    }
  }, [humanOutcome.contribution.userIndependentSteps, humanOutcome.contribution.userAssistedSteps, submittedAtStepCount])

  return (
    <SettingsSection
      title={t('证据复盘', 'Evidence debrief')}
      aria-labelledby="debrief-title"
      actions={(
        <Badge variant={debrief.status === 'failed' ? 'destructive' : 'outline'}>
          {statusLabel(debrief.status)}
        </Badge>
      )}
    >
      <div className="px-5 py-5">
        <MarkdownContent className="mt-5 text-body leading-6" content={debrief.summary} />

        <div className="mt-5 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <p className="text-caption text-muted-foreground">{t('证据', 'Evidence')}</p>
            <p className="mt-1 font-mono text-control">{debrief.evidenceCount}</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <p className="text-caption text-muted-foreground">{t('制品', 'Artifacts')}</p>
            <p className="mt-1 font-mono text-control">{debrief.artifactCount}</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <p className="text-caption text-muted-foreground">{t('用户独立步骤', 'Independent user steps')}</p>
            <p className="mt-1 font-mono text-control">{debrief.independentSteps}</p>
          </div>
          <div className="rounded-lg bg-muted/50 px-3 py-2">
            <p className="text-caption text-muted-foreground">{t('提示', 'Hints')}</p>
            <p className="mt-1 font-mono text-control">{debrief.hintCount}</p>
          </div>
        </div>

        <div className="mt-5 rounded-lg border border-border bg-muted/20 p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="flex items-center gap-2 text-control font-medium">
                <Handshake className="size-3.5" />
                {t('贡献归属', 'Attribution')}
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline">{actorLabel(humanOutcome.contribution.primaryActor)}</Badge>
              <Badge variant="secondary">{assistanceLabel(humanOutcome.contribution.assistance)}</Badge>
            </div>
          </div>
          <p className="mt-3 text-caption leading-5 text-muted-foreground">
            {t(`用户独立 ${humanOutcome.contribution.userIndependentSteps} 步 · 用户在协助下 ${humanOutcome.contribution.userAssistedSteps} 步 · Agent 记录 ${humanOutcome.contribution.agentRecords} 条 · 旧记录/导入 ${humanOutcome.contribution.importedRecords} 条`, `Independent user steps ${humanOutcome.contribution.userIndependentSteps} · assisted user steps ${humanOutcome.contribution.userAssistedSteps} · Agent records ${humanOutcome.contribution.agentRecords} · imported records ${humanOutcome.contribution.importedRecords}`)}
          </p>
        </div>

        <div className="mt-6 grid gap-5 md:grid-cols-2">
          <div>
            <h3 className="flex items-center gap-2 text-control font-medium">
              <FileCheck2 className="size-3.5" />
              {t('关键观察', 'Key observations')}
            </h3>
            {debrief.keyObservations.length ? (
              <ul className="mt-3 space-y-2">
                {debrief.keyObservations.map(item => (
                  <li key={item} className="flex gap-2 text-caption leading-5 text-muted-foreground">
                    <Check className="mt-0.5 size-3.5 shrink-0 text-primary" />
                    <MarkdownContent className="min-w-0 flex-1" content={item} compact />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
          <div>
            <h3 className="flex items-center gap-2 text-control font-medium">
              <Route className="size-3.5" />
              {t('失败分支', 'Failed branches')}
            </h3>
            {visibleFailureBranches.length ? (
              <ul className="mt-3 space-y-2">
                {visibleFailureBranches.map(item => (
                  <li key={item} className="flex gap-2 text-caption leading-5 text-muted-foreground">
                    <X className="mt-0.5 size-3.5 shrink-0 text-destructive" />
                    <MarkdownContent className="min-w-0 flex-1" content={item} compact />
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>

        {debrief.candidates.length ? (
          <div className="mt-6 border-t border-border pt-5">
            <h3 className="text-control font-medium">{t('候选历史', 'Candidate history')}</h3>
            <div className="mt-3 space-y-2">
              {debrief.candidates.map((candidate, index) => (
                <div key={`${candidate.candidate}-${index}`} className="rounded-lg border border-border px-3 py-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <code className="break-all text-caption">{candidate.candidate}</code>
                    <Badge variant={candidate.verdict === 'fail' ? 'destructive' : 'outline'}>
                      {verdictLabel(candidate.verdict)}
                    </Badge>
                  </div>
                  {candidate.summary ? (
                    <MarkdownContent
                      className="mt-1 text-caption leading-5 text-muted-foreground"
                      content={candidate.summary}
                      compact
                    />
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {debrief.knowledgePoints.length ? (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-border pt-5">
            {debrief.knowledgePoints.map(point => (
              <Badge key={point} variant="secondary">{point}</Badge>
            ))}
          </div>
        ) : null}

        <div className="mt-6 rounded-lg border border-primary/20 bg-primary/5 p-4">
          <p className="flex items-center gap-2 text-control font-medium">
            <Sparkles className="size-3.5 text-primary" />
            {t('推荐下一步', 'Recommended next step')}
          </p>
          <MarkdownContent
            className="mt-1 text-caption leading-5 text-muted-foreground"
            content={debrief.recommendedNextAction}
            compact
          />
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-3"
            disabled={submitting || !canSaveMemory}
            onClick={onSaveMemory}
          >
            {submitting ? <LoaderCircle className="size-3.5 animate-spin" /> : <BrainCircuit className="size-3.5" />}
            {t('沉淀为可复用技法', 'Save as a reusable technique')}
          </Button>
        </div>

        <details className="mt-6 rounded-lg border border-border bg-muted/20 px-3 py-2">
          <summary className="cursor-pointer text-caption font-medium text-muted-foreground">
            {t('复盘接力棒', 'Debrief handoff')}
          </summary>
          <pre className="mt-2 max-h-52 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background px-3 py-2 font-mono text-caption leading-5">{handoffSummary}</pre>
          <div className="mt-2 flex items-center justify-between gap-2">
            {copyNotice ? <span className="text-caption text-muted-foreground">{copyNotice}</span> : null}
            <Button type="button" variant="outline" size="sm" onClick={() => { void copyHandoffSummary() }}>
              <Copy className="size-3.5" />
              {t('复制复盘摘要', 'Copy debrief summary')}
            </Button>
          </div>
        </details>

        <form className="mt-6 border-t border-border pt-5" onSubmit={submitIndependentStep}>
          <p className="flex items-center gap-2 text-control font-medium">
            <UserRoundCheck className="size-3.5" />
            {t('记录我实际完成的步骤', 'Record a step I actually completed')}
          </p>
          <Textarea
            value={independentStep}
            onChange={event => setIndependentStep(event.target.value)}
            className="mt-3"
            placeholder={t('例如：我手动比较了两组响应长度，确认第四个字节会改变校验分支……', 'Example: I compared two response lengths and confirmed the fourth byte changes the checksum branch…')}
          />
          <label className="mt-3 flex cursor-pointer items-start gap-2 text-caption leading-5 text-muted-foreground">
            <input
              checked={independentStepConfirmed}
              onChange={event => setIndependentStepConfirmed(event.target.checked)}
              type="checkbox"
              className="mt-0.5 size-4 rounded border-border accent-primary"
            />
            <span>{t('我确认这是我实际完成的步骤，而不是 Agent 自动生成的描述。', 'I confirm this is a step I actually completed, not a description generated by the Agent.')}</span>
          </label>
          <Button
            type="submit"
            variant="outline"
            className="mt-3"
            disabled={submitting || !independentStep.trim() || !independentStepConfirmed}
          >
            {submitting ? <LoaderCircle className="size-3.5 animate-spin" /> : <UserRoundCheck className="size-3.5" />}
            {t('保存用户步骤', 'Save user step')}
          </Button>
        </form>

        {debrief.needsReflection ? (
          <form className="mt-6 border-t border-border pt-5" onSubmit={submit}>
            <p className="flex items-center gap-2 text-control font-medium">
              <Lightbulb className="size-3.5" />
              {t('用你自己的话完成复盘', 'Write the debrief in your own words')}
            </p>
            <Textarea
              value={reflection}
              onChange={event => setReflection(event.target.value)}
              className="mt-3"
              placeholder={t('例如：我一开始把输入当作编码题，直到 strings 的输出证明它更像逆向题……', 'Example: I first treated this as an encoding challenge until strings output showed it was closer to reverse engineering…')}
            />
            <Button type="submit" className="mt-2" disabled={submitting || !reflection.trim()}>
              {submitting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Circle className="size-3.5" />}
              {t('保存复盘', 'Save debrief')}
            </Button>
          </form>
        ) : null}
      </div>
    </SettingsSection>
  )
}
