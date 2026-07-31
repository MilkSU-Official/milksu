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
  ArrowUp,
  Bot,
  Check,
  Compass,
  FilePenLine,
  Files,
  Flag,
  FolderOpen,
  KeyRound,
  Lightbulb,
  LoaderCircle,
  Puzzle,
  Route,
  Square,
  StickyNote,
  Terminal,
  Wrench,
} from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import type { CTFToolWorkshopState } from '@/ctfTypes'
import type { AppSettings, Conversation, CTFChatAction } from '@/types'
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
}>()

const emit = defineEmits<{
  send: [text: string]
  ctfAction: [action: CTFChatAction]
  abort: []
  chooseWorkspace: []
  changeModel: [mode: 'auto' | 'manual', provider?: string, model?: string]
  openSettings: []
  returnCtf: []
  switchCtfAgent: [role: 'solver' | 'tool-builder' | 'strategist']
}>()

const draft = ref('')
const scrollArea = ref<HTMLElement | null>(null)
const workshopState = ref<CTFToolWorkshopState | null>(null)
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
const extensionLabel = (value: string) => (
  value === 'milksu-workflow' ? 'MilkSU Workflow' : value
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
watch(
  () => [props.ctfSession, props.conversation?.ctfJobId, props.ctfRole, props.running] as const,
  async ([ctfSession, jobId, _role, running]) => {
    if (ctfSession && jobId && !running) await loadWorkshopState()
  },
  { immediate: true },
)
</script>

<template>
  <main class="flex min-w-0 flex-1 flex-col bg-surface-editor">
    <header class="app-drag flex h-14 shrink-0 items-center justify-between border-b border-border px-6">
      <div class="min-w-0">
        <div class="flex items-center gap-2">
          <p class="truncate text-control font-medium">Coding</p>
          <Badge v-if="ctfSession" variant="secondary">
            {{ ctfRoleLabel }}
          </Badge>
        </div>
        <p class="truncate text-caption text-muted-foreground">
          {{ conversation?.title ?? '新编码任务' }}
          · {{ workspacePath || '临时沙盒 · 选择项目后可读写代码并运行命令' }}
        </p>
      </div>
      <div class="app-no-drag flex items-center gap-2">
        <Button
          v-if="ctfSession && ctfRole === 'solver'"
          variant="outline"
          size="sm"
          @click="$emit('switchCtfAgent', 'strategist')"
        >
          <Route class="size-4" />
          策略复盘
        </Button>
        <Button
          v-if="ctfSession && ctfRole === 'solver'"
          variant="outline"
          size="sm"
          @click="$emit('switchCtfAgent', 'tool-builder')"
        >
          <Wrench class="size-4" />
          {{
            workshopState?.pendingCount
              ? '交给 Coding Agent'
              : '打开工具工坊'
          }}
        </Button>
        <Button
          v-else-if="ctfSession"
          variant="outline"
          size="sm"
          @click="$emit('switchCtfAgent', 'solver')"
        >
          <Flag class="size-4" />
          返回解题 Agent
        </Button>
        <Button v-if="ctfSession" variant="ghost" size="sm" @click="$emit('returnCtf')">
          <Flag class="size-4" />
          返回训练工作台
        </Button>
        <Button
          variant="outline"
          size="sm"
          :disabled="workspaceLocked"
          :title="workspaceLocked ? '项目目录在任务开始后锁定；请新建任务来切换项目' : '选择项目目录'"
          @click="$emit('chooseWorkspace')"
        >
          <FolderOpen class="size-4" />
          {{ workspacePath ? workspaceName : '选择项目' }}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              size="sm"
              :aria-label="`查看本任务能力，${activeExtensions.length} 个插件`"
            >
              <Puzzle class="size-4" />
              能力
              <Badge v-if="activeExtensions.length" variant="secondary">
                {{ activeExtensions.length }}
              </Badge>
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" class="w-80">
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
                    计划可见、角色工作流与结果验证
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
          </DropdownMenuContent>
        </DropdownMenu>
        <Select
          :model-value="currentModelKey"
          :disabled="running"
          @update:model-value="value => changeModel(String(value ?? ''))"
        >
          <SelectTrigger
            size="sm"
            class="min-w-64"
            aria-label="选择本任务模型"
            :title="effectiveModelMode === 'auto'
              ? 'MilkSU 按任务角色自动选择模型；你可以仅为当前对话覆盖'
              : '当前对话固定使用所选模型'"
          >
            <SelectValue />
          </SelectTrigger>
          <SelectContent size="sm" align="end" :align-offset="0" class="min-w-96">
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
    </header>

    <div
      v-if="ctfSession && ctfRole === 'strategist'"
      class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-primary/5 px-6 py-2 text-caption"
    >
      <span class="text-muted-foreground">
        独立审阅题面、轨迹与证据；不执行命令，不修改解题笔记或候选。
      </span>
      <Button variant="link" size="text" @click="$emit('switchCtfAgent', 'solver')">
        复盘完成后返回验证
      </Button>
    </div>
    <div
      v-else-if="ctfSession"
      class="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-primary/5 px-6 py-2 text-caption"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-2">
        <Badge variant="outline">{{ workshopSummary }}</Badge>
        <span
          v-if="workshopState?.latestRequest"
          class="max-w-80 truncate text-muted-foreground"
          :title="workshopState.latestRequest.relativePath"
        >
          {{ workshopState.latestRequest.title }}
        </span>
      </div>
      <div class="flex items-center gap-2">
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
        <Button variant="link" size="text" @click="$emit('returnCtf')">查看轨迹与提交</Button>
      </div>
    </div>

    <div ref="scrollArea" class="min-h-0 flex-1 overflow-y-auto">
      <div v-if="!conversation?.messages.length" class="mx-auto flex min-h-full max-w-2xl flex-col justify-center px-8 py-16">
        <Bot class="size-6 text-muted-foreground" />
        <h1 class="mt-5 text-3xl font-semibold tracking-[-0.04em]">Coding</h1>
        <p class="mt-2 max-w-lg text-body leading-6 text-muted-foreground">
          选择项目并描述目标。MilkSU 使用 PI 读取项目、编辑文件并执行命令，你可以随时查看或停止。
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
            class="whitespace-pre-wrap break-words text-label leading-7"
            :class="message.role === 'user' ? 'rounded-xl bg-chat-user-bubble px-4 py-3 text-chat-user-bubble-fg' : ''"
          >
            {{ message.content }}
            <LoaderCircle v-if="message.status === 'running'" class="ml-2 inline size-3.5 animate-spin text-muted-foreground" />
          </div>
        </article>
      </div>
    </div>

    <div class="shrink-0 border-t border-border bg-surface-composer px-5 py-4">
      <div
        v-if="ctfSession && ctfRole === 'solver'"
        class="mx-auto mb-3 flex max-w-3xl flex-wrap items-center gap-2"
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
      <form class="mx-auto flex max-w-3xl items-end gap-2" @submit.prevent="submit">
        <Textarea
          v-model="draft"
          class="max-h-40 min-h-11"
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
  </main>
</template>
