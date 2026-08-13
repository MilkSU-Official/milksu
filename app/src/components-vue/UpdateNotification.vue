<script setup lang="ts">
import { computed } from 'vue'
import { ArrowDownToLine, CheckCircle2, RefreshCw, RotateCcw, X } from 'lucide-vue-next'
import { Button } from '@felinic/ui'
import type { UpdateStatus } from '@/types'

const props = defineProps<{
  status: UpdateStatus | null
  dismissedVersion?: string
}>()

const emit = defineEmits<{
  dismiss: [version: string]
  download: []
  install: []
}>()

const visible = computed(() => {
  const state = props.status?.state
  if (!state || !['available', 'downloading', 'downloaded', 'error'].includes(state)) return false
  return !(state === 'available' && props.dismissedVersion === props.status?.version)
})

const progress = computed(() => Math.max(0, Math.min(100, Number(props.status?.percent) || 0)))
const firstNote = computed(() => String(props.status?.notes ?? '').split(/\r?\n/u).find(Boolean) ?? '')
</script>

<template>
  <section
    v-if="visible && status"
    class="shell-traffic-light-safe-x flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-info-border bg-info-soft py-3 pr-5"
    role="status"
    data-testid="update-notification"
    data-shell-traffic-safe="x"
  >
    <ArrowDownToLine v-if="status.state === 'available'" class="size-4 shrink-0 text-info" />
    <RefreshCw v-else-if="status.state === 'downloading'" class="size-4 shrink-0 animate-spin text-info" />
    <CheckCircle2 v-else-if="status.state === 'downloaded'" class="size-4 shrink-0 text-success" />
    <RotateCcw v-else class="size-4 shrink-0 text-warning" />

    <div class="min-w-0 flex-1 text-body leading-5">
      <template v-if="status.state === 'available'">
        <span class="font-medium">MilkSU {{ status.version }} 可以更新</span>
        <span v-if="firstNote" class="ml-2 text-muted-foreground">{{ firstNote }}</span>
      </template>
      <template v-else-if="status.state === 'downloading'">
        <span class="font-medium">正在下载 MilkSU {{ status.version }}</span>
        <span class="ml-2 text-muted-foreground">{{ progress.toFixed(0) }}%</span>
        <span class="mt-2 block h-1.5 max-w-md overflow-hidden rounded-full bg-secondary">
          <span class="block h-full bg-info transition-[width]" :style="{ width: `${progress}%` }" />
        </span>
      </template>
      <template v-else-if="status.state === 'downloaded'">
        <span class="font-medium">MilkSU {{ status.version }} 已准备好</span>
        <span class="ml-2 text-muted-foreground">重启后完成更新</span>
      </template>
      <template v-else>
        <span class="font-medium">更新没有下载完成</span>
        <span class="ml-2 text-muted-foreground">{{ status.message || '请稍后重试' }}</span>
      </template>
    </div>

    <div class="flex shrink-0 items-center gap-2">
      <Button v-if="status.state === 'available'" size="sm" @click="emit('download')">
        更新
      </Button>
      <Button v-else-if="status.state === 'downloaded'" size="sm" @click="emit('install')">
        重启更新
      </Button>
      <Button v-else-if="status.state === 'error'" size="sm" variant="outline" @click="emit('download')">
        重试
      </Button>
      <Button
        v-if="status.state === 'available'"
        size="icon-sm"
        variant="ghost"
        aria-label="稍后更新"
        title="稍后更新"
        @click="emit('dismiss', status.version || '')"
      >
        <X class="size-4" />
      </Button>
    </div>
  </section>
</template>
