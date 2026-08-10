<script setup lang="ts">
import { FileWarning, X } from 'lucide-vue-next'
import { Button } from '@felinic/ui'
import type { StartupRecoveryStatus } from '@/types'

defineProps<{
  status: StartupRecoveryStatus | null
}>()

const emit = defineEmits<{
  dismiss: []
  openRecovery: []
}>()

function formatTimestamp(value?: string) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString('zh-CN', { hour12: false })
}
</script>

<template>
  <div
    v-if="status?.previousExit === 'abnormal'"
    class="shell-traffic-light-safe-x flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-warning-border bg-warning-soft py-3 pr-5"
    role="alert"
    data-testid="startup-recovery-banner"
    data-shell-traffic-safe="x"
  >
    <FileWarning class="mt-0.5 size-4 shrink-0 text-warning" />
    <div class="min-w-0 flex-1 text-body leading-5">
      <span class="font-medium">上次 MilkSU 未正常退出</span>
      <span v-if="status.consecutiveAbnormalExits > 1" class="text-muted-foreground">
        （连续 {{ status.consecutiveAbnormalExits }} 次）
      </span>
      <span
        v-if="status.previousStartedAt"
        class="text-muted-foreground"
      >
        上次启动于 {{ formatTimestamp(status.previousStartedAt) }}
      </span>
      <span class="text-muted-foreground">
        已检查后台任务与数据库恢复状态；诊断日志不保存会话正文、工具原始输出或凭据。
      </span>
    </div>
    <div class="flex shrink-0 items-center gap-2">
      <Button size="sm" variant="outline" @click="emit('openRecovery')">
        查看恢复与诊断
      </Button>
      <Button
        size="icon-sm"
        variant="ghost"
        aria-label="知道了"
        title="知道了"
        @click="emit('dismiss')"
      >
        <X class="size-4" />
      </Button>
    </div>
  </div>
</template>
