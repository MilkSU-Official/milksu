import { useMemo } from 'react'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
  Input,
  SettingsSection,
} from '@/components/ui'
import { Check, Circle, LoaderCircle, RotateCcw, Send } from 'lucide-react'
import MarkdownContent from '@/components/MarkdownContent'
import { redactProviderCredentials } from '@/lib/redaction'
import { useT } from '@/hooks/useUiLocale'
import type { CTFProjection } from '@/ctfTypes'

export default function CTFSubmissionGate({
  projection,
  working,
  canContinue,
  activeStartCost,
  activeBrowserCanSubmit,
  ctfshowBridgeReady,
  platformReview,
  externalJudgeLabel,
  candidate,
  onCandidateChange,
  onSubmit,
  onRecordPlatformResult,
}: {
  projection: CTFProjection
  working: boolean
  canContinue: boolean
  activeStartCost: number
  activeBrowserCanSubmit: boolean
  ctfshowBridgeReady: boolean
  platformReview: boolean
  externalJudgeLabel: string
  candidate: string
  onCandidateChange?: (value: string) => void
  onSubmit?: () => void
  onRecordPlatformResult?: (accepted: boolean) => void
}) {
  const t = useT()
  const isArenaWorkspace = projection.challenge.externalPlatform === 'nssctf-agent-arena'
  const isWebWorkspace = projection.challenge.externalPlatform === 'nssctf-web'
  const isCTFShowWorkspace = projection.challenge.externalPlatform === 'ctfshow-web'
  const activeAgentCandidate = useMemo(() => {
    const value = projection.agentCandidates.at(-1)
    if (!value || value.candidate !== candidate.trim()) return null
    return value
  }, [projection.agentCandidates, candidate])
  const matchingSubmission = useMemo(() => {
    const value = candidate.trim()
    if (!value) return null
    return projection.submissions.find(submission => submission.candidate === value) ?? null
  }, [candidate, projection.submissions])
  const matchingSubmissionMessage = useMemo(() => {
    switch (matchingSubmission?.verdict) {
      case 'pass':
        return t('这个候选已经被平台确认 Accepted，无需再次提交。', 'This candidate has already been Accepted by the platform; no need to submit again.')
      case 'fail':
        return t('这个候选已被平台拒绝，请修改后再提交。', 'This candidate was Rejected by the platform; change it before submitting again.')
      case 'needs_review':
        return t('这个候选正在等待平台判题，不能并发重复提交。', 'This candidate is waiting for a platform verdict; do not submit it again in parallel.')
      case 'inconclusive':
        return t('上次没有得到明确回执。你可以安全重试同一候选，或在平台页面核对后手动记录结果。', 'The last attempt did not return a clear receipt. You can safely retry the same candidate, or record the result after checking the platform page.')
      default:
        return ''
    }
  }, [matchingSubmission, t])
  const matchingSubmissionBlocks = matchingSubmission?.verdict === 'pass'
    || matchingSubmission?.verdict === 'fail'
    || matchingSubmission?.verdict === 'needs_review'

  function redacted(value: string) {
    return redactProviderCredentials(value)
  }

  return (
    <SettingsSection title={t('提交候选', 'Submit candidate')} aria-labelledby="ctf-submission-title">
      <div className="px-5 py-5">
        <h2 id="ctf-submission-title" className="sr-only">{t('提交候选', 'Submit candidate')}</h2>
        <p className="mt-1 text-caption leading-5 text-muted-foreground">
          {isArenaWorkspace
            ? t('由 Arena API 判题。', 'Judged by the Arena API.')
            : isCTFShowWorkspace
              ? t('通过已绑定的 CTFshow 标签页提交。', 'Submit through the bound CTFshow tab.')
              : isWebWorkspace
                ? t('通过已绑定的 NSSCTF 标签页提交。', 'Submit through the bound NSSCTF tab.')
                : t('复制到外部平台提交后，回来记录结果。', 'Copy to the external platform to submit, then come back to record the result.')}
        </p>
        {activeStartCost ? (
          <p className="mt-3 rounded-md border border-border bg-muted/50 px-3 py-2 text-caption leading-5">
            {t(`题目需先在 NSSCTF 开启环境（${activeStartCost} 金币），开启后点“检测连接”。`, `Start the challenge environment on NSSCTF first (${activeStartCost} coins), then click Check connection.`)}
          </p>
        ) : null}
        <Input
          value={candidate}
          onChange={event => onCandidateChange?.(event.target.value)}
          className="mt-4 font-mono"
          placeholder="flag{...}"
        />
        {matchingSubmissionMessage ? (
          <Alert className="mt-3">
            <RotateCcw className="size-4" />
            <AlertDescription>{matchingSubmissionMessage}</AlertDescription>
          </Alert>
        ) : null}
        {activeAgentCandidate && !projection.submissions.length ? (
          <div className="mt-3 rounded-lg border border-border bg-muted/50 px-3 py-2 text-caption leading-5">
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-medium">{t('Agent 候选已载入', 'Agent candidate loaded')}</span>
              <Badge variant={activeAgentCandidate.assessment.status === 'unusual' ? 'destructive' : 'secondary'}>
                {activeAgentCandidate.assessment.status === 'unusual' ? t('格式需要确认', 'Format needs confirmation') : t('格式正常', 'Format looks valid')}
              </Badge>
            </div>
            <p className="mt-1 line-clamp-4 text-muted-foreground">
              {redacted(activeAgentCandidate.explanation)}
            </p>
            {activeAgentCandidate.assessment.warnings.length ? (
              <ul className="mt-2 space-y-1 border-t border-border pt-2 text-destructive">
                {activeAgentCandidate.assessment.warnings.map(warning => (
                  <li key={warning} className="flex items-start gap-1.5">
                    <Circle className="mt-1 size-2 shrink-0 fill-current" />
                    <span>{redacted(warning)}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}
        <Button
          className="mt-3 w-full"
          disabled={working || !candidate.trim()
            || !canContinue
            || matchingSubmissionBlocks
            || (isWebWorkspace && !activeBrowserCanSubmit)
            || (isCTFShowWorkspace && !ctfshowBridgeReady)}
          onClick={onSubmit}
        >
          {working ? <LoaderCircle className="size-4 animate-spin" /> : <Send className="size-4" />}
          {isWebWorkspace && activeStartCost
            ? t('等待你在 NSSCTF 开启题目', 'Waiting for you to start the challenge on NSSCTF')
            : isCTFShowWorkspace
              ? t('提交到 CTFshow', 'Submit to CTFshow')
              : isWebWorkspace
                ? t('提交到 NSSCTF', 'Submit to NSSCTF')
                : t('提交候选', 'Submit candidate')}
        </Button>

        {projection.judgeReceipts.length ? (
          <div className="mt-4 rounded-lg bg-muted/50 p-3">
            <div className="flex items-center justify-between gap-3 text-caption">
              <span className="font-medium">{t('最新 Judge 回执', 'Latest Judge receipt')}</span>
              <Badge variant="outline">{projection.judgeReceipts.at(-1)?.status}</Badge>
            </div>
            <MarkdownContent
              className="mt-2 line-clamp-3 text-caption leading-5 text-muted-foreground"
              content={redacted(projection.judgeReceipts.at(-1)?.summary ?? '')}
              compact
            />
          </div>
        ) : null}

        {platformReview && (!isWebWorkspace || projection.evaluations.at(-1)?.verdict === 'inconclusive') ? (
          <div className="mt-4 border-t border-border pt-4">
            <p className="text-caption font-medium">{t(`${redacted(externalJudgeLabel)}的结果是？`, `What was the result from ${redacted(externalJudgeLabel)}?`)}</p>
            <div className="mt-3 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => onRecordPlatformResult?.(false)}>
                <RotateCcw className="size-4" />
                Rejected
              </Button>
              <Button className="flex-1" onClick={() => onRecordPlatformResult?.(true)}>
                <Check className="size-4" />
                Accepted
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </SettingsSection>
  )
}
