<script setup lang="ts">
import { computed, markRaw, nextTick, ref, watch } from 'vue'
import {
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  Textarea,
} from '@felinic/ui'
import {
  Activity,
  ArrowUp,
  Bot,
  Check,
  CircleDot,
  Compass,
  Copy,
  ExternalLink,
  FilePenLine,
  Files,
  Flag,
  FolderOpen,
  GitBranch,
  Globe2,
  KeyRound,
  Lightbulb,
  LoaderCircle,
  LockKeyhole,
  PanelRightClose,
  PanelRightOpen,
  Puzzle,
  RefreshCw,
  Route,
  Square,
  StickyNote,
  Terminal,
  Wrench,
} from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import type { CodingDiffSnapshot, CodingEnvironmentSnapshot } from '@/codingEnvironmentTypes'
import type { CTFShowCatalogStatus } from '@/ctfshowTypes'
import {
  normalizeCodingApprovalPolicy,
  normalizeCodingExecutionMode,
  previewCodingCapabilities,
} from '@/lib/codingPolicy'
import type {
  CTFAgentBudgetStatus,
  CTFAgentRunCheckpoint,
  CTFProjection,
  CTFToolWorkshopState,
} from '@/ctfTypes'
import type {
  AppSettings,
  CodingApprovalPolicy,
  CodingExecutionMode,
  Conversation,
  CTFChatAction,
} from '@/types'
import type { NSSCTFWebBridgeStatus } from '@/nssctfWebTypes'
import { PROVIDER_GROUPS, providerModelLabel } from '@/types'

const props = defineProps<{
  conversation: Conversation | null
  settings: AppSettings | null
  workspacePath: string
  running: boolean
  ctfSession: boolean
  ctfMode?: 'coach' | 'copilot' | 'delegate'
  ctfRole?: 'solver' | 'tool-builder' | 'strategist'
  modelMode?: 'auto' | 'manual'
  modelProvider?: string
  modelId?: string
  executionMode?: CodingExecutionMode
  approvalPolicy?: CodingApprovalPolicy
}>()

const emit = defineEmits<{
  send: [text: string]
  ctfAction: [action: CTFChatAction]
  abort: []
  chooseWorkspace: []
  changeModel: [mode: 'auto' | 'manual', provider?: string, model?: string]
  changeCodingPolicy: [
    executionMode: CodingExecutionMode,
    approvalPolicy: CodingApprovalPolicy,
  ]
  openSettings: []
  returnCtf: []
  switchCtfAgent: [role: 'solver' | 'tool-builder' | 'strategist']
}>()

const draft = ref('')
const scrollArea = ref<HTMLElement | null>(null)
const workshopState = ref<CTFToolWorkshopState | null>(null)
const environmentOpen = ref(!props.ctfSession)
const contextPanel = ref<'environment' | 'browser' | 'collaboration' | 'evidence'>('environment')
const environmentLoading = ref(false)
const environmentError = ref('')
const browserPanelError = ref('')
const nssctfBrowserStatus = ref<NSSCTFWebBridgeStatus | null>(null)
const ctfshowBrowserStatus = ref<CTFShowCatalogStatus | null>(null)
const codingEnvironment = ref<CodingEnvironmentSnapshot | null>(null)
const codingDiff = ref<CodingDiffSnapshot | null>(null)
const codingDiffLoading = ref(false)
const codingDiffError = ref('')
const ctfBudget = ref<CTFAgentBudgetStatus | null>(null)
const ctfCheckpoint = ref<CTFAgentRunCheckpoint | null>(null)
const ctfProjection = ref<CTFProjection | null>(null)
const automaticModel = computed(() => {
  if (!props.settings) return null
  const preferred = props.ctfRole === 'strategist'
    ? props.settings.model_routing.deep
    : props.settings.model_routing.fast
  const fast = props.settings.model_routing.fast
  const active = {
    provider: props.settings.active_provider,
    model: props.settings.active_model,
  }
  return [preferred, fast, active].find(selection => {
    if (props.settings?.relay?.enabled && props.settings.relay.has_key) return true
    const configured = props.settings?.providers[selection.provider]
    return Boolean(configured?.enabled && configured.has_api_key)
  }) ?? preferred
})
const effectiveModelMode = computed(() => (
  props.modelMode ?? props.settings?.model_routing.default_mode ?? 'auto'
))
const currentModelKey = computed(() => {
  if (!props.settings) return ''
  if (effectiveModelMode.value === 'auto') return 'auto'
  const provider = props.modelProvider || props.settings.active_provider
  const model = props.modelId || props.settings.active_model
  return `manual:${provider}:${model}`
})
const automaticModelLabel = computed(() => {
  const selection = automaticModel.value
  if (!selection) return '自动编排'
  const task = props.ctfRole === 'strategist' ? '深度策略' : '快速执行'
  return `自动 · ${providerModelLabel(selection.provider, selection.model)} · ${task}`
})
const activeExtensions = computed(() => (
  props.conversation?.agentExtensions ?? []
))
const activeSkills = computed(() => (
  props.conversation?.agentSkills ?? []
))
const activeTools = computed(() => (
  props.conversation?.agentTools ?? []
))
const effectiveExecutionMode = computed(() => (
  normalizeCodingExecutionMode(props.executionMode)
))
const effectiveApprovalPolicy = computed(() => (
  normalizeCodingApprovalPolicy(props.approvalPolicy)
))
const codingCapabilities = computed(() => (
  props.conversation?.agentCapabilities?.length
    ? props.conversation.agentCapabilities
    : previewCodingCapabilities(
        effectiveExecutionMode.value,
        effectiveApprovalPolicy.value,
      )
))
const codingPolicyLabel = computed(() => {
  const mode = effectiveExecutionMode.value === 'plan' ? 'Plan' : 'Go'
  const approval = effectiveApprovalPolicy.value === 'read-only'
    ? '只读'
    : effectiveApprovalPolicy.value === 'ask'
      ? '每次询问'
      : '工作区自动'
  return `${mode} · ${approval}`
})
const compactModelLabel = computed(() => {
  const provider = effectiveModelMode.value === 'auto'
    ? automaticModel.value?.provider
    : props.modelProvider || props.settings?.active_provider
  const model = effectiveModelMode.value === 'auto'
    ? automaticModel.value?.model
    : props.modelId || props.settings?.active_model
  if (!provider || !model) {
    return effectiveModelMode.value === 'auto' ? '自动编排' : '选择模型'
  }
  const modelName = providerModelLabel(provider, model).split(' · ').at(-1) || model
  return effectiveModelMode.value === 'auto' ? `自动 · ${modelName}` : modelName
})
const capabilityStatusLabel = (status: string) => (
  status === 'allowed'
    ? '允许'
    : status === 'approval-required'
      ? '需批准'
      : status === 'unavailable'
        ? '未接入'
        : '阻止'
)
const extensionLabel = (value: string) => (
  value === 'milksu-workflow'
    ? 'MilkSU Workflow'
    : value === 'pi-lsp'
      ? 'PI LSP'
      : value === 'pi-retry'
        ? 'PI Retry'
        : value
)
const extensionDescription = (value: string) => (
  value === 'milksu-workflow'
    ? '计划可见、角色工作流与结果验证'
    : value === 'pi-lsp'
      ? '固定 Go / Vue / TypeScript 路由；需本机安装对应语言服务器'
      : value === 'pi-retry'
        ? '识别可重试的上游错误；慢模型停滞中止暂不启用'
        : '已由 MilkSU 白名单加载'
)
const hasCredential = computed(() => {
  if (!props.settings) return false
  if (props.settings.relay?.enabled) return props.settings.relay.has_key
  const provider = props.settings.providers[props.settings.active_provider]
  return Boolean(provider?.enabled && provider.has_api_key)
})
const workspaceName = computed(() => {
  const value = props.workspacePath.replace(/\/+$/, '')
  return value.split('/').at(-1) || '临时沙盒'
})
const workspaceLocked = computed(() => Boolean(props.conversation?.messages.length))
const activeModelLabel = computed(() => {
  if (effectiveModelMode.value === 'auto') return automaticModelLabel.value.replace(/^自动 · /, '')
  const provider = props.modelProvider || props.settings?.active_provider
  const model = props.modelId || props.settings?.active_model
  return provider && model ? providerModelLabel(provider, model) : '等待选择'
})
const messageCount = computed(() => props.conversation?.messages.length ?? 0)
const toolMessageCount = computed(() => (
  props.conversation?.messages.filter(message => message.role === 'tool').length ?? 0
))
const latestJudge = computed(() => ctfProjection.value?.judgeReceipts.at(-1))
const contextPanelTitle = computed(() => ({
  environment: props.ctfSession ? '解题环境' : '环境信息',
  browser: '浏览器',
  collaboration: 'Agent 协作',
  evidence: '证据与 Judge',
})[contextPanel.value])
const ctfRoleLabel = computed(() => {
  if (props.ctfRole === 'tool-builder') return 'Coding Agent 工具工坊'
  if (props.ctfRole === 'strategist') return '策略 Agent 复盘'
  return 'CTF 解题会话'
})
const workshopSummary = computed(() => {
  const state = workshopState.value
  if (!state) return '正在读取工具交接状态'
  if (state.pendingCount) return `${state.pendingCount} 个工具请求待实现`
  if (state.readyCount) return `${state.readyCount} 个工具已交付，等待解题 Agent 验收`
  if (state.blockedCount) return `${state.blockedCount} 个工具请求被阻塞`
  if (state.unknownCount) return `${state.unknownCount} 个请求缺少有效状态`
  return state.toolCount
    ? `${state.toolCount} 个本题工具已保存在工作区`
    : '当前没有工具请求'
})
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

function submit() {
  const text = draft.value.trim()
  if (!text || props.running) return
  draft.value = ''
  emit('send', text)
}

function changeModel(value: string) {
  if (value === 'auto') {
    emit('changeModel', 'auto')
    return
  }
  const [mode, provider, model] = value.split(':')
  if (mode === 'manual' && provider && model) emit('changeModel', 'manual', provider, model)
}

function changeExecutionMode(value: string) {
  const executionMode = normalizeCodingExecutionMode(value)
  emit('changeCodingPolicy', executionMode, effectiveApprovalPolicy.value)
}

function changeApprovalPolicy(value: string) {
  const approvalPolicy = normalizeCodingApprovalPolicy(value)
  emit('changeCodingPolicy', effectiveExecutionMode.value, approvalPolicy)
}

async function loadWorkshopState() {
  const jobId = props.conversation?.ctfJobId
  if (!props.ctfSession || !jobId || props.ctfRole === 'strategist') {
    workshopState.value = null
    return
  }
  try {
    workshopState.value = await invokeCommand<CTFToolWorkshopState>(
      'get_ctf_tool_workshop_state',
      { id: jobId },
    )
  } catch {
    workshopState.value = null
  }
}

async function refreshEnvironment() {
  environmentError.value = ''
  codingDiff.value = null
  codingDiffError.value = ''
  if (props.ctfSession) {
    codingEnvironment.value = null
    const jobId = props.conversation?.ctfJobId
    if (!jobId) {
      ctfBudget.value = null
      ctfCheckpoint.value = null
      ctfProjection.value = null
      return
    }
    environmentLoading.value = true
    const [budget, checkpoint, projection] = await Promise.allSettled([
      invokeCommand<CTFAgentBudgetStatus>('get_ctf_agent_budget_status', { id: jobId }),
      invokeCommand<CTFAgentRunCheckpoint | null>('get_ctf_agent_run_checkpoint', { id: jobId }),
      invokeCommand<CTFProjection>('get_ctf_job', { id: jobId }),
    ])
    ctfBudget.value = budget.status === 'fulfilled' ? budget.value : null
    ctfCheckpoint.value = checkpoint.status === 'fulfilled' ? checkpoint.value : null
    ctfProjection.value = projection.status === 'fulfilled' ? projection.value : null
    if ([budget, checkpoint, projection].every(result => result.status === 'rejected')) {
      environmentError.value = '暂时无法读取解题环境。'
    }
    environmentLoading.value = false
    return
  }

  ctfBudget.value = null
  ctfCheckpoint.value = null
  ctfProjection.value = null
  if (!props.workspacePath) {
    codingEnvironment.value = null
    return
  }
  environmentLoading.value = true
  try {
    codingEnvironment.value = await invokeCommand<CodingEnvironmentSnapshot>(
      'get_coding_environment',
      { workspacePath: props.workspacePath },
    )
  } catch (reason) {
    codingEnvironment.value = null
    environmentError.value = reason instanceof Error
      ? reason.message
      : '暂时无法读取项目环境。'
  } finally {
    environmentLoading.value = false
  }
}

async function refreshBrowserPanel() {
  browserPanelError.value = ''
  if (!props.ctfSession) {
    nssctfBrowserStatus.value = null
    ctfshowBrowserStatus.value = null
    return
  }
  environmentLoading.value = true
  const [nssctf, ctfshow] = await Promise.allSettled([
    invokeCommand<NSSCTFWebBridgeStatus>('get_nssctf_web_bridge_status'),
    invokeCommand<CTFShowCatalogStatus>('get_ctfshow_catalog_status'),
  ])
  nssctfBrowserStatus.value = nssctf.status === 'fulfilled' ? nssctf.value : null
  ctfshowBrowserStatus.value = ctfshow.status === 'fulfilled' ? ctfshow.value : null
  if (nssctf.status === 'rejected' && ctfshow.status === 'rejected') {
    browserPanelError.value = '暂时无法读取浏览器连接。'
  }
  environmentLoading.value = false
}

async function refreshContextPanel() {
  if (contextPanel.value === 'browser') {
    await refreshBrowserPanel()
    return
  }
  await Promise.all([refreshEnvironment(), loadWorkshopState()])
}

function changeContextPanel(value: string) {
  if (!['environment', 'browser', 'collaboration', 'evidence'].includes(value)) return
  contextPanel.value = value as typeof contextPanel.value
  environmentOpen.value = true
  void refreshContextPanel()
}

async function revealBrowserExtension() {
  browserPanelError.value = ''
  try {
    await invokeCommand('reveal_browser_extension')
  } catch (reason) {
    browserPanelError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

async function copyPairingCode(value: string) {
  if (!value) return
  try {
    await navigator.clipboard.writeText(value)
  } catch {
    browserPanelError.value = '复制失败，请回到训练工作台手动复制配对码。'
  }
}

async function openSharedBrowserPage(url: string) {
  if (!url) return
  try {
    await invokeCommand('open_ctf_source_url', { url })
  } catch (reason) {
    browserPanelError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

async function inspectCodingDiff(relativePath: string) {
  if (!props.workspacePath || codingDiffLoading.value) return
  codingDiffLoading.value = true
  codingDiffError.value = ''
  try {
    codingDiff.value = await invokeCommand<CodingDiffSnapshot>(
      'get_coding_diff',
      { workspacePath: props.workspacePath, relativePath },
    )
  } catch (reason) {
    codingDiff.value = null
    codingDiffError.value = reason instanceof Error
      ? reason.message
      : '暂时无法读取文件 Diff。'
  } finally {
    codingDiffLoading.value = false
  }
}

function requestTool() {
  emit('ctfAction', {
    kind: 'handoff',
    prompt: '检查 notes.md 当前真正的阻塞点。如果确实需要一个可重复使用的辅助工具，请按 TOOLING.md 在 work/tool-requests/ 新建一个 status: pending 的最小请求，写清单一假设、输入输出契约、验收条件、fixture 和安全边界；这一步只写请求，不实现工具。若一次性命令已足够，请说明为什么不需要委托 Coding Agent。',
  })
}

function verifyDeliveredTool() {
  emit('ctfAction', {
    kind: 'handoff',
    prompt: '读取 work/tool-requests/ 中最新的 ready 请求和对应的 work/tools/ 实现。不要相信交付声明本身：独立运行验收测试，用当前题目材料验证输出契约，把命令、关键输出、结论和限制写入 notes.md，再决定是否把工具用于下一步解题。',
  })
}

watch(() => props.conversation?.messages.length, async () => {
  await nextTick()
  if (scrollArea.value) scrollArea.value.scrollTop = scrollArea.value.scrollHeight
})
watch(() => props.ctfSession, (current, previous) => {
  if (current !== previous) {
    environmentOpen.value = !current
    contextPanel.value = 'environment'
  }
})
watch(contextPanel, panel => {
  if (panel === 'browser' && environmentOpen.value) void refreshBrowserPanel()
})
watch(
  () => [props.ctfSession, props.conversation?.ctfJobId, props.ctfRole, props.running] as const,
  async ([ctfSession, jobId, _role, running]) => {
    if (ctfSession && jobId && !running) {
      await Promise.all([loadWorkshopState(), refreshEnvironment()])
    }
  },
  { immediate: true },
)
watch(
  () => [
    props.ctfSession,
    props.conversation?.id,
    props.workspacePath,
    props.running,
  ] as const,
  async ([_ctfSession, _conversationId, _workspacePath, running]) => {
    if (!running) await refreshEnvironment()
  },
  { immediate: true },
)
</script>

<template>
  <section class="relative flex min-w-0 flex-1 overflow-hidden bg-surface-editor">
  <main class="chat-main flex min-w-0 flex-1 flex-col overflow-hidden bg-surface-editor">
    <header
      class="chat-toolbar app-drag shrink-0"
      :class="{ 'chat-toolbar--ctf': ctfSession }"
    >
      <div class="chat-toolbar__summary min-w-0">
        <div class="flex min-w-0 items-center gap-2 overflow-hidden">
          <p class="truncate text-control font-medium">Coding</p>
          <Badge v-if="ctfSession" variant="secondary" class="max-w-full truncate">
            {{ ctfRoleLabel }}
          </Badge>
        </div>
        <p class="truncate text-caption text-muted-foreground">
          {{ conversation?.title ?? '新编码任务' }}
          · {{ workspacePath || `临时工作区 · ${codingPolicyLabel}` }}
        </p>
      </div>
      <div class="chat-toolbar__actions app-no-drag flex min-w-0 items-center gap-2">
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="environmentOpen ? '关闭右侧栏' : '打开右侧栏'"
          :title="environmentOpen ? '关闭右侧栏' : '打开右侧栏'"
          @click="environmentOpen = !environmentOpen"
        >
          <PanelRightClose v-if="environmentOpen" class="size-4" />
          <PanelRightOpen v-else class="size-4" />
        </Button>
      </div>
    </header>

    <div ref="scrollArea" class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="!conversation?.messages.length" class="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-8 py-16">
        <Bot class="size-6 text-muted-foreground" />
        <h1 class="mt-5 text-3xl font-semibold tracking-[-0.04em]">Coding</h1>
        <p class="mt-2 max-w-lg text-body leading-6 text-muted-foreground">
          选择项目并描述目标。MilkSU 使用 PI，并由当前执行模式和权限策略决定可用工具。
        </p>
        <div class="mt-6 grid grid-cols-3 gap-3">
          <div class="rounded-lg border border-border bg-card px-4 py-3">
            <Files class="size-4 text-muted-foreground" />
            <p class="mt-3 text-body font-medium">理解项目</p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">搜索并读取相关代码</p>
          </div>
          <div class="rounded-lg border border-border bg-card px-4 py-3">
            <FilePenLine class="size-4 text-muted-foreground" />
            <p class="mt-3 text-body font-medium">修改文件</p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">直接完成可审查的改动</p>
          </div>
          <div class="rounded-lg border border-border bg-card px-4 py-3">
            <Terminal class="size-4 text-muted-foreground" />
            <p class="mt-3 text-body font-medium">运行命令</p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">构建、测试与验证结果</p>
          </div>
        </div>
        <div class="mt-6 flex items-center gap-2">
          <Button v-if="!workspacePath" @click="$emit('chooseWorkspace')">
            <FolderOpen class="size-4" />
            选择项目目录
          </Button>
          <Badge v-else variant="outline" class="max-w-md truncate">
            {{ workspacePath }}
          </Badge>
          <Button v-if="!hasCredential" variant="outline" @click="$emit('openSettings')">
            <KeyRound class="size-4" />
            配置模型
          </Button>
        </div>
      </div>

      <div v-else class="mx-auto max-w-3xl px-8 py-8">
        <article
          v-for="message in conversation.messages"
          :key="message.id"
          class="mb-7"
          :class="message.role === 'user' ? 'ml-auto max-w-[82%]' : 'max-w-full'"
        >
          <div v-if="message.role === 'tool'" class="rounded-lg border border-border bg-muted/30 px-4 py-3">
            <p class="flex items-center gap-2 text-caption font-medium text-muted-foreground">
              <Wrench class="size-3.5" />
              {{ message.toolName ?? 'tool' }}
              <LoaderCircle v-if="message.status === 'running'" class="size-3.5 animate-spin" />
            </p>
            <pre v-if="message.content" class="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-body leading-5">{{ message.content }}</pre>
          </div>
          <div
            v-else
            class="break-words text-label leading-7"
            :class="message.role === 'user' ? 'rounded-xl bg-chat-user-bubble px-4 py-3 text-chat-user-bubble-fg' : ''"
          >
            <MarkdownContent :content="message.content" :compact="message.role === 'user'" />
            <LoaderCircle v-if="message.status === 'running'" class="ml-2 inline size-3.5 animate-spin text-muted-foreground" />
          </div>
        </article>
      </div>
    </div>

    <div class="chat-composer shrink-0 bg-surface-editor px-5 pb-4 pt-2">
      <div class="mx-auto max-w-3xl">
        <div class="chat-composer__controls app-no-drag mb-2 flex min-w-0 items-center gap-1.5 px-1">
          <Button
            variant="ghost"
            size="sm"
            class="chat-composer__workspace min-w-0"
            :disabled="workspaceLocked"
            :title="workspaceLocked ? '项目目录在任务开始后锁定；请新建任务来切换项目' : '选择项目目录'"
            @click="$emit('chooseWorkspace')"
          >
            <FolderOpen class="size-3.5 shrink-0" />
            <span class="truncate">{{ workspacePath ? workspaceName : '项目' }}</span>
          </Button>
          <Select
            v-if="!ctfSession"
            :model-value="effectiveExecutionMode"
            :disabled="running"
            @update:model-value="value => changeExecutionMode(String(value ?? ''))"
          >
            <SelectTrigger
              size="sm"
              class="w-20 border-0 bg-transparent shadow-none"
              aria-label="Coding 执行模式"
              title="Plan 只分析和规划；Go 按右侧权限策略使用工具。"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent size="sm" align="start">
              <SelectItem value="plan">Plan</SelectItem>
              <SelectItem value="go">Go</SelectItem>
            </SelectContent>
          </Select>
          <Select
            v-if="!ctfSession"
            :model-value="effectiveApprovalPolicy"
            :disabled="running"
            @update:model-value="value => changeApprovalPolicy(String(value ?? ''))"
          >
            <SelectTrigger
              size="sm"
              class="w-36 border-0 bg-transparent shadow-none"
              aria-label="Coding 权限策略"
              :title="effectiveApprovalPolicy === 'ask'
                ? 'Ask 暂无 Sidecar 同步审批通道，当前会按只读执行。'
                : effectiveApprovalPolicy === 'workspace-auto'
                  ? '仅自动批准工作区 edit/write 和固定的无网络 build/test/lint 命令。'
                  : '只允许读取、搜索和诊断。'"
            >
              <LockKeyhole class="size-3.5 shrink-0" />
              <SelectValue />
            </SelectTrigger>
            <SelectContent size="sm" align="start" class="min-w-72">
              <SelectGroup>
                <SelectLabel>权限策略</SelectLabel>
                <SelectItem value="read-only">只读</SelectItem>
                <SelectItem value="ask">每次询问 · 当前按只读</SelectItem>
                <SelectItem value="workspace-auto">工作区自动</SelectItem>
              </SelectGroup>
            </SelectContent>
          </Select>
          <DropdownMenu>
            <DropdownMenuTrigger as-child>
              <Button
                variant="ghost"
                size="sm"
                :aria-label="`查看本任务能力，${activeExtensions.length} 个插件`"
              >
                <Puzzle class="size-3.5" />
                能力
                <Badge v-if="activeExtensions.length" variant="secondary">
                  {{ activeExtensions.length }}
                </Badge>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" class="w-80">
              <DropdownMenuLabel>本任务已启用</DropdownMenuLabel>
              <div v-if="activeExtensions.length" class="space-y-2 px-2 py-2">
                <div
                  v-for="extension in activeExtensions"
                  :key="extension"
                  class="flex items-start gap-2"
                >
                  <Check class="mt-0.5 size-3.5 shrink-0 text-primary" />
                  <div>
                    <p class="text-body font-medium">{{ extensionLabel(extension) }}</p>
                    <p class="text-caption text-muted-foreground">
                      {{ extensionDescription(extension) }}
                    </p>
                  </div>
                </div>
              </div>
              <p v-else class="px-2 py-3 text-caption text-muted-foreground">
                启动一次 Agent 任务后显示实际加载结果。
              </p>
              <template v-if="activeSkills.length">
                <DropdownMenuSeparator />
                <DropdownMenuLabel>技能</DropdownMenuLabel>
                <div class="flex flex-wrap gap-1.5 px-2 py-2">
                  <Badge v-for="skill in activeSkills" :key="skill" variant="outline">
                    {{ skill }}
                  </Badge>
                </div>
              </template>
              <template v-if="activeTools.length">
                <DropdownMenuSeparator />
                <DropdownMenuLabel>工具 · {{ activeTools.length }}</DropdownMenuLabel>
                <p class="px-2 pb-2 text-caption leading-5 text-muted-foreground">
                  {{ activeTools.join(' · ') }}
                </p>
              </template>
              <template v-if="!ctfSession">
                <DropdownMenuSeparator />
                <DropdownMenuLabel>权限能力 · {{ codingPolicyLabel }}</DropdownMenuLabel>
                <div class="space-y-2 px-2 py-2">
                  <div
                    v-for="capability in codingCapabilities"
                    :key="capability.id"
                    class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-0.5"
                  >
                    <p class="text-body font-medium">{{ capability.label }}</p>
                    <Badge
                      :variant="capability.status === 'allowed' ? 'secondary' : 'outline'"
                    >
                      {{ capabilityStatusLabel(capability.status) }}
                    </Badge>
                    <p class="col-span-2 text-caption leading-5 text-muted-foreground">
                      {{ capability.detail }}
                    </p>
                  </div>
                </div>
              </template>
            </DropdownMenuContent>
          </DropdownMenu>
          <Select
            :model-value="currentModelKey"
            :disabled="running"
            @update:model-value="value => changeModel(String(value ?? ''))"
          >
            <SelectTrigger
              size="sm"
              class="chat-composer__model min-w-0 border-0 bg-transparent shadow-none"
              aria-label="选择本任务模型"
              :title="effectiveModelMode === 'auto'
                ? 'MilkSU 按任务角色自动选择模型；你可以仅为当前对话覆盖'
                : '当前对话固定使用所选模型'"
            >
              <SelectValue>{{ compactModelLabel }}</SelectValue>
            </SelectTrigger>
            <SelectContent size="sm" align="start" :align-offset="0" class="min-w-96">
              <SelectGroup>
                <SelectLabel>自动</SelectLabel>
                <SelectItem value="auto">
                  {{ automaticModelLabel }}
                </SelectItem>
              </SelectGroup>
              <SelectSeparator />
              <template
                v-for="(group, groupIndex) in PROVIDER_GROUPS"
                :key="group.kind"
              >
                <SelectSeparator v-if="groupIndex > 0" />
                <SelectGroup>
                  <SelectLabel>{{ group.label }}</SelectLabel>
                  <template v-for="provider in group.providers" :key="provider.id">
                    <SelectItem
                      v-for="model in provider.models"
                      :key="`${provider.id}:${model}`"
                      :value="`manual:${provider.id}:${model}`"
                    >
                      {{ providerModelLabel(provider.id, model) }}
                    </SelectItem>
                  </template>
                </SelectGroup>
              </template>
            </SelectContent>
          </Select>
        </div>

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

        <form class="chat-composer__island flex items-end gap-2" @submit.prevent="submit">
          <Textarea
            v-model="draft"
            class="max-h-40 min-h-11 resize-none border-0 bg-transparent shadow-none focus-visible:ring-0"
            :placeholder="ctfSession
              ? ctfRole === 'strategist'
                ? '补充你希望独立复盘的卡点或失败路线…'
                : ctfRole === 'tool-builder'
                  ? '告诉 Coding Agent 要实现或修正的本题工具…'
                  : '告诉 Agent 你的观察、假设，或直接使用上面的快捷协作…'
              : workspacePath
                ? `让 Agent 在 ${workspaceName} 中完成任务…`
                : '在临时沙盒中开始，或先选择一个项目…'"
            aria-label="消息"
            @keydown.enter.exact.prevent="submit"
          />
          <Button
            v-if="running"
            type="button"
            variant="destructive"
            size="icon"
            aria-label="停止 Agent"
            @click="$emit('abort')"
          >
            <Square class="size-3.5 fill-current" />
          </Button>
          <Button v-else type="submit" variant="brand" size="icon" :disabled="!draft.trim()" aria-label="发送">
            <ArrowUp class="size-4" />
          </Button>
        </form>
      </div>
    </div>
  </main>
  <aside
    v-if="environmentOpen"
    class="context-sidebar flex w-80 shrink-0 flex-col border-l border-border bg-card/95 backdrop-blur"
    :aria-label="contextPanelTitle"
  >
    <header class="app-drag flex h-14 shrink-0 items-center justify-between border-b border-border px-4">
      <Select
        :model-value="contextPanel"
        @update:model-value="value => changeContextPanel(String(value ?? ''))"
      >
        <SelectTrigger
          size="sm"
          class="app-no-drag min-w-44 border-0 bg-transparent px-0 shadow-none"
          aria-label="选择右侧页面"
        >
          <Activity v-if="contextPanel === 'environment'" class="size-4 text-primary" />
          <Globe2 v-else-if="contextPanel === 'browser'" class="size-4 text-primary" />
          <Wrench v-else-if="contextPanel === 'collaboration'" class="size-4 text-primary" />
          <CircleDot v-else class="size-4 text-primary" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent size="sm" align="start" class="min-w-56">
          <SelectItem value="environment">{{ ctfSession ? '解题环境' : '环境信息' }}</SelectItem>
          <SelectItem value="browser">浏览器</SelectItem>
          <template v-if="ctfSession">
            <SelectSeparator />
            <SelectItem value="collaboration">Agent 协作</SelectItem>
            <SelectItem value="evidence">证据与 Judge</SelectItem>
          </template>
        </SelectContent>
      </Select>
      <div class="app-no-drag flex items-center gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="environmentLoading"
          :aria-label="`刷新${contextPanelTitle}`"
          @click="refreshContextPanel"
        >
          <RefreshCw class="size-4" :class="{ 'animate-spin': environmentLoading }" />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="关闭右侧栏"
          @click="environmentOpen = false"
        >
          <PanelRightClose class="size-4" />
        </Button>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto">
      <template v-if="contextPanel === 'environment'">
        <div v-if="environmentError" class="border-b border-border px-4 py-3 text-caption text-destructive">
          {{ environmentError }}
        </div>

        <section class="border-b border-border px-4 py-4">
          <p class="text-caption font-medium text-muted-foreground">工作区</p>
          <div class="mt-3 flex items-start gap-3">
            <FolderOpen class="mt-0.5 size-4 shrink-0 text-primary" />
            <div class="min-w-0">
              <p class="truncate text-body font-medium">
                {{ codingEnvironment?.workspaceName || workspaceName }}
              </p>
              <p class="mt-1 truncate font-mono text-caption text-muted-foreground" :title="workspacePath">
                {{ workspacePath || '尚未选择项目' }}
              </p>
            </div>
          </div>
        </section>

        <template v-if="!ctfSession">
        <section class="border-b border-border px-4 py-4">
          <div class="flex items-center justify-between gap-3">
            <p class="text-caption font-medium text-muted-foreground">执行与权限</p>
            <Badge variant="outline">{{ codingPolicyLabel }}</Badge>
          </div>
          <div class="mt-3 space-y-3">
            <div
              v-for="capability in codingCapabilities"
              :key="capability.id"
              class="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1"
            >
              <p class="text-body">{{ capability.label }}</p>
              <span
                class="text-caption"
                :class="capability.status === 'allowed'
                  ? 'text-primary'
                  : capability.status === 'approval-required'
                    ? 'text-amber-500'
                    : 'text-muted-foreground'"
              >
                {{ capabilityStatusLabel(capability.status) }}
              </span>
              <p class="col-span-2 text-caption leading-5 text-muted-foreground">
                {{ capability.detail }}
              </p>
            </div>
          </div>
        </section>
        <section class="border-b border-border px-4 py-4">
          <div class="flex items-center justify-between">
            <p class="text-caption font-medium text-muted-foreground">Git</p>
            <Badge
              v-if="codingEnvironment?.git.isRepository"
              :variant="codingEnvironment.git.dirty ? 'secondary' : 'outline'"
            >
              {{ codingEnvironment.git.dirty ? '有变更' : '干净' }}
            </Badge>
          </div>
          <div v-if="codingEnvironment?.git.isRepository" class="mt-3 space-y-3 text-body">
            <div class="flex items-center justify-between gap-3">
              <span class="flex min-w-0 items-center gap-2 text-muted-foreground">
                <GitBranch class="size-4 shrink-0" />
                <span class="truncate">{{ codingEnvironment.git.branch || 'detached' }}</span>
              </span>
              <span v-if="codingEnvironment.git.ahead || codingEnvironment.git.behind" class="font-mono text-caption">
                ↑{{ codingEnvironment.git.ahead }} ↓{{ codingEnvironment.git.behind }}
              </span>
            </div>
            <div v-if="codingEnvironment.git.head" class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground">提交</span>
              <span class="font-mono text-caption">{{ codingEnvironment.git.head }}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground">变更</span>
              <span class="font-mono text-caption">
                {{ codingEnvironment.git.changedFiles }} 文件
                <span class="text-primary">+{{ codingEnvironment.git.additions }}</span>
                <span class="text-destructive">-{{ codingEnvironment.git.deletions }}</span>
              </span>
            </div>
            <div class="grid grid-cols-2 gap-x-3 gap-y-2 text-caption text-muted-foreground">
              <span>暂存 {{ codingEnvironment.git.staged }}</span>
              <span>修改 {{ codingEnvironment.git.modified }}</span>
              <span>未跟踪 {{ codingEnvironment.git.untracked }}</span>
              <span :class="{ 'text-destructive': codingEnvironment.git.conflicts }">
                冲突 {{ codingEnvironment.git.conflicts }}
              </span>
            </div>
            <div v-if="codingEnvironment.git.changes?.length" class="border-t border-border pt-3">
              <div class="mb-2 flex items-center justify-between gap-3">
                <span class="text-caption font-medium text-muted-foreground">文件</span>
                <span v-if="codingEnvironment.git.changesTruncated" class="text-caption text-muted-foreground">
                  仅显示前 80 项
                </span>
              </div>
              <div class="space-y-1">
                <button
                  v-for="change in codingEnvironment.git.changes"
                  :key="`${change.indexStatus}${change.worktreeStatus}:${change.path}`"
                  type="button"
                  class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-caption transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  :class="{ 'bg-muted': codingDiff?.path === change.path }"
                  :title="change.originalPath ? `${change.originalPath} → ${change.path}` : change.path"
                  @click="inspectCodingDiff(change.path)"
                >
                  <span
                    class="w-6 shrink-0 font-mono"
                    :class="change.conflict ? 'text-destructive' : change.untracked ? 'text-primary' : 'text-muted-foreground'"
                  >
                    {{ change.indexStatus }}{{ change.worktreeStatus }}
                  </span>
                  <span class="min-w-0 flex-1 truncate">{{ change.path }}</span>
                </button>
              </div>
            </div>
            <div
              v-if="codingDiffLoading || codingDiffError || codingDiff"
              class="rounded-md border border-border bg-background/50 p-3"
            >
              <div class="flex items-center justify-between gap-3">
                <span class="min-w-0 truncate font-mono text-caption">
                  {{ codingDiff?.path || '读取 Diff' }}
                </span>
                <LoaderCircle v-if="codingDiffLoading" class="size-3.5 animate-spin text-muted-foreground" />
              </div>
              <p v-if="codingDiffError" class="mt-2 text-caption leading-5 text-destructive">
                {{ codingDiffError }}
              </p>
              <template v-else-if="codingDiff">
                <div v-if="codingDiff.staged" class="mt-3">
                  <p class="mb-1 text-caption font-medium text-muted-foreground">已暂存</p>
                  <pre class="max-h-52 overflow-auto whitespace-pre font-mono text-[11px] leading-4">{{ codingDiff.staged }}</pre>
                </div>
                <div v-if="codingDiff.workingTree" class="mt-3">
                  <p class="mb-1 text-caption font-medium text-muted-foreground">工作区</p>
                  <pre class="max-h-52 overflow-auto whitespace-pre font-mono text-[11px] leading-4">{{ codingDiff.workingTree }}</pre>
                </div>
                <p
                  v-if="!codingDiff.staged && !codingDiff.workingTree"
                  class="mt-2 text-caption leading-5 text-muted-foreground"
                >
                  未跟踪文件或二进制变更没有可显示的文本 Diff。
                </p>
                <p v-if="codingDiff.truncated" class="mt-2 text-caption text-muted-foreground">
                  Diff 过长，已截断。
                </p>
              </template>
            </div>
          </div>
          <p v-else class="mt-3 text-caption leading-5 text-muted-foreground">
            {{ codingEnvironment?.git.problem || '当前目录不是 Git 仓库。' }}
          </p>
        </section>
        </template>

        <template v-else>
        <section class="border-b border-border px-4 py-4">
          <p class="text-caption font-medium text-muted-foreground">当前解题</p>
          <div class="mt-3 space-y-3 text-body">
            <div class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground">角色</span>
              <span>{{ ctfRoleLabel }}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground">协作</span>
              <span>{{ ctfMode === 'coach' ? '教练' : ctfMode === 'delegate' ? '代理' : '搭档' }}</span>
            </div>
            <div class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground">阶段</span>
              <span>{{ ctfCheckpoint?.progress?.phase || ctfCheckpoint?.status || '待启动' }}</span>
            </div>
            <div v-if="ctfBudget" class="flex items-center justify-between gap-3">
              <span class="text-muted-foreground">回合预算</span>
              <span class="font-mono text-caption">
                {{ ctfBudget.remainingTurns }}/{{ ctfBudget.budget.maxTurns }}
              </span>
            </div>
          </div>
        </section>

        </template>

        <section class="border-b border-border px-4 py-4">
        <p class="text-caption font-medium text-muted-foreground">Agent</p>
        <div class="mt-3 space-y-3 text-body">
          <div class="flex items-center justify-between gap-3">
            <span class="text-muted-foreground">状态</span>
            <span class="flex items-center gap-2">
              <span
                class="size-1.5 rounded-full"
                :class="running ? 'animate-pulse bg-primary' : 'bg-muted-foreground'"
              />
              {{ running ? '执行中' : '空闲' }}
            </span>
          </div>
          <div class="flex items-start justify-between gap-3">
            <span class="shrink-0 text-muted-foreground">模型</span>
            <span class="text-right text-caption leading-5">{{ activeModelLabel }}</span>
          </div>
          <div class="flex items-start justify-between gap-3">
            <span class="shrink-0 text-muted-foreground">插件</span>
            <span class="text-right text-caption leading-5">
              {{ activeExtensions.length ? activeExtensions.map(extensionLabel).join(' · ') : '启动后显示' }}
            </span>
          </div>
          <div class="flex items-start justify-between gap-3">
            <span class="shrink-0 text-muted-foreground">工具</span>
            <span class="text-right text-caption leading-5">
              {{ activeTools.length }} 个
            </span>
          </div>
        </div>
        </section>

        <section class="px-4 py-4">
        <p class="text-caption font-medium text-muted-foreground">任务上下文</p>
        <div class="mt-3 space-y-3 text-body">
          <div class="flex items-center justify-between gap-3">
            <span class="text-muted-foreground">消息</span>
            <span>{{ messageCount }}</span>
          </div>
          <div class="flex items-center justify-between gap-3">
            <span class="text-muted-foreground">工具记录</span>
            <span>{{ toolMessageCount }}</span>
          </div>
          <div v-if="ctfSession" class="flex items-center justify-between gap-3">
            <span class="text-muted-foreground">工具工坊</span>
            <span class="text-right text-caption">{{ workshopSummary }}</span>
          </div>
        </div>
        </section>
      </template>

      <template v-else-if="contextPanel === 'browser'">
        <div v-if="browserPanelError" class="border-b border-border px-4 py-3 text-caption text-destructive">
          {{ browserPanelError }}
        </div>
        <section v-if="!ctfSession" class="px-4 py-5">
          <p class="text-body font-medium">Coding 浏览器能力尚未启用</p>
          <p class="mt-2 text-caption leading-5 text-muted-foreground">
            MCP 浏览器与 Computer Use 会走独立权限授权；当前任务不会静默继承浏览器会话。
          </p>
        </section>
        <template v-else>
          <section class="border-b border-border px-4 py-4">
            <div class="flex items-center justify-between gap-3">
              <div>
                <p class="text-body font-medium">MilkSU Chrome Bridge</p>
                <p class="mt-1 text-caption text-muted-foreground">
                  {{
                    nssctfBrowserStatus?.bridge.connected || ctfshowBrowserStatus?.bridge.connected
                      ? '扩展已连接'
                      : '等待扩展连接'
                  }}
                </p>
              </div>
              <span
                class="size-2 rounded-full"
                :class="nssctfBrowserStatus?.bridge.connected || ctfshowBrowserStatus?.bridge.connected
                  ? 'bg-primary'
                  : 'bg-muted-foreground'"
              />
            </div>
            <div class="mt-4 flex flex-wrap gap-2">
              <Button variant="outline" size="sm" @click="revealBrowserExtension">
                查看扩展
              </Button>
              <Button
                v-if="nssctfBrowserStatus?.bridge.pairingCode"
                variant="ghost"
                size="sm"
                @click="copyPairingCode(nssctfBrowserStatus.bridge.pairingCode)"
              >
                <Copy class="size-3.5" />
                复制配对码
              </Button>
            </div>
          </section>
          <section class="border-b border-border px-4 py-4">
            <p class="text-caption font-medium text-muted-foreground">
              NSSCTF · {{ nssctfBrowserStatus?.pages.length ?? 0 }} 个页面
            </p>
            <div v-if="nssctfBrowserStatus?.pages.length" class="mt-3 space-y-2">
              <button
                v-for="page in nssctfBrowserStatus.pages"
                :key="page.id"
                type="button"
                class="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"
                @click="openSharedBrowserPage(page.url)"
              >
                <Globe2 class="mt-0.5 size-4 shrink-0 text-primary" />
                <span class="min-w-0 flex-1">
                  <span class="block truncate text-body">{{ page.title }}</span>
                  <span class="mt-0.5 block truncate text-caption text-muted-foreground">
                    P{{ page.nssctf.problemId }} · {{ page.connected ? '已连接' : '已断开' }}
                  </span>
                </span>
                <ExternalLink class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
            <p v-else class="mt-3 text-caption text-muted-foreground">没有共享的 NSSCTF 页面。</p>
          </section>
          <section class="px-4 py-4">
            <p class="text-caption font-medium text-muted-foreground">
              CTFshow · {{ ctfshowBrowserStatus?.pages.length ?? 0 }} 个页面
            </p>
            <div v-if="ctfshowBrowserStatus?.pages.length" class="mt-3 space-y-2">
              <button
                v-for="page in ctfshowBrowserStatus.pages"
                :key="page.id"
                type="button"
                class="flex w-full items-start gap-2 rounded-md px-2 py-2 text-left hover:bg-muted"
                @click="openSharedBrowserPage(page.url)"
              >
                <Globe2 class="mt-0.5 size-4 shrink-0 text-primary" />
                <span class="min-w-0 flex-1 truncate text-body">{{ page.title }}</span>
                <ExternalLink class="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
              </button>
            </div>
            <p v-else class="mt-3 text-caption text-muted-foreground">没有共享的 CTFshow 页面。</p>
          </section>
        </template>
      </template>

      <template v-else-if="contextPanel === 'collaboration'">
        <section class="border-b border-border px-4 py-4">
          <p class="text-caption font-medium text-muted-foreground">当前角色</p>
          <div class="mt-3 grid gap-2">
            <Button
              :variant="ctfRole === 'solver' ? 'secondary' : 'outline'"
              class="justify-start"
              @click="$emit('switchCtfAgent', 'solver')"
            >
              <Flag class="size-4" />
              解题 Agent
            </Button>
            <Button
              :variant="ctfRole === 'tool-builder' ? 'secondary' : 'outline'"
              class="justify-start"
              @click="$emit('switchCtfAgent', 'tool-builder')"
            >
              <Wrench class="size-4" />
              Coding Agent 工具工坊
            </Button>
            <Button
              :variant="ctfRole === 'strategist' ? 'secondary' : 'outline'"
              class="justify-start"
              @click="$emit('switchCtfAgent', 'strategist')"
            >
              <Route class="size-4" />
              策略复盘
            </Button>
          </div>
          <div
            v-if="ctfRole === 'strategist'"
            class="mt-3 rounded-lg bg-primary/5 px-3 py-3"
          >
            <p class="text-body font-medium">策略 Agent 复盘</p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">
              独立审阅题面、轨迹与证据；不执行命令，不修改解题笔记或候选。
            </p>
            <Button
              variant="link"
              size="text"
              class="mt-2"
              @click="$emit('switchCtfAgent', 'solver')"
            >
              复盘完成后返回验证
            </Button>
          </div>
        </section>
        <section class="border-b border-border px-4 py-4">
          <p class="text-caption font-medium text-muted-foreground">工具交接</p>
          <p class="mt-2 text-body">{{ workshopSummary }}</p>
          <p
            v-if="workshopState?.latestRequest"
            class="mt-1 truncate text-caption text-muted-foreground"
            :title="workshopState.latestRequest.relativePath"
          >
            {{ workshopState.latestRequest.title }}
          </p>
          <div class="mt-4 flex flex-wrap gap-2">
            <Button
              v-if="ctfRole !== 'tool-builder' && workshopState?.readyCount"
              variant="outline"
              size="sm"
              :disabled="running"
              @click="verifyDeliveredTool"
            >
              验收工具
            </Button>
            <Button
              v-else-if="ctfRole !== 'tool-builder' && !workshopState?.pendingCount"
              variant="outline"
              size="sm"
              :disabled="running"
              @click="requestTool"
            >
              提出工具需求
            </Button>
          </div>
        </section>
        <section class="px-4 py-4">
          <Button variant="outline" class="w-full justify-start" @click="$emit('returnCtf')">
            <Flag class="size-4" />
            返回训练工作台
          </Button>
        </section>
      </template>

      <template v-else>
        <section class="border-b border-border px-4 py-4">
          <p class="text-caption font-medium text-muted-foreground">证据与 Judge</p>
          <div class="mt-3 grid grid-cols-2 gap-3">
            <div>
              <p class="text-xl font-semibold">{{ ctfProjection?.evidence.length ?? 0 }}</p>
              <p class="text-caption text-muted-foreground">证据</p>
            </div>
            <div>
              <p class="text-xl font-semibold">{{ ctfProjection?.artifacts.length ?? 0 }}</p>
              <p class="text-caption text-muted-foreground">制品</p>
            </div>
          </div>
          <div v-if="latestJudge" class="mt-4 flex items-start gap-2">
            <CircleDot
              class="mt-0.5 size-4 shrink-0"
              :class="latestJudge.correct ? 'text-primary' : 'text-muted-foreground'"
            />
            <div>
              <p class="text-body font-medium">{{ latestJudge.platform }} · {{ latestJudge.status }}</p>
              <MarkdownContent
                class="mt-1 line-clamp-3 text-caption leading-5 text-muted-foreground"
                :content="latestJudge.summary"
                compact
              />
            </div>
          </div>
          <p v-else class="mt-3 text-caption text-muted-foreground">尚无外部 Judge 回执。</p>
        </section>
        <section class="px-4 py-4">
          <Button variant="outline" class="w-full justify-start" @click="$emit('returnCtf')">
            查看完整轨迹与提交
          </Button>
        </section>
      </template>
    </div>
  </aside>
  </section>
</template>

<style scoped>
.chat-main {
  container-name: chat-main;
  container-type: inline-size;
}

.chat-toolbar {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.75rem;
  min-height: 3.5rem;
  padding: 0.5rem 1.5rem;
}

.chat-toolbar__summary {
  overflow: hidden;
}

.chat-toolbar__actions {
  max-width: 100%;
}

.chat-toolbar--ctf {
  grid-template-columns: minmax(0, 1fr);
  align-items: stretch;
  padding-inline: 1rem;
}

.chat-toolbar--ctf .chat-toolbar__actions {
  flex-wrap: wrap;
  justify-content: flex-start;
}

.chat-composer {
  position: relative;
  z-index: 2;
}

.chat-composer__workspace {
  max-width: 12rem;
}

.chat-composer__model {
  width: min(22rem, 48vw);
}

.chat-composer__island {
  border: 1px solid var(--border);
  border-radius: 1rem;
  background: var(--card);
  padding: 0.5rem 0.55rem 0.5rem 0.8rem;
  box-shadow:
    0 14px 34px rgb(0 0 0 / 18%),
    0 2px 8px rgb(0 0 0 / 10%);
}

@media (max-width: 68.75rem) {
  .context-sidebar {
    position: absolute;
    inset-block: 0;
    right: 0;
    z-index: 20;
    box-shadow: -18px 0 40px rgb(0 0 0 / 28%);
  }
}

@container chat-main (max-width: 52rem) {
  .chat-composer__controls {
    flex-wrap: wrap;
  }

  .chat-composer__workspace {
    max-width: 9rem;
  }

  .chat-composer__model {
    flex: 1 1 13rem;
    width: auto;
  }
}
</style>
