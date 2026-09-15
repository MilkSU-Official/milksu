import { useEffect, useMemo, useRef, useState } from 'react'
import { Button } from '@/components/ui'
import { invokeCommand } from '@/desktop'
import {
  Check,
  Copy,
  FileText,
  GitFork,
  Pencil,
  RotateCcw,
  Undo2,
  X,
} from 'lucide-react'
import AgentPixelLoader from '@/components/AgentPixelLoader'
import MarkdownContent from '@/components/MarkdownContent'
import { formatDemoElapsed, messageSourceChips } from '@/lib/agentConversation'
import { redactProviderCredentials } from '@/lib/redaction'
import { isBlankAssistantMessage } from '@/lib/chatActivity'
import {
  askOtherChoiceId,
  encodeAskOtherChoice,
  isAskMessage,
  parseAskOptions,
} from '@/lib/agentAsk'
import { toolBudgetToolName } from '@/lib/toolBudget'
import { assessApprovalRequest, type DestructiveAssessment, type DestructiveFacts } from '@/lib/destructiveTarget'
import { useT } from '@/hooks/useUiLocale'
import type { CodingAttachment, CodingAttachmentPreview, Message } from '@/types'

const THINKING_COLLAPSE_CHARS = 300
const THINKING_COLLAPSE_ROWS = 3

function countThinkingRows(text: string) {
  let rows = 0
  for (const line of text.split('\n')) {
    if (line.trim()) rows += 1
  }
  return rows
}

export default function ChatMessageItem({
  message,
  recoverable,
  recoveryContext,
  canRewind,
  rewindDisabled,
  kernel,
  thinkingTotal,
  onRespondApproval,
  onRetry,
  onEditUser,
  onRewindContext,
  onBranchAssistant,
}: {
  message: Message
  recoverable?: boolean
  recoveryContext?: 'coding' | 'ctf'
  canRewind?: boolean
  rewindDisabled?: boolean
  kernel?: 'pi' | 'dsh'
  thinkingTotal?: boolean
  onRespondApproval?: (requestId: string, approved: boolean, scope?: 'once' | 'conversation', choice?: string) => void
  onRetry?: () => void
  onEditUser?: (messageId: string, content: string) => void
  onRewindContext?: () => void
  onBranchAssistant?: (messageId: string) => void
}) {
  const t = useT()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const [approvalPinned, setApprovalPinned] = useState(false)
  const [imagePreviewUrls, setImagePreviewUrls] = useState<Record<string, string>>({})
  const attachmentLightbox = useRef<HTMLDialogElement | null>(null)
  const [lightboxPreview, setLightboxPreview] = useState<CodingAttachmentPreview | null>(null)
  const copyReset = useRef(0)
  const previewLoad = useRef(0)
  const [otherDraft, setOtherDraft] = useState(
    message.approvalChoiceId === askOtherChoiceId
      ? String(message.approvalReason ?? '')
      : '',
  )
  const [thinkingNow, setThinkingNow] = useState(Date.now())
  const [lastOutputAt, setLastOutputAt] = useState(Date.now())
  const [thinkManual, setThinkManual] = useState<boolean | null>(null)
  const [replyNow, setReplyNow] = useState(Date.now())
  const [destructiveAssessment, setDestructiveAssessment] = useState<DestructiveAssessment | null>(null)
  const [measuredFacts, setMeasuredFacts] = useState<DestructiveFacts[]>([])

  function isImageAttachment(attachment: CodingAttachment) {
    return attachment.mediaType.startsWith('image/')
  }

  function attachmentKey(attachment: CodingAttachment) {
    return attachment.sha256 || attachment.id
  }

  const imageAttachments = useMemo(() => (
    (message.attachments ?? []).filter(isImageAttachment)
  ), [message.attachments])
  const fileAttachments = useMemo(() => (
    (message.attachments ?? []).filter(attachment => !isImageAttachment(attachment))
  ), [message.attachments])

  function imagePreviewUrl(attachment: CodingAttachment) {
    return imagePreviewUrls[attachmentKey(attachment)] ?? ''
  }

  useEffect(() => {
    const images = imageAttachments
    if (!images.length) return
    const load = ++previewLoad.current
    void (async () => {
      const next = { ...imagePreviewUrls }
      await Promise.all(images.map(async attachment => {
        const key = attachmentKey(attachment)
        if (next[key]) return
        try {
          const preview = await invokeCommand<CodingAttachmentPreview>(
            'preview_coding_attachment',
            { attachment },
          )
          if (load !== previewLoad.current) return
          if (preview.kind === 'image' && preview.dataUrl) next[key] = preview.dataUrl
        } catch {
          // Keep the filename chip when the stored image cannot be read.
        }
      }))
      if (load === previewLoad.current) setImagePreviewUrls(next)
    })()
  }, [imageAttachments])

  function openAttachmentLightbox() {
    const dialog = attachmentLightbox.current
    if (!dialog) return
    if (typeof dialog.showModal === 'function') dialog.showModal()
    else dialog.setAttribute('open', '')
  }

  function closeAttachmentPreview() {
    setLightboxPreview(null)
    const dialog = attachmentLightbox.current
    if (!dialog) return
    if (typeof dialog.close === 'function') dialog.close()
    else dialog.removeAttribute('open')
  }

  async function openAttachmentPreview(attachment: CodingAttachment) {
    const cached = imagePreviewUrl(attachment)
    if (cached) {
      setLightboxPreview({
        name: attachment.name,
        mediaType: attachment.mediaType,
        size: attachment.size,
        kind: 'image',
        dataUrl: cached,
      })
      openAttachmentLightbox()
      return
    }
    try {
      const preview = await invokeCommand<CodingAttachmentPreview>(
        'preview_coding_attachment',
        { attachment },
      )
      setLightboxPreview(preview)
      if (preview.kind === 'image' && preview.dataUrl) {
        setImagePreviewUrls(current => ({
          ...current,
          [attachmentKey(attachment)]: preview.dataUrl as string,
        }))
      }
      openAttachmentLightbox()
    } catch {
      setLightboxPreview({
        name: attachment.name,
        mediaType: attachment.mediaType,
        size: attachment.size,
        kind: 'metadata',
      })
      openAttachmentLightbox()
    }
  }

  const sessionTreeUnavailable = kernel === 'dsh'
  const rewindControlDisabled = Boolean(rewindDisabled) || sessionTreeUnavailable
  const rewindControlLabel = sessionTreeUnavailable
    ? t('此运行时暂不支持回退', 'This runtime cannot rewind')
    : t('丢掉这段', 'Drop this turn')
  const branchControlDisabled = sessionTreeUnavailable
  const branchControlLabel = sessionTreeUnavailable
    ? t('此运行时暂不支持分叉', 'This runtime cannot branch')
    : t('分叉到新对话', 'Branch to new chat')
  const askOptions = useMemo(() => parseAskOptions(message.approvalInput), [message.approvalInput])
  const isChoiceCard = isAskMessage(message) && askOptions.length >= 2

  useEffect(() => {
    if (message.approvalChoiceId === askOtherChoiceId) {
      setOtherDraft(String(message.approvalReason ?? ''))
    }
  }, [message.approvalChoiceId, message.approvalReason, message.approvalState])

  function submitAskOther() {
    const text = otherDraft.trim()
    if (!text || message.approvalState !== 'pending' || !message.approvalRequestId) return
    onRespondApproval?.(message.approvalRequestId, true, 'once', encodeAskOtherChoice(text))
  }

  const showApproval = (
    message.role === 'tool'
    && Boolean(message.approvalRequestId)
    && (isChoiceCard || message.approvalState === 'pending' || approvalPinned)
  )

  const showMessageActions = (
    !editing
    && (
      message.role === 'user'
      || (message.role === 'assistant' && Boolean(message.content?.trim()))
    )
  )

  function startEdit() {
    if (message.role !== 'user') return
    setDraft(message.content)
    setEditing(true)
  }

  function cancelEdit() {
    setEditing(false)
    setDraft('')
  }

  function confirmEdit() {
    const next = draft.trim()
    if (!next) return
    setEditing(false)
    onEditUser?.(message.id, next)
  }

  async function copyMessage() {
    const text = message.content.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.clearTimeout(copyReset.current)
      copyReset.current = window.setTimeout(() => {
        setCopied(false)
      }, 1500)
    } catch {
      setCopied(false)
    }
  }

  function pinApproval() {
    setApprovalPinned(true)
  }

  function formatAttachmentSize(size: number) {
    if (size >= 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${size} B`
  }

  function visibleApprovalText(value?: string) {
    return value ? redactProviderCredentials(value) : ''
  }

  function recoveryHint() {
    return recoveryContext === 'ctf'
      ? t('从已保留的 notes、证据、Judge 回执和工具结果继续', 'Continue from saved notes, evidence, Judge receipts, and tool results')
      : t('从已保留的工作区、Git 状态、工具结果和验证面板继续', 'Continue from the saved workspace, Git state, tool results, and verification panel')
  }

  function userMessageTime(timestamp: number) {
    if (!Number.isFinite(timestamp) || timestamp < 1_000_000_000_000) return ''
    const date = new Date(timestamp)
    if (Number.isNaN(date.getTime())) return ''
    const now = new Date()
    const sameDay = date.toDateString() === now.toDateString()
    const timeOptions: Intl.DateTimeFormatOptions = {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }
    return sameDay
      ? date.toLocaleTimeString('zh-CN', timeOptions)
      : date.toLocaleString('zh-CN', {
        month: 'numeric',
        day: 'numeric',
        ...timeOptions,
      })
  }

  const timeLabel = message.role === 'user' ? userMessageTime(message.timestamp) : ''
  const sources = message.role === 'assistant' ? messageSourceChips(message.content) : []

  useEffect(() => {
    const running = message.thinkingStatus === 'running'
    if (!running) return
    setThinkingNow(Date.now())
    const clock = window.setInterval(() => {
      setThinkingNow(Date.now())
    }, 100)
    return () => window.clearInterval(clock)
  }, [message.thinkingStatus === 'running'])

  useEffect(() => {
    setLastOutputAt(Date.now())
  }, [message.content, message.thinking])

  const thinkingElapsedMs = message.thinkingStatus === 'running'
    ? Math.max(0, thinkingNow - (Number.isFinite(message.timestamp) ? message.timestamp : thinkingNow))
    : message.thinkingDurationMs

  const thinkingLabel = message.thinkingStatus === 'running'
    ? t('正在思考', 'Thinking')
    : thinkingTotal || String(message.id).startsWith('process-thinking:')
      ? t('想了共', 'Thought')
      : t('想了', 'Thought')

  const thinkingElapsed = message.thinkingStatus === 'running'
    ? formatDemoElapsed(thinkingElapsedMs)
    : message.thinkingDurationMs === undefined
      ? ''
      : formatDemoElapsed(message.thinkingDurationMs)

  const thinkingRunning = message.thinkingStatus === 'running'
  const quietSeconds = Math.max(0, Math.round((thinkingNow - lastOutputAt) / 1000))
  const conclusionStarted = Boolean(message.content?.trim())
  const thinkingRows = String(message.thinking ?? '')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
  const thinkingCollapsible = (() => {
    const text = String(message.thinking ?? '')
    if (text.length >= THINKING_COLLAPSE_CHARS) return true
    return countThinkingRows(text) >= THINKING_COLLAPSE_ROWS
  })()

  useEffect(() => {
    if (thinkingRunning) setThinkManual(null)
  }, [thinkingRunning])

  const thinkOpen = thinkManual !== null
    ? thinkManual
    : thinkingCollapsible
      ? false
      : thinkingRunning && !conclusionStarted

  function toggleThink() {
    setThinkManual(!thinkOpen)
  }

  const replyTicking = (
    message.status === 'running'
    && message.thinkingStatus !== 'running'
    && (
      Boolean(message.content?.trim())
      || message.thinkingStatus !== 'done'
    )
  )

  useEffect(() => {
    if (!replyTicking) return
    setReplyNow(Date.now())
    const clock = window.setInterval(() => {
      setReplyNow(Date.now())
    }, 100)
    return () => window.clearInterval(clock)
  }, [replyTicking])

  const replyElapsed = replyTicking
    ? formatDemoElapsed(Math.max(0, replyNow - (Number.isFinite(message.timestamp) ? message.timestamp : replyNow)))
    : ''

  useEffect(() => () => {
    previewLoad.current += 1
    window.clearTimeout(copyReset.current)
  }, [])

  const approvalTitle = t(
    `允许运行 ${message.toolName ?? 'tool'}`,
    `Allow ${message.toolName ?? 'tool'}`,
  )
  const approvalCommand = (message.content ?? '').trim()
  const approvalPurpose = message.approvalJustification?.purpose?.trim()
    || t('发起者未提供', 'Not provided by the requester')
  const approvalSafety = message.approvalJustification?.safety?.trim()
    || t('发起者未提供', 'Not provided by the requester')
  const approvalVerification = destructiveAssessment ?? assessApprovalRequest({
    content: message.content ?? '',
    approvalInput: message.approvalInput ?? '',
  })
  const approvalIsDestructive = (
    /(^|\s)(rm|find|unlink|shred)\b/.test(`${approvalCommand}\n${message.approvalInput ?? ''}`)
    || /\bxargs\b/.test(`${approvalCommand}\n${message.approvalInput ?? ''}`)
    || approvalVerification.targets.some(target => target.kind !== 'unknown')
  )
  const approvalBlocked = approvalIsDestructive && !approvalVerification.canAllow
  const approvalMeasurement = measuredFacts.find(fact => (
    typeof fact.fileCount === 'number' || typeof fact.inGitRepository === 'boolean'
  )) ?? {}

  useEffect(() => {
    if (!message.approvalRequestId) return
    let cancelled = false
    void (async () => {
      const base = assessApprovalRequest({
        content: approvalCommand,
        approvalInput: message.approvalInput ?? '',
      })
      if (!approvalCommand) {
        if (!cancelled) {
          setDestructiveAssessment(base)
          setMeasuredFacts([])
        }
        return
      }
      const facts: DestructiveFacts[] = []
      for (const target of base.targets) {
        if (!target.path) {
          facts.push({})
          continue
        }
        try {
          facts.push(await invokeCommand('inspect_destructive_target', { path: target.path }) as DestructiveFacts)
        } catch {
          facts.push({})
        }
      }
      if (cancelled) return
      setDestructiveAssessment(assessApprovalRequest({
        content: approvalCommand,
        approvalInput: message.approvalInput ?? '',
      }, facts))
      setMeasuredFacts(facts)
    })()
    return () => {
      cancelled = true
    }
  }, [approvalCommand, message.approvalInput, message.approvalRequestId])

  async function openSource(href: string, event: React.MouseEvent) {
    event.preventDefault()
    try {
      const url = new URL(href)
      if (url.protocol !== 'https:' && url.protocol !== 'http:') return
      await invokeCommand('open_ctf_source_url', { url: url.toString() })
    } catch {
      return
    }
  }

  const showBubble = (
    message.role !== 'tool'
    && (
      message.role === 'user'
      || Boolean(message.content)
      || Boolean(message.attachments?.length)
      || Boolean(recoverable)
      || (
        message.status === 'running'
        && message.thinkingStatus !== 'running'
        && message.thinkingStatus !== 'done'
      )
    )
  )

  const approvalKicker = (
    message.approvalState === 'pending'
      ? t('等待决定', 'Waiting')
      : message.approvalState === 'approved'
        ? t('已允许', 'Allowed')
        : message.approvalState === 'denied'
          ? t('已拒绝', 'Denied')
          : t('已失效', 'Expired')
  )

  if (
    isBlankAssistantMessage(message)
    || (message.toolName === toolBudgetToolName && message.approvalState === 'pending')
    || (message.role === 'tool' && message.approvalRequestId && !showApproval)
  ) {
    return null
  }

  return (
    <article
      className={`agent-turn mb-7 min-w-0 w-full${message.role === 'user' ? ' agent-turn--user' : ''}`}
    >
      {timeLabel ? (
        <div className="agent-time" role="separator">
          <span>{timeLabel}</span>
        </div>
      ) : null}
      {showApproval ? (
        <div className={isChoiceCard ? 'agent-choice' : 'agent-approve'}>
          {isChoiceCard ? (
            <>
              <h4 className="agent-choice__title">{message.content}</h4>
              <div className="agent-choice__options" role="radiogroup">
                {askOptions.map(option => (
                  <button
                    key={option.id}
                    type="button"
                    role="radio"
                    className={`agent-choice__option${message.approvalChoiceId === option.id ? ' is-selected' : ''}`}
                    aria-checked={message.approvalChoiceId === option.id}
                    disabled={message.approvalState !== 'pending' || !message.approvalRequestId}
                    onClick={() => message.approvalRequestId && onRespondApproval?.(message.approvalRequestId, true, 'once', option.id)}
                  >
                    <span className="agent-choice__mark" aria-hidden="true" />
                    <span className="agent-choice__copy">
                      <strong>{option.label}</strong>
                      {option.detail ? <span>{option.detail}</span> : null}
                    </span>
                  </button>
                ))}
              </div>
              <div
                className={`agent-choice__option agent-choice__other${message.approvalChoiceId === askOtherChoiceId ? ' is-selected' : ''}`}
              >
                <span className="agent-choice__mark" aria-hidden="true" />
                <span className="agent-choice__copy">
                  <strong>{t('其他', 'Other')}</strong>
                  <input
                    value={otherDraft}
                    type="text"
                    className="agent-choice__other-input"
                    disabled={message.approvalState !== 'pending' || !message.approvalRequestId}
                    aria-label={t('其他', 'Other')}
                    onChange={event => setOtherDraft(event.target.value)}
                    onKeyDown={event => {
                      if (event.key === 'Enter') {
                        event.preventDefault()
                        submitAskOther()
                      }
                    }}
                  />
                </span>
                {message.approvalState === 'pending' && message.approvalRequestId ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="shrink-0"
                    disabled={!otherDraft.trim()}
                    onClick={submitAskOther}
                  >
                    {t('发送', 'Send')}
                  </Button>
                ) : null}
              </div>
            </>
          ) : (
            <>
              <div className="agent-approve__kicker">{approvalKicker}</div>
              <h4 className="agent-approve__title">{approvalTitle}</h4>
              <section className="mt-2 space-y-1.5 rounded-xl border border-border/70 bg-background/40 px-3 py-2" data-testid="approval-brief">
                <div className="flex gap-2 text-caption">
                  <span className="w-16 shrink-0 font-medium text-muted-foreground">{t('用途', 'Purpose')}</span>
                  <p className="min-w-0 flex-1 text-foreground">{visibleApprovalText(approvalPurpose)}</p>
                </div>
                <div className="flex gap-2 text-caption">
                  <span className="w-16 shrink-0 font-medium text-muted-foreground">{t('安全性', 'Safety')}</span>
                  <p className="min-w-0 flex-1 text-foreground">{visibleApprovalText(approvalSafety)}</p>
                </div>
                <div className="space-y-1 border-t border-border/60 pt-1.5 text-caption" data-testid="approval-verification">
                  <div className="flex gap-2">
                    <span className="w-16 shrink-0 font-medium text-muted-foreground">{t('核验', 'Verification')}</span>
                    <span className="rounded-md bg-muted px-1.5 py-0.5 text-muted-foreground">{t('MilkSU 实测', 'Measured by MilkSU')}</span>
                  </div>
                  <ul className="space-y-0.5 pl-18">
                    {approvalVerification.targets.map((target, index) => (
                      <li key={`${index}:${target.raw}`}>
                        <span className="font-medium">
                          {target.kind === 'file' ? t('文件', 'file')
                            : target.kind === 'glob' ? t('通配', 'glob')
                              : target.kind === 'directory-tree' ? t('目录树', 'directory tree')
                                : t('无法确定', 'unknown')}
                        </span>
                        {' · '}{visibleApprovalText(target.path ?? target.raw)}
                        <span className="text-muted-foreground">
                          （{target.recursive ? t('递归', 'recursive') : t('不递归', 'not recursive')}：{target.reason}）
                        </span>
                      </li>
                    ))}
                  </ul>
                  {approvalVerification.irrecoverable ? (
                    <p className="font-medium text-destructive" data-testid="approval-irrecoverable">
                      {t('不可恢复：不在 git 中且无备份', 'Not recoverable: not in git and no backup')}
                    </p>
                  ) : null}
                  {approvalMeasurement.fileCount !== undefined ? (
                    <p className="text-muted-foreground">
                      {t('规模', 'Size')}：{approvalMeasurement.fileCount} {t('个文件', 'files')}
                      {approvalMeasurement.sampled ? `（${t('仅采样', 'sampled')}）` : ''}
                    </p>
                  ) : null}
                  {approvalMeasurement.inGitRepository !== undefined ? (
                    <p className="text-muted-foreground">
                      {t('git 状态', 'Git')}：{approvalMeasurement.inGitRepository
                        ? (approvalMeasurement.gitTracked ? t('在仓库内且已跟踪', 'tracked in a repository') : t('在仓库内但未跟踪', 'in a repository, untracked'))
                        : t('不在仓库内', 'not in a repository')}
                    </p>
                  ) : null}
                  {approvalVerification.targets.some(target => target.path) ? (
                    <p className="text-muted-foreground">
                      {t('备份情况', 'Backups')}：{approvalVerification.irrecoverable ? t('未发现', 'none found') : t('存在可重建来源', 'a rebuild source exists')}
                    </p>
                  ) : null}
                  <p className={`font-medium ${approvalVerification.risk === 'high' ? 'text-destructive' : 'text-foreground'}`} data-testid="approval-verdict">
                    {approvalVerification.verdict}
                  </p>
                </div>
              </section>
              <p className="agent-approve__message">
                {t('Agent 已暂停。允许这一次只会执行当前操作，不会扩大权限。', 'The agent is paused. Allow once runs only this action and grants nothing more.')}
              </p>
              {message.content ? (
                <details className="mt-2" onToggle={pinApproval}>
                  <summary className="cursor-pointer text-caption text-muted-foreground">
                    {t('查看原始命令', 'View the raw command')}
                  </summary>
                  <pre>{visibleApprovalText(message.content)}</pre>
                </details>
              ) : null}
              {message.approvalInput ? (
                <details className="mt-2" onToggle={pinApproval}>
                  <summary className="cursor-pointer text-caption text-muted-foreground">
                    {t('查看完整参数', 'View full arguments')}
                  </summary>
                  <pre>{visibleApprovalText(message.approvalInput)}</pre>
                </details>
              ) : null}
              {message.approvalState === 'pending' && message.approvalRequestId ? (
                <div className="agent-approve__actions">
                  {approvalBlocked ? (
                    <p className="w-full text-caption font-medium text-destructive" data-testid="approval-gate">
                      {t('核验为高风险或目标无法确定：本卡不提供「允许」。请让发起者补上用途与安全性，或改用更小的目标。', 'Verification failed (high risk or unknown scope): this card offers no allow. Ask the requester for a purpose and safety note, or narrow the target.')}
                    </p>
                  ) : null}
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => onRespondApproval?.(message.approvalRequestId as string, false)}
                  >
                    {t('拒绝', 'Deny')}
                  </Button>
                  {!approvalBlocked ? (
                    <Button
                      type="button"
                      variant={message.approvalGrantable ? 'outline' : 'default'}
                      size="sm"
                      onClick={() => onRespondApproval?.(message.approvalRequestId as string, true, 'once')}
                    >
                      {t('允许这一次', 'Allow once')}
                    </Button>
                  ) : null}
                </div>
              ) : message.approvalReason ? (
                <p className="mt-2 text-caption text-muted-foreground">
                  {visibleApprovalText(message.approvalReason)}
                </p>
              ) : null}
            </>
          )}
        </div>
      ) : message.role !== 'user' && (message.thinking || message.thinkingStatus === 'running') ? (
        <div className="agent-think">
          <button
            type="button"
            className="agent-think__summary"
            aria-expanded={thinkOpen}
            onClick={toggleThink}
          >
            <AgentPixelLoader
              label={thinkingLabel}
              elapsed={thinkingElapsed}
              running={thinkingRunning}
            />
            {thinkingRunning ? <span className="agent-think__pulse" aria-hidden="true" /> : null}
            {thinkingRunning && quietSeconds >= 3 ? (
              <span className="agent-think__quiet">
                {t(`最近 ${quietSeconds}s 前有输出`, `Last output ${quietSeconds}s ago`)}
              </span>
            ) : null}
            <svg
              className={`agent-think__chevron${thinkOpen ? ' agent-think__chevron--open' : ''}`}
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </button>
          <div
            className="agent-think__more"
            data-open={thinkOpen ? 'true' : 'false'}
            aria-hidden={!thinkOpen}
          >
            <div className="agent-think__more-inner">
              {thinkingRows.map((row, index) => (
                <p key={index} className="agent-think__row">{row}</p>
              ))}
            </div>
          </div>
        </div>
      ) : null}
      {showBubble && !editing ? (
        <div
          className={`min-w-0 overflow-x-auto break-words text-control leading-7${message.role === 'user' ? ' agent-user' : ' agent-answer'}`}
        >
          {message.attachments?.length ? (
            <div className="mb-2 flex flex-wrap gap-2" aria-label={t('消息附件', 'Message attachments')}>
              {imageAttachments.map(attachment => (
                <button
                  key={`${attachment.id}:${attachment.name}`}
                  type="button"
                  className="agent-attachment-thumb"
                  data-testid="message-attachment-image"
                  aria-label={t(`查看 ${attachment.name}`, `View ${attachment.name}`)}
                  title={attachment.name}
                  onClick={() => openAttachmentPreview(attachment)}
                >
                  {imagePreviewUrl(attachment) ? (
                    <img src={imagePreviewUrl(attachment)} alt={attachment.name} />
                  ) : (
                    <span className="agent-attachment">
                      <FileText className="size-3.5 shrink-0" />
                      <span className="truncate">{attachment.name}</span>
                      <span className="shrink-0 opacity-65">{formatAttachmentSize(attachment.size)}</span>
                    </span>
                  )}
                </button>
              ))}
              {fileAttachments.map(attachment => (
                <span
                  key={`${attachment.id}:${attachment.name}`}
                  className="agent-attachment"
                  title={`${attachment.mediaType} · sha256:${attachment.sha256}`}
                >
                  <FileText className="size-3.5 shrink-0" />
                  <span className="truncate">{attachment.name}</span>
                  <span className="shrink-0 opacity-65">{formatAttachmentSize(attachment.size)}</span>
                </span>
              ))}
            </div>
          ) : null}
          {message.content ? (
            <MarkdownContent
              content={message.content}
              compact={message.role === 'user'}
              streaming={replyTicking}
            />
          ) : null}
          {sources.length ? (
            <div className="agent-sources">
              {sources.map(source => (
                <a
                  key={source.href}
                  className="agent-source"
                  href={source.href}
                  onClick={event => openSource(source.href, event)}
                >
                  {source.label}
                </a>
              ))}
            </div>
          ) : null}
          {replyTicking && !message.content?.trim() ? (
            <p className="chat-model-loading">
              <AgentPixelLoader
                label={t('正在回复', 'Replying')}
                elapsed={replyElapsed}
                running
              />
            </p>
          ) : null}
          {recoverable ? (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => onRetry?.()}>
                <RotateCcw className="size-3.5" />
                {t('继续', 'Continue')}
              </Button>
              <span className="text-caption text-muted-foreground">
                {recoveryHint()}
              </span>
            </div>
          ) : null}
        </div>
      ) : editing ? (
        <form
          className="agent-user agent-user-edit min-w-0"
          onSubmit={event => {
            event.preventDefault()
            confirmEdit()
          }}
        >
          <textarea
            value={draft}
            className="agent-user-edit__input"
            rows={3}
            aria-label={t('编辑消息', 'Edit message')}
            onChange={event => setDraft(event.target.value)}
          />
          <div className="agent-turn-actions agent-turn-actions--visible">
            <button
              type="button"
              aria-label={t('取消', 'Cancel')}
              title={t('取消', 'Cancel')}
              onClick={cancelEdit}
            >
              <X />
            </button>
            <button
              type="submit"
              aria-label={t('发送', 'Send')}
              title={t('发送', 'Send')}
            >
              <Check />
            </button>
          </div>
        </form>
      ) : null}
      {showMessageActions ? (
        <div className={`agent-turn-actions${canRewind ? ' agent-turn-actions--visible' : ''}`}>
          <button
            type="button"
            aria-label={copied ? t('已复制', 'Copied') : t('复制', 'Copy')}
            title={copied ? t('已复制', 'Copied') : t('复制', 'Copy')}
            onClick={() => void copyMessage()}
          >
            {copied ? <Check /> : <Copy />}
          </button>
          {message.role === 'user' ? (
            <button
              type="button"
              aria-label={t('编辑并从这里重发', 'Edit and restart from here')}
              title={t('编辑并从这里重发', 'Edit and restart from here')}
              onClick={startEdit}
            >
              <Pencil />
            </button>
          ) : null}
          {canRewind ? (
            <button
              type="button"
              data-testid="message-rewind"
              aria-label={rewindControlLabel}
              title={rewindControlLabel}
              disabled={rewindControlDisabled}
              onClick={() => onRewindContext?.()}
            >
              <Undo2 />
            </button>
          ) : null}
          {message.role === 'assistant' ? (
            <button
              type="button"
              data-testid="message-branch"
              aria-label={branchControlLabel}
              title={branchControlLabel}
              disabled={branchControlDisabled}
              onClick={() => onBranchAssistant?.(message.id)}
            >
              <GitFork />
            </button>
          ) : null}
        </div>
      ) : null}
      <dialog
        ref={attachmentLightbox}
        className="agent-attachment-lightbox"
        aria-label={t('图片预览', 'Image preview')}
        onClick={event => {
          if (event.target === event.currentTarget) closeAttachmentPreview()
        }}
        onCancel={event => {
          event.preventDefault()
          closeAttachmentPreview()
        }}
      >
        <header className="agent-attachment-lightbox__bar">
          <p className="truncate">{lightboxPreview?.name || t('图片预览', 'Image preview')}</p>
          <button
            type="button"
            data-testid="message-attachment-close"
            aria-label={t('关闭', 'Close')}
            onClick={closeAttachmentPreview}
          >
            <X className="size-4" />
          </button>
        </header>
        {lightboxPreview?.kind === 'image' && lightboxPreview.dataUrl ? (
          <img src={lightboxPreview.dataUrl} alt={lightboxPreview.name} />
        ) : (
          <p className="agent-attachment-lightbox__empty">
            {t('这张图片暂时无法预览。', 'This image cannot be previewed right now.')}
          </p>
        )}
      </dialog>
    </article>
  )
}
