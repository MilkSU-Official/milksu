<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  watch,
} from 'vue'
import {
  Badge,
  Button,
  Textarea,
} from '@felinic/ui'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  ChevronDown,
  ListTree,
  LoaderCircle,
  Plus,
  Play,
  RefreshCw,
  Shell,
  Square,
  Terminal as TerminalIcon,
} from 'lucide-vue-next'
import {
  hasDesktopRuntime,
  invokeCommand,
  listenEvent,
} from '@/desktop'
import { redactProviderCredentials } from '@/lib/redaction'
import type {
  CodingBackgroundTask,
  CodingRuntimeStatus,
  CodingTerminalEvent,
  CodingTerminalSession,
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

const desktopRuntime = hasDesktopRuntime()
const activeView = ref<'shell' | 'tasks'>('shell')
const shellContainer = ref<HTMLElement | null>(null)
const terminalSessions = ref<CodingTerminalSession[]>([])
const selectedTerminalId = ref('')
const shellLoading = ref(false)
const shellError = ref('')
const command = ref('')
const runtime = ref<CodingRuntimeStatus | null>(null)
const refreshing = ref(false)
const starting = ref(false)
const stopping = ref<string[]>([])
const taskError = ref('')
const pendingOutput = new Map<string, string>()
let hydratingShell = false
let terminal: XTerm | undefined
let fitAddon: FitAddon | undefined
let resizeObserver: ResizeObserver | undefined
let terminalInputDisposable: { dispose: () => void } | undefined
let stopTerminalEvents: (() => void) | undefined
let resizeHandle: number | undefined
let pollHandle: number | undefined
let terminalWriteChain: Promise<void> = Promise.resolve()

const selectedTerminal = computed(() => (
  terminalSessions.value.find(session => session.id === selectedTerminalId.value)
))
const runningShells = computed(() => (
  terminalSessions.value.filter(session => session.status === 'running')
))
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

function terminalStatusLabel(status: CodingTerminalSession['status']): string {
  if (status === 'running') return '运行中'
  if (status === 'exited') return '已退出'
  if (status === 'stopped') return '已停止'
  return '失败'
}

function errorMessage(reason: unknown, fallback: string) {
  return redactProviderCredentials(reason instanceof Error ? reason.message : fallback)
}

function visibleTaskText(value?: string) {
  return value ? redactProviderCredentials(value) : ''
}

function taskElapsed(task: CodingBackgroundTask): string {
  const elapsed = Math.max(0, (task.endedAt ?? Date.now()) - task.startedAt)
  const seconds = Math.round(elapsed / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`
}

function upsertTerminal(session: CodingTerminalSession) {
  const existing = terminalSessions.value.findIndex(
    candidate => candidate.id === session.id,
  )
  if (existing < 0) {
    terminalSessions.value = [session, ...terminalSessions.value]
    return
  }
  const updated = [...terminalSessions.value]
  updated[existing] = session
  terminalSessions.value = updated
}

function renderTerminalSession(session: CodingTerminalSession) {
  if (!terminal) return
  terminal.reset()
  terminal.clear()
  if (session.outputTrimmed) {
    terminal.write('\x1b[90m[更早的终端输出已省略]\x1b[0m\r\n')
  }
  if (session.output) terminal.write(session.output)
  if (session.status !== 'running') {
    const exit = session.exitCode === undefined ? '' : ` · exit ${session.exitCode}`
    terminal.write(
      `\r\n\x1b[90m[${terminalStatusLabel(session.status)}${exit}]\x1b[0m\r\n`,
    )
  }
  void nextTick(() => {
    fitShell()
    terminal?.focus()
  })
}

function selectTerminal(identifier: string) {
  const session = terminalSessions.value.find(item => item.id === identifier)
  if (!session) return
  selectedTerminalId.value = identifier
  renderTerminalSession(session)
}

function terminalDimensions() {
  return {
    columns: Math.max(20, terminal?.cols ?? 100),
    rows: Math.max(5, terminal?.rows ?? 28),
  }
}

async function startShell() {
  if (
    !desktopRuntime
    || !props.conversationId
    || !props.workspacePath
    || shellLoading.value
  ) return
  shellLoading.value = true
  shellError.value = ''
  try {
    fitShell()
    const size = terminalDimensions()
    const session = await invokeCommand<CodingTerminalSession>(
      'start_coding_terminal',
      {
        conversationId: props.conversationId,
        workspacePath: props.workspacePath,
        ...size,
      },
    )
    upsertTerminal(session)
    selectedTerminalId.value = session.id
    renderTerminalSession(session)
  } catch (reason) {
    shellError.value = errorMessage(reason, '无法启动项目 Shell。')
  } finally {
    shellLoading.value = false
  }
}

async function hydrateShellSessions() {
  if (!terminal) return
  shellError.value = ''
  terminalSessions.value = []
  selectedTerminalId.value = ''
  pendingOutput.clear()
  if (!desktopRuntime) {
    terminal.reset()
    terminal.clear()
    terminal.write(
      '\r\n\x1b[90m交互式 Shell 会在 MilkSU 桌面应用中启动。\x1b[0m\r\n',
    )
    return
  }
  if (!props.conversationId || !props.workspacePath) {
    terminal.reset()
    terminal.clear()
    terminal.write('\r\n\x1b[90m请先选择项目并建立 Coding 任务。\x1b[0m\r\n')
    return
  }
  hydratingShell = true
  try {
    const sessions = await invokeCommand<CodingTerminalSession[]>(
      'list_coding_terminals',
      { conversationId: props.conversationId },
    )
    terminalSessions.value = sessions
    const preferred = sessions.find(session => session.status === 'running')
      ?? sessions[0]
    if (preferred) {
      selectedTerminalId.value = preferred.id
      renderTerminalSession(preferred)
    } else {
      terminal.reset()
      terminal.clear()
      terminal.write(
        '\r\n\x1b[90m没有当前 App 进程的 Shell。交互式 Shell 不跨 App 重启恢复；'
        + '旧 PTY 已结束且不可重连。点击 + 新建 Shell，后台长任务请在“后台任务”中恢复。'
        + '\x1b[0m\r\n',
      )
    }
  } catch (reason) {
    shellError.value = errorMessage(reason, '无法读取项目 Shell。')
  } finally {
    hydratingShell = false
    const buffered = pendingOutput.get(selectedTerminalId.value)
    if (buffered) terminal.write(buffered)
    pendingOutput.clear()
  }
}

function handleTerminalEvent(event: CodingTerminalEvent) {
  if (event.conversationId !== props.conversationId) return
  if (event.session) {
    upsertTerminal(event.session)
    if (!selectedTerminalId.value) {
      selectedTerminalId.value = event.session.id
    }
  }
  if (event.type === 'terminal.output' && event.data) {
    if (hydratingShell) {
      pendingOutput.set(
        event.terminalId,
        (pendingOutput.get(event.terminalId) ?? '') + event.data,
      )
    } else if (event.terminalId === selectedTerminalId.value) {
      terminal?.write(event.data)
    }
  }
  if (
    event.type === 'terminal.exited'
    && event.session
    && event.terminalId === selectedTerminalId.value
  ) {
    const exit = event.session.exitCode === undefined
      ? ''
      : ` · exit ${event.session.exitCode}`
    terminal?.write(
      `\r\n\x1b[90m[${terminalStatusLabel(event.session.status)}${exit}]\x1b[0m\r\n`,
    )
  }
}

function writeShell(data: string) {
  const session = selectedTerminal.value
  if (!desktopRuntime || !session || session.status !== 'running') return
  const conversationId = props.conversationId
  const terminalId = session.id
  terminalWriteChain = terminalWriteChain
    .then(() => invokeCommand<void>('write_coding_terminal', {
      conversationId,
      terminalId,
      data,
    }))
    .catch(reason => {
      shellError.value = errorMessage(reason, '无法写入项目 Shell。')
    })
}

async function stopShell() {
  const session = selectedTerminal.value
  if (!session || session.status !== 'running' || shellLoading.value) return
  shellLoading.value = true
  shellError.value = ''
  try {
    await invokeCommand<CodingTerminalSession>('stop_coding_terminal', {
      conversationId: props.conversationId,
      terminalId: session.id,
    })
  } catch (reason) {
    shellError.value = errorMessage(reason, '无法停止项目 Shell。')
  } finally {
    shellLoading.value = false
  }
}

function fitShell() {
  if (
    !terminal
    || !fitAddon
    || !shellContainer.value
    || activeView.value !== 'shell'
  ) return
  try {
    fitAddon.fit()
  } catch {
    return
  }
  if (resizeHandle !== undefined) window.clearTimeout(resizeHandle)
  resizeHandle = window.setTimeout(() => {
    const session = selectedTerminal.value
    if (
      !desktopRuntime
      || !session
      || session.status !== 'running'
      || !terminal
      || (
        session.columns === terminal.cols
        && session.rows === terminal.rows
      )
    ) return
    void invokeCommand<CodingTerminalSession>('resize_coding_terminal', {
      conversationId: props.conversationId,
      terminalId: session.id,
      columns: terminal.cols,
      rows: terminal.rows,
    }).then(upsertTerminal).catch(() => undefined)
  }, 120)
}

async function refreshTasks(silent = false) {
  if (!props.conversationId || !props.workspacePath || refreshing.value) return
  refreshing.value = true
  if (!silent) taskError.value = ''
  try {
    runtime.value = await invokeCommand<CodingRuntimeStatus>(
      'refresh_coding_background_tasks',
      {
        conversationId: props.conversationId,
        workspacePath: props.workspacePath,
        executionMode: props.executionMode,
        approvalPolicy: props.approvalPolicy,
      },
    )
  } catch (reason) {
    if (!silent) {
      taskError.value = errorMessage(reason, '无法读取后台任务。')
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
  taskError.value = ''
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
    taskError.value = errorMessage(reason, '无法运行后台任务。')
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
  taskError.value = ''
  try {
    runtime.value = await invokeCommand<CodingRuntimeStatus>(
      'stop_coding_background_task',
      {
        conversationId: props.conversationId,
        taskId: task.id,
      },
    )
  } catch (reason) {
    taskError.value = errorMessage(reason, '无法停止后台任务。')
    await refreshTasks(true)
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
  if (
    !props.active
    || activeView.value !== 'tasks'
    || !props.conversationId
    || !props.workspacePath
  ) return
  void refreshTasks()
  pollHandle = window.setInterval(() => void refreshTasks(true), 1500)
}

onMounted(async () => {
  await nextTick()
  if (!shellContainer.value) return
  terminal = new XTerm({
    allowProposedApi: false,
    convertEol: false,
    cursorBlink: true,
    cursorStyle: 'bar',
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
    fontSize: 13,
    lineHeight: 1.28,
    screenReaderMode: true,
    scrollback: 5000,
    theme: {
      background: '#0b111d',
      foreground: '#e7edf6',
      cursor: '#9fef00',
      cursorAccent: '#0b111d',
      selectionBackground: '#9fef0033',
      black: '#0b111d',
      brightBlack: '#607089',
      green: '#9fef00',
      brightGreen: '#b7ff3c',
      cyan: '#5ce1e6',
      brightCyan: '#8ff7fa',
      red: '#ff6b6b',
      brightRed: '#ff8b8b',
      yellow: '#f2c94c',
      brightYellow: '#ffe37a',
      blue: '#6ea8fe',
      brightBlue: '#94c1ff',
      magenta: '#c084fc',
      brightMagenta: '#d7a8ff',
      white: '#d7deea',
      brightWhite: '#ffffff',
    },
  })
  fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.open(shellContainer.value)
  terminalInputDisposable = terminal.onData(writeShell)
  resizeObserver = new ResizeObserver(fitShell)
  resizeObserver.observe(shellContainer.value)
  stopTerminalEvents = await listenEvent<CodingTerminalEvent>(
    'coding-terminal-event',
    event => handleTerminalEvent(event.payload),
  )
  fitShell()
  await hydrateShellSessions()
})

watch(
  () => [
    props.active,
    activeView.value,
    props.conversationId,
    props.workspacePath,
    props.executionMode,
    props.approvalPolicy,
  ] as const,
  () => {
    startPolling()
    if (activeView.value === 'shell') {
      void nextTick(() => {
        fitShell()
        terminal?.focus()
      })
    }
  },
  { immediate: true },
)

watch(
  () => [props.conversationId, props.workspacePath] as const,
  (current, previous) => {
    if (
      current[0] !== previous?.[0]
      || current[1] !== previous?.[1]
    ) {
      void hydrateShellSessions()
    }
  },
)

onBeforeUnmount(() => {
  stopPolling()
  if (resizeHandle !== undefined) window.clearTimeout(resizeHandle)
  resizeObserver?.disconnect()
  terminalInputDisposable?.dispose()
  stopTerminalEvents?.()
  terminal?.dispose()
})
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col">
    <div class="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
      <div class="flex items-center gap-1 rounded-lg bg-muted/50 p-1">
        <Button
          type="button"
          size="sm"
          :variant="activeView === 'shell' ? 'secondary' : 'ghost'"
          @click="activeView = 'shell'"
        >
          <Shell class="size-3.5" />
          Shell
          <Badge v-if="runningShells.length" variant="outline">
            {{ runningShells.length }}
          </Badge>
        </Button>
        <Button
          type="button"
          size="sm"
          :variant="activeView === 'tasks' ? 'secondary' : 'ghost'"
          @click="activeView = 'tasks'"
        >
          <ListTree class="size-3.5" />
          后台任务
          <Badge v-if="runningTasks.length" variant="outline">
            {{ runningTasks.length }}
          </Badge>
        </Button>
      </div>
      <Button
        v-if="activeView === 'tasks'"
        variant="ghost"
        size="icon-sm"
        :disabled="refreshing"
        aria-label="刷新后台任务"
        @click="refreshTasks()"
      >
        <RefreshCw class="size-3.5" :class="{ 'animate-spin': refreshing }" />
      </Button>
    </div>

    <template v-if="activeView === 'shell'">
      <div class="flex shrink-0 items-center gap-2 border-b border-border px-4 py-2">
        <div class="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <button
            v-for="(session, index) in terminalSessions"
            :key="session.id"
            type="button"
            class="flex max-w-40 shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-caption transition-colors"
            :class="session.id === selectedTerminalId
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
            :title="`${session.shell} · PID ${session.pid ?? '—'}`"
            @click="selectTerminal(session.id)"
          >
            <span
              class="size-1.5 shrink-0 rounded-full"
              :class="session.status === 'running'
                ? 'bg-primary'
                : session.status === 'failed'
                  ? 'bg-destructive'
                  : 'bg-muted-foreground'"
            />
            <span class="truncate">Shell {{ terminalSessions.length - index }}</span>
          </button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          :disabled="!desktopRuntime || !workspacePath || shellLoading || runningShells.length >= 4"
          aria-label="新建项目 Shell"
          title="新建项目 Shell"
          @click="startShell"
        >
          <LoaderCircle v-if="shellLoading" class="size-3.5 animate-spin" />
          <Plus v-else class="size-4" />
        </Button>
        <Button
          v-if="selectedTerminal?.status === 'running'"
          type="button"
          variant="ghost"
          size="icon-sm"
          :disabled="shellLoading"
          aria-label="停止当前 Shell"
          title="停止当前 Shell"
          @click="stopShell"
        >
          <Square class="size-3 fill-current" />
        </Button>
      </div>

      <div class="flex min-h-0 flex-1 flex-col bg-[#0b111d]">
        <div ref="shellContainer" class="min-h-0 flex-1 px-2 py-2" />
        <p
          v-if="shellError"
          class="shrink-0 border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-caption text-destructive"
        >
          {{ shellError }}
        </p>
        <p class="shrink-0 border-t border-white/10 px-4 py-1.5 text-[11px] text-slate-500">
          本机 Shell · 你键入的命令以当前 macOS 用户权限运行；Agent 自动执行仍受上方权限策略控制。
        </p>
      </div>
    </template>

    <template v-else>
      <div class="shrink-0 border-b border-border px-4 py-3">
        <div class="flex items-center gap-2">
          <TerminalIcon class="size-4 text-primary" />
          <p class="text-body font-medium">后台任务</p>
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
        <form class="mt-3 flex items-end gap-2" @submit.prevent="runCommand">
          <Textarea
            v-model="command"
            class="min-h-16 flex-1 resize-y font-mono text-caption"
            placeholder="输入需要持续运行的项目命令…"
            aria-label="后台任务命令"
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
          Agent 后台任务需要 Go，以及“请求批准 / 替我审批 / 完全访问权限”之一。
        </p>
        <p
          v-if="runtime?.backgroundRecovery?.state === 'recovered'
            || runtime?.backgroundRecovery?.state === 'attached'"
          class="mt-2 text-caption leading-5 text-primary"
        >
          {{ runtime.backgroundRecovery.state === 'recovered'
            ? '已从磁盘恢复持久任务，并重新连接状态、日志和超时监控。'
            : '持久任务的状态、日志和超时监控已连接。' }}
        </p>
        <p
          v-else-if="runtime?.backgroundRecovery?.state === 'failed'"
          class="mt-2 text-caption leading-5 text-amber-500"
        >
          已读取持久任务，但恢复监控失败：{{ runtime.backgroundRecovery.detail }}
        </p>
        <p v-if="taskError" class="mt-2 text-caption leading-5 text-destructive">
          {{ taskError }}
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
                :aria-label="`停止后台任务 ${taskLabel(task)}`"
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
            >{{ visibleTaskText(task.logTail) }}</pre>
            <p v-if="task.logTruncated" class="text-muted-foreground">
              仅显示日志末尾。
            </p>
            <p v-if="task.lastExitCode !== undefined" class="text-muted-foreground">
              退出码 {{ task.lastExitCode }}
            </p>
            <p v-if="task.error" class="break-words text-destructive">
              {{ visibleTaskText(task.error) }}
            </p>
          </div>
        </details>

        <div
          v-if="!tasks.length && !refreshing"
          class="flex min-h-60 flex-col items-center justify-center text-center"
        >
          <TerminalIcon class="size-6 text-muted-foreground" />
          <p class="mt-3 text-body font-medium">暂无后台任务</p>
        </div>
      </div>
    </template>
  </section>
</template>

<style scoped>
:deep(.xterm) {
  height: 100%;
}

:deep(.xterm-viewport) {
  scrollbar-color: rgb(96 112 137 / 65%) transparent;
}

:deep(.xterm-screen canvas) {
  image-rendering: auto;
}
</style>
