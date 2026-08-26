<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from 'vue'
import { Button } from '@felinic/ui'
import { invokeCommand } from '@/desktop'
import {
  Check,
  Copy,
  FileText,
  GitFork,
  Pencil,
  RotateCcw,
  X,
} from 'lucide-vue-next'
import AgentPixelLoader from '@/components-vue/AgentPixelLoader.vue'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import { formatDemoElapsed, messageSourceChips } from '@/lib/agentConversation'
import { redactProviderCredentials } from '@/lib/redaction'
import { isBlankAssistantMessage } from '@/lib/chatActivity'
import { isAskMessage, parseAskOptions } from '@/lib/agentAsk'
import { toolBudgetToolName } from '@/lib/toolBudget'
import { t } from '@/lib/uiLocale'
import type { Message } from '@/types'

const props = defineProps<{
  message: Message
  recoverable?: boolean
  recoveryContext?: 'coding' | 'ctf'
}>()

const emit = defineEmits<{
  respondApproval: [requestId: string, approved: boolean, scope?: 'once' | 'conversation', choice?: string]
  retry: []
  editUser: [messageId: string, content: string]
  branchAssistant: [messageId: string]
}>()

const editing = ref(false)
const draft = ref('')
const copied = ref(false)
const approvalPinned = ref(false)
let copyReset = 0

const askOptions = computed(() => parseAskOptions(props.message.approvalInput))
const isChoiceCard = computed(() => isAskMessage(props.message) && askOptions.value.length >= 2)
const showApproval = computed(() => (
  props.message.role === 'tool'
  && Boolean(props.message.approvalRequestId)
  && (
    isChoiceCard.value
    || props.message.approvalState === 'pending'
    || approvalPinned.value
  )
))

const showMessageActions = computed(() => (
  !editing.value
  && (
    props.message.role === 'user'
    || (props.message.role === 'assistant' && Boolean(props.message.content?.trim()))
  )
))

function startEdit() {
  if (props.message.role !== 'user') return
  draft.value = props.message.content
  editing.value = true
}

function cancelEdit() {
  editing.value = false
  draft.value = ''
}

function confirmEdit() {
  const next = draft.value.trim()
  if (!next) return
  editing.value = false
  emit('editUser', props.message.id, next)
}

async function copyMessage() {
  const text = props.message.content.trim()
  if (!text) return
  try {
    await navigator.clipboard.writeText(text)
    copied.value = true
    window.clearTimeout(copyReset)
    copyReset = window.setTimeout(() => {
      copied.value = false
    }, 1500)
  } catch {
    copied.value = false
  }
}

function pinApproval() {
  approvalPinned.value = true
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
  return props.recoveryContext === 'ctf'
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

const timeLabel = computed(() => (
  props.message.role === 'user' ? userMessageTime(props.message.timestamp) : ''
))

const sources = computed(() => (
  props.message.role === 'assistant' ? messageSourceChips(props.message.content) : []
))

const thinkingNow = ref(Date.now())
let thinkingClock = 0

watch(
  () => props.message.thinkingStatus === 'running',
  running => {
    window.clearInterval(thinkingClock)
    thinkingClock = 0
    if (!running) return
    thinkingNow.value = Date.now()
    thinkingClock = window.setInterval(() => {
      thinkingNow.value = Date.now()
    }, 100)
  },
  { immediate: true },
)

const thinkingElapsedMs = computed(() => {
  if (props.message.thinkingStatus === 'running') {
    const started = Number.isFinite(props.message.timestamp) ? props.message.timestamp : thinkingNow.value
    return Math.max(0, thinkingNow.value - started)
  }
  return props.message.thinkingDurationMs
})

const thinkingLabel = computed(() => (
  props.message.thinkingStatus === 'running'
    ? t('正在思考', 'Thinking')
    : t('想了', 'Thought')
))

const thinkingElapsed = computed(() => {
  if (props.message.thinkingStatus === 'running') {
    return formatDemoElapsed(thinkingElapsedMs.value)
  }
  if (props.message.thinkingDurationMs === undefined) return ''
  return formatDemoElapsed(props.message.thinkingDurationMs)
})

const thinkingRunning = computed(() => props.message.thinkingStatus === 'running')
const conclusionStarted = computed(() => Boolean(props.message.content?.trim()))
const thinkingRows = computed(() => (
  String(props.message.thinking ?? '')
    .split(/\n+/)
    .map(line => line.trim())
    .filter(Boolean)
))
const thinkManual = ref<boolean | null>(null)
watch(thinkingRunning, running => {
  if (running) thinkManual.value = null
})
const thinkOpen = computed(() => (
  thinkManual.value ?? (thinkingRunning.value && !conclusionStarted.value)
))

function toggleThink() {
  thinkManual.value = !thinkOpen.value
}

const replyNow = ref(Date.now())
let replyClock = 0
const replyTicking = computed(() => (
  props.message.status === 'running' && props.message.thinkingStatus !== 'running'
))
watch(replyTicking, ticking => {
  window.clearInterval(replyClock)
  replyClock = 0
  if (!ticking) return
  replyNow.value = Date.now()
  replyClock = window.setInterval(() => {
    replyNow.value = Date.now()
  }, 100)
}, { immediate: true })
const replyElapsed = computed(() => {
  if (!replyTicking.value) return ''
  const started = Number.isFinite(props.message.timestamp) ? props.message.timestamp : replyNow.value
  return formatDemoElapsed(Math.max(0, replyNow.value - started))
})
onBeforeUnmount(() => {
  window.clearInterval(thinkingClock)
  window.clearInterval(replyClock)
})

const approvalTitle = computed(() => t(
  `允许运行 ${props.message.toolName ?? 'tool'}`,
  `Allow ${props.message.toolName ?? 'tool'}`,
))

async function openSource(href: string, event: MouseEvent) {
  event.preventDefault()
  try {
    const url = new URL(href)
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return
    await invokeCommand('open_ctf_source_url', { url: url.toString() })
  } catch {
    return
  }
}

const showBubble = computed(() => (
  props.message.role !== 'tool'
  && (
    props.message.role === 'user'
    || Boolean(props.message.content)
    || Boolean(props.message.attachments?.length)
    || Boolean(props.recoverable)
    || (props.message.status === 'running' && props.message.thinkingStatus !== 'running')
  )
))

const approvalKicker = computed(() => (
  props.message.approvalState === 'pending'
    ? t('等待决定', 'Waiting')
    : props.message.approvalState === 'approved'
      ? t('已允许', 'Allowed')
      : props.message.approvalState === 'denied'
        ? t('已拒绝', 'Denied')
        : t('已失效', 'Expired')
))
</script>

<template>
  <article
    v-if="!isBlankAssistantMessage(message) && !(message.toolName === toolBudgetToolName && message.approvalState === 'pending') && (message.role !== 'tool' || !message.approvalRequestId || showApproval)"
    class="agent-turn mb-7 min-w-0 w-full"
    :class="message.role === 'user' ? 'agent-turn--user' : ''"
  >
    <div
      v-if="timeLabel"
      class="agent-time"
      role="separator"
    >
      <span>{{ timeLabel }}</span>
    </div>
    <div
      v-if="showApproval"
      :class="isChoiceCard ? 'agent-choice' : 'agent-approve'"
    >
      <template v-if="isChoiceCard">
        <h4 class="agent-choice__title">{{ message.content }}</h4>
        <div class="agent-choice__options" role="radiogroup">
          <button
            v-for="option in askOptions"
            :key="option.id"
            type="button"
            role="radio"
            class="agent-choice__option"
            :class="{ 'is-selected': message.approvalChoiceId === option.id }"
            :aria-checked="message.approvalChoiceId === option.id"
            :disabled="message.approvalState !== 'pending' || !message.approvalRequestId"
            @click="message.approvalRequestId && $emit('respondApproval', message.approvalRequestId, true, 'once', option.id)"
          >
            <span class="agent-choice__mark" aria-hidden="true" />
            <span class="agent-choice__copy">
              <strong>{{ option.label }}</strong>
              <span v-if="option.detail">{{ option.detail }}</span>
            </span>
          </button>
        </div>
      </template>
      <template v-else>
      <div class="agent-approve__kicker">{{ approvalKicker }}</div>
      <h4 class="agent-approve__title">{{ approvalTitle }}</h4>
      <p class="agent-approve__message">
        {{ message.approvalGrantable
          ? t('Agent 已暂停。允许这一次只执行当前操作；本对话始终允许后，同类操作不再询问。', 'The agent is paused. Allow once to run only this action. Always allow for this conversation to skip the same kind of action later.')
          : t('Agent 已暂停；只有允许本次操作后才会继续。', 'The agent is paused and will continue only after you allow this action.') }}
      </p>
      <pre v-if="message.content">{{ visibleApprovalText(message.content) }}</pre>
      <details v-if="message.approvalInput" class="mt-2" @toggle="pinApproval">
        <summary class="cursor-pointer text-caption text-muted-foreground">
          {{ t('查看完整参数', 'View full arguments') }}
        </summary>
        <pre>{{ visibleApprovalText(message.approvalInput) }}</pre>
      </details>
      <div
        v-if="message.approvalState === 'pending' && message.approvalRequestId"
        class="agent-approve__actions"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          @click="$emit('respondApproval', message.approvalRequestId, false)"
        >
          {{ t('拒绝', 'Deny') }}
        </Button>
        <Button
          type="button"
          :variant="message.approvalGrantable ? 'outline' : 'brand'"
          size="sm"
          @click="$emit('respondApproval', message.approvalRequestId, true, 'once')"
        >
          {{ t('允许这一次', 'Allow once') }}
        </Button>
        <Button
          v-if="message.approvalGrantable"
          type="button"
          variant="brand"
          size="sm"
          @click="$emit('respondApproval', message.approvalRequestId, true, 'conversation')"
        >
          {{ t('本对话始终允许', 'Always allow in this chat') }}
        </Button>
      </div>
      <p v-else-if="message.approvalReason" class="mt-2 text-caption text-muted-foreground">
        {{ visibleApprovalText(message.approvalReason) }}
      </p>
      </template>
    </div>
    <div
      v-else-if="message.role !== 'user' && (message.thinking || message.thinkingStatus === 'running')"
      class="agent-think"
    >
      <button
        type="button"
        class="agent-think__summary"
        :aria-expanded="thinkOpen"
        @click="toggleThink"
      >
        <AgentPixelLoader
          :label="thinkingLabel"
          :elapsed="thinkingElapsed"
          :running="thinkingRunning"
        />
        <svg
          class="agent-think__chevron"
          :class="{ 'agent-think__chevron--open': thinkOpen }"
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          aria-hidden="true"
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </button>
      <div class="agent-think__more" :data-open="thinkOpen ? 'true' : 'false'">
        <div class="agent-think__more-inner">
          <p
            v-for="(row, index) in thinkingRows"
            :key="index"
            class="agent-think__row"
          >{{ row }}</p>
        </div>
      </div>
    </div>
    <div
      v-if="showBubble && !editing"
      class="min-w-0 overflow-x-auto break-words text-control leading-7"
      :class="message.role === 'user' ? 'agent-user' : 'agent-answer'"
    >
      <div
        v-if="message.attachments?.length"
        class="mb-2 flex flex-wrap gap-2"
        :aria-label="t('消息附件', 'Message attachments')"
      >
        <span
          v-for="attachment in message.attachments"
          :key="`${attachment.id}:${attachment.name}`"
          class="agent-attachment"
          :title="`${attachment.mediaType} · sha256:${attachment.sha256}`"
        >
          <FileText class="size-3.5 shrink-0" />
          <span class="truncate">{{ attachment.name }}</span>
          <span class="shrink-0 opacity-65">{{ formatAttachmentSize(attachment.size) }}</span>
        </span>
      </div>
      <MarkdownContent
        v-if="message.content"
        :content="message.content"
        :compact="message.role === 'user'"
        :streaming="replyTicking"
      />
      <div v-if="sources.length" class="agent-sources">
        <a
          v-for="source in sources"
          :key="source.href"
          class="agent-source"
          :href="source.href"
          @click="openSource(source.href, $event)"
        >{{ source.label }}</a>
      </div>
      <p v-if="replyTicking && !message.content?.trim()" class="chat-model-loading">
        <AgentPixelLoader
          :label="t('正在回复', 'Replying')"
          :elapsed="replyElapsed"
          running
        />
      </p>
      <div
        v-if="recoverable"
        class="mt-3 flex flex-wrap items-center gap-2"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          @click="$emit('retry')"
        >
          <RotateCcw class="size-3.5" />
          {{ t('继续', 'Continue') }}
        </Button>
        <span class="text-caption text-muted-foreground">
          {{ recoveryHint() }}
        </span>
      </div>
    </div>
    <form
      v-else-if="editing"
      class="agent-user agent-user-edit min-w-0"
      @submit.prevent="confirmEdit"
    >
      <textarea
        v-model="draft"
        class="agent-user-edit__input"
        rows="3"
        :aria-label="t('编辑消息', 'Edit message')"
      />
      <div class="agent-turn-actions agent-turn-actions--visible">
        <button
          type="button"
          :aria-label="t('取消', 'Cancel')"
          :title="t('取消', 'Cancel')"
          @click="cancelEdit"
        >
          <X />
        </button>
        <button
          type="submit"
          :aria-label="t('发送', 'Send')"
          :title="t('发送', 'Send')"
        >
          <Check />
        </button>
      </div>
    </form>
    <div
      v-if="showMessageActions"
      class="agent-turn-actions"
    >
      <button
        type="button"
        :aria-label="copied ? t('已复制', 'Copied') : t('复制', 'Copy')"
        :title="copied ? t('已复制', 'Copied') : t('复制', 'Copy')"
        @click="copyMessage"
      >
        <Check v-if="copied" />
        <Copy v-else />
      </button>
      <button
        v-if="message.role === 'user'"
        type="button"
        :aria-label="t('编辑', 'Edit')"
        :title="t('编辑', 'Edit')"
        @click="startEdit"
      >
        <Pencil />
      </button>
      <button
        v-if="message.role === 'assistant'"
        type="button"
        :aria-label="t('分叉到新对话', 'Branch to new chat')"
        :title="t('分叉到新对话', 'Branch to new chat')"
        @click="$emit('branchAssistant', message.id)"
      >
        <GitFork />
      </button>
    </div>
  </article>
</template>
