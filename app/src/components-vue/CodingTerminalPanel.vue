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
  Button,
} from '@felinic/ui'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import {
  LoaderCircle,
  Plus,
  RefreshCw,
  SquareTerminal,
  X,
} from 'lucide-vue-next'
import {
  hasDesktopRuntime,
  invokeCommand,
  listenEvent,
} from '@/desktop'
import { redactProviderCredentials } from '@/lib/redaction'
import type {
  CodingTerminalEvent,
  CodingTerminalSession,
} from '@/codingEnvironmentTypes'

const props = defineProps<{
  active: boolean
  conversationId: string
  workspacePath: string
}>()

const emit = defineEmits<{
  close: []
}>()

const desktopRuntime = hasDesktopRuntime()
const desktopRuntimeNotice = '真实 Shell 仅在 MilkSU 桌面 App 中可用。'
const shellContainer = ref<HTMLElement | null>(null)
const terminalSessions = ref<CodingTerminalSession[]>([])
const selectedTerminalId = ref('')
const shellLoading = ref(false)
const closingTerminals = ref<string[]>([])
const shellError = ref('')
const pendingOutput = new Map<string, string>()
const terminalOrdinals = new Map<string, number>()
let nextTerminalOrdinal = 1
let hydratingShell = false
let terminal: XTerm | undefined
let fitAddon: FitAddon | undefined
let resizeObserver: ResizeObserver | undefined
let terminalInputDisposable: { dispose: () => void } | undefined
let stopTerminalEvents: (() => void) | undefined
let resizeHandle: number | undefined
let terminalWriteChain: Promise<void> = Promise.resolve()

const selectedTerminal = computed(() => (
  terminalSessions.value.find(session => session.id === selectedTerminalId.value)
))
const runningShells = computed(() => (
  terminalSessions.value.filter(session => session.status === 'running')
))
const workspaceName = computed(() => {
  const value = props.workspacePath.replace(/\/+$/, '')
  return value.split('/').at(-1) || '终端'
})

function terminalStatusLabel(status: CodingTerminalSession['status']): string {
  if (status === 'running') return '运行中'
  if (status === 'exited') return '已退出'
  if (status === 'stopped') return '已停止'
  return '失败'
}

function errorMessage(reason: unknown, fallback: string) {
  return redactProviderCredentials(reason instanceof Error ? reason.message : fallback)
}

function upsertTerminal(session: CodingTerminalSession) {
  const existing = terminalSessions.value.findIndex(
    candidate => candidate.id === session.id,
  )
  if (existing < 0) {
    rememberTerminal(session)
    terminalSessions.value = [...terminalSessions.value, session]
    return
  }
  const updated = [...terminalSessions.value]
  updated[existing] = session
  terminalSessions.value = updated
}

function rememberTerminal(session: CodingTerminalSession) {
  if (terminalOrdinals.has(session.id)) return
  terminalOrdinals.set(session.id, nextTerminalOrdinal)
  nextTerminalOrdinal += 1
}

function resetTerminalOrder() {
  terminalOrdinals.clear()
  nextTerminalOrdinal = 1
}

function terminalLabel(session: CodingTerminalSession): string {
  const ordinal = terminalOrdinals.get(session.id) ?? 1
  return ordinal === 1 ? workspaceName.value : `${workspaceName.value} ${ordinal}`
}

function renderTerminalSession(session: CodingTerminalSession) {
  if (!terminal) return
  terminal.options.disableStdin = session.status !== 'running'
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

function renderEmptyTerminal() {
  if (!terminal) return
  terminal.options.disableStdin = true
  terminal.reset()
  terminal.clear()
  terminal.write('\r\n\x1b[90m暂无 Shell，点击 + 新建。\x1b[0m\r\n')
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
  resetTerminalOrder()
  pendingOutput.clear()
  if (!desktopRuntime) {
    terminal.reset()
    terminal.clear()
    terminal.write(
      '\r\n\x1b[90m请在桌面 App 中新建 Shell。\x1b[0m\r\n',
    )
    return
  }
  if (!props.conversationId || !props.workspacePath) {
    terminal.reset()
    terminal.clear()
    terminal.write('\r\n\x1b[90m正在准备项目目录…\x1b[0m\r\n')
    return
  }
  hydratingShell = true
  try {
    const sessions = await invokeCommand<CodingTerminalSession[]>(
      'list_coding_terminals',
      { conversationId: props.conversationId },
    )
    const orderedSessions = [...sessions].sort((left, right) => (
      left.startedAt - right.startedAt || left.id.localeCompare(right.id)
    ))
    for (const session of orderedSessions) rememberTerminal(session)
    terminalSessions.value = orderedSessions
    const preferred = orderedSessions.find(session => session.status === 'running')
      ?? orderedSessions[0]
    if (preferred) {
      selectedTerminalId.value = preferred.id
      renderTerminalSession(preferred)
    } else if (props.active) {
      await startShell()
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
  if (event.type === 'terminal.closed') {
    removeTerminalFromView(event.terminalId)
    return
  }
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
    if (terminal) terminal.options.disableStdin = true
    const exit = event.session.exitCode === undefined
      ? ''
      : ` · exit ${event.session.exitCode}`
    terminal?.write(
      `\r\n\x1b[90m[${terminalStatusLabel(event.session.status)}${exit}]\x1b[0m\r\n`,
    )
  }
}

function removeTerminalFromView(identifier: string) {
  const index = terminalSessions.value.findIndex(item => item.id === identifier)
  if (index < 0) return
  const updated = terminalSessions.value.filter(item => item.id !== identifier)
  terminalSessions.value = updated
  if (updated.length === 0) resetTerminalOrder()
  else terminalOrdinals.delete(identifier)
  if (selectedTerminalId.value !== identifier) return
  const next = updated[index] ?? updated[index - 1]
  selectedTerminalId.value = next?.id ?? ''
  if (next) renderTerminalSession(next)
  else renderEmptyTerminal()
}

async function closeShell(session: CodingTerminalSession): Promise<boolean> {
  if (closingTerminals.value.includes(session.id)) return false
  closingTerminals.value = [...closingTerminals.value, session.id]
  shellError.value = ''
  try {
    await invokeCommand<void>('close_coding_terminal', {
      conversationId: props.conversationId,
      terminalId: session.id,
    })
    removeTerminalFromView(session.id)
    return true
  } catch (reason) {
    shellError.value = errorMessage(reason, '无法关闭项目 Shell。')
    return false
  } finally {
    closingTerminals.value = closingTerminals.value.filter(id => id !== session.id)
  }
}

async function restartShell() {
  const session = selectedTerminal.value
  if (!session || session.status === 'running' || shellLoading.value) return
  if (await closeShell(session)) await startShell()
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

function fitShell() {
  if (
    !terminal
    || !fitAddon
    || !shellContainer.value
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
      background: '#111315',
      foreground: '#f8f8f5',
      cursor: '#22bbff',
      cursorAccent: '#111315',
      selectionBackground: 'rgba(34, 187, 255, 0.22)',
      black: '#111315',
      brightBlack: '#6e7167',
      green: '#46c47c',
      brightGreen: '#8ee0ad',
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
      white: '#dfe1d9',
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
    props.conversationId,
    props.workspacePath,
  ] as const,
  () => {
    void nextTick(() => {
      fitShell()
      terminal?.focus()
    })
  },
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
  if (resizeHandle !== undefined) window.clearTimeout(resizeHandle)
  resizeObserver?.disconnect()
  terminalInputDisposable?.dispose()
  stopTerminalEvents?.()
  terminal?.dispose()
})
</script>

<template>
  <section class="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
    <div class="flex h-12 shrink-0 items-center justify-between border-b border-border px-3">
      <div class="flex min-w-0 items-center gap-1.5 overflow-x-auto">
        <template v-if="terminalSessions.length">
          <div
            v-for="session in terminalSessions"
            :key="session.id"
            class="flex max-w-48 shrink-0 items-center rounded-md transition-colors"
            :class="session.id === selectedTerminalId
              ? 'bg-secondary text-foreground'
              : 'text-muted-foreground hover:bg-muted hover:text-foreground'"
          >
            <button
              type="button"
              :data-terminal-id="session.id"
              class="flex min-w-0 items-center gap-2 px-2.5 py-1.5 text-caption"
              :aria-label="terminalLabel(session)"
              :aria-pressed="session.id === selectedTerminalId"
              :title="`${redactProviderCredentials(session.shell)} · PID ${session.pid ?? '—'}`"
              @click="selectTerminal(session.id)"
            >
              <SquareTerminal class="size-3.5 shrink-0" />
              <span class="truncate">
                {{ terminalLabel(session) }}
              </span>
            </button>
            <button
              type="button"
              class="mr-1 flex size-6 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground"
              :disabled="closingTerminals.includes(session.id)"
              :aria-label="`关闭 ${terminalLabel(session)}`"
              :title="`关闭 ${terminalLabel(session)}`"
              @click="closeShell(session)"
            >
              <LoaderCircle
                v-if="closingTerminals.includes(session.id)"
                class="size-3 animate-spin"
              />
              <X v-else class="size-3" />
            </button>
          </div>
        </template>
        <button
          v-else
          type="button"
          class="flex max-w-44 shrink-0 items-center gap-2 rounded-md bg-secondary px-2.5 py-1.5 text-caption text-foreground"
        >
          <SquareTerminal class="size-3.5 shrink-0" />
          <span class="truncate">{{ workspaceName }}</span>
        </button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          class="shrink-0"
          :disabled="!desktopRuntime || !workspacePath || shellLoading || runningShells.length >= 4"
          aria-label="新建项目 Shell"
          title="新建项目 Shell"
          @click="startShell"
        >
          <LoaderCircle v-if="shellLoading" class="size-3.5 animate-spin" />
          <Plus v-else class="size-4" />
        </Button>
        <Button
          v-if="selectedTerminal && selectedTerminal.status !== 'running'"
          type="button"
          variant="ghost"
          size="icon-sm"
          class="shrink-0"
          :disabled="shellLoading || closingTerminals.includes(selectedTerminal.id)"
          aria-label="重新启动当前 Shell"
          title="重新启动当前 Shell"
          @click="restartShell"
        >
          <RefreshCw class="size-3.5" />
        </Button>
      </div>
      <div class="flex shrink-0 items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="关闭底部面板"
          title="关闭底部面板"
          @click="emit('close')"
        >
          <X class="size-4" />
        </Button>
      </div>
    </div>

    <div
      v-if="!desktopRuntime"
      class="border-b border-amber-500/30 bg-amber-500/10 px-4 py-3 text-caption leading-5 text-amber-200"
    >
      {{ desktopRuntimeNotice }}
    </div>

    <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-[var(--night-sunken)]">
      <div
        ref="shellContainer"
        class="box-border min-h-0 min-w-0 flex-1 overflow-hidden px-2 py-2"
      />
      <p
        v-if="shellError"
        class="shrink-0 border-t border-destructive/30 bg-destructive/10 px-4 py-2 text-caption text-destructive"
      >
        {{ shellError }}
      </p>
    </div>
  </section>
</template>

<style scoped>
:deep(.xterm) {
  height: 100%;
  width: 100%;
  overflow: hidden;
}

:deep(.xterm-viewport) {
  max-width: 100%;
  scrollbar-color: rgb(96 112 137 / 65%) transparent;
}

:deep(.xterm-screen),
:deep(.xterm-helpers) {
  max-width: 100%;
}

:deep(.xterm-screen canvas) {
  image-rendering: auto;
}
</style>
