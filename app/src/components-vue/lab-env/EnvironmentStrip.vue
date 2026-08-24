<script setup lang="ts">
import { computed } from 'vue'
import { Button } from '@felinic/ui'
import type { EnvironmentLease } from './environmentTypes'

defineOptions({ name: 'EnvironmentStrip' })

const props = defineProps<{
  lease: EnvironmentLease
  compact?: boolean
}>()

const emit = defineEmits<{
  start: []
  stop: []
  reset: []
  openTarget: []
  retry: []
  openDocker: []
  occupyGo: []
  occupyStop: []
}>()

const statusLabel = computed(() => {
  if (props.lease.provider === 'user-attached') return '用户自带靶'
  switch (props.lease.state) {
    case 'none':
      return props.lease.packageName ? '未启动' : '没有练习包'
    case 'docker-down':
      return 'Docker 未运行'
    case 'stopped':
      return '已停止'
    case 'pulling':
      return '启动中'
    case 'ready':
      return '就绪'
    case 'busy':
      return '被占用'
    case 'failed':
      return '失败'
    default:
      return props.lease.state
  }
})

const canStart = computed(() => (
  props.lease.provider !== 'user-attached'
  && (props.lease.state === 'stopped' || (props.lease.state === 'none' && Boolean(props.lease.packageName)))
))

const statusClass = computed(() => {
  switch (props.lease.state) {
    case 'ready':
      return 'ak-tag ak-tag--compact'
    case 'pulling':
      return 'ak-tag ak-tag--compact ak-tag--advanced'
    case 'failed':
    case 'docker-down':
    case 'busy':
      return 'ak-tag ak-tag--compact ak-tag--danger'
    default:
      return 'ak-tag ak-tag--compact ak-tag--neutral'
  }
})
</script>

<template>
  <section
    class="rounded-xl border border-border bg-card"
    :class="compact ? 'p-4' : 'p-6'"
    data-testid="environment-strip"
    :data-state="lease.state"
  >
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div class="min-w-0 space-y-2">
        <div class="flex flex-wrap items-center gap-2">
          <h2 class="text-label font-medium">环境</h2>
          <span :class="statusClass">{{ statusLabel }}</span>
        </div>
        <p v-if="lease.packageName" class="text-body">{{ lease.packageName }}</p>
        <p v-if="lease.address" class="font-mono text-body select-text" data-testid="environment-address">{{ lease.address }}</p>
        <p v-if="lease.detail" class="text-caption text-muted-foreground">{{ lease.detail }}</p>
        <p v-if="lease.occupyJobTitle" class="text-caption text-muted-foreground">
          被作业「{{ lease.occupyJobTitle }}」占用
        </p>
        <p v-if="lease.device" class="font-mono text-caption text-muted-foreground">{{ lease.device }}</p>
      </div>
      <div class="flex flex-wrap items-center gap-2">
        <Button v-if="canStart" variant="brand" size="sm" data-testid="environment-start" @click="emit('start')">
          启动
        </Button>
        <Button v-if="lease.state === 'ready'" variant="brand" size="sm" data-testid="environment-open" @click="emit('openTarget')">
          打开靶
        </Button>
        <Button v-if="lease.state === 'ready'" variant="outline" size="sm" data-testid="environment-reset" @click="emit('reset')">
          重置
        </Button>
        <Button v-if="lease.state === 'ready'" variant="ghost" size="sm" data-testid="environment-stop" @click="emit('stop')">
          停止
        </Button>
        <Button v-if="lease.state === 'docker-down'" variant="outline" size="sm" data-testid="environment-open-docker" @click="emit('openDocker')">
          打开 Docker
        </Button>
        <Button v-if="lease.state === 'docker-down' || lease.state === 'failed'" variant="brand" size="sm" data-testid="environment-retry" @click="emit('retry')">
          重试
        </Button>
        <Button v-if="lease.state === 'busy'" variant="brand" size="sm" data-testid="environment-occupy-go" @click="emit('occupyGo')">
          去那边
        </Button>
        <Button v-if="lease.state === 'busy'" variant="outline" size="sm" data-testid="environment-occupy-stop" @click="emit('occupyStop')">
          停那边
        </Button>
        <Button v-if="lease.state === 'pulling'" variant="ghost" size="sm" data-testid="environment-cancel" @click="emit('stop')">
          取消
        </Button>
      </div>
    </div>
  </section>
</template>
