<script setup lang="ts">
import { computed, markRaw, nextTick, ref, watch, type Component } from 'vue'
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
  Clock3,
  Compass,
  FileDiff,
  FileText,
  FolderOpen,
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
  StickyNote,
  Target,
  Trash2,
  X,
} from 'lucide-vue-next'
import CodingComposerControls from '@/components-vue/CodingComposerControls.vue'
import { invokeCommand } from '@/desktop'
import type {
  CodingApprovalPolicy,
  CodingAttachment,
  CodingAttachmentImport,
  CodingAttachmentPreview,
  CodingExecutionMode,
  CodingGoalState,
  CTFChatAction,
} from '@/types'
import type { CodingGitChange } from '@/codingEnvironmentTypes'
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
  ctfSession: boolean
  ctfMode?: 'coach' | 'copilot' | 'delegate'
  ctfRole?: 'solver' | 'tool-builder' | 'strategist'
  goalMode: boolean
  goal?: CodingGoalState
  gitSummary?: ComposerGitSummary
  executionMode: CodingExecutionMode
  approvalPolicy: CodingApprovalPolicy
  approvalLabel: string
  modelKey: string
  automaticModelLabel: string
  compactModelLabel: string
  compactDisabled?: boolean
  workspaceReady?: boolean
  workspaceLocked?: boolean
  browserUseReady?: boolean
  computerUseReady?: boolean
  availableSkills?: string[]
  selectedMcpServers?: string[]
  queuedGuidance?: string[]
}>()

const emit = defineEmits<{
  send: [
    text: string,
    visibleText?: string,
    attachments?: CodingAttachment[],
    scopeToken?: ComposerScopeToken,
  ]
  ctfAction: [action: CTFChatAction]
  abort: []
  openChanges: [path?: string]
  changeExecutionMode: [value: string]
  changeApprovalPolicy: [value: string]
  changeModel: [value: string]
  showPermissions: []
  consumeGoal: []
  startGoal: []
  runSlashCommand: [command: string]
  controlGoal: [action: 'pause' | 'resume' | 'clear']
  chooseWorkspace: []
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
      description: '当前会话已审核的 Pi Skill',
      icon: markRaw(Plug),
    })
  }
  return [...known.values()]
})
const selectedMcpDescription = computed(() => {
  const servers = props.selectedMcpServers ?? []
  if (!servers.length) return '查看并选择项目中已审核的 MCP 服务'
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
    id: 'compact',
    label: '整理上下文',
    description: '使用 Pi 压缩当前会话上下文',
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
    id: 'review',
    label: '审阅',
    description: '让 Agent 审阅当前工作区变更',
    keywords: ['diff', 'code-review', '审查'],
    icon: markRaw(ScanSearch),
  },
  {
    id: 'mcp',
    label: 'MCP',
    description: '查看当前项目的 MCP 服务',
    keywords: ['tools', '工具'],
    icon: markRaw(Plug),
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
  if (id === 'compact') return props.running || props.compactDisabled
  if (id === 'new' || id === 'plan' || id === 'model' || id === 'permissions') {
    return props.running
  }
  if (id === 'review') return props.running || !props.workspaceReady
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
  !props.ctfSession && (props.goal || props.goalMode || showProgressSummary.value),
))

const ctfActionOptions = computed(() => {
  const mode = props.ctfMode ?? 'copilot'
  const modeRule = mode === 'coach'
    ? '保持教练模式，不要直接给完整解法或候选 Flag。'
    : mode === 'delegate'
      ? '保持代理模式，可以自主检查工作区，但不要向外部平台提交。'
      : '保持搭档模式，每次只推进一个可复核实验。'
  return [
    {
      label: '梳理题面',
      icon: markRaw(Compass),
      action: {
        kind: 'orient',
        prompt: `先暂停执行。结合 TASK.md、题面和材料，用三点说明目标、现有证据和最合理的第一步。${modeRule}`,
      } satisfies CTFChatAction,
    },
    {
      label: '提示 1',
      icon: markRaw(Lightbulb),
      action: {
        kind: 'hint',
        level: 1,
        prompt: '我需要一级提示。只指出一个应该关注的证据、概念或材料，不给命令、完整解法或候选 Flag；最后问我一个检查理解的问题。',
      } satisfies CTFChatAction,
    },
    {
      label: '提示 2',
      icon: markRaw(Route),
      action: {
        kind: 'hint',
        level: 2,
        prompt: '我需要二级提示。基于当前轨迹给出一个可执行且可验证的下一步实验，说明预期观察，但不要透露候选 Flag。',
      } satisfies CTFChatAction,
    },
    {
      label: '重新规划',
      icon: markRaw(StickyNote),
      action: {
        kind: 'replan',
        prompt: '暂停当前路线，读取 notes.md 和已有轨迹，列出已证伪假设、仍成立的证据和最多三个下一步；选择信息增益最高的一步再继续。',
      } satisfies CTFChatAction,
    },
  ]
})

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

async function chooseCodingAttachments() {
  if (props.running || props.ctfSession) return
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

function detectSlashQuery() {
  slashQuery.value = null
  slashQueryRange.value = null
  if (props.ctfSession || props.goalMode) return
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
    : !props.ctfSession && props.goalMode
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
      ? 'Browser Use 需要已选择项目，并使用可调用工具的 Go 权限；当前输入不会被清空。'
      : '请先在右栏锁定一个外部 App 窗口；当前输入不会被清空。'
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
  if (
    event.isComposing
    || composing.value
    || event.keyCode === 229
  ) return
  if (compositionJustEnded.value) {
    if (event.key === 'Enter') event.preventDefault()
    return
  }

  if (slashMenuOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      slashMenuDismissed.value = true
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
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
      event.preventDefault()
      chooseSlashCommand()
      return
    }
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
})
</script>

<template>
  <div class="chat-composer shrink-0 bg-surface-editor px-5 pb-4 pt-2">
    <div ref="composerFrame" class="chat-composer__frame mx-auto max-w-5xl">
      <div
        v-if="ctfSession && ctfRole === 'solver'"
        class="mb-2 flex flex-wrap items-center gap-2 px-1"
        aria-label="CTF 快捷协作"
      >
        <span class="mr-1 text-caption text-muted-foreground">快捷协作</span>
        <Button
          v-for="option in ctfActionOptions"
          :key="option.label"
          type="button"
          variant="outline"
          size="sm"
          :disabled="running"
          @click="$emit('ctfAction', option.action)"
        >
          <component :is="option.icon" class="size-3.5" />
          {{ option.label }}
        </Button>
      </div>

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
          :disabled="command.disabled"
          @mousedown.prevent
          @mouseenter="activeSlashCommandIndex = index"
          @click="chooseSlashCommand(command)"
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

      <div
        v-if="showGoalDock"
        class="chat-composer__dock"
        aria-label="任务与目标状态"
      >
        <div
          v-if="showProgressSummary"
          class="chat-composer__progress-pill"
          aria-label="任务进度摘要"
        >
          <LoaderCircle
            v-if="goal?.status === 'active'"
            class="size-3.5 shrink-0 text-primary"
            :class="{ 'animate-spin': running }"
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
                <p class="mt-0.5 text-caption text-muted-foreground">点击“代码”打开右侧变更面板</p>
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
                <p v-if="!(gitSummary?.changes?.length)" class="px-2 py-2 text-caption text-muted-foreground">
                  文件列表正在刷新；点击后可查看完整变更。
                </p>
                <p v-if="gitSummary?.changesTruncated" class="px-2 py-1 text-caption text-muted-foreground">
                  仅显示前 {{ gitSummary?.changes?.length ?? 0 }} 项。
                </p>
              </div>
            </HoverCardContent>
          </HoverCard>
        </div>

        <section
          v-if="goal || goalMode"
          class="chat-composer__goal-panel"
          aria-label="持续目标"
        >
          <Target class="size-4 shrink-0 text-primary" />
          <span class="shrink-0 text-caption font-medium text-primary">
            {{ goal ? goalStatusLabel : '正在设置' }}
          </span>
          <span class="min-w-0 flex-1 truncate text-body" :title="goal?.text">
            {{ goal?.text || '下一条消息会成为持续目标。' }}
          </span>
          <span
            v-if="goalUsageLabel"
            class="hidden shrink-0 text-caption text-muted-foreground sm:inline"
          >
            {{ goalUsageLabel }}
          </span>
          <div class="flex shrink-0 items-center gap-1">
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
        </section>
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

      <form class="chat-composer__island tactical-command-surface flex flex-col gap-1" @submit.prevent="submit">
        <div class="chat-composer__command-label tactical-label">Command composer</div>
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
          @keydown="handleComposerKeyDown"
          @input="syncComposerInput"
          @keyup="detectSlashQuery"
          @click="detectSlashQuery"
          @paste="handleComposerPaste"
          @drop="handleComposerDrop"
        />
        <div class="chat-composer__toolbar flex min-w-0 items-center gap-1.5">
          <CodingComposerControls
            :running="running"
            :ctf-session="ctfSession"
            :approval-policy="approvalPolicy"
            :approval-label="approvalLabel"
            :model-key="modelKey"
            :automatic-model-label="automaticModelLabel"
            :compact-model-label="compactModelLabel"
            @change-approval-policy="$emit('changeApprovalPolicy', $event)"
            @change-model="$emit('changeModel', $event)"
            @show-permissions="$emit('showPermissions')"
          >
            <template v-if="!ctfSession" #leading>
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
                  :side-offset="8"
                  class="composer-add-menu app-no-drag w-[31rem] max-w-[calc(100vw-2rem)] p-1"
                >
                  <DropdownMenuLabel class="px-3 pb-1.5 pt-2 text-caption">
                    添加
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    class="composer-add-option app-no-drag cursor-pointer"
                    @pointerdown.stop
                    @select="chooseCodingAttachments"
                  >
                    <Paperclip class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">本机文件或图片</span>
                      <span class="block text-caption text-muted-foreground">选择后以只读附件交给 Agent</span>
                    </span>
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    v-if="!workspaceLocked"
                    class="composer-add-option"
                    @select="$emit('chooseWorkspace')"
                  >
                    <FolderOpen class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">项目目录</span>
                      <span class="block text-caption text-muted-foreground">选择当前任务的会话目录</span>
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
                      <span class="block text-caption text-muted-foreground">打开 MilkSU 管理的隔离浏览器</span>
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
                      <span class="block text-caption text-muted-foreground">{{ skill.description }}</span>
                    </span>
                    <Check v-if="skillToken === skill.name" class="size-4 shrink-0 text-primary" />
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel class="px-3 pb-1.5 pt-2 text-caption">
                    MCP
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    class="composer-add-option"
                    :disabled="!workspaceReady"
                    @select="runComposerShortcut('mcp')"
                  >
                    <Plug class="size-4 shrink-0" />
                    <span class="min-w-0 flex-1">
                      <span class="block text-label font-medium">项目 MCP</span>
                      <span class="block truncate text-caption text-muted-foreground">{{ selectedMcpDescription }}</span>
                    </span>
                    <Check v-if="selectedMcpServers?.length" class="size-4 shrink-0 text-primary" />
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </template>
          </CodingComposerControls>
          <Button
              v-if="running && (!draft.trim() || aborting)"
              type="button"
              variant="destructive"
              size="icon"
              :disabled="aborting"
              :aria-label="aborting ? '正在停止 Agent' : '停止 Agent'"
              :title="aborting ? '正在等待 Agent 安全停止' : '停止当前 Agent 回合'"
              @click="$emit('abort')"
            >
              <LoaderCircle v-if="aborting" class="size-3.5 animate-spin" />
              <Square v-else class="size-3.5 fill-current" />
            </Button>
            <Button
              v-else
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
      <p v-else-if="attachmentImporting" class="px-2 pt-1.5 text-caption text-muted-foreground">
        正在加入附件…
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
          <div v-if="attachmentPreviewLoading" class="grid min-h-48 place-items-center text-muted-foreground">
            <LoaderCircle class="size-5 animate-spin" />
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

.chat-composer__dock {
  display: flex;
  min-width: 0;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.5rem;
  padding: 0 0.4rem 0.65rem;
}

.chat-composer__progress-pill,
.chat-composer__goal-panel {
  border: 1px solid color-mix(in srgb, var(--border) 82%, transparent);
  background: color-mix(in srgb, var(--card) 94%, transparent);
  box-shadow: 0 6px 18px rgb(0 0 0 / 8%);
  backdrop-filter: blur(14px);
}

.chat-composer__progress-pill {
  display: inline-flex;
  min-height: 2.25rem;
  align-items: center;
  gap: 0.4rem;
  border-radius: 999px;
  padding: 0.4rem 0.85rem;
  font-size: var(--text-caption);
  color: var(--muted-foreground);
}

.chat-composer__goal-panel {
  display: inline-flex;
  min-width: 0;
  min-height: 2.25rem;
  max-width: min(36rem, 100%);
  flex: 0 1 auto;
  align-items: center;
  gap: 0.45rem;
  border-radius: 9999px;
  padding: 0.35rem 0.4rem 0.35rem 0.75rem;
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
  border: 1px solid var(--night-border);
  border-radius: 0;
  background-color: var(--tactical-ink-2);
  padding: .75rem 1rem .85rem;
  box-shadow: 0 16px 38px rgb(0 0 0 / 24%);
}

.chat-composer__command-label { border-bottom: 1px solid var(--night-border); padding: 0 0 .55rem .15rem; color: var(--night-muted-foreground); }

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
  color: var(--night-foreground);
}

.chat-composer__input:empty::before {
  color: var(--night-muted-foreground);
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
