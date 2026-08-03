<script setup lang="ts">
import { computed } from 'vue'
import {
  Badge,
  Button,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@felinic/ui'
import {
  Compass,
  KeyRound,
  LoaderCircle,
  RefreshCw,
} from 'lucide-vue-next'
import type {
  CodingComputerUseStatus,
  CodingComputerUseTarget,
} from '@/codingEnvironmentTypes'
import {
  computerUseTargetKey,
  selectedComputerUseTarget as resolveSelectedComputerUseTarget,
} from '@/lib/codingPolicy'

const props = defineProps<{
  status: CodingComputerUseStatus | null
  targets: CodingComputerUseTarget[]
  selectedTargetKey: string
  loading: boolean
  running: boolean
  ownedByCurrentTask: boolean
}>()

const emit = defineEmits<{
  'update:selectedTargetKey': [value: string]
  requestPermissions: []
  refresh: []
  start: []
  stop: []
}>()

const selectedKey = computed({
  get: () => props.selectedTargetKey,
  set: value => emit('update:selectedTargetKey', value),
})
const selectedTarget = computed(() => (
  resolveSelectedComputerUseTarget(props.targets, props.selectedTargetKey)
))
const permissionsReady = computed(() => Boolean(
  props.status?.permissions.accessibility
  && props.status.permissions.screenRecording,
))
const readyForCurrentTask = computed(() => Boolean(
  props.status?.enabled
  && props.ownedByCurrentTask,
))
const attachedToOtherTask = computed(() => Boolean(
  props.status?.conversationId
  && !props.ownedByCurrentTask,
))
const canStart = computed(() => Boolean(
  !props.loading
  && !props.running
  && props.status?.available
  && permissionsReady.value
  && selectedTarget.value
  && !props.status?.conversationId,
))
const missingPermissions = computed(() => {
  const missing: string[] = []
  if (!props.status?.permissions.accessibility) missing.push('辅助功能')
  if (!props.status?.permissions.screenRecording) missing.push('屏幕录制')
  return missing
})
const connectionLabel = computed(() => {
  if (readyForCurrentTask.value) return '已接入当前任务'
  if (attachedToOtherTask.value) return '其他任务正在使用'
  if (!props.status?.available) return '不可用'
  return '未接入'
})
const guidance = computed(() => {
  if (!props.status?.available) {
    return props.status?.problem || 'Computer Use 当前不可用。'
  }
  if (missingPermissions.value.length) {
    return `还需要授权 ${missingPermissions.value.join('、')}；“App 管理”不能替代这两项。点击未授权标签或“请求系统权限”后，若 macOS 打开系统设置，请勾选 MilkSU 并回到这里重新检测。`
  }
  if (attachedToOtherTask.value) {
    return '可见会话正由另一个 Coding 任务使用；请回到该任务停止后再切换。'
  }
  if (!props.targets.length) {
    return '没有发现可选的可见窗口；请打开目标 App 窗口，然后重新检测。'
  }
  if (!selectedTarget.value && !props.status?.target) {
    return '请选择一个当前可见窗口，MilkSU 会把 Computer Use 锁定到这个 App / PID / Window。'
  }
  if (readyForCurrentTask.value) {
    return 'Computer Use 已锁定到当前任务；替我审批与完全访问会自动执行普通可见操作，请求批准档才逐次确认。'
  }
  return '权限和窗口都已就绪，点击“启动可见会话”后才算正式接入当前 Coding 任务。'
})
</script>

<template>
  <div class="mt-5 border-t border-border pt-5">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-body font-medium">可见 App 会话</p>
        <p class="mt-1 text-caption leading-5 text-muted-foreground">
          选择一个当前可见窗口，启动后锁定为本任务的 App Scope。
        </p>
      </div>
      <span
        class="mt-1 size-2 shrink-0 rounded-full"
        :class="readyForCurrentTask ? 'bg-primary' : 'bg-muted-foreground'"
      />
    </div>
    <div class="mt-4 rounded-md bg-muted/45 px-3 py-3 text-caption">
      <div class="mb-3 flex items-center justify-between gap-3">
        <span class="text-muted-foreground">接入状态</span>
        <Badge :variant="readyForCurrentTask ? 'secondary' : 'outline'">
          {{ connectionLabel }}
        </Badge>
      </div>
      <div
        v-if="!ownedByCurrentTask"
        class="mb-3"
      >
        <Select
          v-model="selectedKey"
          :disabled="loading || running || Boolean(status?.conversationId)"
        >
          <SelectTrigger class="w-full">
            <SelectValue placeholder="选择可见 App 窗口" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem
              v-for="target in targets"
              :key="computerUseTargetKey(target)"
              :value="computerUseTargetKey(target)"
            >
              {{ target.name }}
              <span v-if="target.windowTitle"> · {{ target.windowTitle }}</span>
            </SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div class="flex items-center justify-between gap-3">
        <span class="text-muted-foreground">锁定范围</span>
        <span class="font-medium text-foreground">
          {{ status?.target.name || selectedTarget?.name || '未选择' }}
        </span>
      </div>
      <p class="mt-1 break-all font-mono text-muted-foreground">
        {{ status?.target.bundleId || selectedTarget?.bundleId || '—' }}
        · PID {{ status?.target.pid || selectedTarget?.pid || '—' }}
        · Window {{ status?.target.windowId || selectedTarget?.windowId || '—' }}
      </p>
      <p
        v-if="status?.target.windowTitle || selectedTarget?.windowTitle"
        class="mt-1 truncate text-muted-foreground"
      >
        {{ status?.target.windowTitle || selectedTarget?.windowTitle }}
      </p>
      <div class="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          class="rounded-full disabled:cursor-default"
          :disabled="Boolean(status?.permissions.accessibility) || loading || running || !status?.available"
          aria-label="请求辅助功能权限"
          @click="emit('requestPermissions')"
        >
          <Badge
            :variant="status?.permissions.accessibility ? 'secondary' : 'outline'"
            :class="!status?.permissions.accessibility && status?.available ? 'cursor-pointer' : ''"
          >
            辅助功能
            {{ status?.permissions.accessibility ? '已授权' : '未授权' }}
          </Badge>
        </button>
        <button
          type="button"
          class="rounded-full disabled:cursor-default"
          :disabled="Boolean(status?.permissions.screenRecording) || loading || running || !status?.available"
          aria-label="请求屏幕录制权限"
          @click="emit('requestPermissions')"
        >
          <Badge
            :variant="status?.permissions.screenRecording ? 'secondary' : 'outline'"
            :class="!status?.permissions.screenRecording && status?.available ? 'cursor-pointer' : ''"
          >
            屏幕录制
            {{ status?.permissions.screenRecording ? '已授权' : '未授权' }}
          </Badge>
        </button>
      </div>
    </div>
    <p
      v-if="status?.problem"
      class="mt-3 text-caption leading-5 text-destructive"
    >
      {{ status.problem }}
    </p>
    <p
      v-else
      class="mt-3 text-caption leading-5 text-muted-foreground"
    >
      {{ guidance }}
    </p>
    <div class="mt-4 flex flex-wrap gap-2">
      <Button
        variant="outline"
        size="sm"
        :disabled="loading || running"
        @click="emit('refresh')"
      >
        <LoaderCircle v-if="loading" class="size-3.5 animate-spin" />
        <RefreshCw v-else class="size-3.5" />
        重新检测
      </Button>
      <Button
        v-if="!permissionsReady"
        variant="outline"
        size="sm"
        :disabled="loading || running || !status?.available"
        @click="emit('requestPermissions')"
      >
        <LoaderCircle v-if="loading" class="size-3.5 animate-spin" />
        <KeyRound v-else class="size-3.5" />
        请求系统权限
      </Button>
      <Button
        v-if="ownedByCurrentTask"
        variant="outline"
        size="sm"
        :disabled="loading || running"
        @click="emit('stop')"
      >
        停止可见会话
      </Button>
      <Button
        v-else
        variant="brand"
        size="sm"
        :disabled="!canStart"
        @click="emit('start')"
      >
        <LoaderCircle v-if="loading" class="size-3.5 animate-spin" />
        <Compass v-else class="size-3.5" />
        启动可见会话
      </Button>
    </div>
    <p class="mt-3 text-caption leading-5 text-muted-foreground">
      可见会话必须由你显式启动；替我审批与完全访问会自动操作，请求批准档才逐次确认。
      Driver {{ status?.driverVersion || '0.14.2' }} · prerelease。
    </p>
  </div>
</template>
