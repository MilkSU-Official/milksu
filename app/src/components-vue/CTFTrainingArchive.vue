<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { Alert, AlertDescription, Badge, Button, SettingsSection } from '@felinic/ui'
import {
  Check,
  ChevronDown,
  ChevronUp,
  ClipboardCopy,
  FileDown,
  ShieldCheck,
  TerminalSquare,
} from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import { redactProviderCredentials } from '@/lib/redaction'
import { t } from '@/lib/uiLocale'
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

function errorMessage(reason: unknown) {
  return redactProviderCredentials(reason instanceof Error ? reason.message : String(reason))
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
    notice.value = t('安全报告已生成。', 'Security report generated.')
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
    notice.value = t(`${label}已复制。`, `${label} copied.`)
  } catch (reason) {
    error.value = t(`复制失败：${errorMessage(reason)}`, `Copy failed: ${errorMessage(reason)}`)
  }
}

function eventLabel(event: CTFAgentReplayEvent) {
  if (event.toolName) return event.toolName
  switch (event.type) {
    case 'assistant_text': return t('Agent 回复', 'Agent reply')
    case 'tool_call': return t('工具调用', 'Tool call')
    case 'tool_result': return t('工具结果', 'Tool result')
    case 'turn_end': return t('回合完成', 'Turn completed')
    case 'error': return t('运行错误', 'Run error')
    default: return event.type || t('运行事件', 'Run event')
  }
}

function eventSummary(event: CTFAgentReplayEvent) {
  return redactProviderCredentials(event.error || event.text || event.engine || t('该事件没有附带文本。', 'This event has no attached text.'))
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
  if (actor === 'user') return t('用户完成', 'Completed by user')
  if (actor === 'agent') return t('Agent 代做', 'Completed by Agent')
  if (actor === 'shared') return t('共同完成', 'Completed together')
  return t('尚无可归属证据', 'No attributable evidence yet')
}

function assistanceLabel(assistance: string) {
  if (assistance === 'none') return t('无协助', 'No assistance')
  if (assistance === 'hint') return t('依赖提示', 'Used hints')
  if (assistance === 'copilot') return t('搭档协作', 'Copilot collaboration')
  return t('代理完成', 'Delegate completed')
}
</script>

<template>
  <SettingsSection :title="t('训练档案', 'Training archive')" aria-labelledby="training-archive-title">
    <template #actions>
      <div class="flex flex-wrap gap-2">
        <Button
          variant="outline"
          size="sm"
          :loading="loadingReplay"
          :disabled="!replayAvailable"
          @click="loadReplay"
        >
          <TerminalSquare class="size-4" />
          {{ replayOpen ? t('收起回放', 'Hide replay') : t('运行回放', 'Run replay') }}
        </Button>
        <Button size="sm" :loading="generatingReport" @click="generateReport">
          <FileDown class="size-4" />
          {{ report ? t('重新生成', 'Regenerate') : t('生成报告', 'Generate report') }}
        </Button>
      </div>
    </template>
    <div class="px-5 py-5">

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
          <p class="text-control font-medium">{{ t('可分享训练报告', 'Shareable training report') }}</p>
          <Badge :variant="report.report.verified ? 'secondary' : 'outline'">
            {{ report.report.verified ? t('平台已验证', 'Platform verified') : t('尚未验证', 'Not yet verified') }}
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
          <p class="text-caption text-muted-foreground">{{ t('完成回合', 'Completed turns') }}</p>
          <p class="mt-1 font-mono text-control">{{ report.report.stats.completedTurns }}</p>
        </div>
        <div class="rounded-md bg-background px-3 py-2">
          <p class="text-caption text-muted-foreground">{{ t('工具调用', 'Tool calls') }}</p>
          <p class="mt-1 font-mono text-control">{{ report.report.stats.toolCalls }}</p>
        </div>
        <div class="rounded-md bg-background px-3 py-2">
          <p class="text-caption text-muted-foreground">{{ t('实验', 'Experiments') }}</p>
          <p class="mt-1 font-mono text-control">{{ report.report.stats.experiments }}</p>
        </div>
        <div class="rounded-md bg-background px-3 py-2">
          <p class="text-caption text-muted-foreground">{{ t('用户独立步骤', 'Independent user steps') }}</p>
          <p class="mt-1 font-mono text-control">{{ report.report.stats.independentSteps }}</p>
        </div>
      </div>

      <p class="mt-4 truncate rounded-md border border-border bg-background px-3 py-2 font-mono text-caption text-muted-foreground">
        {{ report.markdownPath }}
      </p>
      <details class="mt-3 overflow-hidden rounded-md border border-border bg-background">
        <summary class="cursor-pointer px-3 py-2 text-caption font-medium">
          {{ t('预览报告', 'Preview report') }}
        </summary>
        <MarkdownContent
          class="max-h-80 overflow-y-auto border-t border-border px-4 py-4 text-caption leading-5"
          :content="report.report.markdown"
        />
      </details>
      <div class="mt-3 flex flex-wrap gap-2">
        <Button variant="outline" size="sm" @click="copy(report.report.markdown, t('Markdown 报告', 'Markdown report'))">
          <ClipboardCopy class="size-4" />
          {{ t('复制 Markdown', 'Copy Markdown') }}
        </Button>
        <Button variant="ghost" size="sm" @click="copy(report.markdownPath, t('报告路径', 'Report path'))">
          <ClipboardCopy class="size-4" />
          {{ t('复制路径', 'Copy path') }}
        </Button>
      </div>
    </div>

    <div v-if="replayOpen && replay" class="mt-5 border-t border-border pt-5">
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <p class="text-control font-medium">{{ t('PI 逐事件回放', 'PI event-by-event replay') }}</p>
          <Badge variant="outline">{{ t(`${replay.events.length} 个事件`, `${replay.events.length} events`) }}</Badge>
          <Badge v-if="replay.truncated" variant="secondary">{{ t('后端已截断', 'Truncated by backend') }}</Badge>
        </div>
        <p class="text-caption text-muted-foreground">
          {{ t(`${replay.metrics.toolCalls} 次工具调用 · ${replay.metrics.toolErrors} 次错误`, `${replay.metrics.toolCalls} tool calls · ${replay.metrics.toolErrors} errors`) }}
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
            <Badge v-if="event.truncated" variant="secondary">{{ t('内容已截断', 'Content truncated') }}</Badge>
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
            ? t('只看最近 6 个事件', 'Show last 6 events')
            : t(`查看最近 ${Math.min(100, replay.events.length)} 个事件`, `View last ${Math.min(100, replay.events.length)} events`)
        }}
      </Button>
      <p v-if="replayExpanded && replay.events.length > 100" class="mt-2 text-caption text-muted-foreground">
        {{ t('为避免界面卡顿，这里只展示最近 100 个事件；完整轨迹仍保存在本机证据目录。', 'To keep the UI responsive, only the last 100 events are shown here; the full trajectory remains in the local evidence directory.') }}
      </p>
    </div>
    </div>
  </SettingsSection>
</template>
