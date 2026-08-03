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
        <Badge
          :variant="status?.permissions.accessibility ? 'secondary' : 'outline'"
        >
          辅助功能
          {{ status?.permissions.accessibility ? '已授权' : '未授权' }}
        </Badge>
        <Badge
          :variant="status?.permissions.screenRecording ? 'secondary' : 'outline'"
        >
          屏幕录制
          {{ status?.permissions.screenRecording ? '已授权' : '未授权' }}
        </Badge>
      </div>
    </div>
    <p
      v-if="status?.problem"
      class="mt-3 text-caption leading-5 text-destructive"
    >
      {{ status.problem }}
    </p>
    <p
      v-else-if="!permissionsReady"
      class="mt-3 text-caption leading-5 text-muted-foreground"
    >
      需要 macOS 辅助功能和屏幕录制权限；“App 管理”授权不能替代这两项。
    </p>
    <p
      v-else-if="attachedToOtherTask"
      class="mt-3 text-caption leading-5 text-muted-foreground"
    >
      可见会话正由另一个 Coding 任务使用；请回到该任务停止后再切换。
    </p>
    <div class="mt-4 flex flex-wrap gap-2">
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
