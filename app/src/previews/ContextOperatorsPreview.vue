<script setup lang="ts">
import { onMounted } from 'vue'
import ChatMessageItem from '@/components-vue/ChatMessageItem.vue'
import ContextUsageMeter from '@/components-vue/ContextUsageMeter.vue'
import { applyThemeMode } from '@/lib/themeMode'
import {
  applySessionContextComposition,
  applySessionContextWindow,
  applySessionUsageRecorded,
  emptySessionTurnSnapshot,
  presentContextUsage,
} from '@/lib/sessionTurnStatus'
import type { Message } from '@/types'

applyThemeMode('dark')

const earlierUser: Message = {
  id: 'u1',
  role: 'user',
  content: '先读入口，把鉴权改成 header 注入。',
  timestamp: Date.now() - 120_000,
  status: 'done',
}

const earlierAssistant: Message = {
  id: 'a1',
  role: 'assistant',
  content: '已经读过入口。下一步会改请求头，不动现有登录页。',
  timestamp: Date.now() - 90_000,
  status: 'done',
}

const lastUser: Message = {
  id: 'u2',
  role: 'user',
  content: '算了，改成 cookie 方案试试。',
  timestamp: Date.now() - 40_000,
  status: 'done',
}

const lastAssistant: Message = {
  id: 'a2',
  role: 'assistant',
  content: '按 cookie 走了一段，登录态对不上。这一段可以丢掉。',
  timestamp: Date.now() - 10_000,
  status: 'done',
}

let usageState = applySessionContextWindow(emptySessionTurnSnapshot(), 200_000)
usageState = applySessionUsageRecorded(usageState, {
  inputTokens: 28_000,
  outputTokens: 2_400,
  cacheReadTokens: 96_000,
  totalTokens: 126_400,
})
usageState = applySessionContextComposition(usageState, {
  estimatedTokens: 164_000,
  contextWindow: 200_000,
  categories: [
    { id: 'system', tokens: 18_000 },
    { id: 'tools', tokens: 22_000 },
    { id: 'conversation', tokens: 124_000 },
  ],
})
const usage = presentContextUsage(usageState)

onMounted(() => {
  applyThemeMode('dark')
})
</script>

<template>
  <div class="min-h-screen bg-background px-8 py-8 text-foreground">
    <div class="mx-auto flex max-w-5xl flex-col gap-8">
      <header class="space-y-1">
        <p class="text-caption text-muted-foreground">Coding · 设计预览</p>
        <h1 class="text-xl font-medium tracking-tight">
          丢掉这段 / 从这里重发 / 接到新会话
        </h1>
      </header>

      <section
        class="rounded-lg border border-border bg-card px-6 py-5"
        data-agent-conversation
        data-preview="rewind"
      >
        <p class="mb-4 text-caption text-muted-foreground">最后一问 · 丢掉这段</p>
        <div class="agent-thread preview-thread">
          <ChatMessageItem :message="earlierUser" />
          <ChatMessageItem :message="earlierAssistant" />
          <ChatMessageItem
            :message="lastUser"
            can-rewind
          />
          <ChatMessageItem :message="lastAssistant" />
        </div>
      </section>

      <section
        class="rounded-lg border border-border bg-card px-6 py-5"
        data-agent-conversation
        data-preview="edit"
      >
        <p class="mb-4 text-caption text-muted-foreground">更早的一问 · 编辑并从这里重发</p>
        <div class="agent-thread preview-thread">
          <ChatMessageItem :message="earlierUser" />
        </div>
      </section>

      <section
        class="rounded-lg border border-border bg-card px-6 py-5"
        data-preview="handoff"
      >
        <p class="mb-4 text-caption text-muted-foreground">用量环 · 整理上下文 / 接到新会话</p>
        <div class="flex items-center justify-end">
          <ContextUsageMeter
            v-if="usage"
            :usage="usage"
            size="md"
            default-open
          />
        </div>
      </section>
    </div>
  </div>
</template>

<style scoped>
.preview-thread :deep(.agent-turn-actions) {
  opacity: 1;
}
</style>
