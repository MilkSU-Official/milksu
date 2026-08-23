<script setup lang="ts">
import { computed, markRaw, nextTick, onBeforeUnmount, onMounted, ref, watch, type Component } from 'vue'
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '@felinic/ui'
import {
  Activity,
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
  Trash2,
  Wrench,
  X,
} from 'lucide-vue-next'
import AkLoadingMark from '@/components-vue/AkLoadingMark.vue'
import CodingComposerControls from '@/components-vue/CodingComposerControls.vue'
import ContextUsageMeter from '@/components-vue/ContextUsageMeter.vue'
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
import type { CodingGitChange, CodingRecentProject } from '@/codingEnvironmentTypes'
import type { ContextUsagePresentation } from '@/lib/sessionTurnStatus'
import { CODING_SKILLS } from '@/codingSkills'

interface ComposerGitSummary {
  changedFiles: number
  additions: number
  deletions: number
  changes?: CodingGitChange[]
  changesTruncated?: boolean
}

type ComposerScopeToken = 'browser-use' | 'computer-use'

interface ComposerSkillOption {
  name: string
  label: string
  description: string
  icon: Component
}

const skillIcons: Record<string, Component> = {
  'product-design': Palette,
  'frontend-visual-qa': ScanSearch,
  'integrate-api': Cable,
  'review-security': ShieldCheck,
  'create-technical-deliverables': FileText,
  archify: Route,
  'release-milksu': PackageCheck,
}

const reviewedComposerSkills: ComposerSkillOption[] = CODING_SKILLS.map(skill => ({
  ...skill,
  icon: markRaw(skillIcons[skill.name] ?? Plug),
}))

const props = defineProps<{
  running: boolean
  aborting: boolean
  compacting?: boolean
  ctfSession: boolean
  goalMode: boolean
  goal?: CodingGoalState
  gitSummary?: ComposerGitSummary
  executionMode: CodingExecutionMode
  approvalPolicy: CodingApprovalPolicy
  approvalLabel: string
  modelKey: string
  automaticModelLabel: string
  compactModelLabel: string
  thinkingLevels?: ModelThinkingLevel[]
  thinkingLevel?: ModelThinkingLevel
  compactDisabled?: boolean
  /** Last model usage projection; meter shows ring + hover details when present. */
  contextUsage?: ContextUsagePresentation | null
  /** Live model-run elapsed label, e.g. "1:05". */
  runElapsedLabel?: string
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
  selectedMcpServers?: string[]
  mcpCatalog?: Array<{ name: string; reviewReady: boolean }>
  mcpConfigDigest?: string
  queuedGuidance?: string[]
}>()

const emit = defineEmits<{
  send: [
    text: string,
    visibleText?: string,
    attachments?: CodingAttachment[],
    scopeToken?: ComposerScopeToken,
  ]
  abort: []
  openChanges: [path?: string]
  changeExecutionMode: [value: string]
  changeApprovalPolicy: [value: string]
  changeModel: [value: string]
  changeThinkingLevel: [level: ModelThinkingLevel]
  showPermissions: []
  consumeGoal: []
  startGoal: []
  runSlashCommand: [command: string]
  changeMcpServers: [servers: string[], digest: string]
  controlGoal: [action: 'pause' | 'resume' | 'clear']
  chooseWorkspace: []
  selectWorkspace: [path: string]
  forgetWorkspace: [path: string]
  clearWorkspace: []
  checkoutBranch: [branch: string]
  cancelQueuedGuidance: [index: number]
  editQueuedGuidance: [index: number]
}>()

const draft = ref('')
const composerFrame = ref<HTMLElement | null>(null)
const messageEditor = ref<HTMLElement | null>(null)
const pendingAttachments = ref<CodingAttachment[]>([])
const attachmentError = ref('')
const attachmentImporting = ref(false)
const attachmentPreviewDialog = ref<HTMLDialogElement | null>(null)
const attachmentPreview = ref<CodingAttachmentPreview | null>(null)
const attachmentPreviewLoading = ref(false)
const composerHistory = ref<string[]>([])
const composerFuture = ref<string[]>([])
let applyingComposerHistory = false
let attachmentChooserStartedAt = 0
const composing = ref(false)
const compositionJustEnded = ref(false)
const slashMenuDismissed = ref(false)
const activeSlashCommandIndex = ref(0)
const slashQuery = ref<string | null>(null)
const slashQueryRange = ref<Range | null>(null)
const scopeToken = ref<ComposerScopeToken | null>(null)
const pendingScopeSubmit = ref<ComposerScopeToken | null>(null)
const skillToken = ref<string | null>(null)
const hasUnfinishedGoal = computed(() => Boolean(
  props.goal && props.goal.status !== 'complete',
))
const availableSkillOptions = computed(() => {
  const available = new Set(props.availableSkills ?? [])
  const known = new Map(reviewedComposerSkills
    .filter(skill => available.has(skill.name))
    .map(skill => [skill.name, skill]))
  for (const name of props.availableSkills ?? []) {
    if (!name || known.has(name)) continue
    known.set(name, {
      name,
      label: name,
      description: '',
      icon: markRaw(Plug),
    })
  }
  return [...known.values()]
})
const selectedMcpDescription = computed(() => {
  const servers = props.selectedMcpServers ?? []
  if (!servers.length) return ''
  const names = servers.slice(0, 2).join('、')
  return `${servers.length} 个已接入${names ? `：${names}` : ''}`
})

const slashCommandCatalog = [
  {
    id: 'goal',
    label: '目标',
    description: '设置一个持续追踪的目标',
    keywords: ['target'],
    icon: markRaw(Target),
  },
  {
    id: 'new',
    label: '新任务',
    description: '开始一个新的编码会话',
    keywords: ['clear', '新建'],
    icon: markRaw(MessageSquarePlus),
  },
  {
    id: 'plan',
    label: '计划模式',
    description: '只分析和规划，不修改文件',
    keywords: ['mode', '规划'],
    icon: markRaw(Lightbulb),
  },
  {
    id: 'understand',
    label: '理解项目',
    description: '读取入口、结构、运行方式和风险',
    keywords: ['project', '项目', '了解'],
    icon: markRaw(Compass),
  },
  {
    id: 'test',
    label: '运行测试',
    description: '自动识别并运行项目的主验证链',
    keywords: ['verify', '测试'],
    icon: markRaw(Terminal),
  },
  {
    id: 'review',
    label: '审阅变更',
    description: '按文件和风险检查当前 Git 变更',
    keywords: ['diff', 'code-review', '审查', '审阅'],
    icon: markRaw(ScanSearch),
  },
  {
    id: 'fix',
    label: '修复失败',
    description: '复现最近失败并完成最小修复',
    keywords: ['repair', '修复'],
    icon: markRaw(Wrench),
  },
  {
    id: 'summary',
    label: '生成总结',
    description: '汇总改动、验证、风险和下一步',
    keywords: ['report', '总结'],
    icon: markRaw(FileText),
  },
  {
    id: 'compact',
    label: '整理上下文',
    description: '整理当前会话上下文',
    keywords: ['context', '上下文', 'summarize'],
    icon: markRaw(Shrink),
  },
  {
    id: 'model',
    label: '模型',
    description: '打开当前任务的模型选择',
    keywords: ['provider', '模型'],
    icon: markRaw(Bot),
  },
  {
    id: 'permissions',
    label: '权限',
    description: '打开审批与访问范围选择',
    keywords: ['approve', 'approval', '权限'],
    icon: markRaw(ShieldCheck),
  },
  {
    id: 'status',
    label: '状态',
    description: '查看会话、Git 和运行环境',
    keywords: ['session', 'environment', '状态'],
    icon: markRaw(Activity),
  },
  {
    id: 'diff',
    label: '变更',
    description: '查看当前工作区的文件改动',
    keywords: ['changes', '变更'],
    icon: markRaw(FileDiff),
  },
  {
    id: 'mcp',
    label: 'MCP',
    description: '查看或接入当前项目的 MCP 服务',
    keywords: ['tools', '工具'],
    icon: markRaw(Plug),
  },
  {
    id: 'browser',
    label: '浏览器',
    description: '打开隔离浏览器',
    keywords: ['playwright', '浏览器'],
    icon: markRaw(Monitor),
  },
  {
    id: 'browser-use',
    label: 'Browser Use',
    description: '把一个用户浏览器窗口加入本轮输入',
    keywords: ['chrome', 'safari', '浏览器'],
    icon: markRaw(Globe2),
  },
  {
    id: 'computer-use',
    label: 'Computer Use',
    description: '把一个外部 App 窗口加入本轮输入',
    keywords: ['app', '窗口', '电脑'],
    icon: markRaw(MousePointer2),
  },
] as const

function slashCommandDisabled(id: typeof slashCommandCatalog[number]['id']) {
  if (id === 'goal') return props.running || hasUnfinishedGoal.value
  // Compact is invoked even before Pi session.ready and while a turn is
  // running. Native disabled buttons drop pointer events, which lets IME
  // cancel `/compact` on click. Only skip when compaction is already live.
  if (id === 'compact') return Boolean(props.compacting)
  if (id === 'new' || id === 'plan' || id === 'model' || id === 'permissions') {
    return props.running
  }
  if (['understand', 'test', 'review', 'fix', 'summary'].includes(id)) {
    return props.running || !props.workspaceReady
  }
  if (['diff', 'mcp'].includes(id)) return !props.workspaceReady
  return false
}

const slashCommands = computed(() => {
  const query = slashQuery.value
  if (query === null) return []
  const commands = slashCommandCatalog.map(command => ({
    ...command,
    description: command.id === 'goal' && hasUnfinishedGoal.value
      ? '当前已有持续目标'
      : command.description,
    disabled: slashCommandDisabled(command.id),
  })).filter(command => (
    !query
    || command.id.includes(query)
    || command.label.toLocaleLowerCase().includes(query)
    || command.keywords.some(keyword => keyword.toLocaleLowerCase().includes(query))
  ))
  if (query) {
    commands.sort((left, right) => Number(right.id === query) - Number(left.id === query))
  }
  return commands
})
const slashMenuOpen = computed(() => (
  !slashMenuDismissed.value && slashCommands.value.length > 0
))
const activeSlashCommand = computed(() => (
  slashCommands.value[activeSlashCommandIndex.value]
  ?? slashCommands.value[0]
))
const goalStatusLabel = computed(() => {
  const status = props.goal?.status
  if (status === 'active') return '进行中'
  if (status === 'paused') return '已暂停'
  if (status === 'blocked') return '受阻'
  if (status === 'usage_limited') return '额度受限'
  if (status === 'budget_limited') return '预算已用完'
  if (status === 'queued') return '排队中'
  return '已完成'
})
const goalUsageLabel = computed(() => {
  const goal = props.goal
  if (!goal?.tokenBudget) return ''
  return `${goal.tokensUsed.toLocaleString()} / ${goal.tokenBudget.toLocaleString()} tokens`
})
const resumableGoal = computed(() => (
  ['paused', 'blocked', 'usage_limited', 'budget_limited'].includes(
    props.goal?.status ?? '',
  )
))
const showGitSummary = computed(() => Boolean(
  props.gitSummary && props.gitSummary.changedFiles > 0,
))
const showProgressSummary = computed(() => Boolean(
  (props.goal?.iteration ?? 0) > 0 || showGitSummary.value,
))
const showGoalDock = computed(() => Boolean(
  props.goal || props.goalMode,
))
const goalPanelOpen = ref(false)
const goalSlot = ref<HTMLElement | null>(null)
watch(showGoalDock, visible => {
  if (!visible) goalPanelOpen.value = false
})
watch(() => props.goal, goal => {
  if (!goal) goalPanelOpen.value = false
})
function closeGoalPanelOnEscape(event: KeyboardEvent) {
  if (!goalPanelOpen.value || event.key !== 'Escape') return
  event.preventDefault()
  goalPanelOpen.value = false
}
function closeGoalPanelOnOutsidePointer(event: PointerEvent) {
  if (!goalPanelOpen.value) return
  const slot = goalSlot.value
  if (slot && !slot.contains(event.target as Node)) goalPanelOpen.value = false
}
onMounted(() => {
  document.addEventListener('pointerdown', closeGoalPanelOnOutsidePointer)
  document.addEventListener('keydown', closeGoalPanelOnEscape)
})
onBeforeUnmount(() => {
  document.removeEventListener('pointerdown', closeGoalPanelOnOutsidePointer)
  document.removeEventListener('keydown', closeGoalPanelOnEscape)
})
function toggleGoalChip() {
  if (props.goal) {
    goalPanelOpen.value = !goalPanelOpen.value
  } else {
    emit('consumeGoal')
  }
}
const workspaceFixed = computed(() => Boolean(props.workspaceLocked || props.ctfSession))
const showWorkspaceChip = computed(() => {
  if (props.ctfSession) return Boolean(props.workspacePath?.trim() || props.workspaceName?.trim())
  return Boolean(props.workspaceName?.trim() || !props.workspaceLocked)
})
const workspaceChipLabel = computed(() => props.workspaceName?.trim() || '选择项目')
const hasSelectedWorkspace = computed(() => Boolean(props.workspacePath?.trim()))
const workspaceChipTitle = computed(() => (
  props.workspacePath || workspaceChipLabel.value
))

function formatAttachmentSize(size: number) {
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function gitChangeStatus(change: CodingGitChange) {
  if (change.conflict) return '冲突'
  if (change.untracked) return '新增'
  if (change.staged && change.modified) return '暂存/修改'
  if (change.staged) return '已暂存'
  return '修改'
}

function startCodingAttachmentChooser(event?: Event) {
  if (props.running) return
  if (event instanceof PointerEvent && event.button !== 0) return
  // Start on pointerdown so Electron still has a user gesture for the native
  // dialog. Keyboard activation still arrives as a select event.
  if (event instanceof PointerEvent) {
    event.preventDefault()
    event.stopPropagation()
  }
  const now = Date.now()
  if (now - attachmentChooserStartedAt < 500) return
  attachmentChooserStartedAt = now
  void chooseCodingAttachments()
}

async function chooseCodingAttachments() {
  if (props.running) return
  attachmentError.value = ''
  try {
    const selected = await invokeCommand<CodingAttachment[]>('choose_coding_attachments')
    const merged = new Map(
      pendingAttachments.value.map(value => [`${value.id}:${value.name}`, value]),
    )
    for (const attachment of selected) {
      merged.set(`${attachment.id}:${attachment.name}`, attachment)
    }
    if (merged.size > 8) {
      attachmentError.value = '每条消息最多添加 8 个附件。'
      return
    }
    pendingAttachments.value = [...merged.values()]
  } catch (reason) {
    attachmentError.value = reason instanceof Error
      ? reason.message
      : '暂时无法添加附件。'
  }
}

function mergeCodingAttachments(selected: CodingAttachment[]) {
  const merged = new Map(
    pendingAttachments.value.map(value => [`${value.id}:${value.name}`, value]),
  )
  for (const attachment of selected) {
    merged.set(`${attachment.id}:${attachment.name}`, attachment)
  }
  if (merged.size > 8) {
    attachmentError.value = '每条消息最多添加 8 个附件。'
    return false
  }
  pendingAttachments.value = [...merged.values()]
  return true
}

function fileAsBase64(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('读取附件失败'))
    reader.onload = () => {
      const result = String(reader.result ?? '')
      const separator = result.indexOf(',')
      if (separator < 0) reject(new Error('读取附件失败'))
      else resolve(result.slice(separator + 1))
    }
    reader.readAsDataURL(file)
  })
}

function fallbackClipboardFileName(file: File, index: number) {
  if (file.name.trim()) return file.name.trim()
  const extension = file.type === 'image/jpeg'
    ? 'jpg'
    : file.type === 'image/webp'
      ? 'webp'
      : file.type === 'image/gif'
        ? 'gif'
        : file.type === 'image/png'
          ? 'png'
          : 'bin'
  return `粘贴附件-${Date.now()}-${index + 1}.${extension}`
}

async function importCodingFiles(files: File[]) {
  if (!files.length || attachmentImporting.value) return
  attachmentError.value = ''
  if (pendingAttachments.value.length + files.length > 8) {
    attachmentError.value = '每条消息最多添加 8 个附件。'
    return
  }
  if (files.some(file => file.size <= 0 || file.size > 32 * 1024 * 1024)) {
    attachmentError.value = '单个附件必须在 1 字节到 32 MiB 之间。'
    return
  }
  if (files.reduce((total, file) => total + file.size, 0) > 96 * 1024 * 1024) {
    attachmentError.value = '附件合计不能超过 96 MiB。'
    return
  }
  attachmentImporting.value = true
  try {
    const payloads: CodingAttachmentImport[] = await Promise.all(files.map(async (file, index) => ({
      name: fallbackClipboardFileName(file, index),
      mediaType: file.type || 'application/octet-stream',
      dataBase64: await fileAsBase64(file),
    })))
    const imported = await invokeCommand<CodingAttachment[]>('import_coding_attachments', { payloads })
    mergeCodingAttachments(imported)
  } catch (reason) {
    attachmentError.value = reason instanceof Error ? reason.message : '暂时无法添加附件。'
  } finally {
    attachmentImporting.value = false
  }
}

async function previewCodingAttachment(attachment: CodingAttachment) {
  attachmentError.value = ''
  attachmentPreview.value = null
  attachmentPreviewLoading.value = true
  const dialog = attachmentPreviewDialog.value
  if (typeof dialog?.showModal === 'function') dialog.showModal()
  else dialog?.setAttribute('open', '')
  try {
    attachmentPreview.value = await invokeCommand<CodingAttachmentPreview>(
      'preview_coding_attachment',
      { attachment },
    )
  } catch (reason) {
    attachmentError.value = reason instanceof Error ? reason.message : '暂时无法预览附件。'
    if (typeof dialog?.close === 'function') dialog.close()
    else dialog?.removeAttribute('open')
  } finally {
    attachmentPreviewLoading.value = false
  }
}

function removeCodingAttachment(attachment: CodingAttachment) {
  pendingAttachments.value = pendingAttachments.value.filter(value => (
    value.id !== attachment.id || value.name !== attachment.name
  ))
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
  const editor = messageEditor.value
  if (!editor) return draft.value
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

function composerHtml() {
  return messageEditor.value?.innerHTML ?? ''
}

function rememberComposerSnapshot() {
  if (applyingComposerHistory || composing.value) return
  const remembered = captureComposerSnapshot(composerHistory.value, composerHtml())
  if (remembered.history === composerHistory.value && remembered.future.length === 0) return
  composerHistory.value = remembered.history
  composerFuture.value = remembered.future
}

function applyComposerHtml(html: string) {
  const editor = messageEditor.value
  if (!editor) return
  applyingComposerHistory = true
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
  applyingComposerHistory = false
}

function undoComposer() {
  const next = undoComposerHistory(
    composerHistory.value,
    composerFuture.value,
    composerHtml(),
  )
  if (!next) return
  composerHistory.value = next.history
  composerFuture.value = next.future
  applyComposerHtml(next.html)
}

function redoComposer() {
  const next = redoComposerHistory(
    composerHistory.value,
    composerFuture.value,
    composerHtml(),
  )
  if (!next) return
  composerHistory.value = next.history
  composerFuture.value = next.future
  applyComposerHtml(next.html)
}

function detectSlashQuery() {
  slashQuery.value = null
  slashQueryRange.value = null
  if (props.goalMode) return
  const editor = messageEditor.value
  if (!editor) return

  const selection = window.getSelection()
  let textNode: Node | null = selection?.focusNode ?? null
  let offset = selection?.focusOffset ?? 0
  if (
    !textNode
    || textNode.nodeType !== Node.TEXT_NODE
    || !editor.contains(textNode)
  ) {
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
  slashQuery.value = query.toLocaleLowerCase()
  slashQueryRange.value = range
}

function syncComposerInput() {
  draft.value = readComposerText()
  const token = messageEditor.value?.querySelector<HTMLElement>('[data-composer-scope-token]')
  const tokenValue = token?.dataset.composerScopeToken
  scopeToken.value = tokenValue === 'browser-use' || tokenValue === 'computer-use'
    ? tokenValue
    : null
  skillToken.value = messageEditor.value
    ?.querySelector<HTMLElement>('[data-composer-skill-token]')
    ?.dataset.composerSkillToken ?? null
  if (composing.value) return
  slashMenuDismissed.value = false
  detectSlashQuery()
}

function removeSlashQueryText() {
  rememberComposerSnapshot()
  const range = slashQueryRange.value
  if (range) {
    range.deleteContents()
    const anchor = document.createTextNode('')
    range.insertNode(anchor)
    setCaretAfter(anchor)
  }
  slashQuery.value = null
  slashQueryRange.value = null
  draft.value = readComposerText()
}

function removeInlineToken(selector: string) {
  const editor = messageEditor.value
  const token = editor?.querySelector<HTMLElement>(selector)
  if (token) {
    const next = token.nextSibling
    token.remove()
    if (next?.nodeType === Node.TEXT_NODE && next.textContent?.startsWith('\u00a0')) {
      next.textContent = next.textContent.slice(1)
    }
  }
}

function removeScopeToken(refocus = true) {
  removeInlineToken('[data-composer-scope-token]')
  scopeToken.value = null
  pendingScopeSubmit.value = null
  draft.value = readComposerText()
  if (refocus) focusMessageInput()
}

function removeSkillToken(refocus = true) {
  removeInlineToken('[data-composer-skill-token]')
  skillToken.value = null
  draft.value = readComposerText()
  if (refocus) focusMessageInput()
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
  const editor = messageEditor.value
  if (!editor) return false
  rememberComposerSnapshot()

  const range = slashQueryRange.value ?? document.createRange()
  if (!slashQueryRange.value) {
    range.selectNodeContents(editor)
    range.collapse(false)
  }
  range.deleteContents()

  const spacer = document.createTextNode('\u00a0')
  range.insertNode(spacer)
  range.insertNode(token)
  setCaretAfter(spacer)

  slashQuery.value = null
  slashQueryRange.value = null
  draft.value = readComposerText()
  return true
}

function insertScopeToken(value: ComposerScopeToken) {
  removeScopeToken(false)
  const label = value === 'browser-use' ? 'Browser Use' : 'Computer Use'
  const token = createInlineToken(
    'data-composer-scope-token',
    value,
    label,
    label,
    `移除 /${value}`,
    () => removeScopeToken(),
  )
  if (!insertInlineToken(token)) return
  scopeToken.value = value
  emit('runSlashCommand', value)
}

function skillOption(name: string) {
  return availableSkillOptions.value.find(skill => skill.name === name)
}

function insertSkillToken(name: string) {
  removeSkillToken(false)
  const option = skillOption(name)
  const label = option?.label ?? name
  const token = createInlineToken(
    'data-composer-skill-token',
    name,
    `Skill · ${label}`,
    `${label} Skill 已加入`,
    `移除 ${label} Skill`,
    () => removeSkillToken(),
  )
  if (!insertInlineToken(token)) return
  skillToken.value = name
}

function clearComposerInput() {
  rememberComposerSnapshot()
  if (messageEditor.value) messageEditor.value.replaceChildren()
  draft.value = ''
  slashQuery.value = null
  slashQueryRange.value = null
  scopeToken.value = null
  pendingScopeSubmit.value = null
  skillToken.value = null
}

function handleComposerPaste(event: ClipboardEvent) {
  const editor = messageEditor.value
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

function handleComposerDrop(event: DragEvent) {
  const editor = messageEditor.value
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
  const range = document.caretRangeFromPoint?.(event.clientX, event.clientY)
    ?? document.createRange()
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
  if (attachmentImporting.value) {
    attachmentError.value = '附件仍在加入，请稍候。'
    return
  }
  draft.value = readComposerText()
  const attachments = [...pendingAttachments.value]
  const text = draft.value.trim()
    || (attachments.length ? '请检查这些附件并完成我接下来需要处理的任务。' : '')
  if (!text) return
  if (props.running && attachments.length) {
    attachmentError.value = '运行中引导暂不支持附件；请等待当前回合结束后再发送附件。'
    return
  }
  const activeSkillToken = skillToken.value ?? undefined
  const prompt = props.running
    ? text
    : props.goalMode
    ? `/goal ${text}`
    : activeSkillToken
      ? `/skill:${activeSkillToken} ${text}`
      : text
  const visiblePrompt = !props.running && activeSkillToken && !props.goalMode
    ? `使用 ${skillOption(activeSkillToken)?.label ?? activeSkillToken}\n${text}`
    : text
  const activeScopeToken = scopeToken.value ?? undefined
  const scopeReady = activeScopeToken === 'browser-use'
    ? props.browserUseReady
    : activeScopeToken === 'computer-use'
      ? props.computerUseReady
      : true
  if (!scopeReady && activeScopeToken) {
    pendingScopeSubmit.value = activeScopeToken === 'computer-use'
      ? activeScopeToken
      : null
    attachmentError.value = activeScopeToken === 'browser-use'
      ? 'Browser Use 需要已选项目，并使用 Go 权限。'
      : '请先在右栏锁定一个外部 App 窗口。'
    emit('runSlashCommand', activeScopeToken)
    return
  }
  clearComposerInput()
  pendingAttachments.value = []
  attachmentError.value = ''
  if (activeScopeToken) emit('send', prompt, visiblePrompt, attachments, activeScopeToken)
  else emit('send', prompt, visiblePrompt, attachments)
  if (!props.running) emit('consumeGoal')
}

function focusMessageInput() {
  void nextTick(() => {
    messageEditor.value?.focus()
  })
}

function openComposerChooser(ariaLabel: string) {
  void nextTick(() => {
    composerFrame.value
      ?.querySelector<HTMLButtonElement>(`[aria-label="${ariaLabel}"]`)
      ?.click()
  })
}

function chooseSlashCommand(command = activeSlashCommand.value) {
  if (!command || command.disabled) return
  composing.value = false
  compositionJustEnded.value = false
  slashMenuDismissed.value = false
  activeSlashCommandIndex.value = 0

  if (command.id === 'browser-use' || command.id === 'computer-use') {
    insertScopeToken(command.id)
    return
  }

  removeSlashQueryText()

  if (command.id === 'model') {
    openComposerChooser('选择本任务模型')
    return
  }
  if (command.id === 'permissions') {
    openComposerChooser('Coding 权限策略')
    return
  }

  if (command.id === 'goal') {
    removeScopeToken(false)
    removeSkillToken(false)
    emit('startGoal')
  }
  else if (command.id === 'plan') emit('changeExecutionMode', 'plan')
  else emit('runSlashCommand', command.id)

  focusMessageInput()
}

function togglePlanningMode() {
  emit('changeExecutionMode', props.executionMode === 'plan' ? 'go' : 'plan')
  focusMessageInput()
}

function startGoalFromPlus() {
  removeScopeToken(false)
  removeSkillToken(false)
  emit('startGoal')
  focusMessageInput()
}

function runComposerShortcut(command: 'browser' | 'mcp') {
  emit('runSlashCommand', command)
  focusMessageInput()
}

function openAddMenu() {
  openComposerChooser('添加内容与工具')
}

function toggleCatalogMcpServer(server: { name: string; reviewReady: boolean }) {
  if (props.running || !server.reviewReady || !props.mcpConfigDigest) return
  const selection = new Set(props.selectedMcpServers ?? [])
  if (selection.has(server.name)) selection.delete(server.name)
  else selection.add(server.name)
  emit(
    'changeMcpServers',
    [...selection].sort((left, right) => left.localeCompare(right)),
    props.mcpConfigDigest,
  )
}

function addInteractionScope(value: ComposerScopeToken) {
  insertScopeToken(value)
}

function moveSlashCommandSelection(direction: 1 | -1) {
  const commands = slashCommands.value
  if (!commands.length) return
  let index = activeSlashCommandIndex.value
  for (let attempts = 0; attempts < commands.length; attempts += 1) {
    index = (index + direction + commands.length) % commands.length
    if (!commands[index]?.disabled) {
      activeSlashCommandIndex.value = index
      return
    }
  }
}

function handleComposerKeyDown(event: KeyboardEvent) {
  const historyAction = isComposerHistoryKey(event)
  if (historyAction) {
    if (event.isComposing || composing.value || event.keyCode === 229) return
    event.preventDefault()
    if (historyAction === 'undo') undoComposer()
    else redoComposer()
    return
  }

  if (slashMenuOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      slashMenuDismissed.value = true
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      if (event.isComposing || composing.value || event.keyCode === 229) return
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      moveSlashCommandSelection(direction)
      return
    }
    if (
      event.key === 'Enter'
      && !event.shiftKey
      && !event.ctrlKey
      && !event.altKey
      && !event.metaKey
    ) {
      // Confirm the slash item even while IME is composing; otherwise Enter
      // commits a candidate and `/compact` vanishes without running.
      event.preventDefault()
      chooseSlashCommand()
      return
    }
  }

  if (
    event.isComposing
    || composing.value
    || event.keyCode === 229
  ) return
  if (compositionJustEnded.value) {
    if (event.key === 'Enter') event.preventDefault()
    return
  }

  if (event.key === 'Escape' && (props.running || props.compacting)) {
    event.preventDefault()
    emit('abort')
    return
  }

  if (
    event.key !== 'Enter'
    || event.shiftKey
    || event.ctrlKey
    || event.altKey
    || event.metaKey
  ) return
  event.preventDefault()
  submit()
}

function handleCompositionEnd() {
  composing.value = false
  compositionJustEnded.value = true
  syncComposerInput()
  window.setTimeout(() => {
    compositionJustEnded.value = false
  }, 0)
}

function appendDraftText(text: string) {
  const normalized = text.trim()
  // Running conversations still accept steering input. Queue retraction uses
  // this path to place the withdrawn guidance back into the composer, so do
  // not discard it merely because the current Agent turn is active.
  if (!normalized) return
  const editor = messageEditor.value
  if (!editor) return
  rememberComposerSnapshot()
  if (readComposerText().trim() || scopeToken.value || skillToken.value) {
    editor.append(document.createElement('br'), document.createElement('br'))
  }
  const textNode = document.createTextNode(normalized)
  editor.append(textNode)
  setCaretAfter(textNode)
  syncComposerInput()
}

watch(draft, () => {
  slashMenuDismissed.value = false
  activeSlashCommandIndex.value = 0
})

watch(() => props.computerUseReady, ready => {
  if (
    !ready
    || props.running
    || pendingScopeSubmit.value !== 'computer-use'
    || scopeToken.value !== 'computer-use'
  ) return
  pendingScopeSubmit.value = null
  void nextTick(() => submit())
})

watch(slashCommands, commands => {
  if (!commands.length) {
    activeSlashCommandIndex.value = 0
    return
  }
  if (
    activeSlashCommandIndex.value >= commands.length
    || commands[activeSlashCommandIndex.value]?.disabled
  ) {
    const firstEnabled = commands.findIndex(command => !command.disabled)
    activeSlashCommandIndex.value = firstEnabled >= 0 ? firstEnabled : 0
  }
})

defineExpose({
  appendDraftText,
  openAddMenu,
})
</script>

<template>
  <div class="chat-composer shrink-0 border-t border-border bg-surface-editor px-4 pb-3 pt-2">
    <div ref="composerFrame" class="chat-composer__frame mx-auto w-full max-w-5xl">
      <div
        v-if="slashMenuOpen"
        id="coding-slash-command-menu"
        class="chat-composer__command-menu"
        role="listbox"
        aria-label="斜杠命令"
      >
        <button
          v-for="(command, index) in slashCommands"
          :id="`coding-slash-command-${command.id}`"
          :key="command.id"
          type="button"
          class="chat-composer__command-option"
          :class="{
            'chat-composer__command-option--active': index === activeSlashCommandIndex,
            'opacity-50': command.disabled,
          }"
          role="option"
          :aria-selected="index === activeSlashCommandIndex"
          :aria-disabled="command.disabled"
          @pointerdown.prevent.stop="chooseSlashCommand(command)"
          @mouseenter="activeSlashCommandIndex = index"
        >
          <component :is="command.icon" class="size-4 shrink-0" />
          <span class="min-w-0 text-left">
            <span class="block text-body font-medium">
              <span class="font-mono">/{{ command.id }}</span>
              <span class="ml-2 text-muted-foreground">{{ command.label }}</span>
            </span>
            <span class="mt-0.5 block text-caption text-muted-foreground">
              {{ command.description }}
            </span>
          </span>
        </button>
      </div>

      <section
        v-if="queuedGuidance?.length"
        class="chat-composer__queued-guidance"
        aria-label="待应用引导"
      >
        <div class="flex items-center gap-2 text-caption font-medium text-primary">
          <Clock3 class="size-3.5" />
          <span>{{ queuedGuidance.length }} 条引导已排队</span>
          <span class="font-normal text-muted-foreground">当前工具调用结束后应用</span>
        </div>
        <div
          v-for="(message, index) in queuedGuidance"
          :key="`${index}:${message}`"
          class="mt-1 flex items-center gap-2 rounded-md border border-border/70 bg-background/55 px-2 py-1.5"
        >
          <p class="min-w-0 flex-1 truncate text-caption text-foreground" :title="message">
            {{ message }}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="shrink-0 text-muted-foreground hover:text-foreground"
            :aria-label="`编辑排队消息 ${index + 1}`"
            title="撤回并编辑"
            @click="$emit('editQueuedGuidance', index)"
          >
            <Pencil class="size-3.5" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            class="shrink-0 text-muted-foreground hover:text-destructive"
            :aria-label="`撤回排队消息 ${index + 1}`"
            title="撤回"
            @click="$emit('cancelQueuedGuidance', index)"
          >
            <X class="size-3.5" />
          </Button>
        </div>
      </section>

      <form class="chat-composer__island flex flex-col gap-1" @submit.prevent="submit">
        <div
          v-if="pendingAttachments.length"
          class="flex flex-wrap gap-2 px-1 pb-1"
          aria-label="待发送附件"
        >
          <span
            v-for="attachment in pendingAttachments"
            :key="`${attachment.id}:${attachment.name}`"
            class="inline-flex max-w-full items-center gap-2 rounded-lg border border-border bg-muted/60 px-2.5 py-1.5 text-caption"
            :title="`${attachment.mediaType} · ${formatAttachmentSize(attachment.size)}`"
          >
            <button
              type="button"
              class="inline-flex min-w-0 items-center gap-2 rounded-sm text-left hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="`预览 ${attachment.name}`"
              @click="previewCodingAttachment(attachment)"
            >
              <FileText class="size-3.5 shrink-0 text-muted-foreground" />
              <span class="max-w-52 truncate">{{ attachment.name }}</span>
              <span class="shrink-0 text-muted-foreground">{{ formatAttachmentSize(attachment.size) }}</span>
            </button>
            <button
              type="button"
              class="rounded-sm text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              :aria-label="`移除 ${attachment.name}`"
              @click="removeCodingAttachment(attachment)"
            >
              <X class="size-3.5" />
            </button>
          </span>
        </div>
        <div
          ref="messageEditor"
          class="chat-composer__input max-h-44 min-h-24 resize-none border-0 bg-transparent px-1 pb-2 pt-1.5 shadow-none focus-visible:ring-0"
          contenteditable="true"
          role="textbox"
          aria-label="消息"
          aria-multiline="true"
          aria-autocomplete="list"
          :aria-controls="slashMenuOpen ? 'coding-slash-command-menu' : undefined"
          :aria-expanded="slashMenuOpen"
          :aria-activedescendant="slashMenuOpen && activeSlashCommand
            ? `coding-slash-command-${activeSlashCommand.id}`
            : undefined"
          :data-placeholder="goalMode ? '写下一个可持续目标，MilkSU 会持续推进并保留恢复点' : ctfSession ? '告诉 Agent 你的观察、假设或下一步想法' : '描述你想让 MilkSU 完成的任务'"
          @compositionstart="composing = true"
          @compositionend="handleCompositionEnd"
          @beforeinput="rememberComposerSnapshot"
          @keydown="handleComposerKeyDown"
          @input="syncComposerInput"
          @keyup="detectSlashQuery"
          @click="detectSlashQuery"
          @paste="handleComposerPaste"
          @drop="handleComposerDrop"
        />
        <div
          v-if="contextUsage || runElapsedLabel"
          class="chat-composer__context-strip flex min-w-0 items-center justify-end gap-3 px-1 pb-0.5"
          data-testid="composer-context-strip"
        >
          <ContextUsageMeter
            v-if="contextUsage"
            :usage="contextUsage"
            size="sm"
          />
          <span
            v-if="runElapsedLabel"
            class="inline-flex shrink-0 items-center gap-1.5 font-mono text-caption tabular-nums text-muted-foreground"
            data-testid="composer-run-elapsed"
            :title="running ? '本轮模型已运行' : '上次运行时长'"
          >
            <AkLoadingMark v-if="running" label="本轮模型已运行" />
            <Clock3 v-else class="size-3" />
            {{ runElapsedLabel }}
          </span>
        </div>
        <div class="chat-composer__toolbar flex min-w-0 items-center gap-1.5">
          <CodingComposerControls
            :running="running"
            :ctf-session="ctfSession"
            :approval-policy="approvalPolicy"
            :approval-label="approvalLabel"
            :model-key="modelKey"
            :automatic-model-label="automaticModelLabel"
            :compact-model-label="compactModelLabel"
            :thinking-levels="thinkingLevels"
            :thinking-level="thinkingLevel"
            @change-approval-policy="$emit('changeApprovalPolicy', $event)"
            @change-model="$emit('changeModel', $event)"
            @change-thinking-level="$emit('changeThinkingLevel', $event)"
            @show-permissions="$emit('showPermissions')"
          >
            <template #leading>
              <DropdownMenu>
                <DropdownMenuTrigger as-child>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    :disabled="running"
                    aria-label="添加内容与工具"
                    title="添加附件、工作方式或交互范围"
                  >
                    <Plus class="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  side="top"
                  :side-offset="8"
                  :collision-padding="16"
                  class="composer-add-menu app-no-drag w-[31rem] max-w-[calc(100vw-2rem)] max-h-[min(24rem,calc(100vh-8rem))] overflow-y-auto p-1"
                >
                  <DropdownMenuLabel class="px-3 pb-1.5 pt-2 text-caption">
                    添加
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    class="composer-add-option app-no-drag cursor-pointer"
                    @pointerdown="startCodingAttachmentChooser"
                    @select="startCodingAttachmentChooser"
                  >
                    <Paperclip class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">本机文件或图片</span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="!workspaceFixed"
                    class="composer-add-option"
                    @select="$emit('chooseWorkspace')"
                  >
                    <FolderOpen class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">项目目录</span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    class="composer-add-option"
                    :disabled="running || goalMode || hasUnfinishedGoal"
                    @select="startGoalFromPlus"
                  >
                    <Target class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">目标</span>
                      <span class="block text-caption text-muted-foreground">
                        {{ hasUnfinishedGoal ? '当前已有持续目标' : '设置一个持续追踪的目标' }}
                      </span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem class="composer-add-option" @select="togglePlanningMode">
                    <Lightbulb class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">
                        {{ executionMode === 'plan' ? '退出计划模式' : '计划模式' }}
                      </span>
                      <span class="block text-caption text-muted-foreground">
                        {{ executionMode === 'plan' ? '恢复使用当前授权工具' : '只分析和规划，不修改文件' }}
                      </span>
                    </span>
                    <Check v-if="executionMode === 'plan'" class="size-4 shrink-0 text-primary" />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel class="px-3 pb-1.5 pt-2 text-caption">
                    浏览与控制
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    class="composer-add-option"
                    :disabled="!workspaceReady"
                    @select="runComposerShortcut('browser')"
                  >
                    <Monitor class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">浏览器</span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem class="composer-add-option" @select="addInteractionScope('browser-use')">
                    <Globe2 class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">Browser Use</span>
                      <span class="block text-caption text-muted-foreground">选择真实浏览器标签页加入本轮输入</span>
                    </span>
                    <Check v-if="scopeToken === 'browser-use'" class="size-4 shrink-0 text-primary" />
                  </DropdownMenuItem>
                  <DropdownMenuItem class="composer-add-option" @select="addInteractionScope('computer-use')">
                    <MousePointer2 class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">Computer Use</span>
                      <span class="block text-caption text-muted-foreground">选择一个外部 App 窗口加入本轮输入</span>
                    </span>
                    <Check v-if="scopeToken === 'computer-use'" class="size-4 shrink-0 text-primary" />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel class="px-3 pb-1.5 pt-2 text-caption">
                    Skills
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    v-for="skill in availableSkillOptions"
                    :key="skill.name"
                    class="composer-add-option"
                    :disabled="!workspaceReady"
                    @select="insertSkillToken(skill.name)"
                  >
                    <component :is="skill.icon" class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">{{ skill.label }}</span>
                      <span v-if="skill.description" class="block text-caption text-muted-foreground">{{ skill.description }}</span>
                    </span>
                    <Check v-if="skillToken === skill.name" class="size-4 shrink-0 text-primary" />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel class="px-3 pb-1.5 pt-2 text-caption">
                    MCP
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    v-for="server in mcpCatalog ?? []"
                    :key="server.name"
                    class="composer-add-option"
                    :disabled="running || !server.reviewReady || !mcpConfigDigest"
                    @select="toggleCatalogMcpServer(server)"
                  >
                    <Plug class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">{{ server.name }}</span>
                      <span class="block text-caption text-muted-foreground">
                        {{ server.reviewReady ? '为本任务接入' : '审阅信息不完整' }}
                      </span>
                    </span>
                    <Check v-if="selectedMcpServers?.includes(server.name)" class="size-4 shrink-0 text-primary" />
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    class="composer-add-option"
                    :disabled="!workspaceReady"
                    @select="runComposerShortcut('mcp')"
                  >
                    <Plug class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">项目 MCP</span>
                      <span v-if="selectedMcpDescription" class="block truncate text-caption text-muted-foreground">{{ selectedMcpDescription }}</span>
                      <span v-else class="block text-caption text-muted-foreground">查看当前项目的 MCP 服务</span>
                    </span>
                    <Check v-if="selectedMcpServers?.length" class="size-4 shrink-0 text-primary" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </template>
            <template #status>
              <div
                v-if="showGoalDock"
                ref="goalSlot"
                class="chat-composer__goal-slot"
                aria-label="持续目标"
              >
                <button
                  type="button"
                  class="chat-composer__chip chat-composer__chip--goal"
                  :aria-haspopup="goal ? 'true' : undefined"
                  :aria-expanded="goal ? goalPanelOpen : undefined"
                  :title="goal
                    ? `持续目标：${goal.text}（点击展开）`
                    : '目标模式已开启；下一条消息会成为持续目标，点击退出'"
                  @click="toggleGoalChip"
                >
                  <Target class="size-3.5 shrink-0" />
                  <span class="chat-composer__chip__label">
                    {{ goal ? goalStatusLabel : '目标' }}
                  </span>
                  <ChevronDown class="chat-composer__chip__chevron size-3 shrink-0 opacity-60" />
                </button>
                <div
                  v-show="goalPanelOpen"
                  class="chat-composer__goal-panel"
                  aria-label="持续目标详情"
                >
                  <div class="flex items-center gap-2">
                    <Target class="size-4 shrink-0 text-primary" />
                    <span class="shrink-0 text-caption font-medium text-primary">
                      {{ goal ? goalStatusLabel : '正在设置' }}
                    </span>
                    <span
                      v-if="goalUsageLabel"
                      class="ml-auto shrink-0 text-caption text-muted-foreground"
                    >
                      {{ goalUsageLabel }}
                    </span>
                  </div>
                  <p class="mt-2 truncate text-body" :title="goal?.text">
                    {{ goal?.text || '下一条消息会成为持续目标。' }}
                  </p>
                  <div class="mt-3 flex items-center gap-1">
                    <Button
                      v-if="goal?.status === 'active'"
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      :disabled="aborting"
                      :aria-label="aborting ? '正在暂停目标' : '暂停目标'"
                      :title="aborting ? '正在等待当前回合停止' : '暂停持续目标'"
                      @click="$emit('controlGoal', 'pause')"
                    >
                      <LoaderCircle v-if="aborting" class="size-3.5 animate-spin" />
                      <Pause v-else class="size-3.5" />
                    </Button>
                    <Button
                      v-if="goal && resumableGoal"
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      :disabled="running"
                      aria-label="继续目标"
                      title="继续持续目标"
                      @click="$emit('controlGoal', 'resume')"
                    >
                      <Play class="size-3.5" />
                    </Button>
                    <Button
                      v-if="goal && !running"
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="清除当前目标"
                      title="清除当前目标"
                      @click="$emit('controlGoal', 'clear')"
                    >
                      <Trash2 class="size-3.5" />
                    </Button>
                    <Button
                      v-else-if="goalMode && !goal"
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label="取消目标模式"
                      title="取消目标模式"
                      @click="$emit('consumeGoal')"
                    >
                      <X class="size-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
              <button
                v-if="executionMode === 'plan'"
                type="button"
                class="chat-composer__chip chat-composer__chip--plan"
                aria-label="计划模式已开启"
                title="只分析和规划，不修改文件；点击退出计划模式"
                @click="$emit('changeExecutionMode', 'go')"
              >
                <Lightbulb class="size-3.5 shrink-0" />
                <span class="chat-composer__chip__label">计划</span>
              </button>
              <div
                v-if="showProgressSummary"
                class="chat-composer__progress-pill"
                aria-label="任务进度摘要"
              >
                <AkLoadingMark
                  v-if="goal?.status === 'active'"
                  label="目标进行中"
                />
                <span v-if="goal?.iteration">第 {{ goal.iteration }} 轮</span>
                <span v-if="goal?.iteration && showGitSummary" aria-hidden="true">·</span>
                <HoverCard v-if="showGitSummary" :open-delay="120" :close-delay="80">
                  <HoverCardTrigger as-child>
                    <button
                      type="button"
                      class="chat-composer__git-trigger"
                      aria-label="查看代码变更"
                      @click="$emit('openChanges')"
                    >
                      <span>代码</span>
                      <span class="text-primary">+{{ gitSummary?.additions }}</span>
                      <span class="text-destructive">-{{ gitSummary?.deletions }}</span>
                    </button>
                  </HoverCardTrigger>
                  <HoverCardContent side="top" align="start" class="w-96 p-0">
                    <div class="border-b border-border px-3 py-2.5">
                      <p class="text-label font-medium">{{ gitSummary?.changedFiles }} 个文件已更改</p>
                    </div>
                    <div class="max-h-64 overflow-y-auto px-2 py-2">
                      <button
                        v-for="change in gitSummary?.changes ?? []"
                        :key="`${change.indexStatus}${change.worktreeStatus}:${change.path}`"
                        type="button"
                        class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        :aria-label="`在变更中打开 ${change.path}`"
                        @click="$emit('openChanges', change.path)"
                      >
                        <span class="w-14 shrink-0 text-muted-foreground">{{ gitChangeStatus(change) }}</span>
                        <span class="min-w-0 flex-1 truncate font-mono" :title="change.path">{{ change.path }}</span>
                        <span class="shrink-0 font-mono text-primary">+{{ change.additions ?? 0 }}</span>
                        <span class="shrink-0 font-mono text-destructive">-{{ change.deletions ?? 0 }}</span>
                      </button>

                      <p v-if="gitSummary?.changesTruncated" class="px-2 py-1 text-caption text-muted-foreground">
                        仅显示前 {{ gitSummary?.changes?.length ?? 0 }} 项。
                      </p>
                    </div>
                  </HoverCardContent>
                </HoverCard>
              </div>
            </template>
            <template v-if="showWorkspaceChip" #context>
              <div
                class="chat-composer__workspace"
                :class="{ 'chat-composer__workspace--locked': workspaceFixed }"
              >
                <button
                  v-if="!workspaceFixed"
                  type="button"
                  class="chat-composer__chip chat-composer__chip--workspace"
                  :class="{
                    'chat-composer__chip--workspace-empty': !hasSelectedWorkspace,
                    'chat-composer__chip--workspace-split': hasSelectedWorkspace,
                  }"
                  :disabled="running"
                  :aria-label="hasSelectedWorkspace ? `会话目录：${workspaceChipLabel}` : '选择项目'"
                  :title="workspaceChipTitle"
                  @click="$emit('chooseWorkspace')"
                >
                  <FolderOpen class="size-3.5 shrink-0" />
                  <span class="chat-composer__chip__label">{{ workspaceChipLabel }}</span>
                </button>
                <span
                  v-else
                  class="chat-composer__chip chat-composer__chip--workspace"
                  :aria-label="`会话目录：${workspaceChipLabel}`"
                  :title="workspaceChipTitle"
                >
                  <FolderOpen class="size-3.5 shrink-0" />
                  <span class="chat-composer__chip__label">{{ workspaceChipLabel }}</span>
                </span>
                <button
                  v-if="hasSelectedWorkspace && !workspaceFixed"
                  type="button"
                  class="chat-composer__workspace-clear"
                  :disabled="running"
                  aria-label="清空项目"
                  title="清空项目"
                  @click.stop="$emit('clearWorkspace')"
                >
                  <X class="size-3.5" />
                </button>
              </div>
              <DropdownMenu v-if="gitRepository && (gitBranches ?? []).length">
                <DropdownMenuTrigger as-child>
                  <button
                    type="button"
                    class="chat-composer__chip"
                    :disabled="running"
                    :aria-label="`当前分支：${gitBranch || '选择分支'}`"
                    :title="gitBranch || '选择分支'"
                  >
                    <GitBranch class="size-3.5 shrink-0" />
                    <span class="chat-composer__chip__label">{{ gitBranch || '分支' }}</span>
                    <ChevronDown class="chat-composer__chip__chevron size-3 shrink-0 opacity-60" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" :side-offset="8" class="min-w-48 p-1">
                  <DropdownMenuItem
                    v-for="branch in gitBranches ?? []"
                    :key="branch"
                    class="cursor-pointer"
                    @select="$emit('checkoutBranch', branch)"
                  >
                    <span class="min-w-0 flex-1 truncate">{{ branch }}</span>
                    <Check v-if="branch === gitBranch" class="size-3.5 shrink-0" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </template>
          </CodingComposerControls>
          <Button
              v-if="running || compacting"
              type="button"
              variant="destructive"
              size="icon"
              :disabled="aborting"
              :aria-label="aborting ? '正在停止 Agent' : compacting ? '停止整理上下文' : '停止 Agent'"
              :title="aborting ? '正在等待 Agent 安全停止' : compacting ? '取消当前上下文整理' : '停止当前 Agent 回合'"
              @pointerdown.prevent.stop="$emit('abort')"
              @click.prevent.stop="$emit('abort')"
            >
              <LoaderCircle v-if="aborting" class="size-3.5 animate-spin" />
              <Square v-else class="size-3.5 fill-current" />
            </Button>
            <Button
              v-if="!compacting && (!running || draft.trim() || pendingAttachments.length)"
              type="submit"
              variant="brand"
              size="icon"
              class="tactical-action"
              :disabled="attachmentImporting || (!draft.trim() && !pendingAttachments.length)"
              :aria-label="running ? '发送引导' : '发送'"
              :title="running ? '在当前工具调用结束后应用' : '发送'"
            >
              <ArrowUp class="size-4" />
            </Button>
        </div>
      </form>
      <p v-if="attachmentError" class="px-2 pt-1.5 text-caption text-destructive">
        {{ attachmentError }}
      </p>
      <p v-else-if="attachmentImporting" class="chat-model-loading px-2 pt-1.5">
        <AkLoadingMark label="正在加入附件" show-label />
      </p>
    </div>
    <dialog
      ref="attachmentPreviewDialog"
      class="m-auto max-h-[calc(100vh-3rem)] w-[min(760px,calc(100vw-2rem))] overflow-hidden rounded-xl border border-border bg-card p-0 text-foreground shadow-[var(--shadow-modal)] backdrop:bg-foreground/25 backdrop:backdrop-blur-[2px]"
      aria-labelledby="coding-attachment-preview-title"
      @click.self="attachmentPreviewDialog?.close()"
    >
      <section class="flex max-h-[calc(100vh-3rem)] flex-col">
        <header class="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <div class="min-w-0">
            <h2 id="coding-attachment-preview-title" class="truncate text-lg font-semibold">
              {{ attachmentPreview?.name || '附件预览' }}
            </h2>
            <p v-if="attachmentPreview" class="text-caption text-muted-foreground">
              {{ attachmentPreview.mediaType }} · {{ formatAttachmentSize(attachmentPreview.size) }}
            </p>
          </div>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="关闭附件预览" @click="attachmentPreviewDialog?.close()">
            <X class="size-4" />
          </Button>
        </header>
        <div class="min-h-0 flex-1 overflow-auto p-5">
          <div v-if="attachmentPreviewLoading" class="grid min-h-48 place-items-center">
            <AkLoadingMark label="正在加载预览" show-label />
          </div>
          <img
            v-else-if="attachmentPreview?.kind === 'image' && attachmentPreview.dataUrl"
            :src="attachmentPreview.dataUrl"
            :alt="attachmentPreview.name"
            class="mx-auto max-h-[65vh] max-w-full rounded-lg object-contain"
          >
          <pre
            v-else-if="attachmentPreview?.kind === 'text'"
            class="whitespace-pre-wrap break-words rounded-lg border border-border bg-muted/40 p-4 font-mono text-caption"
          >{{ attachmentPreview.text }}</pre>
          <p v-else class="text-body text-muted-foreground">
            此附件已加入发送队列；当前格式不提供内嵌内容预览。
          </p>
        </div>
      </section>
    </dialog>
  </div>
</template>

<style scoped>
.chat-composer {
  position: relative;
  z-index: 2;
}

.chat-composer__frame {
  position: relative;
}

.chat-composer__git-trigger {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  border-radius: 0.375rem;
  padding: 0.125rem 0.25rem;
  transition: background-color 120ms ease;
}

.chat-composer__git-trigger:hover,
.chat-composer__git-trigger:focus-visible {
  background: var(--muted);
  outline: none;
}

.chat-composer__queued-guidance {
  margin: 0 0.25rem 0.5rem;
  border: 1px solid color-mix(in srgb, var(--brand) 22%, var(--border));
  border-radius: 0.75rem;
  background: color-mix(in srgb, var(--card) 94%, var(--brand) 6%);
  padding: 0.625rem 0.75rem;
  box-shadow: 0 8px 24px rgb(0 0 0 / 8%);
}

.chat-composer__command-menu {
  position: absolute;
  bottom: calc(100% + 0.65rem);
  left: 0;
  z-index: 10;
  width: min(30rem, calc(100vw - 3rem));
  max-height: min(30rem, calc(100vh - 14rem));
  overflow-x: hidden;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: color-mix(in srgb, var(--card) 96%, transparent);
  padding: 0.35rem;
  box-shadow:
    0 18px 42px rgb(0 0 0 / 18%),
    0 3px 10px rgb(0 0 0 / 10%);
  backdrop-filter: blur(18px);
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
.chat-composer__command-option--active:not(:disabled) {
  background: var(--muted);
}

.chat-composer__command-option:focus-visible {
  box-shadow: 0 0 0 2px var(--ring);
}

.chat-composer__goal-slot {
  position: relative;
  display: inline-flex;
  min-width: 0;
}

.chat-composer__chip {
  display: inline-flex;
  height: 2rem;
  min-width: 0;
  flex: 0 1 auto;
  align-items: center;
  gap: 0.35rem;
  border-radius: 9999px;
  padding-inline: 0.6rem;
  font-size: var(--text-body);
  line-height: var(--text-body--line-height);
  color: var(--foreground);
  transition: background-color 110ms ease, color 110ms ease;
}

.chat-composer__chip:hover:not(:disabled),
.chat-composer__chip[aria-expanded='true'] {
  background: var(--btn-ghost-hover);
}

.chat-composer__chip:disabled {
  opacity: 0.55;
}

.chat-composer__chip__label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chat-composer__chip--goal {
  background: color-mix(in srgb, var(--primary) 10%, transparent);
  color: color-mix(in srgb, var(--primary) 72%, var(--foreground));
}

.chat-composer__chip--plan {
  color: var(--muted-foreground);
}

.chat-composer__chip--plan:hover:not(:disabled) {
  color: var(--foreground);
}

.chat-composer__chip--workspace {
  max-width: 11rem;
  color: var(--muted-foreground);
}

.chat-composer__workspace .chat-composer__chip--workspace {
  max-width: 12rem;
}

.chat-composer__chip--workspace:hover:not(:disabled) {
  color: var(--foreground);
}

.chat-composer__goal-panel {
  position: absolute;
  bottom: calc(100% + 0.5rem);
  left: 0;
  z-index: 30;
  width: min(24rem, calc(100vw - 2rem));
  border: 1px solid var(--border);
  border-radius: 2px;
  background: var(--card);
  padding: 0.75rem 0.85rem;
  box-shadow:
    0 18px 42px rgb(0 0 0 / 18%),
    0 3px 10px rgb(0 0 0 / 10%);
}

.chat-composer__progress-pill {
  display: inline-flex;
  min-height: 2rem;
  align-items: center;
  gap: 0.4rem;
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  border-radius: 999px;
  background: color-mix(in srgb, var(--card) 94%, transparent);
  padding: 0.25rem 0.75rem;
  font-size: var(--text-caption);
  color: var(--muted-foreground);
}

@container chat-main (max-width: 40rem) {
  .chat-composer__chip--workspace {
    max-width: 7rem;
  }
}

@container chat-main (max-width: 36rem) {
  .chat-composer__chip--workspace {
    max-width: 2rem;
    justify-content: center;
    padding-inline: 0;
  }

  .chat-composer__chip--workspace .chat-composer__chip__label,
  .chat-composer__chip--workspace .chat-composer__chip__chevron {
    display: none;
  }

  .chat-composer__chip--goal {
    width: 2rem;
    justify-content: center;
    padding-inline: 0;
  }

  .chat-composer__chip--goal .chat-composer__chip__label,
  .chat-composer__chip--goal .chat-composer__chip__chevron {
    display: none;
  }

  .chat-composer__progress-pill {
    min-width: 0;
    overflow: hidden;
    padding-inline: 0.5rem;
  }
}

.composer-add-option {
  display: flex;
  min-height: 3.5rem;
  align-items: center;
  gap: 0.75rem;
  padding: 0.55rem 0.75rem;
}

.composer-add-menu {
  max-height: min(38rem, calc(100vh - 10rem));
  overflow-x: hidden;
  overflow-y: auto;
}

.chat-composer__island {
  border: 1px solid var(--border);
  border-left: 4px solid var(--brand);
  border-radius: 2px;
  background-color: var(--card);
  padding: .65rem .85rem .75rem;
  box-shadow: none;
  color: var(--foreground);
}

.chat-composer__workspace {
  display: inline-flex;
  min-width: 0;
  max-width: 14rem;
  align-items: center;
  border-radius: 9999px;
}

.chat-composer__workspace:not(.chat-composer__workspace--locked):hover .chat-composer__chip--workspace,
.chat-composer__workspace:not(.chat-composer__workspace--locked):hover .chat-composer__workspace-clear {
  background: var(--btn-ghost-hover);
  color: var(--foreground);
}

.chat-composer__workspace--locked .chat-composer__chip--workspace {
  cursor: default;
}

.chat-composer__workspace-clear {
  display: inline-flex;
  height: 2rem;
  width: 1.6rem;
  flex: none;
  align-items: center;
  justify-content: center;
  margin-left: -0.35rem;
  border: 0;
  border-radius: 0 9999px 9999px 0;
  background: transparent;
  color: var(--muted-foreground);
  cursor: pointer;
}

.chat-composer__workspace-clear:disabled {
  cursor: default;
  opacity: 0.55;
}

.chat-composer__chip--workspace-empty {
  color: var(--muted-foreground);
}

.chat-composer__chip--workspace-split {
  border-radius: 9999px 0 0 9999px;
  padding-inline-end: 0.35rem;
}

.chat-composer__toolbar {
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  padding-top: 0.55rem;
}

.chat-composer__input {
  overflow-y: auto;
  white-space: pre-wrap;
  word-break: break-word;
  outline: none;
  font-size: var(--text-label);
  line-height: var(--text-label--line-height);
  letter-spacing: var(--text-label--letter-spacing);
  color: var(--foreground);
}

.chat-composer__input:empty::before {
  color: var(--muted-foreground);
  content: attr(data-placeholder);
  pointer-events: none;
}

.chat-composer__input :deep(.chat-composer__inline-token) {
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

.chat-composer__input :deep(.chat-composer__inline-token-remove) {
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

.chat-composer__input :deep(.chat-composer__inline-token-remove:hover) {
  background: var(--btn-ghost-hover);
  color: var(--foreground);
}
</style>
