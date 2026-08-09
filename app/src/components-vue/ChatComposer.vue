<script setup lang="ts">
import { computed, markRaw, nextTick, ref, watch } from 'vue'
import { Button, Textarea } from '@felinic/ui'
import {
  ArrowUp,
  Compass,
  FileText,
  Lightbulb,
  LoaderCircle,
  Paperclip,
  Pause,
  Play,
  Route,
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
  CodingExecutionMode,
  CodingGoalState,
  CTFChatAction,
} from '@/types'

interface ComposerGitSummary {
  changedFiles: number
  additions: number
  deletions: number
}

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
}>()

const emit = defineEmits<{
  send: [text: string, visibleText?: string, attachments?: CodingAttachment[]]
  ctfAction: [action: CTFChatAction]
  abort: []
  changeExecutionMode: [value: string]
  changeApprovalPolicy: [value: string]
  changeModel: [value: string]
  showPermissions: []
  consumeGoal: []
  startGoal: []
  controlGoal: [action: 'pause' | 'resume' | 'clear']
}>()

const draft = ref('')
const composerFrame = ref<HTMLElement | null>(null)
const pendingAttachments = ref<CodingAttachment[]>([])
const attachmentError = ref('')
const composing = ref(false)
const compositionJustEnded = ref(false)
const slashMenuDismissed = ref(false)

const slashQuery = computed(() => {
  if (props.ctfSession || props.goalMode) return null
  if (!draft.value.startsWith('/') || /\s/u.test(draft.value)) return null
  return draft.value.slice(1).toLocaleLowerCase()
})
const hasUnfinishedGoal = computed(() => Boolean(
  props.goal && props.goal.status !== 'complete',
))
const slashCommands = computed(() => {
  const query = slashQuery.value
  if (query === null) return []
  return [{
    id: 'goal',
    label: '目标',
    description: hasUnfinishedGoal.value
      ? '当前已有持续目标'
      : '设置要持续追求的目标',
    disabled: props.running || hasUnfinishedGoal.value,
  }].filter(command => (
    !query
    || command.id.includes(query)
    || command.label.toLocaleLowerCase().includes(query)
  ))
})
const slashMenuOpen = computed(() => (
  !slashMenuDismissed.value && slashCommands.value.length > 0
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

function removeCodingAttachment(attachment: CodingAttachment) {
  pendingAttachments.value = pendingAttachments.value.filter(value => (
    value.id !== attachment.id || value.name !== attachment.name
  ))
}

function submit() {
  const attachments = [...pendingAttachments.value]
  const text = draft.value.trim()
    || (attachments.length ? '请检查这些附件并完成我接下来需要处理的任务。' : '')
  if (!text || props.running) return
  const prompt = !props.ctfSession && props.goalMode
    ? `/goal ${text}`
    : text
  draft.value = ''
  pendingAttachments.value = []
  attachmentError.value = ''
  emit('send', prompt, text, attachments)
  emit('consumeGoal')
}

function focusMessageInput() {
  void nextTick(() => {
    composerFrame.value?.querySelector<HTMLTextAreaElement>('textarea')?.focus()
  })
}

function chooseGoalCommand() {
  const command = slashCommands.value[0]
  if (!command || command.disabled) return
  draft.value = ''
  slashMenuDismissed.value = false
  emit('startGoal')
  focusMessageInput()
}

function handleComposerKeyDown(event: KeyboardEvent) {
  if (
    event.isComposing
    || composing.value
    || compositionJustEnded.value
    || event.keyCode === 229
  ) return

  if (slashMenuOpen.value) {
    if (event.key === 'Escape') {
      event.preventDefault()
      slashMenuDismissed.value = true
      return
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
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
      chooseGoalCommand()
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
  window.setTimeout(() => {
    compositionJustEnded.value = false
  }, 0)
}

function appendDraftText(text: string) {
  const normalized = text.trim()
  if (!normalized || props.running) return
  draft.value = draft.value.trim()
    ? `${draft.value.trim()}\n\n${normalized}`
    : normalized
}

watch(draft, () => {
  slashMenuDismissed.value = false
})

defineExpose({
  appendDraftText,
})
</script>

<template>
  <div class="chat-composer shrink-0 bg-surface-editor px-5 pb-4 pt-2">
    <div ref="composerFrame" class="chat-composer__frame mx-auto max-w-3xl">
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
          v-for="command in slashCommands"
          :id="`coding-slash-command-${command.id}`"
          :key="command.id"
          type="button"
          class="chat-composer__command-option"
          :class="{ 'opacity-50': command.disabled }"
          role="option"
          aria-selected="true"
          :aria-disabled="command.disabled"
          :disabled="command.disabled"
          @mousedown.prevent
          @click="chooseGoalCommand"
        >
          <Target class="size-4 shrink-0" />
          <span class="min-w-0 text-left">
            <span class="block text-body font-medium">{{ command.label }}</span>
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
          <span v-if="showGitSummary">
            {{ gitSummary?.changedFiles }} 个文件已更改
          </span>
          <span v-if="showGitSummary" class="text-primary">
            +{{ gitSummary?.additions }}
          </span>
          <span v-if="showGitSummary" class="text-destructive">
            -{{ gitSummary?.deletions }}
          </span>
        </div>

        <section
          v-if="goal || goalMode"
          class="chat-composer__goal-panel"
          aria-label="持续目标"
        >
          <Target class="size-4 shrink-0 text-primary" />
          <div class="min-w-0 flex-1">
            <div class="flex min-w-0 items-center gap-2">
              <span class="shrink-0 text-caption font-medium text-primary">
                {{ goal ? goalStatusLabel : '正在设置' }}
              </span>
              <span
                v-if="goalUsageLabel"
                class="truncate text-caption text-muted-foreground"
              >
                {{ goalUsageLabel }}
              </span>
            </div>
            <p class="mt-0.5 max-w-[34rem] truncate text-body" :title="goal?.text">
              {{ goal?.text || '下一条消息会成为持续目标。' }}
            </p>
          </div>
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
            <FileText class="size-3.5 shrink-0 text-muted-foreground" />
            <span class="max-w-52 truncate">{{ attachment.name }}</span>
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
        <Textarea
          v-model="draft"
          class="chat-composer__input max-h-44 min-h-24 resize-none border-0 bg-transparent px-1 pb-2 pt-1.5 shadow-none focus-visible:ring-0"
          aria-label="消息"
          aria-autocomplete="list"
          :aria-controls="slashMenuOpen ? 'coding-slash-command-menu' : undefined"
          :aria-expanded="slashMenuOpen"
          :aria-activedescendant="slashMenuOpen ? 'coding-slash-command-goal' : undefined"
          :placeholder="goalMode ? '写下一个可持续目标，MilkSU 会持续推进并保留恢复点' : ctfSession ? '告诉 Agent 你的观察、假设或下一步想法' : '描述你想让 MilkSU 完成的任务'"
          @compositionstart="composing = true"
          @compositionend="handleCompositionEnd"
          @keydown="handleComposerKeyDown"
        />
        <div class="chat-composer__toolbar flex min-w-0 flex-wrap items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-1.5">
            <Button
              v-if="!ctfSession"
              type="button"
              variant="ghost"
              size="icon"
              :disabled="running"
              aria-label="添加文件或图片"
              title="添加文件或图片；文件会安全复制到 MilkSU 用户数据目录"
              @click="chooseCodingAttachments"
            >
              <Paperclip class="size-4" />
            </Button>
          </div>
          <div class="flex min-w-0 flex-1 items-center justify-end gap-1.5">
            <CodingComposerControls
              :running="running"
              :ctf-session="ctfSession"
              :execution-mode="executionMode"
              :approval-policy="approvalPolicy"
              :approval-label="approvalLabel"
              :model-key="modelKey"
              :automatic-model-label="automaticModelLabel"
              :compact-model-label="compactModelLabel"
              @change-execution-mode="$emit('changeExecutionMode', $event)"
              @change-approval-policy="$emit('changeApprovalPolicy', $event)"
              @change-model="$emit('changeModel', $event)"
              @show-permissions="$emit('showPermissions')"
            />
          <Button
              v-if="running"
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
              :disabled="!draft.trim() && !pendingAttachments.length"
              aria-label="发送"
            >
              <ArrowUp class="size-4" />
            </Button>
          </div>
        </div>
      </form>
      <p v-if="attachmentError" class="px-2 pt-1.5 text-caption text-destructive">
        {{ attachmentError }}
      </p>
    </div>
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

.chat-composer__command-menu {
  position: absolute;
  bottom: calc(100% + 0.65rem);
  left: 0;
  z-index: 10;
  width: min(25rem, calc(100vw - 3rem));
  overflow: hidden;
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
.chat-composer__command-option:not(:disabled):focus-visible {
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
  display: flex;
  min-width: min(18rem, 100%);
  max-width: 100%;
  flex: 1 1 18rem;
  align-items: center;
  gap: 0.65rem;
  border-radius: 1rem;
  padding: 0.45rem 0.55rem 0.45rem 0.75rem;
}

.chat-composer__island {
  border: 1px solid var(--border);
  border-radius: 1.35rem;
  background: var(--card);
  padding: 0.8rem;
  box-shadow:
    0 14px 34px rgb(0 0 0 / 18%),
    0 2px 8px rgb(0 0 0 / 10%);
}

.chat-composer__toolbar {
  border-top: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
  padding-top: 0.55rem;
}

.chat-composer__input {
  font-size: var(--text-label);
  line-height: var(--text-label--line-height);
  letter-spacing: var(--text-label--letter-spacing);
}
</style>
