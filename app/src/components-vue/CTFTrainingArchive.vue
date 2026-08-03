<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Alert, AlertDescription, Badge, Button } from '@felinic/ui'
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  FileClock,
  FileDown,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import type {
  CTFAgentReplay,
  CTFAgentReplayEvent,
  CTFTrainingReportExport,
} from '@/ctfTypes'

const props = defineProps<{
  jobId: string
  replayAvailable: boolean
}>()

const replay = ref<CTFAgentReplay | null>(null)
const report = ref<CTFTrainingReportExport | null>(null)
const replayOpen = ref(false)
const replayExpanded = ref(false)
const loadingReplay = ref(false)
const generatingReport = ref(false)
const error = ref('')
const notice = ref('')

const visibleReplayEvents = computed(() => {
  const events = replay.value?.events ?? []
  return replayExpanded.value ? events.slice(-100) : events.slice(-6)
})

function redactReplayText(value: string) {
  return value
    .replace(
      /\b[A-Z][A-Z0-9_]*API_KEY\s*=\s*[^\s"']+/g,
      match => `${match.split('=')[0].trim()}=[credential redacted]`,
    )
    .replace(
      /([?&])api[_-]?key=([^&#\s"']+)/gi,
      '$1api_key=[credential redacted]',
    )
    .replace(
      /(^|[\s,;])api[_-]?key\s*[:=]\s*[^\s"']+/gi,
      '$1api_key=[credential redacted]',
    )
    .replace(
      /(^|[\s,;])x-api-key\s*[:=]\s*[^\s"']+/gi,
      '$1x-api-key=[credential redacted]',
    )
    .replace(/\bBearer\s+[^\s"']+/gi, 'Bearer [credential redacted]')
    .replace(/\b(?:sk|sess)-[A-Za-z0-9_-]{8,}\b/g, '[credential redacted]')
}

function errorMessage(reason: unknown) {
  return redactReplayText(reason instanceof Error ? reason.message : String(reason))
}

watch(() => props.jobId, () => {
  replay.value = null
  report.value = null
  replayOpen.value = false
  replayExpanded.value = false
  error.value = ''
  notice.value = ''
})

async function loadReplay() {
  if (replay.value) {
    replayOpen.value = !replayOpen.value
    return
  }
  loadingReplay.value = true
  error.value = ''
  notice.value = ''
  try {
    replay.value = await invokeCommand<CTFAgentReplay>('get_ctf_agent_replay', { id: props.jobId })
    replayOpen.value = true
  } catch (reason) {
    error.value = errorMessage(reason)
  } finally {
    loadingReplay.value = false
  }
}

async function generateReport() {
  generatingReport.value = true
  error.value = ''
  notice.value = ''
  try {
    report.value = await invokeCommand<CTFTrainingReportExport>('generate_ctf_training_report', {
      id: props.jobId,
    })
    notice.value = '安全报告已生成；候选 Flag 不会写入可分享内容。'
  } catch (reason) {
    error.value = errorMessage(reason)
  } finally {
    generatingReport.value = false
  }
}

async function copy(value: string, label: string) {
  if (!value) return
  error.value = ''
  try {
    await navigator.clipboard.writeText(value)
    notice.value = `${label}已复制。`
  } catch (reason) {
    error.value = `复制失败：${errorMessage(reason)}`
  }
}

function eventLabel(event: CTFAgentReplayEvent) {
  if (event.toolName) return event.toolName
  switch (event.type) {
    case 'assistant_text': return 'Agent 回复'
    case 'tool_call': return '工具调用'
    case 'tool_result': return '工具结果'
    case 'turn_end': return '回合完成'
    case 'error': return '运行错误'
    default: return event.type || '运行事件'
  }
}

function eventSummary(event: CTFAgentReplayEvent) {
  return redactReplayText(event.error || event.text || event.engine || '该事件没有附带文本。')
}

function formatTime(value?: string) {
  if (!value) return ''
  return new Intl.DateTimeFormat('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).format(new Date(value))
}

function actorLabel(actor: string) {
  if (actor === 'user') return '用户完成'
  if (actor === 'agent') return 'Agent 代做'
  if (actor === 'shared') return '共同完成'
  return '尚无可归属证据'
}

function assistanceLabel(assistance: string) {
  if (assistance === 'none') return '无协助'
  if (assistance === 'hint') return '依赖提示'
  if (assistance === 'copilot') return '搭档协作'
  return '代理完成'
}
</script>

<template>
  <section class="rounded-xl border border-border bg-card p-6" aria-labelledby="training-archive-title">
    <div class="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h2 id="training-archive-title" class="flex items-center gap-2 text-label font-medium">
          <FileClock class="size-4" />
          训练档案
        </h2>
        <p class="mt-1 max-w-xl text-caption leading-5 text-muted-foreground">
          回看 PI 的真实工具轨迹，或生成默认隐去候选内容的面试复盘材料。
        </p>
      </div>
      <div class="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          :loading="loadingReplay"
          :disabled="!replayAvailable"
          @click="loadReplay"
        >
          <TerminalSquare class="size-4" />
          {{ replayOpen ? '收起回放' : '运行回放' }}
        </Button>
        <Button size="sm" :loading="generatingReport" @click="generateReport">
          <FileDown class="size-4" />
          {{ report ? '重新生成' : '生成报告' }}
        </Button>
      </div>
    </div>

    <p v-if="!replayAvailable" class="mt-4 text-caption leading-5 text-muted-foreground">
      启动一次 PI 解题回合后即可查看逐事件回放；训练报告现在就可以生成。
    </p>

    <Alert v-if="error" variant="destructive" class="mt-4">
      <ShieldCheck class="size-4" />
      <AlertDescription>{{ error }}</AlertDescription>
    </Alert>
    <Alert v-else-if="notice" class="mt-4">
      <Check class="size-4" />
      <AlertDescription>{{ notice }}</AlertDescription>
    </Alert>

    <div v-if="report" class="mt-5 rounded-lg border border-border bg-muted/20 p-4">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <p class="text-control font-medium">可分享训练报告</p>
          <Badge :variant="report.report.verified ? 'secondary' : 'outline'">
            {{ report.report.verified ? '平台已验证' : '尚未验证' }}
          </Badge>
          <Badge variant="outline">
            {{ actorLabel(report.report.contribution.primaryActor) }}
          </Badge>
          <Badge variant="outline">
            {{ assistanceLabel(report.report.contribution.assistance) }}
          </Badge>
        </div>
        <span class="text-caption text-muted-foreground">
          {{ new Date(report.report.generatedAt).toLocaleString() }}
        </span>
      </div>

      <div class="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <div class="rounded-md bg-background px-3 py-2">
          <p class="text-caption text-muted-foreground">完成回合</p>
          <p class="mt-1 font-mono text-control">{{ report.report.stats.completedTurns }}</p>
        </div>
        <div class="rounded-md bg-background px-3 py-2">
          <p class="text-caption text-muted-foreground">工具调用</p>
          <p class="mt-1 font-mono text-control">{{ report.report.stats.toolCalls }}</p>
        </div>
        <div class="rounded-md bg-background px-3 py-2">
          <p class="text-caption text-muted-foreground">实验</p>
          <p class="mt-1 font-mono text-control">{{ report.report.stats.experiments }}</p>
        </div>
        <div class="rounded-md bg-background px-3 py-2">
          <p class="text-caption text-muted-foreground">用户独立步骤</p>
          <p class="mt-1 font-mono text-control">{{ report.report.stats.independentSteps }}</p>
        </div>
      </div>

      <p class="mt-4 truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-caption text-muted-foreground">
        {{ report.markdownPath }}
      </p>
      <details class="mt-3 overflow-hidden rounded-md border border-border bg-background">
        <summary class="cursor-pointer px-3 py-2 text-caption font-medium">
          预览报告
        </summary>
        <MarkdownContent
          class="max-h-80 overflow-y-auto border-t border-border px-4 py-4 text-caption leading-5"
          :content="report.report.markdown"
        />
      </details>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" @click="copy(report.report.markdown, 'Markdown 报告')">
          <ClipboardCopy class="size-4" />
          复制 Markdown
        </Button>
        <Button variant="ghost" size="sm" @click="copy(report.markdownPath, '报告路径')">
          <ClipboardCopy class="size-4" />
          复制路径
        </Button>
      </div>
    </div>

    <div v-if="replayOpen && replay" class="mt-5 border-t border-border pt-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <p class="text-control font-medium">PI 逐事件回放</p>
          <Badge variant="outline">{{ replay.events.length }} 个事件</Badge>
          <Badge v-if="replay.truncated" variant="secondary">后端已截断</Badge>
        </div>
        <p class="text-caption text-muted-foreground">
          {{ replay.metrics.toolCalls }} 次工具调用 · {{ replay.metrics.toolErrors }} 次错误
        </p>
      </div>

      <div v-if="visibleReplayEvents.length" class="mt-4 space-y-2">
        <article
          v-for="event in visibleReplayEvents"
          :key="event.sequence"
          class="rounded-lg border border-border px-3 py-3"
        >
          <div class="flex flex-wrap items-center gap-2">
            <span class="font-mono text-caption text-muted-foreground">#{{ event.sequence }}</span>
            <p class="text-control font-medium">{{ eventLabel(event) }}</p>
            <Badge v-if="event.truncated" variant="secondary">内容已截断</Badge>
            <span class="ml-auto text-caption text-muted-foreground">{{ formatTime(event.timestamp) }}</span>
          </div>
          <pre
            v-if="event.type === 'tool_result' || event.type === 'tool_call'"
            class="mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-caption leading-5"
            :class="event.error ? 'text-destructive' : 'text-muted-foreground'"
          >{{ eventSummary(event) }}</pre>
          <MarkdownContent
            v-else
            class="mt-1 text-caption leading-5"
            :class="event.error ? 'text-destructive' : 'text-muted-foreground'"
            :content="eventSummary(event)"
            compact
          />
        </article>
      </div>
      <p v-else class="mt-4 text-caption text-muted-foreground">工作区已建立，但还没有 PI 事件。</p>

      <Button
        v-if="replay.events.length > 6"
        variant="link"
        size="text"
        class="mt-3"
        @click="replayExpanded = !replayExpanded"
      >
        <ChevronUp v-if="replayExpanded" class="size-3.5" />
        <ChevronDown v-else class="size-3.5" />
        {{
          replayExpanded
            ? '只看最近 6 个事件'
            : `查看最近 ${Math.min(100, replay.events.length)} 个事件`
        }}
      </Button>
      <p v-if="replayExpanded && replay.events.length > 100" class="mt-2 text-caption text-muted-foreground">
        为避免界面卡顿，这里只展示最近 100 个事件；完整轨迹仍保存在本机证据目录。
      </p>
    </div>
  </section>
</template>
