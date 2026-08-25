<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@felinic/ui'
import { invokeCommand } from '@/desktop'
import {
  FileText,
  RotateCcw,
} from 'lucide-vue-next'
import AkLoadingMark from '@/components-vue/AkLoadingMark.vue'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import { thinkingSummary, messageSourceChips } from '@/lib/agentConversation'
import { redactProviderCredentials } from '@/lib/redaction'
import { isBlankAssistantMessage } from '@/lib/chatActivity'
import { toolBudgetToolName } from '@/lib/toolBudget'
import { t } from '@/lib/uiLocale'
import type { Message } from '@/types'

const props = defineProps<{
  message: Message
  recoverable?: boolean
  recoveryContext?: 'coding' | 'ctf'
}>()

defineEmits<{
  respondApproval: [requestId: string, approved: boolean, scope?: 'once' | 'conversation']
  retry: []
}>()

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

const thinkingLabel = computed(() => thinkingSummary(
  props.message.thinkingDurationMs,
  props.message.thinkingStatus === 'running',
))

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
    v-if="!isBlankAssistantMessage(message) && !(message.toolName === toolBudgetToolName && message.approvalState === 'pending')"
    class="agent-turn mb-7 min-w-0 w-full"
  >
    <div
      v-if="timeLabel"
      class="agent-time ak-divider chat-time-divider"
      role="separator"
    >
      <span>{{ timeLabel }}</span>
    </div>
    <div
      v-if="message.role === 'tool'"
      class="agent-approve"
    >
      <div class="agent-approve__kicker">{{ approvalKicker }}</div>
      <h4 class="agent-approve__title">{{ approvalTitle }}</h4>
      <p class="agent-approve__message">
        {{ message.approvalGrantable
          ? t('Agent 已暂停。允许这一次只执行当前操作；本对话始终允许后，同类操作不再询问。', 'The agent is paused. Allow once to run only this action. Always allow for this conversation to skip the same kind of action later.')
          : t('Agent 已暂停；只有允许本次操作后才会继续。', 'The agent is paused and will continue only after you allow this action.') }}
      </p>
      <pre v-if="message.content">{{ visibleApprovalText(message.content) }}</pre>
      <details v-if="message.approvalInput" class="mt-2">
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
    </div>
    <details
      v-else-if="message.role !== 'user' && (message.thinking || message.thinkingStatus === 'running')"
      class="agent-think"
      :open="message.thinkingStatus === 'running'"
    >
      <summary class="agent-think__summary">
        <span class="agent-think__dot" />
        <span>{{ thinkingLabel }}</span>
        <AkLoadingMark
          v-if="message.thinkingStatus === 'running'"
          :label="t('正在思考', 'Thinking')"
        />
      </summary>
      <div v-if="message.thinking" class="agent-think__body">{{ message.thinking }}</div>
    </details>
    <div
      v-if="showBubble"
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
      <p v-if="message.status === 'running' && message.thinkingStatus !== 'running'" class="chat-model-loading">
        <AkLoadingMark :label="t('正在回复', 'Replying')" />
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
  </article>
</template>
