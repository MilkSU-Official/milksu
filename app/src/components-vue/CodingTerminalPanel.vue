<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  ref,
  watch,
} from 'vue'
import {
  Badge,
  Button,
  Textarea,
} from '@felinic/ui'
import {
  ChevronDown,
  LoaderCircle,
  Play,
  RefreshCw,
  Square,
  Terminal,
} from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import type {
  CodingBackgroundTask,
  CodingRuntimeStatus,
} from '@/codingEnvironmentTypes'
import type {
  CodingApprovalPolicy,
  CodingExecutionMode,
} from '@/types'

const props = defineProps<{
  active: boolean
  conversationId: string
  workspacePath: string
  executionMode: CodingExecutionMode
  approvalPolicy: CodingApprovalPolicy
}>()

const command = ref('')
const runtime = ref<CodingRuntimeStatus | null>(null)
const refreshing = ref(false)
const starting = ref(false)
const stopping = ref<string[]>([])
const error = ref('')
let pollHandle: number | undefined

const tasks = computed(() => runtime.value?.backgroundTasks ?? [])
const runningTasks = computed(() => (
  tasks.value.filter(task => task.status === 'running')
))
const commandAllowed = computed(() => (
  props.executionMode === 'go' && props.approvalPolicy !== 'read-only'
))

function taskLabel(task: CodingBackgroundTask): string {
  return task.name || task.command || task.id
}

function taskStatusLabel(status: CodingBackgroundTask['status']): string {
  if (status === 'running') return '运行中'
  if (status === 'succeeded') return '已完成'
  if (status === 'cancelled') return '已停止'
  if (status === 'timed_out') return '超时'
  return '失败'
}

function taskElapsed(task: CodingBackgroundTask): string {
  const elapsed = Math.max(0, (task.endedAt ?? Date.now()) - task.startedAt)
  const seconds = Math.round(elapsed / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

async function refresh(silent = false) {
  if (!props.conversationId || refreshing.value) return
  refreshing.value = true
  if (!silent) error.value = ''
  try {
    runtime.value = await invokeCommand<CodingRuntimeStatus>(
      'refresh_coding_background_tasks',
      { conversationId: props.conversationId },
    )
  } catch (reason) {
    if (!silent) {
      error.value = reason instanceof Error
        ? reason.message
        : '无法读取终端任务。'
    }
  } finally {
    refreshing.value = false
  }
}

async function runCommand() {
  const value = command.value.trim()
  if (
    !value
    || !props.conversationId
    || !props.workspacePath
    || !commandAllowed.value
    || starting.value
  ) return
  starting.value = true
  error.value = ''
  try {
    runtime.value = await invokeCommand<CodingRuntimeStatus>(
      'start_coding_background_task',
      {
        conversationId: props.conversationId,
        workspacePath: props.workspacePath,
        command: value,
        name: value.split(/\r?\n/, 1)[0].slice(0, 120),
        executionMode: props.executionMode,
        approvalPolicy: props.approvalPolicy,
      },
    )
    command.value = ''
  } catch (reason) {
    error.value = reason instanceof Error
      ? reason.message
      : '无法运行终端命令。'
  } finally {
    starting.value = false
  }
}

async function stopTask(task: CodingBackgroundTask) {
  if (
    task.status !== 'running'
    || stopping.value.includes(task.id)
    || !props.conversationId
  ) return
  stopping.value = [...stopping.value, task.id]
  error.value = ''
  try {
    runtime.value = await invokeCommand<CodingRuntimeStatus>(
      'stop_coding_background_task',
      {
        conversationId: props.conversationId,
        taskId: task.id,
      },
    )
  } catch (reason) {
    error.value = reason instanceof Error
      ? reason.message
      : '无法停止终端任务。'
    await refresh(true)
  } finally {
    stopping.value = stopping.value.filter(id => id !== task.id)
  }
}

function stopPolling() {
  if (pollHandle !== undefined) {
    window.clearInterval(pollHandle)
    pollHandle = undefined
  }
}

function startPolling() {
  stopPolling()
  if (!props.active || !props.conversationId) return
  void refresh()
  pollHandle = window.setInterval(() => void refresh(true), 1500)
}

watch(
  () => [props.active, props.conversationId, props.workspacePath] as const,
  startPolling,
  { immediate: true },
)

onBeforeUnmount(stopPolling)
</script>

<template>
  <section class="flex min-h-full flex-col">
    <div class="border-b border-border px-4 py-3">
      <div class="flex items-center justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <Terminal class="size-4 text-primary" />
            <p class="text-body font-medium">项目终端</p>
            <Badge :variant="runningTasks.length ? 'secondary' : 'outline'">
              {{ runningTasks.length }} 运行中
            </Badge>
          </div>
          <p
            class="mt-1 truncate font-mono text-caption text-muted-foreground"
            :title="workspacePath"
          >
            {{ workspacePath || '请先选择项目' }}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="refreshing"
          aria-label="刷新终端任务"
          @click="refresh()"
        >
          <RefreshCw class="size-3.5" :class="{ 'animate-spin': refreshing }" />
        </Button>
      </div>

      <form class="mt-3 flex items-end gap-2" @submit.prevent="runCommand">
        <Textarea
          v-model="command"
          class="min-h-16 flex-1 resize-y font-mono text-caption"
          placeholder="输入项目命令…"
          aria-label="终端命令"
          :disabled="!workspacePath || !commandAllowed || starting"
          @keydown.meta.enter.prevent="runCommand"
          @keydown.ctrl.enter.prevent="runCommand"
        />
        <Button
          type="submit"
          size="sm"
          :disabled="!command.trim() || !workspacePath || !commandAllowed || starting"
        >
          <LoaderCircle v-if="starting" class="size-3.5 animate-spin" />
          <Play v-else class="size-3.5 fill-current" />
          运行
        </Button>
      </form>
      <p
        v-if="!commandAllowed"
        class="mt-2 text-caption leading-5 text-amber-500"
      >
        切换到 Go，并选择“请求批准 / 替我审批 / 完全访问权限”后运行命令。
      </p>
      <p v-if="error" class="mt-2 text-caption leading-5 text-destructive">
        {{ error }}
      </p>
    </div>

    <div class="min-h-0 flex-1 overflow-y-auto px-4 py-2">
      <details
        v-for="task in tasks"
        :key="task.id"
        class="group border-b border-border/70 last:border-b-0"
        :open="task.status === 'running'"
      >
        <summary
          class="flex cursor-pointer list-none items-center gap-2 py-3 [&::-webkit-details-marker]:hidden"
        >
          <span
            class="size-1.5 shrink-0 rounded-full"
            :class="task.status === 'running'
              ? 'animate-pulse bg-primary'
              : task.status === 'succeeded'
                ? 'bg-primary'
                : task.status === 'failed' || task.status === 'timed_out'
                  ? 'bg-destructive'
                  : 'bg-muted-foreground'"
          />
          <span class="min-w-0 flex-1">
            <span class="block truncate text-body font-medium" :title="taskLabel(task)">
              {{ taskLabel(task) }}
            </span>
            <span class="mt-0.5 block truncate text-caption text-muted-foreground">
              {{ taskStatusLabel(task.status) }} · {{ taskElapsed(task) }}
              <template v-if="task.pid"> · PID {{ task.pid }}</template>
              <template v-if="task.ports?.length">
                · {{ task.ports.map(port => `:${port}`).join(' ') }}
              </template>
            </span>
          </span>
          <ChevronDown
            class="size-3.5 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"
          />
        </summary>
        <div class="space-y-2 pb-3 pl-3 text-caption leading-5">
          <div class="flex items-start justify-between gap-3">
            <div class="min-w-0 space-y-1">
              <p v-if="task.command" class="break-words font-mono text-foreground">
                $ {{ task.command }}
              </p>
              <p v-if="task.cwd" class="break-all text-muted-foreground">
                {{ task.cwd }}
              </p>
            </div>
            <Button
              v-if="task.status === 'running'"
              type="button"
              variant="outline"
              size="sm"
              class="shrink-0"
              :disabled="stopping.includes(task.id)"
              :aria-label="`停止终端任务 ${taskLabel(task)}`"
              @click="stopTask(task)"
            >
              <LoaderCircle
                v-if="stopping.includes(task.id)"
                class="size-3.5 animate-spin"
              />
              <Square v-else class="size-3 fill-current" />
              停止
            </Button>
          </div>
          <div v-if="task.ports?.length" class="flex flex-wrap items-center gap-1.5">
            <span class="text-muted-foreground">监听端口</span>
            <Badge v-for="port in task.ports" :key="port" variant="outline">
              {{ port }}
            </Badge>
          </div>
          <pre
            v-if="task.logTail"
            class="max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-background/70 px-3 py-2 font-mono text-caption text-foreground"
          >{{ task.logTail }}</pre>
          <p v-if="task.logTruncated" class="text-muted-foreground">
            仅显示日志末尾。
          </p>
          <p v-if="task.lastExitCode !== undefined" class="text-muted-foreground">
            退出码 {{ task.lastExitCode }}
          </p>
          <p v-if="task.error" class="break-words text-destructive">
            {{ task.error }}
          </p>
        </div>
      </details>

      <div
        v-if="!tasks.length && !refreshing"
        class="flex min-h-60 flex-col items-center justify-center text-center"
      >
        <Terminal class="size-6 text-muted-foreground" />
        <p class="mt-3 text-body font-medium">暂无终端任务</p>
      </div>
    </div>
  </section>
</template>
