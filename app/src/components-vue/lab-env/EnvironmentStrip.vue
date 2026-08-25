<script setup lang="ts">
import { computed } from 'vue'
import { Button, SettingsRow, SettingsSection } from '@felinic/ui'
import { t } from '@/lib/uiLocale'
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
  openLabSettings: []
}>()

const statusLabel = computed(() => {
  if (props.lease.provider === 'user-attached') return t('用户自带靶', 'User-attached target')
  switch (props.lease.state) {
    case 'none':
      return props.lease.packageName ? t('未启动', 'Not started') : t('没有练习包', 'No practice package')
    case 'docker-down':
      return t('Docker 未运行', 'Docker is not running')
    case 'stopped':
      return t('已停止', 'Stopped')
    case 'pulling':
      return t('启动中', 'Starting')
    case 'ready':
      return t('就绪', 'Ready')
    case 'busy':
      return t('被占用', 'Occupied')
    case 'failed':
      return t('失败', 'Failed')
    default:
      return props.lease.state
  }
})

const canStart = computed(() => (
  props.lease.provider !== 'user-attached'
  && (props.lease.state === 'stopped' || (props.lease.state === 'none' && Boolean(props.lease.packageName)))
))
const hasActions = computed(() => (
  canStart.value
  || props.lease.state === 'ready'
  || props.lease.state === 'docker-down'
  || props.lease.state === 'failed'
  || props.lease.state === 'busy'
  || props.lease.state === 'pulling'
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
  <SettingsSection :title="t('环境', 'Environment')" data-testid="environment-strip" :data-state="lease.state">
    <template #actions>
      <span :class="statusClass">{{ statusLabel }}</span>
    </template>
    <SettingsRow v-if="lease.packageName" :label="t('练习包', 'Package')" :description="lease.packageName" />
    <SettingsRow v-if="lease.address" :label="t('地址', 'Address')" :description="lease.address">
      <span class="font-mono text-body select-text" data-testid="environment-address">{{ lease.address }}</span>
    </SettingsRow>
    <SettingsRow v-if="lease.detail" :label="t('说明', 'Notes')" :description="lease.detail" />
    <SettingsRow v-if="lease.occupyJobTitle" :label="t('占用', 'Occupied')" :description="t(`被作业「${lease.occupyJobTitle}」占用`, `Occupied by job “${lease.occupyJobTitle}”`)" />
    <SettingsRow v-if="lease.device" :label="t('设备', 'Device')" :description="lease.device" :divider="false" />
    <SettingsRow v-if="!lease.packageName && !lease.address && !lease.detail && !lease.device" :label="statusLabel" :divider="false" />
    <template v-if="hasActions" #footer>
      <Button v-if="canStart" variant="brand" size="sm" data-testid="environment-start" @click="emit('start')">
        {{ t('启动', 'Start') }}
      </Button>
      <Button v-if="lease.state === 'ready'" variant="brand" size="sm" data-testid="environment-open" @click="emit('openTarget')">
        {{ t('打开靶', 'Open target') }}
      </Button>
      <Button v-if="lease.state === 'ready'" variant="outline" size="sm" data-testid="environment-reset" @click="emit('reset')">
        {{ t('重置', 'Reset') }}
      </Button>
      <Button v-if="lease.state === 'ready'" variant="ghost" size="sm" data-testid="environment-stop" @click="emit('stop')">
        {{ t('停止', 'Stop') }}
      </Button>
      <Button v-if="lease.state === 'docker-down'" variant="outline" size="sm" data-testid="environment-open-docker" @click="emit('openDocker')">
        {{ t('打开 Docker', 'Open Docker') }}
      </Button>
      <Button v-if="lease.state === 'docker-down' || lease.state === 'failed'" variant="brand" size="sm" data-testid="environment-retry" @click="emit('retry')">
        {{ t('重试', 'Retry') }}
      </Button>
      <Button
        v-if="lease.provider === 'avd' && (lease.state === 'failed' || lease.state === 'none' || lease.state === 'stopped')"
        variant="outline"
        size="sm"
        data-testid="environment-lab-settings"
        @click="emit('openLabSettings')"
      >
        {{ t('Lab 设置', 'Lab settings') }}
      </Button>
      <Button v-if="lease.state === 'busy'" variant="brand" size="sm" data-testid="environment-occupy-go" @click="emit('occupyGo')">
        {{ t('去那边', 'Go there') }}
      </Button>
      <Button v-if="lease.state === 'busy'" variant="outline" size="sm" data-testid="environment-occupy-stop" @click="emit('occupyStop')">
        {{ t('停那边', 'Stop that job') }}
      </Button>
      <Button v-if="lease.state === 'pulling'" variant="ghost" size="sm" data-testid="environment-cancel" @click="emit('stop')">
        {{ t('取消', 'Cancel') }}
      </Button>
    </template>
  </SettingsSection>
</template>
