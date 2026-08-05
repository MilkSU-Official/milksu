<script setup lang="ts">
import { Badge, Button } from '@felinic/ui'
import type { CodingMCPServerSummary } from '@/codingEnvironmentTypes'

defineProps<{
  server: CodingMCPServerSummary
  selected: boolean
  running: boolean
}>()

defineEmits<{
  toggle: []
}>()
</script>

<template>
  <article class="rounded-lg border border-border bg-muted/20 p-3">
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <p class="truncate text-body font-medium">{{ server.name }}</p>
        <p class="mt-0.5 text-caption text-muted-foreground">{{ server.transport }}</p>
      </div>
      <Badge :variant="server.reviewReady ? 'outline' : 'secondary'">
        {{ server.reviewReady ? '审阅信息完整' : '不可启用' }}
      </Badge>
    </div>

    <p
      v-if="server.reviewProblem"
      class="mt-3 text-caption leading-5 text-destructive"
    >
      {{ server.reviewProblem }}
    </p>

    <dl class="mt-3 grid grid-cols-[5rem_minmax(0,1fr)] gap-x-2 gap-y-2 text-caption leading-5">
      <dt class="text-muted-foreground">来源</dt>
      <dd class="break-words">{{ server.source || '未声明' }}</dd>
      <dt class="text-muted-foreground">固定版本</dt>
      <dd class="break-words">{{ server.version || '未声明' }}</dd>
      <dt class="text-muted-foreground">任务范围</dt>
      <dd class="break-words">{{ server.taskScope || '未声明' }}</dd>
      <dt class="text-muted-foreground">工具面</dt>
      <dd class="break-words">
        {{ server.tools.length ? server.tools.join(' · ') : '未声明白名单' }}
      </dd>
      <dt class="text-muted-foreground">文件</dt>
      <dd class="break-words">{{ server.fileAccess }}</dd>
      <dt class="text-muted-foreground">网络</dt>
      <dd class="break-words">{{ server.networkAccess }}</dd>
      <dt class="text-muted-foreground">凭据</dt>
      <dd class="break-words">{{ server.credentialAccess }}</dd>
    </dl>

    <Button
      type="button"
      class="mt-3 w-full"
      :variant="selected ? 'secondary' : 'outline'"
      size="sm"
      :disabled="running || !server.reviewReady"
      :aria-pressed="selected"
      @click="$emit('toggle')"
    >
      {{ selected ? '从本任务移除' : '仅为本任务启用' }}
    </Button>
  </article>
</template>
