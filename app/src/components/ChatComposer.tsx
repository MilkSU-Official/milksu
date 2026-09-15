import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type ComponentType,
} from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui'
import {
  Activity,
  ArrowRightLeft,
  ArrowUp,
  Bot,
  Cable,
  Check,
  ChevronDown,
  Clock3,
  Compass,
  FileDiff,
  FileText,
  FolderOpen,
  GitBranch,
  Globe2,
  Lightbulb,
  LoaderCircle,
  MessageSquarePlus,
  Monitor,
  MousePointer2,
  PackageCheck,
  Palette,
  Paperclip,
  Pause,
  Pencil,
  Play,
  Plus,
  Plug,
  Route,
  ScanSearch,
  ShieldCheck,
  Shrink,
  Square,
  Target,
  Terminal,
  Undo2,
  Trash2,
  Wrench,
  X,
} from 'lucide-react'
import AkLoadingMark from '@/components/AkLoadingMark'
import CodingComposerControls from '@/components/CodingComposerControls'
import ContextUsageMeter from '@/components/ContextUsageMeter'
import { invokeCommand } from '@/desktop'
import {
  captureComposerSnapshot,
  isComposerHistoryKey,
  redoComposerHistory,
  undoComposerHistory,
} from '@/lib/composerHistory'
import type {
  CodingApprovalPolicy,
  CodingAttachment,
  CodingAttachmentImport,
  CodingAttachmentPreview,
  CodingExecutionMode,
  CodingGoalState,
  ModelThinkingLevel,
} from '@/types'
import type { CodingRecentProject } from '@/codingEnvironmentTypes'
import type { ContextUsagePresentation } from '@/lib/sessionTurnStatus'
import { CODING_SKILLS } from '@/codingSkills'
import { useT } from '@/hooks/useUiLocale'

type ComposerScopeToken = 'browser-use' | 'computer-use'
type LucideIcon = ComponentType<{ className?: string }>

interface ComposerSkillOption {
  name: string
  label: string
  description: string
  icon: LucideIcon
}

const skillIcons: Record<string, LucideIcon> = {
  'product-design': Palette,
  'frontend-visual-qa': ScanSearch,
  'integrate-api': Cable,
  'review-security': ShieldCheck,
  'create-technical-deliverables': FileText,
  archify: Route,
  'release-milksu': PackageCheck,
}

const COMPOSER_STYLES = `
.chat-composer { position: relative; z-index: 2; }
.chat-composer__frame { position: relative; }
.chat-composer__queued-guidance {
  margin: 0 0.25rem 0.5rem;
  border: 0;
  border-radius: 12px;
  background: var(--muted);
  padding: 0.625rem 0.75rem;
  box-shadow: 0 0 0 0.5px color-mix(in srgb, var(--foreground) 10%, transparent);
}
.chat-composer__command-menu {
  position: absolute;
  bottom: calc(100% + 0.5rem);
  left: 0;
  z-index: 10;
  width: min(30rem, calc(100vw - 3rem));
  max-height: min(30rem, calc(100vh - 14rem));
  overflow-x: hidden;
  overflow-y: auto;
  border: 0;
  border-radius: 16px;
  background: var(--popover);
  padding: 0.35rem;
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 12%, transparent),
    0 12px 32px rgb(0 0 0 / 28%);
}
.chat-composer__command-option {
  display: flex;
  width: 100%;
  align-items: center;
  gap: 0.75rem;
  border-radius: 0.7rem;
  padding: 0.65rem 0.75rem;
  color: var(--foreground);
  outline: none;
}
.chat-composer__command-option:not(:disabled):hover,
.chat-composer__command-option:not(:disabled):focus-visible,
.chat-composer__command-option--active:not(:disabled) { background: var(--muted); }
.chat-composer__command-option:focus-visible { box-shadow: 0 0 0 2px var(--ring); }
.chat-composer__goal-slot { position: relative; display: inline-flex; min-width: 0; }
.chat-composer__chip {
  display: inline-flex;
  height: 28px;
  min-width: 0;
  flex: 0 1 auto;
  align-items: center;
  gap: 0.35rem;
  border: 0;
  border-radius: 8px;
  padding-inline: 8px;
  font-size: 13px;
  line-height: 20px;
  font-weight: 500;
  color: var(--muted-foreground);
  transition: background-color 100ms ease, color 100ms ease;
}
.chat-composer__chip:hover:not(:disabled),
.chat-composer__chip[aria-expanded='true'] { background: var(--btn-ghost-hover); }
.chat-composer__chip:disabled { opacity: 0.55; }
.chat-composer__chip__label { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-composer__chip--goal { background: color-mix(in srgb, var(--primary) 10%, transparent); color: color-mix(in srgb, var(--primary) 72%, var(--foreground)); }
.chat-composer__chip--plan { color: var(--muted-foreground); }
.chat-composer__chip--plan:hover:not(:disabled) { color: var(--foreground); }
.chat-composer__chip--workspace { max-width: 11rem; color: var(--muted-foreground); }
.chat-composer__workspace .chat-composer__chip--workspace { max-width: 12rem; }
.chat-composer__chip--workspace:hover:not(:disabled) { color: var(--foreground); }
.chat-composer__goal-panel {
  position: absolute;
  bottom: calc(100% + 0.5rem);
  left: 0;
  z-index: 30;
  width: min(24rem, calc(100vw - 2rem));
  border: 1px solid var(--border);
  border-radius: 16px;
  background: var(--card);
  padding: 0.75rem 0.85rem;
  box-shadow: 0 18px 42px rgb(0 0 0 / 18%), 0 3px 10px rgb(0 0 0 / 10%);
}
.chat-composer__progress-pill {
  display: inline-flex;
  min-height: 28px;
  align-items: center;
  gap: 0.4rem;
  border: 0;
  border-radius: 8px;
  background: var(--muted);
  padding: 0.25rem 0.75rem;
  font-size: var(--text-caption);
  color: var(--muted-foreground);
}
@container chat-main (max-width: 40rem) { .chat-composer__chip--workspace { max-width: 7rem; } }
@container chat-main (max-width: 36rem) {
  .chat-composer__chip--workspace { max-width: 2rem; justify-content: center; padding-inline: 0; }
  .chat-composer__chip--workspace .chat-composer__chip__label,
  .chat-composer__chip--workspace .chat-composer__chip__chevron { display: none; }
  .chat-composer__chip--goal { width: 2rem; justify-content: center; padding-inline: 0; }
  .chat-composer__chip--goal .chat-composer__chip__label,
  .chat-composer__chip--goal .chat-composer__chip__chevron { display: none; }
  .chat-composer__progress-pill { min-width: 0; overflow: hidden; padding-inline: 0.5rem; }
}
.composer-add-option { display: flex; min-height: 3.5rem; align-items: center; gap: 0.75rem; padding: 0.55rem 0.75rem; }
.composer-add-menu { max-height: min(38rem, calc(100vh - 10rem)); overflow-x: hidden; overflow-y: auto; }
.chat-composer__island {
  display: flex;
  flex-direction: column;
  gap: 12px;
  border: 0;
  border-radius: 22px;
  background: var(--surface-raised);
  padding: 8px 0 0;
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 12%, transparent),
    0 8px 28px rgb(0 0 0 / 22%);
  color: var(--foreground);
}
.chat-composer__island:focus-within {
  box-shadow:
    0 0 0 0.5px color-mix(in srgb, var(--foreground) 22%, transparent),
    0 10px 32px rgb(0 0 0 / 26%);
}
:root[data-theme='light'] .chat-composer__island {
  box-shadow:
    0 0 0 0.5px rgb(24 24 27 / 10%),
    0 8px 24px rgb(24 24 27 / 8%);
}
:root[data-theme='light'] .chat-composer__island:focus-within {
  box-shadow:
    0 0 0 0.5px rgb(24 24 27 / 16%),
    0 10px 28px rgb(24 24 27 / 10%);
}
.chat-composer__workspace { display: inline-flex; min-width: 0; max-width: 14rem; align-items: center; border-radius: 8px; }
.chat-composer__workspace:not(.chat-composer__workspace--locked):hover .chat-composer__chip--workspace,
.chat-composer__workspace:not(.chat-composer__workspace--locked):hover .chat-composer__workspace-clear {
  background: var(--btn-ghost-hover);
  color: var(--foreground);
}
.chat-composer__workspace--locked .chat-composer__chip--workspace { cursor: default; }
.chat-composer__workspace-clear {
  display: inline-flex;
  height: 28px;
  width: 1.6rem;
  flex: none;
  align-items: center;
  justify-content: center;
  margin-left: -0.35rem;
  border: 0;
  border-radius: 0 8px 8px 0;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}
.chat-composer__workspace-clear:disabled { cursor: default; opacity: 0.55; }
.chat-composer__chip--workspace-empty { color: var(--muted-foreground); }
.chat-composer__chip--workspace-split { border-radius: 8px 0 0 8px; padding-inline-end: 0.35rem; }
.chat-composer__toolbar {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  border-top: 0;
  padding: 2px 8px 6px;
}
.chat-composer__add {
  width: 28px !important;
  height: 28px !important;
  border-radius: 999px !important;
  background: var(--muted) !important;
  color: var(--foreground) !important;
}
.chat-composer__add:hover:not(:disabled) { background: var(--hover-2) !important; }
.chat-composer__send,
.chat-composer__stop {
  width: 34px !important;
  height: 34px !important;
  border-radius: 999px !important;
  transform: translateY(-2px);
}
.chat-composer__input {
  overflow-y: auto;
  min-height: 36px;
  padding: 4px 8px 0 14px;
  white-space: pre-wrap;
  word-break: break-word;
  outline: none;
  font-size: 14px;
  line-height: 24px;
  color: var(--foreground);
}
.chat-composer__input:empty::before { color: var(--muted-foreground); content: attr(data-placeholder); pointer-events: none; }
.chat-composer__input .chat-composer__inline-token {
  display: inline-flex;
  min-height: 1.65rem;
  align-items: center;
  gap: 0.35rem;
  border: 1px solid color-mix(in srgb, var(--primary) 36%, var(--border));
  border-radius: 0.55rem;
  background: color-mix(in srgb, var(--primary) 11%, var(--card));
  padding: 0.1rem 0.25rem 0.1rem 0.45rem;
  color: var(--foreground);
  font-family: "SFMono-Regular", "Cascadia Code", "Liberation Mono", monospace;
  font-size: var(--text-body);
  line-height: var(--text-body--line-height);
  vertical-align: baseline;
}
.chat-composer__input .chat-composer__inline-token-remove {
  display: inline-grid;
  width: 1.2rem;
  height: 1.2rem;
  cursor: pointer;
  place-items: center;
  border: 0;
  border-radius: 999px;
  background: transparent;
  color: var(--muted-foreground);
  font: inherit;
  line-height: 1;
}
.chat-composer__input .chat-composer__inline-token-remove:hover { background: var(--btn-ghost-hover); color: var(--foreground); }
`

export type ChatComposerHandle = {
  appendDraftText: (text: string) => void
  openAddMenu: () => void
  focusMessageInput: () => Promise<void>
}

const ChatComposer = forwardRef<ChatComposerHandle, {
  running: boolean
  aborting: boolean
  compacting?: boolean
  ctfSession: boolean
  goalMode: boolean
  goal?: CodingGoalState
  executionMode: CodingExecutionMode
  approvalPolicy: CodingApprovalPolicy
  approvalLabel: string
  modelKey: string
  automaticModelLabel: string
  compactModelLabel: string
  thinkingLevels?: ModelThinkingLevel[]
  thinkingLevel?: ModelThinkingLevel
  kernel?: 'pi' | 'dsh'
  kernelLocked?: boolean
  compactDisabled?: boolean
  contextUsage?: ContextUsagePresentation | null
  workspaceReady?: boolean
  workspaceLocked?: boolean
  workspaceName?: string
  workspacePath?: string
  homeDirectory?: string
  recentProjects?: CodingRecentProject[]
  gitRepository?: boolean
  gitBranch?: string
  gitBranches?: string[]
  browserUseReady?: boolean
  computerUseReady?: boolean
  availableSkills?: string[]
  importedSkills?: Array<{ name: string; label: string; description: string }>
  selectedMcpServers?: string[]
  mcpCatalog?: Array<{ name: string; reviewReady: boolean; scope?: string }>
  mcpConfigDigest?: string
  conversationKey?: string
  queuedGuidance?: string[]
  queuedGuidanceAwaitingTool?: boolean
  queuedGuidanceStalled?: boolean
  abortStalled?: boolean
  onSend?: (text: string, visibleText?: string, attachments?: CodingAttachment[], scopeToken?: ComposerScopeToken) => void
  onAbort?: () => void
  onOpenChanges?: (path?: string) => void
  onChangeExecutionMode?: (value: string) => void
  onChangeApprovalPolicy?: (value: string) => void
  onChangeModel?: (value: string) => void
  onChangeThinkingLevel?: (level: ModelThinkingLevel) => void
  onChangeKernel?: (value: 'pi' | 'dsh') => void
  onMigrateKernel?: (value: 'pi' | 'dsh') => void
  onShowPermissions?: () => void
  onConsumeGoal?: () => void
  onStartGoal?: () => void
  onRunSlashCommand?: (command: string) => void
  onChangeMcpServers?: (servers: string[], digest: string) => void
  onControlGoal?: (action: 'pause' | 'resume' | 'clear') => void
  onChooseWorkspace?: () => void
  onSelectWorkspace?: (path: string) => void
  onForgetWorkspace?: (path: string) => void
  onClearWorkspace?: () => void
  onCheckoutBranch?: (branch: string) => void
  onCancelQueuedGuidance?: (index: number) => void
  onEditQueuedGuidance?: (index: number) => void
}>(function ChatComposer(props, ref) {
  const t = useT()
  const {
    running, aborting, compacting, ctfSession, goalMode, goal, executionMode,
    approvalPolicy, approvalLabel, modelKey, automaticModelLabel, compactModelLabel,
    thinkingLevels, thinkingLevel, kernel, kernelLocked, contextUsage, workspaceReady,
    workspaceLocked, workspaceName, workspacePath, gitRepository, gitBranch, gitBranches,
    browserUseReady, computerUseReady, availableSkills, importedSkills, selectedMcpServers,
    mcpCatalog, mcpConfigDigest, conversationKey, queuedGuidance,
    queuedGuidanceAwaitingTool: queuedGuidanceAwaitingToolProp,
    queuedGuidanceStalled, abortStalled: abortStalledProp,
  } = props

  const reviewedComposerSkills: ComposerSkillOption[] = CODING_SKILLS.map(skill => ({
    ...skill,
    icon: skillIcons[skill.name] ?? Plug,
  }))

  const [draft, setDraft] = useState('')
  const draftsByConversation = useRef(new Map<string, { html: string; text: string }>())
  const composerFrame = useRef<HTMLDivElement | null>(null)
  const messageEditor = useRef<HTMLDivElement | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<CodingAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState('')
  const [attachmentImporting, setAttachmentImporting] = useState(false)
  const attachmentPreviewDialog = useRef<HTMLDialogElement | null>(null)
  const [attachmentPreview, setAttachmentPreview] = useState<CodingAttachmentPreview | null>(null)
  const [attachmentPreviewLoading, setAttachmentPreviewLoading] = useState(false)
  const [composerHistory, setComposerHistory] = useState<string[]>([])
  const [composerFuture, setComposerFuture] = useState<string[]>([])
  const applyingComposerHistory = useRef(false)
  const attachmentChooserStartedAt = useRef(0)
  const [, setComposing] = useState(false)
  const composingRef = useRef(false)
  const [, setCompositionJustEnded] = useState(false)
  const compositionJustEndedRef = useRef(false)
  const [slashMenuDismissed, setSlashMenuDismissed] = useState(false)
  const [activeSlashCommandIndex, setActiveSlashCommandIndex] = useState(0)
  const [slashQuery, setSlashQuery] = useState<string | null>(null)
  const slashQueryRange = useRef<Range | null>(null)
  const [pendingMigrateKernel, setPendingMigrateKernel] = useState<'pi' | 'dsh' | null>(null)
  const [scopeToken, setScopeToken] = useState<ComposerScopeToken | null>(null)
  const pendingScopeSubmit = useRef<ComposerScopeToken | null>(null)
  const [skillToken, setSkillToken] = useState<string | null>(null)
  const [goalPanelOpen, setGoalPanelOpen] = useState(false)
  const goalSlot = useRef<HTMLDivElement | null>(null)
  const conversationKeyRef = useRef(conversationKey)
  const previousConversationKey = useRef(conversationKey)

  function currentConversationKey() {
    return String(conversationKey ?? '')
  }

  function composerHtml() {
    return messageEditor.current?.innerHTML ?? ''
  }

  function editorNodeText(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? ''
    if (!(node instanceof HTMLElement)) return ''
    if (node.dataset.composerScopeToken || node.dataset.composerSkillToken) return '\uFFFC'
    if (node.tagName === 'BR') return '\n'
    const text = [...node.childNodes].map(editorNodeText).join('')
    return ['DIV', 'P'].includes(node.tagName) ? `${text}\n` : text
  }

  function readComposerText() {
    const editor = messageEditor.current
    if (!editor) return draft
    return [...editor.childNodes]
      .map(editorNodeText)
      .join('')
      .replace(/\s*\uFFFC\s*/gu, ' ')
      .replace(/\u00a0/gu, ' ')
      .replace(/\n{3,}/gu, '\n\n')
      .replace(/\n$/u, '')
  }

  function setCaretAfter(node: Node) {
    const selection = window.getSelection()
    if (!selection) return
    const range = document.createRange()
    range.setStartAfter(node)
    range.collapse(true)
    selection.removeAllRanges()
    selection.addRange(range)
  }

  function applyComposerHtml(html: string) {
    const editor = messageEditor.current
    if (!editor) return
    applyingComposerHistory.current = true
    editor.innerHTML = html
    const last = editor.lastChild
    if (last) setCaretAfter(last)
    else {
      const selection = window.getSelection()
      if (selection) {
        const range = document.createRange()
        range.selectNodeContents(editor)
        range.collapse(false)
        selection.removeAllRanges()
        selection.addRange(range)
      }
    }
    syncComposerInput()
    applyingComposerHistory.current = false
  }

  function captureComposerDraft() {
    return { html: composerHtml(), text: readComposerText() }
  }

  function applyStoredComposerDraft(stored?: { html: string; text: string }) {
    applyComposerHtml(stored?.html ?? '')
    setDraft(stored?.text ?? '')
  }

  useEffect(() => {
    const key = currentConversationKey()
    const previous = previousConversationKey.current
    if (previous) draftsByConversation.current.set(String(previous), captureComposerDraft())
    applyStoredComposerDraft(key ? draftsByConversation.current.get(key) : undefined)
    previousConversationKey.current = conversationKey
    conversationKeyRef.current = conversationKey
  }, [conversationKey])

  const hasUnfinishedGoal = Boolean(goal && goal.status !== 'complete')
  const availableSkillOptions = useMemo(() => {
    const available = new Set(availableSkills ?? [])
    const known = new Map(reviewedComposerSkills
      .filter(skill => available.has(skill.name))
      .map(skill => [skill.name, skill]))
    for (const skill of importedSkills ?? []) {
      if (!skill.name || !available.has(skill.name)) continue
      known.set(skill.name, {
        name: skill.name,
        label: skill.label || skill.name,
        description: skill.description,
        icon: Plug,
      })
    }
    for (const name of availableSkills ?? []) {
      if (!name || known.has(name)) continue
      known.set(name, { name, label: name, description: '', icon: Plug })
    }
    return [...known.values()]
  }, [availableSkills, importedSkills, t])

  const selectedMcpDescription = (() => {
    const servers = selectedMcpServers ?? []
    if (!servers.length) return ''
    const names = servers.slice(0, 2).join(t('、', ', '))
    return t(`${servers.length} 个已接入${names ? `：${names}` : ''}`, `${servers.length} connected${names ? `: ${names}` : ''}`)
  })()
  const queuedGuidanceAwaitingTool = Boolean(queuedGuidanceAwaitingToolProp)
  const queuedGuidanceIsStalled = Boolean(queuedGuidanceStalled)
  const abortStalled = Boolean(abortStalledProp)
  const queuedGuidanceStatus = queuedGuidanceIsStalled
    ? t('本回合已结束，未送达；可撤回后重发', 'The turn ended before this was delivered. Withdraw it to send again.')
    : queuedGuidanceAwaitingTool
      ? t('当前工具调用结束后应用', 'Applied after the current tool call finishes')
      : t('已并入本回合', 'Merged into this turn')
  const sendSteeringTitle = queuedGuidanceAwaitingTool
    ? t('当前工具调用结束后应用', 'Applied after the current tool call finishes')
    : t('并入本回合', 'Merge into this turn')

  const slashCommandCatalog = [
    { id: 'goal', label: t('目标', 'Goal'), description: t('设置一个持续追踪的目标', 'Set a goal to keep working toward'), keywords: ['target'], icon: Target },
    { id: 'new', label: t('新任务', 'New task'), description: t('开始一个新的编码会话', 'Start a new coding session'), keywords: ['clear', '新建'], icon: MessageSquarePlus },
    { id: 'plan', label: t('计划模式', 'Plan mode'), description: t('只分析和规划，不修改文件', 'Analyze and plan only, without changing files'), keywords: ['mode', '规划'], icon: Lightbulb },
    { id: 'understand', label: t('理解项目', 'Understand the project'), description: t('读取入口、结构、运行方式和风险', 'Read the entry points, structure, how it runs, and the risks'), keywords: ['project', '项目', '了解'], icon: Compass },
    { id: 'test', label: t('运行测试', 'Run tests'), description: t('自动识别并运行项目的主验证链', 'Detect and run the project’s main verification chain'), keywords: ['verify', '测试'], icon: Terminal },
    { id: 'review', label: t('审阅变更', 'Review changes'), description: t('按文件和风险检查当前 Git 变更', 'Inspect current Git changes by file and risk'), keywords: ['diff', 'code-review', '审查', '审阅'], icon: ScanSearch },
    { id: 'fix', label: t('修复失败', 'Fix a failure'), description: t('复现最近失败并完成最小修复', 'Reproduce the latest failure and make the smallest fix'), keywords: ['repair', '修复'], icon: Wrench },
    { id: 'summary', label: t('生成总结', 'Write a summary'), description: t('汇总改动、验证、风险和下一步', 'Summarize changes, verification, risks, and next steps'), keywords: ['report', '总结'], icon: FileText },
    { id: 'compact', label: t('整理上下文', 'Compact context'), description: t('整理当前会话上下文', 'Compact the current conversation context'), keywords: ['context', '上下文', 'summarize'], icon: Shrink },
    { id: 'rewind', label: t('丢掉探索', 'Rewind'), description: t('丢掉最近一段探索，留在同一会话', 'Drop the latest exploration and stay in this chat'), keywords: ['undo', '回退', 'rewind'], icon: Undo2 },
    { id: 'handoff', label: t('接到新会话', 'Handoff'), description: t('整理后开新会话继续同一任务', 'Compact, then continue the same task in a new chat'), keywords: ['fork', '接力', 'handoff'], icon: ArrowRightLeft },
    { id: 'model', label: t('模型', 'Model'), description: t('打开当前任务的模型选择', 'Open the model picker for this task'), keywords: ['provider', '模型'], icon: Bot },
    { id: 'permissions', label: t('权限', 'Permissions'), description: t('打开审批与访问范围选择', 'Open approval and access-scope options'), keywords: ['approve', 'approval', '权限'], icon: ShieldCheck },
    { id: 'status', label: t('状态', 'Status'), description: t('查看会话、Git 和运行环境', 'View the session, Git, and runtime environment'), keywords: ['session', 'environment', '状态'], icon: Activity },
    { id: 'diff', label: t('变更', 'Changes'), description: t('查看当前工作区的文件改动', 'View file changes in the current workspace'), keywords: ['changes', '变更'], icon: FileDiff },
    { id: 'mcp', label: 'MCP', description: t('查看或接入当前项目的 MCP 服务', 'View or attach MCP servers for this project'), keywords: ['tools', '工具'], icon: Plug },
    { id: 'browser', label: t('浏览器', 'Browser'), description: t('打开隔离浏览器', 'Open the isolated browser'), keywords: ['playwright', '浏览器'], icon: Monitor },
    { id: 'browser-use', label: 'Browser Use', description: t('把一个用户浏览器窗口加入本轮输入', 'Add a user browser window to this turn'), keywords: ['chrome', 'safari', '浏览器'], icon: Globe2 },
    { id: 'computer-use', label: 'Computer Use', description: t('把一个外部 App 窗口加入本轮输入', 'Add an external app window to this turn'), keywords: ['app', '窗口', '电脑'], icon: MousePointer2 },
  ] as const

  function slashCommandDisabled(id: typeof slashCommandCatalog[number]['id']) {
    if (id === 'goal') return running || hasUnfinishedGoal
    if (id === 'compact') return Boolean(compacting)
    if (id === 'rewind') return Boolean(compacting) || kernel === 'dsh'
    if (id === 'handoff') return running || Boolean(compacting)
    if (id === 'new' || id === 'plan' || id === 'model' || id === 'permissions') return running
    if (['understand', 'test', 'review', 'fix', 'summary'].includes(id)) return running || !workspaceReady
    if (['diff', 'mcp'].includes(id)) return !workspaceReady
    return false
  }

  const slashCommands = useMemo(() => {
    if (slashQuery === null) return []
    const commands = slashCommandCatalog.map(command => ({
      ...command,
      description: command.id === 'goal' && hasUnfinishedGoal
        ? t('当前已有持续目标', 'A goal is already in progress')
        : command.id === 'rewind' && kernel === 'dsh'
          ? t('此运行时暂不支持回退', 'This runtime cannot rewind')
          : command.description,
      disabled: slashCommandDisabled(command.id),
    })).filter(command => (
      !slashQuery
      || command.id.includes(slashQuery)
      || command.label.toLocaleLowerCase().includes(slashQuery)
      || command.keywords.some(keyword => keyword.toLocaleLowerCase().includes(slashQuery))
    ))
    if (slashQuery) commands.sort((left, right) => Number(right.id === slashQuery) - Number(left.id === slashQuery))
    return commands
  }, [slashQuery, hasUnfinishedGoal, kernel, running, compacting, workspaceReady, t])

  const slashMenuOpen = !slashMenuDismissed && slashCommands.length > 0
  const activeSlashCommand = slashCommands[activeSlashCommandIndex] ?? slashCommands[0]
  const goalStatusLabel = goal?.status === 'active' ? t('进行中', 'In progress')
    : goal?.status === 'paused' ? t('已暂停', 'Paused')
      : goal?.status === 'blocked' ? t('受阻', 'Blocked')
        : goal?.status === 'usage_limited' ? t('额度受限', 'Usage limited')
          : goal?.status === 'budget_limited' ? t('预算已用完', 'Budget exhausted')
            : goal?.status === 'queued' ? t('排队中', 'Queued')
              : t('已完成', 'Completed')
  const goalUsageLabel = goal?.tokenBudget ? `${goal.tokensUsed.toLocaleString()} / ${goal.tokenBudget.toLocaleString()} tokens` : ''
  const resumableGoal = ['paused', 'blocked', 'usage_limited', 'budget_limited'].includes(goal?.status ?? '')
  const showProgressSummary = (goal?.iteration ?? 0) > 0
  const showGoalDock = Boolean(goal || goalMode)

  useEffect(() => {
    if (!showGoalDock) setGoalPanelOpen(false)
  }, [showGoalDock])
  useEffect(() => {
    if (!goal) setGoalPanelOpen(false)
  }, [goal])

  useEffect(() => {
    function closeGoalPanelOnEscape(event: KeyboardEvent) {
      if (!goalPanelOpen || event.key !== 'Escape') return
      event.preventDefault()
      setGoalPanelOpen(false)
    }
    function closeGoalPanelOnOutsidePointer(event: PointerEvent) {
      if (!goalPanelOpen) return
      const slot = goalSlot.current
      if (slot && !slot.contains(event.target as Node)) setGoalPanelOpen(false)
    }
    document.addEventListener('pointerdown', closeGoalPanelOnOutsidePointer)
    document.addEventListener('keydown', closeGoalPanelOnEscape)
    return () => {
      document.removeEventListener('pointerdown', closeGoalPanelOnOutsidePointer)
      document.removeEventListener('keydown', closeGoalPanelOnEscape)
    }
  }, [goalPanelOpen])

  function toggleGoalChip() {
    if (goal) setGoalPanelOpen(open => !open)
    else props.onConsumeGoal?.()
  }

  const workspaceFixed = Boolean(workspaceLocked || ctfSession)
  const showWorkspaceChip = ctfSession
    ? Boolean(workspacePath?.trim() || workspaceName?.trim())
    : Boolean(workspaceName?.trim() || !workspaceLocked)
  const workspaceChipLabel = workspaceName?.trim() || t('选择项目', 'Choose a project')
  const hasSelectedWorkspace = Boolean(workspacePath?.trim())
  const workspaceChipTitle = workspacePath || workspaceChipLabel

  function formatAttachmentSize(size: number) {
    if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
    if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
    return `${size} B`
  }

  function startCodingAttachmentChooser(event?: Event) {
    if (running) return
    if (event instanceof PointerEvent && event.button !== 0) return
    if (event instanceof PointerEvent) {
      event.preventDefault()
      event.stopPropagation()
    }
    const now = Date.now()
    if (now - attachmentChooserStartedAt.current < 500) return
    attachmentChooserStartedAt.current = now
    void chooseCodingAttachments()
  }

  async function chooseCodingAttachments() {
    if (running) return
    setAttachmentError('')
    try {
      const selected = await invokeCommand<CodingAttachment[]>('choose_coding_attachments')
      mergeCodingAttachments(selected)
    } catch (reason) {
      setAttachmentError(reason instanceof Error ? reason.message : t('暂时无法添加附件。', 'Attachments cannot be added right now.'))
    }
  }

  function mergeCodingAttachments(selected: CodingAttachment[]) {
    const merged = new Map(pendingAttachments.map(value => [`${value.id}:${value.name}`, value]))
    for (const attachment of selected) merged.set(`${attachment.id}:${attachment.name}`, attachment)
    if (merged.size > 8) {
      setAttachmentError(t('每条消息最多添加 8 个附件。', 'Each message can have at most 8 attachments.'))
      return false
    }
    setPendingAttachments([...merged.values()])
    return true
  }

  function fileAsBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onerror = () => reject(reader.error ?? new Error(t('读取附件失败', 'Failed to read the attachment')))
      reader.onload = () => {
        const result = String(reader.result ?? '')
        const separator = result.indexOf(',')
        if (separator < 0) reject(new Error(t('读取附件失败', 'Failed to read the attachment')))
        else resolve(result.slice(separator + 1))
      }
      reader.readAsDataURL(file)
    })
  }

  function fallbackClipboardFileName(file: File, index: number) {
    if (file.name.trim()) return file.name.trim()
    const extension = file.type === 'image/jpeg' ? 'jpg' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : file.type === 'image/png' ? 'png' : 'bin'
    return `${t('粘贴附件', 'Pasted attachment')}-${Date.now()}-${index + 1}.${extension}`
  }

  async function importCodingFiles(files: File[]) {
    if (!files.length || attachmentImporting) return
    setAttachmentError('')
    if (pendingAttachments.length + files.length > 8) {
      setAttachmentError(t('每条消息最多添加 8 个附件。', 'Each message can have at most 8 attachments.'))
      return
    }
    if (files.some(file => file.size <= 0 || file.size > 32 * 1024 * 1024)) {
      setAttachmentError(t('单个附件必须在 1 字节到 32 MiB 之间。', 'Each attachment must be between 1 byte and 32 MiB.'))
      return
    }
    if (files.reduce((total, file) => total + file.size, 0) > 96 * 1024 * 1024) {
      setAttachmentError(t('附件合计不能超过 96 MiB。', 'Attachments together cannot exceed 96 MiB.'))
      return
    }
    setAttachmentImporting(true)
    try {
      const payloads: CodingAttachmentImport[] = await Promise.all(files.map(async (file, index) => ({
        name: fallbackClipboardFileName(file, index),
        mediaType: file.type || 'application/octet-stream',
        dataBase64: await fileAsBase64(file),
      })))
      const imported = await invokeCommand<CodingAttachment[]>('import_coding_attachments', { payloads })
      mergeCodingAttachments(imported)
    } catch (reason) {
      setAttachmentError(reason instanceof Error ? reason.message : t('暂时无法添加附件。', 'Attachments cannot be added right now.'))
    } finally {
      setAttachmentImporting(false)
    }
  }

  async function previewCodingAttachment(attachment: CodingAttachment) {
    setAttachmentError('')
    setAttachmentPreview(null)
    setAttachmentPreviewLoading(true)
    const dialog = attachmentPreviewDialog.current
    if (typeof dialog?.showModal === 'function') dialog.showModal()
    else dialog?.setAttribute('open', '')
    try {
      setAttachmentPreview(await invokeCommand<CodingAttachmentPreview>('preview_coding_attachment', { attachment }))
    } catch (reason) {
      setAttachmentError(reason instanceof Error ? reason.message : t('暂时无法预览附件。', 'This attachment cannot be previewed right now.'))
      if (typeof dialog?.close === 'function') dialog.close()
      else dialog?.removeAttribute('open')
    } finally {
      setAttachmentPreviewLoading(false)
    }
  }

  function removeCodingAttachment(attachment: CodingAttachment) {
    setPendingAttachments(current => current.filter(value => value.id !== attachment.id || value.name !== attachment.name))
  }

  function rememberComposerSnapshot() {
    if (applyingComposerHistory.current || composingRef.current) return
    const remembered = captureComposerSnapshot(composerHistory, composerHtml())
    if (remembered.history === composerHistory && remembered.future.length === 0) return
    setComposerHistory(remembered.history)
    setComposerFuture(remembered.future)
  }

  function undoComposer() {
    const next = undoComposerHistory(composerHistory, composerFuture, composerHtml())
    if (!next) return
    setComposerHistory(next.history)
    setComposerFuture(next.future)
    applyComposerHtml(next.html)
  }

  function redoComposer() {
    const next = redoComposerHistory(composerHistory, composerFuture, composerHtml())
    if (!next) return
    setComposerHistory(next.history)
    setComposerFuture(next.future)
    applyComposerHtml(next.html)
  }

  function detectSlashQuery() {
    setSlashQuery(null)
    slashQueryRange.current = null
    if (goalMode) return
    const editor = messageEditor.current
    if (!editor) return
    const selection = window.getSelection()
    let textNode: Node | null = selection?.focusNode ?? null
    let offset = selection?.focusOffset ?? 0
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE || !editor.contains(textNode)) {
      textNode = [...editor.childNodes].reverse().find(node => node.nodeType === Node.TEXT_NODE) ?? null
      offset = textNode?.textContent?.length ?? 0
    }
    if (!textNode || textNode.nodeType !== Node.TEXT_NODE) return
    const prefix = (textNode.textContent ?? '').slice(0, offset)
    const match = prefix.match(/(?:^|\s)\/([\p{L}\p{N}-]*)$/u)
    if (!match) return
    const query = match[1] ?? ''
    const range = document.createRange()
    range.setStart(textNode, offset - query.length - 1)
    range.setEnd(textNode, offset)
    setSlashQuery(query.toLocaleLowerCase())
    slashQueryRange.current = range
  }

  function syncComposerInput() {
    setDraft(readComposerText())
    const token = messageEditor.current?.querySelector<HTMLElement>('[data-composer-scope-token]')
    const tokenValue = token?.dataset.composerScopeToken
    setScopeToken(tokenValue === 'browser-use' || tokenValue === 'computer-use' ? tokenValue : null)
    setSkillToken(messageEditor.current?.querySelector<HTMLElement>('[data-composer-skill-token]')?.dataset.composerSkillToken ?? null)
    if (composingRef.current) return
    setSlashMenuDismissed(false)
    detectSlashQuery()
  }

  function removeSlashQueryText() {
    rememberComposerSnapshot()
    const range = slashQueryRange.current
    if (range) {
      range.deleteContents()
      const anchor = document.createTextNode('')
      range.insertNode(anchor)
      setCaretAfter(anchor)
    }
    setSlashQuery(null)
    slashQueryRange.current = null
    setDraft(readComposerText())
  }

  function removeInlineToken(selector: string) {
    const editor = messageEditor.current
    const token = editor?.querySelector<HTMLElement>(selector)
    if (token) {
      const next = token.nextSibling
      token.remove()
      if (next?.nodeType === Node.TEXT_NODE && next.textContent?.startsWith('\u00a0')) {
        next.textContent = next.textContent.slice(1)
      }
    }
  }

  async function focusMessageInput() {
    await Promise.resolve()
    messageEditor.current?.focus()
  }

  function removeScopeToken(refocus = true) {
    removeInlineToken('[data-composer-scope-token]')
    setScopeToken(null)
    pendingScopeSubmit.current = null
    setDraft(readComposerText())
    if (refocus) void focusMessageInput()
  }

  function removeSkillToken(refocus = true) {
    removeInlineToken('[data-composer-skill-token]')
    setSkillToken(null)
    setDraft(readComposerText())
    if (refocus) void focusMessageInput()
  }

  function createInlineToken(
    attribute: 'data-composer-scope-token' | 'data-composer-skill-token',
    value: string,
    labelText: string,
    ariaLabel: string,
    removeLabel: string,
    onRemove: () => void,
  ) {
    const token = document.createElement('span')
    token.className = 'chat-composer__inline-token'
    token.setAttribute(attribute, value)
    token.contentEditable = 'false'
    token.setAttribute('role', 'group')
    token.setAttribute('aria-label', ariaLabel)
    const label = document.createElement('span')
    label.textContent = labelText
    token.append(label)
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.className = 'chat-composer__inline-token-remove'
    remove.setAttribute('aria-label', removeLabel)
    remove.textContent = '×'
    remove.addEventListener('mousedown', event => event.preventDefault())
    remove.addEventListener('click', onRemove)
    token.append(remove)
    return token
  }

  function insertInlineToken(token: HTMLElement) {
    const editor = messageEditor.current
    if (!editor) return false
    rememberComposerSnapshot()
    const range = slashQueryRange.current ?? document.createRange()
    if (!slashQueryRange.current) {
      range.selectNodeContents(editor)
      range.collapse(false)
    }
    range.deleteContents()
    const spacer = document.createTextNode('\u00a0')
    range.insertNode(spacer)
    range.insertNode(token)
    setCaretAfter(spacer)
    setSlashQuery(null)
    slashQueryRange.current = null
    setDraft(readComposerText())
    return true
  }

  function insertScopeToken(value: ComposerScopeToken) {
    removeScopeToken(false)
    const label = value === 'browser-use' ? 'Browser Use' : 'Computer Use'
    const token = createInlineToken(
      'data-composer-scope-token', value, label, label,
      t(`移除 /${value}`, `Remove /${value}`),
      () => removeScopeToken(),
    )
    if (!insertInlineToken(token)) return
    setScopeToken(value)
    props.onRunSlashCommand?.(value)
  }

  function skillOption(name: string) {
    return availableSkillOptions.find(skill => skill.name === name)
  }

  function insertSkillToken(name: string) {
    removeSkillToken(false)
    const option = skillOption(name)
    const label = option?.label ?? name
    const token = createInlineToken(
      'data-composer-skill-token', name, `Skill · ${label}`,
      t(`${label} Skill 已加入`, `${label} Skill added`),
      t(`移除 ${label} Skill`, `Remove ${label} Skill`),
      () => removeSkillToken(),
    )
    if (!insertInlineToken(token)) return
    setSkillToken(name)
  }

  function clearComposerInput() {
    rememberComposerSnapshot()
    messageEditor.current?.replaceChildren()
    draftsByConversation.current.delete(currentConversationKey())
    setDraft('')
    setSlashQuery(null)
    slashQueryRange.current = null
    setScopeToken(null)
    pendingScopeSubmit.current = null
    setSkillToken(null)
  }

  function handleComposerPaste(event: React.ClipboardEvent) {
    const editor = messageEditor.current
    const files = [...(event.clipboardData?.files ?? [])]
    if (files.length) {
      event.preventDefault()
      void importCodingFiles(files)
      return
    }
    const text = event.clipboardData?.getData('text/plain') ?? ''
    if (!editor || !text) return
    event.preventDefault()
    rememberComposerSnapshot()
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : document.createRange()
    if (!editor.contains(range.commonAncestorContainer)) {
      range.selectNodeContents(editor)
      range.collapse(false)
    }
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    setCaretAfter(node)
    syncComposerInput()
  }

  function handleComposerDrop(event: React.DragEvent) {
    const editor = messageEditor.current
    const files = [...(event.dataTransfer?.files ?? [])]
    if (files.length) {
      event.preventDefault()
      void importCodingFiles(files)
      return
    }
    const text = event.dataTransfer?.getData('text/plain') ?? ''
    event.preventDefault()
    if (!editor || !text) return
    rememberComposerSnapshot()
    const range = document.caretRangeFromPoint?.(event.clientX, event.clientY) ?? document.createRange()
    if (!editor.contains(range.commonAncestorContainer)) {
      range.selectNodeContents(editor)
      range.collapse(false)
    }
    range.deleteContents()
    const node = document.createTextNode(text)
    range.insertNode(node)
    setCaretAfter(node)
    syncComposerInput()
  }

  function submit() {
    if (attachmentImporting) {
      setAttachmentError(t('附件仍在加入，请稍候。', 'Attachments are still being added. Please wait.'))
      return
    }
    const textValue = readComposerText()
    setDraft(textValue)
    const attachments = [...pendingAttachments]
    const text = textValue.trim() || (attachments.length ? t('请检查这些附件并完成我接下来需要处理的任务。', 'Please review these attachments and complete the task I need next.') : '')
    if (!text) return
    if (running && attachments.length) {
      setAttachmentError(t('运行中引导暂不支持附件；请等待当前回合结束后再发送附件。', 'Steering while a turn is running does not support attachments. Wait until this turn finishes.'))
      return
    }
    const activeSkillToken = skillToken ?? undefined
    const prompt = running ? text : goalMode ? `/goal ${text}` : activeSkillToken ? `/skill:${activeSkillToken} ${text}` : text
    const visiblePrompt = !running && activeSkillToken && !goalMode
      ? t(`使用 ${skillOption(activeSkillToken)?.label ?? activeSkillToken}\n${text}`, `Use ${skillOption(activeSkillToken)?.label ?? activeSkillToken}\n${text}`)
      : text
    const activeScopeToken = scopeToken ?? undefined
    const scopeReady = activeScopeToken === 'browser-use' ? browserUseReady : activeScopeToken === 'computer-use' ? computerUseReady : true
    if (!scopeReady && activeScopeToken) {
      pendingScopeSubmit.current = activeScopeToken === 'computer-use' ? activeScopeToken : null
      setAttachmentError(activeScopeToken === 'browser-use'
        ? t('Browser Use 需要已选项目，并使用 Go 权限。', 'Browser Use needs a selected project and Go permissions.')
        : t('请先在右栏锁定一个外部 App 窗口。', 'Lock an external app window in the right rail first.'))
      props.onRunSlashCommand?.(activeScopeToken)
      return
    }
    clearComposerInput()
    setPendingAttachments([])
    setAttachmentError('')
    if (activeScopeToken) props.onSend?.(prompt, visiblePrompt, attachments, activeScopeToken)
    else props.onSend?.(prompt, visiblePrompt, attachments)
    if (!running) props.onConsumeGoal?.()
  }

  function openComposerChooser(ariaLabel: string) {
    queueMicrotask(() => {
      composerFrame.current?.querySelector<HTMLButtonElement>(`[aria-label="${ariaLabel}"]`)?.click()
    })
  }

  function chooseSlashCommand(command = activeSlashCommand) {
    if (!command || command.disabled) return
    setComposing(false)
    composingRef.current = false
    setCompositionJustEnded(false)
    compositionJustEndedRef.current = false
    setSlashMenuDismissed(false)
    setActiveSlashCommandIndex(0)
    if (command.id === 'browser-use' || command.id === 'computer-use') {
      insertScopeToken(command.id)
      return
    }
    removeSlashQueryText()
    if (command.id === 'model') {
      openComposerChooser(t('选择本任务模型', 'Choose a model for this task'))
      return
    }
    if (command.id === 'permissions') {
      openComposerChooser(t('Coding 权限策略', 'Coding permission policy'))
      return
    }
    if (command.id === 'goal') {
      removeScopeToken(false)
      removeSkillToken(false)
      props.onStartGoal?.()
    } else if (command.id === 'plan') props.onChangeExecutionMode?.('plan')
    else props.onRunSlashCommand?.(command.id)
    void focusMessageInput()
  }

  function requestKernelChange(value: 'pi' | 'dsh') {
    if (kernelLocked && value !== (kernel ?? 'pi')) {
      setPendingMigrateKernel(value)
      return
    }
    props.onChangeKernel?.(value)
  }

  function confirmKernelMigrate() {
    const next = pendingMigrateKernel
    setPendingMigrateKernel(null)
    if (next) props.onMigrateKernel?.(next)
  }

  function togglePlanningMode() {
    props.onChangeExecutionMode?.(executionMode === 'plan' ? 'go' : 'plan')
    void focusMessageInput()
  }

  function startGoalFromPlus() {
    removeScopeToken(false)
    removeSkillToken(false)
    props.onStartGoal?.()
    void focusMessageInput()
  }

  function runComposerShortcut(command: 'browser' | 'mcp') {
    props.onRunSlashCommand?.(command)
    void focusMessageInput()
  }

  function openAddMenu() {
    openComposerChooser(t('添加内容与工具', 'Add content and tools'))
  }

  function toggleCatalogMcpServer(server: { name: string; reviewReady: boolean; scope?: string }) {
    if (server.scope === 'user') return
    if (running || !server.reviewReady || !mcpConfigDigest) return
    const selection = new Set(selectedMcpServers ?? [])
    if (selection.has(server.name)) selection.delete(server.name)
    else selection.add(server.name)
    props.onChangeMcpServers?.([...selection].sort((left, right) => left.localeCompare(right)), mcpConfigDigest)
  }

  function moveSlashCommandSelection(direction: 1 | -1) {
    if (!slashCommands.length) return
    let index = activeSlashCommandIndex
    for (let attempts = 0; attempts < slashCommands.length; attempts += 1) {
      index = (index + direction + slashCommands.length) % slashCommands.length
      if (!slashCommands[index]?.disabled) {
        setActiveSlashCommandIndex(index)
        return
      }
    }
  }

  function handleComposerKeyDown(event: React.KeyboardEvent) {
    const historyAction = isComposerHistoryKey(event.nativeEvent)
    if (historyAction) {
      if (event.nativeEvent.isComposing || composingRef.current || event.nativeEvent.keyCode === 229) return
      event.preventDefault()
      if (historyAction === 'undo') undoComposer()
      else redoComposer()
      return
    }
    if (slashMenuOpen) {
      if (event.key === 'Escape') {
        event.preventDefault()
        setSlashMenuDismissed(true)
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        if (event.nativeEvent.isComposing || composingRef.current || event.nativeEvent.keyCode === 229) return
        event.preventDefault()
        moveSlashCommandSelection(event.key === 'ArrowDown' ? 1 : -1)
        return
      }
      if (event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
        event.preventDefault()
        chooseSlashCommand()
        return
      }
    }
    if (event.nativeEvent.isComposing || composingRef.current || event.nativeEvent.keyCode === 229) return
    if (compositionJustEndedRef.current) {
      if (event.key === 'Enter') event.preventDefault()
      return
    }
    if (event.key === 'Escape' && (running || compacting)) {
      event.preventDefault()
      props.onAbort?.()
      return
    }
    if (event.key !== 'Enter' || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return
    event.preventDefault()
    submit()
  }

  function handleCompositionEnd() {
    setComposing(false)
    composingRef.current = false
    setCompositionJustEnded(true)
    compositionJustEndedRef.current = true
    syncComposerInput()
    window.setTimeout(() => {
      setCompositionJustEnded(false)
      compositionJustEndedRef.current = false
    }, 0)
  }

  function appendDraftText(text: string) {
    const normalized = text.trim()
    if (!normalized) return
    const editor = messageEditor.current
    if (!editor) return
    rememberComposerSnapshot()
    if (readComposerText().trim() || scopeToken || skillToken) {
      editor.append(document.createElement('br'), document.createElement('br'))
    }
    const textNode = document.createTextNode(normalized)
    editor.append(textNode)
    setCaretAfter(textNode)
    syncComposerInput()
  }

  useEffect(() => {
    setSlashMenuDismissed(false)
    setActiveSlashCommandIndex(0)
  }, [draft])

  useEffect(() => {
    if (!computerUseReady || running || pendingScopeSubmit.current !== 'computer-use' || scopeToken !== 'computer-use') return
    pendingScopeSubmit.current = null
    queueMicrotask(() => submit())
  }, [computerUseReady])

  useEffect(() => {
    if (!slashCommands.length) {
      setActiveSlashCommandIndex(0)
      return
    }
    if (activeSlashCommandIndex >= slashCommands.length || slashCommands[activeSlashCommandIndex]?.disabled) {
      const firstEnabled = slashCommands.findIndex(command => !command.disabled)
      setActiveSlashCommandIndex(firstEnabled >= 0 ? firstEnabled : 0)
    }
  }, [slashCommands])

  useImperativeHandle(ref, () => ({
    appendDraftText,
    openAddMenu,
    focusMessageInput,
  }), [])

  return (
    <>
      <style>{COMPOSER_STYLES}</style>
      <div className="chat-composer shrink-0 bg-transparent px-0 pb-2 pt-0" data-plugin-surface="chat-composer">
        <div ref={composerFrame} className="chat-composer__frame agent-thread">
          {slashMenuOpen ? (
            <div id="coding-slash-command-menu" className="chat-composer__command-menu" role="listbox" aria-label={t('斜杠命令', 'Slash commands')}>
              {slashCommands.map((command, index) => {
                const Icon = command.icon
                return (
                  <button
                    key={command.id}
                    id={`coding-slash-command-${command.id}`}
                    type="button"
                    className={`chat-composer__command-option${index === activeSlashCommandIndex ? ' chat-composer__command-option--active' : ''}${command.disabled ? ' opacity-50' : ''}`}
                    role="option"
                    aria-selected={index === activeSlashCommandIndex}
                    aria-disabled={command.disabled}
                    onPointerDown={event => {
                      event.preventDefault()
                      event.stopPropagation()
                      chooseSlashCommand(command)
                    }}
                    onMouseEnter={() => setActiveSlashCommandIndex(index)}
                  >
                    <Icon className="size-4 shrink-0" />
                    <span className="min-w-0 text-left">
                      <span className="block text-body font-medium">
                        <span className="font-mono">/{command.id}</span>
                        <span className="ml-2 text-muted-foreground">{command.label}</span>
                      </span>
                      <span className="mt-0.5 block text-caption text-muted-foreground">{command.description}</span>
                    </span>
                  </button>
                )
              })}
            </div>
          ) : null}

          {abortStalled ? (
            <p className="mb-1 text-caption text-muted-foreground" role="status">
              {t('停止请求尚未确认，可再次点击停止。', 'The stop request is not confirmed yet. You can press stop again.')}
            </p>
          ) : null}

          {queuedGuidance?.length ? (
            <section className="chat-composer__queued-guidance" aria-label={t('待应用引导', 'Queued steering')}>
              <div className="flex items-center gap-2 text-caption font-medium text-primary">
                <Clock3 className="size-3.5" />
                <span>{t(`${queuedGuidance.length} 条引导已排队`, `${queuedGuidance.length} steering messages queued`)}</span>
                <span className="font-normal text-muted-foreground">{queuedGuidanceStatus}</span>
              </div>
              {queuedGuidance.map((message, index) => (
                <div key={`${index}:${message}`} className="mt-1 flex items-center gap-2 rounded-xl border border-border/70 bg-background/55 px-2 py-1.5">
                  <p className="min-w-0 flex-1 truncate text-caption text-foreground" title={message}>{message}</p>
                  <Button type="button" variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground hover:text-foreground" aria-label={t(`编辑排队消息 ${index + 1}`, `Edit queued message ${index + 1}`)} title={t('撤回并编辑', 'Withdraw and edit')} onClick={() => props.onEditQueuedGuidance?.(index)}>
                    <Pencil className="size-3.5" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon-sm" className="shrink-0 text-muted-foreground hover:text-destructive" aria-label={t(`撤回排队消息 ${index + 1}`, `Withdraw queued message ${index + 1}`)} title={t('撤回', 'Withdraw')} onClick={() => props.onCancelQueuedGuidance?.(index)}>
                    <X className="size-3.5" />
                  </Button>
                </div>
              ))}
            </section>
          ) : null}

          <form className="chat-composer__island" onSubmit={event => { event.preventDefault(); submit() }}>
            {pendingAttachments.length ? (
              <div className="flex flex-wrap gap-2 px-1 pb-1" aria-label={t('待发送附件', 'Attachments to send')}>
                {pendingAttachments.map(attachment => (
                  <span key={`${attachment.id}:${attachment.name}`} className="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-caption" title={`${attachment.mediaType} · ${formatAttachmentSize(attachment.size)}`}>
                    <button type="button" className="inline-flex min-w-0 items-center gap-2 rounded-lg text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t(`预览 ${attachment.name}`, `Preview ${attachment.name}`)} onClick={() => void previewCodingAttachment(attachment)}>
                      <FileText className="size-3.5 shrink-0 text-muted-foreground" />
                      <span className="max-w-52 truncate">{attachment.name}</span>
                      <span className="shrink-0 text-muted-foreground">{formatAttachmentSize(attachment.size)}</span>
                    </button>
                    <button type="button" className="rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={t(`移除 ${attachment.name}`, `Remove ${attachment.name}`)} onClick={() => removeCodingAttachment(attachment)}>
                      <X className="size-3.5" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
            <div
              ref={messageEditor}
              className="chat-composer__input max-h-44 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
              contentEditable
              role="textbox"
              aria-label={t('消息', 'Message')}
              aria-multiline="true"
              aria-autocomplete="list"
              aria-controls={slashMenuOpen ? 'coding-slash-command-menu' : undefined}
              aria-expanded={slashMenuOpen}
              aria-activedescendant={slashMenuOpen && activeSlashCommand ? `coding-slash-command-${activeSlashCommand.id}` : undefined}
              data-placeholder={goalMode ? t('写下一个可持续目标，MilkSU 会持续推进并保留恢复点', 'Write a lasting goal. MilkSU will keep working toward it and keep recovery points.') : ctfSession ? t('告诉 Agent 你的观察、假设或下一步想法', 'Tell the agent your observations, hypotheses, or next idea') : t('描述你想让 MilkSU 完成的任务', 'Describe the task you want MilkSU to complete')}
              onCompositionStart={() => { setComposing(true); composingRef.current = true }}
              onCompositionEnd={handleCompositionEnd}
              onBeforeInput={rememberComposerSnapshot}
              onKeyDown={handleComposerKeyDown}
              onInput={() => syncComposerInput()}
              onKeyUp={detectSlashQuery}
              onClick={detectSlashQuery}
              onPaste={handleComposerPaste}
              onDrop={handleComposerDrop}
            />
            {contextUsage ? (
              <div className="chat-composer__context-strip flex min-w-0 items-center justify-end gap-3 px-1 pb-0.5" data-testid="composer-context-strip">
                <ContextUsageMeter usage={contextUsage} size="sm" running={running} compacting={Boolean(compacting)} onCompactContext={() => props.onRunSlashCommand?.('compact')} onHandoffContext={() => props.onRunSlashCommand?.('handoff')} />
              </div>
            ) : null}
            <div className="chat-composer__toolbar">
              <CodingComposerControls
                running={running}
                ctfSession={ctfSession}
                approvalPolicy={approvalPolicy}
                approvalLabel={approvalLabel}
                modelKey={modelKey}
                automaticModelLabel={automaticModelLabel}
                compactModelLabel={compactModelLabel}
                thinkingLevels={thinkingLevels}
                thinkingLevel={thinkingLevel}
                kernel={kernel ?? 'pi'}
                onChangeApprovalPolicy={value => props.onChangeApprovalPolicy?.(value)}
                onChangeModel={value => props.onChangeModel?.(value)}
                onChangeThinkingLevel={level => props.onChangeThinkingLevel?.(level)}
                onChangeKernel={requestKernelChange}
                onShowPermissions={() => props.onShowPermissions?.()}
                leading={(
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" variant="ghost" size="icon" className="chat-composer__add" disabled={running} aria-label={t('添加内容与工具', 'Add content and tools')} title={t('添加附件、工作方式或交互范围', 'Add attachments, a working mode, or an interaction scope')}>
                        <Plus className="size-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" side="top" sideOffset={8} collisionPadding={16} className="agent-floating composer-add-menu app-no-drag w-[31rem] max-w-[calc(100vw-2rem)] max-h-[min(24rem,calc(100vh-8rem))] overflow-y-auto p-1">
                      <DropdownMenuLabel className="px-3 pb-1.5 pt-2 text-caption">{t('添加', 'Add')}</DropdownMenuLabel>
                      <DropdownMenuItem className="composer-add-option app-no-drag cursor-pointer" onPointerDown={event => startCodingAttachmentChooser(event.nativeEvent)} onSelect={() => startCodingAttachmentChooser()}>
                        <Paperclip className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1"><span className="block text-label font-medium">{t('本机文件或图片', 'Local files or images')}</span></span>
                      </DropdownMenuItem>
                      {!workspaceFixed ? (
                        <DropdownMenuItem className="composer-add-option" onSelect={() => props.onChooseWorkspace?.()}>
                          <FolderOpen className="size-4 shrink-0" />
                          <span className="min-w-0 flex-1"><span className="block text-label font-medium">{t('项目目录', 'Project folder')}</span></span>
                        </DropdownMenuItem>
                      ) : null}
                      <DropdownMenuItem className="composer-add-option" disabled={running || goalMode || hasUnfinishedGoal} onSelect={startGoalFromPlus}>
                        <Target className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-label font-medium">{t('目标', 'Goal')}</span>
                          <span className="block text-caption text-muted-foreground">{hasUnfinishedGoal ? t('当前已有持续目标', 'A goal is already in progress') : t('设置一个持续追踪的目标', 'Set a goal to keep working toward')}</span>
                        </span>
                      </DropdownMenuItem>
                      <DropdownMenuItem className="composer-add-option" onSelect={togglePlanningMode}>
                        <Lightbulb className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-label font-medium">{executionMode === 'plan' ? t('退出计划模式', 'Exit plan mode') : t('计划模式', 'Plan mode')}</span>
                          <span className="block text-caption text-muted-foreground">{executionMode === 'plan' ? t('恢复使用当前授权工具', 'Resume using currently authorized tools') : t('只分析和规划，不修改文件', 'Analyze and plan only, without changing files')}</span>
                        </span>
                        {executionMode === 'plan' ? <Check className="size-4 shrink-0 text-primary" /> : null}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="px-3 pb-1.5 pt-2 text-caption">{t('浏览与控制', 'Browse and control')}</DropdownMenuLabel>
                      <DropdownMenuItem className="composer-add-option" disabled={!workspaceReady} onSelect={() => runComposerShortcut('browser')}>
                        <Monitor className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1"><span className="block text-label font-medium">{t('浏览器', 'Browser')}</span></span>
                      </DropdownMenuItem>
                      <DropdownMenuItem className="composer-add-option" onSelect={() => insertScopeToken('browser-use')}>
                        <Globe2 className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-label font-medium">Browser Use</span>
                          <span className="block text-caption text-muted-foreground">{t('选择真实浏览器标签页加入本轮输入', 'Choose a real browser tab for this turn')}</span>
                        </span>
                        {scopeToken === 'browser-use' ? <Check className="size-4 shrink-0 text-primary" /> : null}
                      </DropdownMenuItem>
                      <DropdownMenuItem className="composer-add-option" onSelect={() => insertScopeToken('computer-use')}>
                        <MousePointer2 className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-label font-medium">Computer Use</span>
                          <span className="block text-caption text-muted-foreground">{t('选择一个外部 App 窗口加入本轮输入', 'Choose an external app window for this turn')}</span>
                        </span>
                        {scopeToken === 'computer-use' ? <Check className="size-4 shrink-0 text-primary" /> : null}
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="px-3 pb-1.5 pt-2 text-caption">Skills</DropdownMenuLabel>
                      {availableSkillOptions.map(skill => {
                        const Icon = skill.icon
                        return (
                          <DropdownMenuItem key={skill.name} className="composer-add-option" disabled={!workspaceReady} onSelect={() => insertSkillToken(skill.name)}>
                            <Icon className="size-4 shrink-0" />
                            <span className="min-w-0 flex-1">
                              <span className="block text-label font-medium">{skill.label}</span>
                              {skill.description ? <span className="block text-caption text-muted-foreground">{skill.description}</span> : null}
                            </span>
                            {skillToken === skill.name ? <Check className="size-4 shrink-0 text-primary" /> : null}
                          </DropdownMenuItem>
                        )
                      })}
                      <DropdownMenuSeparator />
                      <DropdownMenuLabel className="px-3 pb-1.5 pt-2 text-caption">MCP</DropdownMenuLabel>
                      {(mcpCatalog ?? []).map(server => (
                        <DropdownMenuItem key={server.name} className="composer-add-option" disabled={running || (server.scope !== 'user' && (!server.reviewReady || !mcpConfigDigest))} onSelect={() => toggleCatalogMcpServer(server)}>
                          <Plug className="size-4 shrink-0" />
                          <span className="min-w-0 flex-1">
                            <span className="block text-label font-medium">{server.name}</span>
                            <span className="block text-caption text-muted-foreground">
                              {server.scope === 'user' ? t('已在设置中启用', 'Enabled in Settings') : server.reviewReady ? t('为本任务接入', 'Attach to this task') : t('审阅信息不完整', 'Review details incomplete')}
                            </span>
                          </span>
                          {server.scope === 'user' || selectedMcpServers?.includes(server.name) ? <Check className="size-4 shrink-0 text-primary" /> : null}
                        </DropdownMenuItem>
                      ))}
                      <DropdownMenuItem className="composer-add-option" disabled={!workspaceReady} onSelect={() => runComposerShortcut('mcp')}>
                        <Plug className="size-4 shrink-0" />
                        <span className="min-w-0 flex-1">
                          <span className="block text-label font-medium">{t('项目 MCP', 'Project MCP')}</span>
                          {selectedMcpDescription ? <span className="block truncate text-caption text-muted-foreground">{selectedMcpDescription}</span> : <span className="block text-caption text-muted-foreground">{t('查看当前项目的 MCP 服务', 'View MCP servers for this project')}</span>}
                        </span>
                        {selectedMcpServers?.length ? <Check className="size-4 shrink-0 text-primary" /> : null}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
                status={(
                  <>
                    {showGoalDock ? (
                      <div ref={goalSlot} className="chat-composer__goal-slot" aria-label={t('持续目标', 'Ongoing goal')}>
                        <button
                          type="button"
                          className="chat-composer__chip chat-composer__chip--goal"
                          aria-haspopup={goal ? true : undefined}
                          aria-expanded={goal ? goalPanelOpen : undefined}
                          title={goal ? t(`持续目标：${goal.text}（点击展开）`, `Ongoing goal: ${goal.text} (click to expand)`) : t('目标模式已开启；下一条消息会成为持续目标，点击退出', 'Goal mode is on. The next message becomes the ongoing goal. Click to exit.')}
                          onClick={toggleGoalChip}
                        >
                          <Target className="size-3.5 shrink-0" />
                          <span className="chat-composer__chip__label">{goal ? goalStatusLabel : t('目标', 'Goal')}</span>
                          <ChevronDown className="chat-composer__chip__chevron size-3 shrink-0 opacity-60" />
                        </button>
                        {goalPanelOpen ? (
                          <div className="chat-composer__goal-panel" aria-label={t('持续目标详情', 'Ongoing goal details')}>
                            <div className="flex items-center gap-2">
                              <Target className="size-4 shrink-0 text-primary" />
                              <span className="shrink-0 text-caption font-medium text-primary">{goal ? goalStatusLabel : t('正在设置', 'Setting up')}</span>
                              {goalUsageLabel ? <span className="ml-auto shrink-0 text-caption text-muted-foreground">{goalUsageLabel}</span> : null}
                            </div>
                            <p className="mt-2 truncate text-body" title={goal?.text}>{goal?.text || t('下一条消息会成为持续目标。', 'The next message becomes the ongoing goal.')}</p>
                            <div className="mt-3 flex items-center gap-1">
                              {goal?.status === 'active' ? (
                                <Button type="button" variant="ghost" size="icon-sm" disabled={aborting} aria-label={aborting ? t('正在暂停目标', 'Pausing goal') : t('暂停目标', 'Pause goal')} title={aborting ? t('正在等待当前回合停止', 'Waiting for the current turn to stop') : t('暂停持续目标', 'Pause the ongoing goal')} onClick={() => props.onControlGoal?.('pause')}>
                                  {aborting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Pause className="size-3.5" />}
                                </Button>
                              ) : null}
                              {goal && resumableGoal ? (
                                <Button type="button" variant="ghost" size="icon-sm" disabled={running} aria-label={t('继续目标', 'Resume goal')} title={t('继续持续目标', 'Resume the ongoing goal')} onClick={() => props.onControlGoal?.('resume')}>
                                  <Play className="size-3.5" />
                                </Button>
                              ) : null}
                              {goal && !running ? (
                                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('清除当前目标', 'Clear current goal')} title={t('清除当前目标', 'Clear current goal')} onClick={() => props.onControlGoal?.('clear')}>
                                  <Trash2 className="size-3.5" />
                                </Button>
                              ) : goalMode && !goal ? (
                                <Button type="button" variant="ghost" size="icon-sm" aria-label={t('取消目标模式', 'Cancel goal mode')} title={t('取消目标模式', 'Cancel goal mode')} onClick={() => props.onConsumeGoal?.()}>
                                  <X className="size-3.5" />
                                </Button>
                              ) : null}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {executionMode === 'plan' ? (
                      <button type="button" className="chat-composer__chip chat-composer__chip--plan" aria-label={t('计划模式已开启', 'Plan mode is on')} title={t('只分析和规划，不修改文件；点击退出计划模式', 'Analyze and plan only, without changing files. Click to exit plan mode.')} onClick={() => props.onChangeExecutionMode?.('go')}>
                        <Lightbulb className="size-3.5 shrink-0" />
                        <span className="chat-composer__chip__label">{t('计划', 'Plan')}</span>
                      </button>
                    ) : null}
                    {showProgressSummary ? (
                      <div className="chat-composer__progress-pill" aria-label={t('任务进度摘要', 'Task progress summary')}>
                        {goal?.status === 'active' ? <AkLoadingMark label={t('目标进行中', 'Goal in progress')} /> : null}
                        {goal?.iteration ? <span>{t(`第 ${goal.iteration} 轮`, `Turn ${goal.iteration}`)}</span> : null}
                      </div>
                    ) : null}
                  </>
                )}
                context={showWorkspaceChip ? (
                  <>
                    <div className={`chat-composer__workspace${workspaceFixed ? ' chat-composer__workspace--locked' : ''}`}>
                      {!workspaceFixed ? (
                        <button type="button" className={`chat-composer__chip chat-composer__chip--workspace${!hasSelectedWorkspace ? ' chat-composer__chip--workspace-empty' : ''}${hasSelectedWorkspace ? ' chat-composer__chip--workspace-split' : ''}`} disabled={running} aria-label={hasSelectedWorkspace ? t(`会话目录：${workspaceChipLabel}`, `Session folder: ${workspaceChipLabel}`) : t('选择项目', 'Choose a project')} title={workspaceChipTitle} onClick={() => props.onChooseWorkspace?.()}>
                          <FolderOpen className="size-3.5 shrink-0" />
                          <span className="chat-composer__chip__label">{workspaceChipLabel}</span>
                        </button>
                      ) : (
                        <span className="chat-composer__chip chat-composer__chip--workspace" aria-label={t(`会话目录：${workspaceChipLabel}`, `Session folder: ${workspaceChipLabel}`)} title={workspaceChipTitle}>
                          <FolderOpen className="size-3.5 shrink-0" />
                          <span className="chat-composer__chip__label">{workspaceChipLabel}</span>
                        </span>
                      )}
                      {hasSelectedWorkspace && !workspaceFixed ? (
                        <button type="button" className="chat-composer__workspace-clear" disabled={running} aria-label={t('清空项目', 'Clear project')} title={t('清空项目', 'Clear project')} onClick={event => { event.stopPropagation(); props.onClearWorkspace?.() }}>
                          <X className="size-3.5" />
                        </button>
                      ) : null}
                    </div>
                    {gitRepository && (gitBranches ?? []).length ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button type="button" className="chat-composer__chip" disabled={running} aria-label={t(`当前分支：${gitBranch || t('选择分支', 'Choose a branch')}`, `Current branch: ${gitBranch || t('选择分支', 'Choose a branch')}`)} title={gitBranch || t('选择分支', 'Choose a branch')}>
                            <GitBranch className="size-3.5 shrink-0" />
                            <span className="chat-composer__chip__label">{gitBranch || t('分支', 'Branch')}</span>
                            <ChevronDown className="chat-composer__chip__chevron size-3 shrink-0 opacity-60" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" sideOffset={8} className="agent-floating min-w-48 p-1">
                          {(gitBranches ?? []).map(branch => (
                            <DropdownMenuItem key={branch} className="cursor-pointer" onSelect={() => props.onCheckoutBranch?.(branch)}>
                              <span className="min-w-0 flex-1 truncate">{branch}</span>
                              {branch === gitBranch ? <Check className="size-3.5 shrink-0" /> : null}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </>
                ) : undefined}
              />
              {running || compacting ? (
                <Button type="button" variant="destructive" size="icon" className="chat-composer__stop" disabled={aborting} aria-label={aborting ? t('正在停止 Agent', 'Stopping agent') : abortStalled ? t('重试停止 Agent', 'Retry stopping the agent') : compacting ? t('停止整理上下文', 'Stop compacting context') : t('停止 Agent', 'Stop agent')} title={aborting ? t('正在等待 Agent 安全停止', 'Waiting for the agent to stop safely') : abortStalled ? t('停止请求未确认，点击重试', 'The stop request is not confirmed. Click to retry.') : compacting ? t('取消当前上下文整理', 'Cancel the current context compaction') : t('停止当前 Agent 回合', 'Stop the current agent turn')} onPointerDown={event => { event.preventDefault(); event.stopPropagation(); props.onAbort?.() }} onClick={event => { event.preventDefault(); event.stopPropagation(); props.onAbort?.() }}>
                  {aborting ? <LoaderCircle className="size-3.5 animate-spin" /> : <Square className="size-3.5 fill-current" />}
                </Button>
              ) : null}
              {!compacting && (!running || draft.trim() || pendingAttachments.length) ? (
                <Button type="submit" variant="brand" size="icon" className="chat-composer__send" disabled={attachmentImporting || (!draft.trim() && !pendingAttachments.length)} aria-label={running ? t('发送引导', 'Send steering') : t('发送', 'Send')} title={running ? sendSteeringTitle : t('发送', 'Send')}>
                  <ArrowUp className="size-4" />
                </Button>
              ) : null}
            </div>
          </form>
          {attachmentError ? <p className="px-2 pt-1.5 text-caption text-destructive">{attachmentError}</p> : attachmentImporting ? (
            <p className="chat-model-loading px-2 pt-1.5">
              <AkLoadingMark label={t('正在加入附件', 'Adding attachments')} showLabel />
            </p>
          ) : null}
        </div>
        <dialog
          ref={attachmentPreviewDialog}
          className="m-auto max-h-[calc(100vh-3rem)] w-[min(760px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-[var(--shadow-modal)] backdrop:bg-foreground/25 backdrop:backdrop-blur-[2px]"
          aria-labelledby="coding-attachment-preview-title"
          onClick={event => { if (event.target === event.currentTarget) attachmentPreviewDialog.current?.close() }}
        >
          <section className="flex max-h-[calc(100vh-3rem)] flex-col">
            <header className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
              <div className="min-w-0">
                <h2 id="coding-attachment-preview-title" className="truncate text-lg font-semibold">{attachmentPreview?.name || t('附件预览', 'Attachment preview')}</h2>
                {attachmentPreview ? <p className="text-caption text-muted-foreground">{attachmentPreview.mediaType} · {formatAttachmentSize(attachmentPreview.size)}</p> : null}
              </div>
              <Button type="button" variant="ghost" size="icon-sm" aria-label={t('关闭附件预览', 'Close attachment preview')} onClick={() => attachmentPreviewDialog.current?.close()}>
                <X className="size-4" />
              </Button>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-5">
              {attachmentPreviewLoading ? (
                <div className="grid min-h-48 place-items-center">
                  <AkLoadingMark label={t('正在加载预览', 'Loading preview')} showLabel />
                </div>
              ) : attachmentPreview?.kind === 'image' && attachmentPreview.dataUrl ? (
                <img
                  src={attachmentPreview.dataUrl}
                  alt={attachmentPreview.name}
                  className="mx-auto max-h-[65vh] max-w-full rounded-lg object-contain"
                />
              ) : attachmentPreview?.kind === 'text' ? (
                <pre className="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-4 font-mono text-caption">{attachmentPreview.text}</pre>
              ) : (
                <p className="text-body text-muted-foreground">
                  {t('此附件已加入发送队列；当前格式不提供内嵌内容预览。', 'This attachment is queued to send. This format has no inline preview.')}
                </p>
              )}
            </div>
          </section>
        </dialog>
        <Dialog
          open={Boolean(pendingMigrateKernel)}
          onOpenChange={value => { if (!value) setPendingMigrateKernel(null) }}
        >
          <DialogContent className="sm:max-w-md">
            <DialogTitle>{t('迁移到新对话？', 'Move to a new conversation?')}</DialogTitle>
            <DialogDescription>
              {t(
                '这个对话已经开始，不能中途更换 Agent 运行时。整理当前对话并在新对话中继续？',
                'This conversation has already started, so the agent runtime cannot change here. Compact it and continue in a new conversation?',
              )}
            </DialogDescription>
            <div className="mt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setPendingMigrateKernel(null)}>
                {t('取消', 'Cancel')}
              </Button>
              <Button type="button" variant="brand" onClick={confirmKernelMigrate}>
                {t('整理并迁移', 'Compact and move')}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </>
  )
})

export default ChatComposer
