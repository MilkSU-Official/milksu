<script setup lang="ts">
import { Badge, Button } from '@felinic/ui'
import {
  FileText,
  Hand,
  LoaderCircle,
  RotateCcw,
} from 'lucide-vue-next'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import { redactProviderCredentials } from '@/lib/redaction'
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
  if (size >= 1024 * 1024) return `${(size / (1024 * 1024)).toFixed(1)} MB`
  if (size >= 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${size} B`
}

function visibleApprovalText(value?: string) {
  return value ? redactProviderCredentials(value) : ''
}

function recoveryHint() {
  return props.recoveryContext === 'ctf'
    ? '从已保留的 notes、证据、Judge 回执和工具结果继续'
    : '从已保留的工作区、Git 状态、工具结果和验证面板继续'
}
</script>

<template>
  <article
    class="mb-7"
    :class="message.role === 'user' ? 'ml-auto max-w-[82%]' : 'max-w-full'"
  >
    <div v-if="message.role === 'tool'" class="rounded-lg border border-border bg-muted/30 px-4 py-3">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <p class="flex items-center gap-2 text-body font-medium">
            <Hand class="size-4 shrink-0 text-warning" />
            请求批准 · {{ message.toolName ?? 'tool' }}
          </p>
          <p class="mt-1 text-caption text-muted-foreground">
            {{ message.approvalGrantable
              ? 'Agent 已暂停。允许这一次只执行当前操作；本对话始终允许后，同类操作不再询问。'
              : 'Agent 已暂停；只有允许本次操作后才会继续。' }}
          </p>
        </div>
        <Badge
          :variant="message.approvalState === 'approved' ? 'secondary' : 'outline'"
          :class="message.approvalState === 'denied' || message.approvalState === 'expired'
            ? 'text-muted-foreground'
            : ''"
        >
          {{ message.approvalState === 'pending'
            ? '等待决定'
            : message.approvalState === 'approved'
              ? '已允许'
              : message.approvalState === 'denied'
                ? '已拒绝'
                : '已失效' }}
        </Badge>
      </div>
      <pre
        v-if="message.content"
        class="mt-3 max-h-40 overflow-auto rounded-md bg-background/70 px-3 py-2 whitespace-pre-wrap break-words font-mono text-caption leading-5"
      >{{ visibleApprovalText(message.content) }}</pre>
      <details v-if="message.approvalInput" class="mt-2">
        <summary class="cursor-pointer text-caption text-muted-foreground">
          查看完整参数
        </summary>
        <pre class="mt-2 max-h-56 overflow-auto whitespace-pre-wrap break-words font-mono text-caption leading-5">{{ visibleApprovalText(message.approvalInput) }}</pre>
      </details>
      <div
        v-if="message.approvalState === 'pending' && message.approvalRequestId"
        class="mt-3 flex justify-end gap-2"
      >
        <Button
          type="button"
          variant="outline"
          size="sm"
          @click="$emit('respondApproval', message.approvalRequestId, false)"
        >
          拒绝
        </Button>
        <Button
          type="button"
          :variant="message.approvalGrantable ? 'outline' : 'brand'"
          size="sm"
          @click="$emit('respondApproval', message.approvalRequestId, true, 'once')"
        >
          允许这一次
        </Button>
        <Button
          v-if="message.approvalGrantable"
          type="button"
          variant="brand"
          size="sm"
          @click="$emit('respondApproval', message.approvalRequestId, true, 'conversation')"
        >
          本对话始终允许
        </Button>
      </div>
      <p v-else-if="message.approvalReason" class="mt-2 text-caption text-muted-foreground">
        {{ visibleApprovalText(message.approvalReason) }}
      </p>
    </div>
    <div
      v-else
      class="break-words text-control leading-7"
      :class="message.role === 'user' ? 'chat-bubble chat-bubble--user px-4 py-3' : 'chat-bubble chat-bubble--agent'"
    >
      <div
        v-if="message.attachments?.length"
        class="mb-2 flex flex-wrap gap-2"
        aria-label="消息附件"
      >
        <span
          v-for="attachment in message.attachments"
          :key="`${attachment.id}:${attachment.name}`"
          class="inline-flex max-w-full items-center gap-2 rounded-lg border border-current/15 bg-background/20 px-2.5 py-1.5 text-caption"
          :title="`${attachment.mediaType} · sha256:${attachment.sha256}`"
        >
          <FileText class="size-3.5 shrink-0" />
          <span class="truncate">{{ attachment.name }}</span>
          <span class="shrink-0 opacity-65">{{ formatAttachmentSize(attachment.size) }}</span>
        </span>
      </div>
      <MarkdownContent :content="message.content" :compact="message.role === 'user'" />
      <LoaderCircle
        v-if="message.status === 'running'"
        class="ml-2 inline size-3.5 animate-spin text-muted-foreground"
      />
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
          继续
        </Button>
        <span class="text-caption text-muted-foreground">
          {{ recoveryHint() }}
        </span>
      </div>
    </div>
  </article>
</template>

<style scoped>
.chat-bubble--agent {
  width: min(42rem, 100%);
  padding: 0.9rem 1rem;
  color: #17191b;
  background: rgba(243, 244, 239, 0.94);
}

.chat-bubble--user {
  color: var(--chat-user-bubble-fg);
  background: var(--chat-user-bubble);
}
</style>
