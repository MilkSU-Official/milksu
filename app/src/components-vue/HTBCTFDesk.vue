<script setup lang="ts">
import { computed } from 'vue'
import { Badge, Button } from '@felinic/ui'
import {
  Check,
  Clock3,
  Download,
  ExternalLink,
  KeyRound,
  LoaderCircle,
  Play,
  RefreshCw,
  Server,
  Trophy,
} from 'lucide-vue-next'
import CTFCollaborationModePicker from '@/components-vue/CTFCollaborationModePicker.vue'
import MarkdownContent from '@/components-vue/MarkdownContent.vue'
import type { HTBCTFDetails, HTBCTFEvent } from '@/ctfPlatformTypes'
import type { CTFCollaborationMode } from '@/ctfTypes'

const props = defineProps<{
  configured: boolean
  modelVerified: boolean
  events: HTBCTFEvent[]
  details: HTBCTFDetails | null
  selectedEventId: number | null
  loading: boolean
  starting: boolean
  collaborationMode: CTFCollaborationMode
  error: string | null
}>()

const emit = defineEmits<{
  connect: []
  refresh: []
  selectEvent: [id: number]
  startChallenge: [id: number]
  openOfficial: []
  'update:collaborationMode': [value: CTFCollaborationMode]
}>()

const selectedEvent = computed(() => (
  props.events.find(event => event.id === props.selectedEventId) ?? null
))
const eventPlayable = computed(() => Boolean(
  selectedEvent.value?.hasJoined || selectedEvent.value?.canPlay,
))

function eventStatusLabel(event: HTBCTFEvent) {
  const status = event.status?.toLowerCase()
  if (status === 'ongoing') return '进行中'
  if (status === 'upcoming') return '即将开始'
  if (status === 'ended' || status === 'finished') return '已结束'
  return event.status || '状态未知'
}

function challengeCategory(value: string) {
  const labels: Record<string, string> = {
    '1': 'Web',
    '2': 'Pwn',
    '3': 'Crypto',
    '4': 'Reverse',
    '5': 'Forensics',
    '6': 'Misc',
    '7': 'Fullpwn',
  }
  return (labels[value] ?? value) || 'Misc'
}
</script>

<template>
  <section class="flex h-full min-h-0 flex-col bg-background" aria-labelledby="htb-ctf-title">
    <div class="flex shrink-0 items-center justify-between gap-4 border-b border-border px-6 py-4">
      <div>
        <div class="flex items-center gap-2">
          <h2 id="htb-ctf-title" class="text-label font-semibold">Hack The Box CTF</h2>
          <Badge variant="secondary">官方 MCP</Badge>
        </div>
        <p class="mt-1 text-caption text-muted-foreground">赛事、题目、实例与 Judge 共用 MilkSU 训练工作流</p>
      </div>
      <div class="flex items-center gap-2">
        <Button variant="ghost" size="sm" @click="emit('openOfficial')">
          <ExternalLink class="size-4" />
          官方 CTF
        </Button>
        <Button
          v-if="configured"
          variant="outline"
          size="sm"
          :loading="loading"
          @click="emit('refresh')"
        >
          <RefreshCw class="size-4" />
          刷新
        </Button>
      </div>
    </div>

    <div v-if="!configured" class="grid min-h-0 flex-1 place-items-center px-6 py-10">
      <div class="max-w-lg rounded-xl border border-border bg-card p-7 text-center">
        <span class="mx-auto grid size-11 place-items-center rounded-lg bg-primary/10 text-primary">
          <KeyRound class="size-5" />
        </span>
        <h3 class="mt-5 text-xl font-semibold tracking-[-0.025em]">连接你的 HTB CTF</h3>
        <p class="mt-2 text-body leading-6 text-muted-foreground">
          在 HTB Profile Settings → MCP Access 生成 Token。MilkSU 只把它发给 HTB 官方 MCP，
          并保存在用户目录下的本机 SQLite 凭据库。
        </p>
        <div class="mt-6 flex justify-center gap-3">
          <Button @click="emit('connect')">
            <KeyRound class="size-4" />
            配置 HTB Token
          </Button>
          <Button variant="outline" @click="emit('openOfficial')">
            <ExternalLink class="size-4" />
            打开 HTB
          </Button>
        </div>
      </div>
    </div>

    <div v-else-if="error" class="grid min-h-0 flex-1 place-items-center px-6 py-10">
      <div class="max-w-lg rounded-xl border border-destructive/30 bg-card p-7 text-center">
        <p class="text-control font-medium">暂时无法读取 HTB CTF</p>
        <p class="mt-2 text-caption leading-5 text-muted-foreground">{{ error }}</p>
        <div class="mt-5 flex justify-center gap-2">
          <Button variant="outline" @click="emit('refresh')">
            <RefreshCw class="size-4" />
            重试
          </Button>
          <Button variant="ghost" @click="emit('connect')">检查 Token</Button>
        </div>
      </div>
    </div>

    <div v-else class="grid min-h-0 flex-1 lg:grid-cols-[320px_minmax(0,1fr)]">
      <aside class="min-h-0 overflow-y-auto border-r border-border" aria-label="HTB CTF 赛事">
        <div v-if="loading && !events.length" class="grid min-h-48 place-items-center">
          <LoaderCircle class="size-5 animate-spin text-muted-foreground" />
        </div>
        <button
          v-for="event in events"
          :key="event.id"
          type="button"
          class="w-full border-b border-l-2 border-border px-5 py-4 text-left transition-colors hover:bg-muted/40 focus:outline-none focus-visible:bg-muted/60"
          :class="selectedEventId === event.id
            ? 'border-l-brand bg-brand-soft/60'
            : 'border-l-transparent'"
          :aria-pressed="selectedEventId === event.id"
          @click="emit('selectEvent', event.id)"
        >
          <span class="flex items-start justify-between gap-3">
            <span class="min-w-0">
              <span class="block truncate text-control font-medium">{{ event.name }}</span>
              <span class="mt-1 flex items-center gap-1.5 text-caption text-muted-foreground">
                <Clock3 class="size-3.5" />
                {{ eventStatusLabel(event) }}
              </span>
            </span>
            <Badge v-if="event.hasJoined" variant="outline">已加入</Badge>
            <Badge v-else-if="event.canPlay" variant="secondary">可参加</Badge>
          </span>
        </button>
        <div v-if="!loading && !events.length" class="px-6 py-10 text-center">
          <Trophy class="mx-auto size-5 text-muted-foreground" />
          <p class="mt-3 text-control font-medium">暂无可见赛事</p>
          <p class="mt-1 text-caption text-muted-foreground">稍后刷新，或先在 HTB CTF 加入一场赛事。</p>
        </div>
      </aside>

      <div class="min-h-0 overflow-y-auto p-6 lg:p-8">
        <div v-if="loading && !details" class="grid min-h-64 place-items-center">
          <LoaderCircle class="size-5 animate-spin text-muted-foreground" />
        </div>
        <template v-else-if="details">
          <div class="flex flex-wrap items-start justify-between gap-5">
            <div>
              <p class="font-mono text-caption text-muted-foreground">HTB CTF · #{{ details.id }}</p>
              <h3 class="mt-2 text-2xl font-semibold tracking-[-0.035em]">{{ details.name }}</h3>
              <MarkdownContent
                v-if="details.description"
                class="mt-2 max-w-3xl text-body leading-6 text-muted-foreground"
                :content="details.description"
              />
            </div>
            <div class="flex flex-col items-end gap-3">
              <Badge variant="outline">{{ details.status || '赛事' }}</Badge>
              <CTFCollaborationModePicker
                :model-value="collaborationMode"
                @update:model-value="emit('update:collaborationMode', $event)"
              />
            </div>
          </div>

          <div class="mt-7 overflow-hidden rounded-xl border border-border bg-card">
            <div class="grid grid-cols-[minmax(0,1fr)_100px_90px_90px_140px] gap-3 border-b border-border bg-muted/30 px-4 py-2.5 text-caption text-muted-foreground">
              <span>题目</span>
              <span>类型</span>
              <span>难度</span>
              <span>状态</span>
              <span class="text-right">操作</span>
            </div>
            <div
              v-for="challenge in details.challenges"
              :key="challenge.id"
              class="grid min-h-[76px] grid-cols-[minmax(0,1fr)_100px_90px_90px_140px] items-center gap-3 border-b border-border px-4 last:border-b-0"
            >
              <span class="min-w-0">
                <span class="flex items-center gap-2">
                  <span class="truncate text-control font-medium">{{ challenge.name }}</span>
                  <Server v-if="challenge.hasContainer" class="size-3.5 shrink-0 text-primary" aria-label="有实例" />
                  <Download v-if="challenge.hasDownload" class="size-3.5 shrink-0 text-muted-foreground" aria-label="有附件" />
                </span>
                <span class="mt-1 block font-mono text-caption text-muted-foreground">
                  #{{ challenge.id }} · {{ challenge.points }} pts
                </span>
              </span>
              <span class="truncate text-caption">{{ challengeCategory(challenge.category) }}</span>
              <span class="text-caption text-muted-foreground">{{ challenge.difficulty || '待定' }}</span>
              <span class="flex items-center gap-1.5 text-caption" :class="challenge.solved ? 'text-success' : 'text-muted-foreground'">
                <Check v-if="challenge.solved" class="size-3.5" />
                {{ challenge.solved ? '已完成' : '未开始' }}
              </span>
              <Button
                size="sm"
                :variant="modelVerified && eventPlayable ? 'brand' : 'outline'"
                :loading="starting"
                :disabled="starting || (!eventPlayable && modelVerified)"
                @click="modelVerified
                  ? emit('startChallenge', challenge.id)
                  : emit('connect')"
              >
                <Play class="size-3.5" />
                {{
                  !modelVerified
                    ? '配置模型'
                    : !eventPlayable
                      ? '先加入赛事'
                      : challenge.solved
                        ? '再次训练'
                        : '用 Agent 开始'
                }}
              </Button>
            </div>
            <div v-if="!details.challenges.length" class="px-6 py-10 text-center text-caption text-muted-foreground">
              这场赛事暂时没有可见题目。
            </div>
          </div>

          <div
            v-if="selectedEvent && !eventPlayable"
            class="mt-5 flex items-start gap-3 rounded-lg border border-border bg-muted/30 px-4 py-3"
          >
            <Play class="mt-0.5 size-4 shrink-0 text-primary" />
            <div class="min-w-0 flex-1">
              <p class="text-caption leading-5 text-muted-foreground">
                先在 HTB 官方 CTF 页面加入这场赛事；加入后刷新，MilkSU 才会启动实例、导入附件并建立工作台。
              </p>
              <Button variant="link" size="text" class="mt-1" @click="emit('openOfficial')">
                去 HTB 加入赛事
                <ExternalLink class="size-3.5" />
              </Button>
            </div>
          </div>
        </template>
      </div>
    </div>
  </section>
</template>
