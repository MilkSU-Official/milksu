<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Alert,
  AlertDescription,
  Badge,
  Button,
} from '@felinic/ui'
import {
  ArrowRight,
  BadgeCheck,
  Bot,
  Box,
  Check,
  ChevronRight,
  Circle,
  Container,
  LoaderCircle,
  ExternalLink,
  Copy,
  KeyRound,
  RotateCcw,
  ShieldCheck,
  Wrench,
} from 'lucide-vue-next'
import { managedLabPresentation } from '@/lib/managedLabs'
import type {
  ManagedLabAccess,
  ManagedLabActionKind,
  ManagedLabDefinition,
} from '@/ctfLabTypes'

const props = withDefaults(defineProps<{
  labs: readonly ManagedLabDefinition[]
  selectedLabId?: string | null
  busy?: boolean
  notice?: string
  access?: ManagedLabAccess | null
}>(), {
  selectedLabId: null,
  busy: false,
  notice: '',
  access: null,
})

const emit = defineEmits<{
  select: [labId: string]
  requestSetup: [labId: string]
  requestStart: [labId: string]
  openWorkspace: [labId: string]
  requestReset: [labId: string]
  requestStop: [labId: string]
  requestDestroy: [labId: string]
  startTraining: [labId: string]
  checkTraining: [labId: string]
  requestAccess: [labId: string]
}>()

const accessCopied = ref(false)

const selectedLab = computed(() => (
  props.labs.find(lab => lab.id === props.selectedLabId)
  ?? props.labs[0]
  ?? null
))

const selectedPresentation = computed(() => (
  selectedLab.value
    ? managedLabPresentation(selectedLab.value.lifecycle)
    : null
))

const runningCount = computed(() => (
  props.labs.filter(lab => lab.lifecycle === 'running').length
))

watch(() => props.access, () => {
  accessCopied.value = false
})

async function copyAccess() {
  if (!props.access) return
  await navigator.clipboard.writeText(
    `用户名：${props.access.username}\n密码：${props.access.password}`,
  )
  accessCopied.value = true
}

function statusClass(tone: ReturnType<typeof managedLabPresentation>['statusTone']) {
  switch (tone) {
    case 'brand': return 'text-primary'
    case 'warning': return 'text-warning-foreground'
    case 'danger': return 'text-destructive'
    default: return 'text-muted-foreground'
  }
}

function runPrimaryAction(kind: ManagedLabActionKind) {
  if (!selectedLab.value || props.busy) return
  switch (kind) {
    case 'setup':
    case 'retry':
      emit('requestSetup', selectedLab.value.id)
      break
    case 'destroy':
      emit('requestDestroy', selectedLab.value.id)
      break
    case 'start':
      emit('requestStart', selectedLab.value.id)
      break
    case 'open':
      emit('openWorkspace', selectedLab.value.id)
      break
    case 'train':
      emit('startTraining', selectedLab.value.id)
      break
  }
}
</script>

<template>
  <section class="h-full overflow-y-auto px-6 py-8" aria-labelledby="managed-labs-title">
    <div class="mx-auto max-w-5xl">
      <div class="flex flex-wrap items-end justify-between gap-4 border-b border-border pb-6">
        <div>
          <h2 id="managed-labs-title" class="text-2xl font-semibold tracking-[-0.035em]">
            选择一个本地靶场
          </h2>
          <p class="mt-2 max-w-2xl text-body leading-6 text-muted-foreground">
            MilkSU 负责准备隔离环境；确认环境就绪后，你再决定是否让 Agent 进入。
          </p>
        </div>
        <div class="flex items-center gap-2 text-caption text-muted-foreground">
          <Circle
            class="size-2.5 fill-current"
            :class="runningCount ? 'text-primary' : ''"
          />
          {{ runningCount ? `${runningCount} 个环境运行中` : '暂无环境在运行' }}
        </div>
      </div>

      <div v-if="labs.length" class="grid gap-8 py-7 lg:grid-cols-[minmax(260px,0.8fr)_minmax(0,1.2fr)]">
        <nav class="space-y-2" aria-label="本地靶场目录">
          <button
            v-for="lab in labs"
            :key="lab.id"
            type="button"
            class="group flex w-full items-center gap-4 rounded-lg border px-4 py-4 text-left transition-colors"
            :class="lab.id === selectedLab?.id
              ? 'border-primary/50 bg-primary/5'
              : 'border-transparent hover:border-border hover:bg-muted/30'"
            :aria-current="lab.id === selectedLab?.id ? 'true' : undefined"
            @click="emit('select', lab.id)"
          >
            <span
              class="grid size-10 shrink-0 place-items-center rounded-md"
              :class="lab.id === selectedLab?.id
                ? 'bg-primary/15 text-primary'
                : 'bg-muted text-muted-foreground'"
            >
              <Container class="size-5" />
            </span>
            <span class="min-w-0 flex-1">
              <span class="flex items-center justify-between gap-3">
                <span class="truncate text-control font-medium">{{ lab.name }}</span>
                <span
                  class="shrink-0 text-caption"
                  :class="statusClass(managedLabPresentation(lab.lifecycle).statusTone)"
                >
                  {{ managedLabPresentation(lab.lifecycle).statusLabel }}
                </span>
              </span>
              <span class="mt-1 block truncate text-caption text-muted-foreground">
                {{ lab.difficulty }} · {{ lab.categories.join(' / ') }}
              </span>
            </span>
            <ChevronRight class="size-4 shrink-0 text-muted-foreground group-hover:text-foreground" />
          </button>
        </nav>

        <article v-if="selectedLab && selectedPresentation" class="min-w-0 lg:border-l lg:border-border lg:pl-8">
          <div class="flex flex-wrap items-start justify-between gap-4">
            <div class="min-w-0">
              <p class="text-caption font-medium text-primary">{{ selectedLab.vendor }}</p>
              <h3 class="mt-2 text-2xl font-semibold tracking-[-0.035em]">{{ selectedLab.name }}</h3>
            </div>
            <Badge variant="outline" :class="statusClass(selectedPresentation.statusTone)">
              {{ selectedPresentation.statusLabel }}
            </Badge>
          </div>

          <p class="mt-4 max-w-2xl text-body leading-6 text-muted-foreground">
            {{ selectedLab.summary }}
          </p>

          <div class="mt-6 border-y border-border py-4">
            <p class="text-caption font-medium text-primary">本次挑战</p>
            <p class="mt-1 text-control font-medium">{{ selectedLab.challenge }}</p>
          </div>

          <ol class="mt-7 grid gap-4 sm:grid-cols-3" aria-label="靶场使用流程">
            <li class="border-t border-border pt-4">
              <Wrench class="size-4 text-primary" />
              <p class="mt-3 text-control font-medium">准备环境</p>
              <p class="mt-1 text-caption leading-5 text-muted-foreground">
                检查 Docker 与固定版本镜像。
              </p>
            </li>
            <li class="border-t border-border pt-4">
              <ShieldCheck class="size-4 text-primary" />
              <p class="mt-3 text-control font-medium">本机隔离</p>
              <p class="mt-1 text-caption leading-5 text-muted-foreground">
                只暴露本机回环地址，可随时重置。
              </p>
            </li>
            <li class="border-t border-border pt-4">
              <Box class="size-4 text-primary" />
              <p class="mt-3 text-control font-medium">进入工作台</p>
              <p class="mt-1 text-caption leading-5 text-muted-foreground">
                环境就绪后再建立训练记录。
              </p>
            </li>
          </ol>

          <dl class="mt-7 flex flex-wrap gap-x-7 gap-y-3 border-b border-border pb-4 text-caption">
            <div class="flex items-center gap-2">
              <dt class="text-muted-foreground">运行方式</dt>
              <dd>{{ selectedLab.runtime }}</dd>
            </div>
            <div class="flex items-center gap-2">
              <dt class="text-muted-foreground">准备时间</dt>
              <dd>{{ selectedLab.startupEstimate }}</dd>
            </div>
            <div class="flex items-center gap-2">
              <dt class="text-muted-foreground">重置</dt>
              <dd class="flex items-center gap-1">
                <Check v-if="selectedLab.resettable" class="size-3.5 text-primary" />
                {{ selectedLab.resettable ? '支持' : '不支持' }}
              </dd>
            </div>
          </dl>

          <Alert v-if="notice" class="mt-5">
            <Circle class="size-4" />
            <AlertDescription>{{ notice }}</AlertDescription>
          </Alert>
          <Alert v-else-if="selectedLab.message" class="mt-5">
            <Circle class="size-4" />
            <AlertDescription>{{ selectedLab.message }}</AlertDescription>
          </Alert>

          <div
            v-if="access && access.instanceId === selectedLab.instanceId"
            class="mt-5 rounded-lg border border-primary/30 bg-primary/5 p-4"
            aria-live="polite"
          >
            <div class="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p class="flex items-center gap-2 text-control font-medium">
                  <KeyRound class="size-4 text-primary" />
                  当前实例的临时登录
                </p>
                <p class="mt-2 font-mono text-caption text-foreground">
                  {{ access.username }} · {{ access.password }}
                </p>
              </div>
              <Button size="sm" variant="outline" @click="copyAccess">
                <Check v-if="accessCopied" class="size-4 text-primary" />
                <Copy v-else class="size-4" />
                {{ accessCopied ? '已复制' : '复制' }}
              </Button>
            </div>
            <p class="mt-3 text-caption leading-5 text-muted-foreground">
              只对当前本机环境有效；重置或清理后立即失效。
            </p>
          </div>

          <div class="mt-6 flex flex-wrap items-center gap-3">
            <Button
              size="lg"
              :variant="selectedPresentation.actionKind === 'start' || selectedPresentation.actionKind === 'open'
                || selectedPresentation.actionKind === 'train'
                ? 'brand'
                : 'default'"
              :disabled="selectedPresentation.actionDisabled || busy"
              @click="runPrimaryAction(selectedPresentation.actionKind)"
            >
              <LoaderCircle v-if="busy || selectedPresentation.actionKind === 'wait'" class="size-4 animate-spin" />
              <RotateCcw v-else-if="selectedPresentation.actionKind === 'retry'" class="size-4" />
              <RotateCcw v-else-if="selectedPresentation.actionKind === 'destroy'" class="size-4" />
              <Wrench v-else-if="selectedPresentation.actionKind === 'setup'" class="size-4" />
              <Bot v-else-if="selectedPresentation.actionKind === 'train'" class="size-4" />
              <Container v-else class="size-4" />
              {{ selectedPresentation.actionLabel }}
              <ArrowRight
                v-if="!selectedPresentation.actionDisabled
                  && selectedPresentation.actionKind !== 'setup'
                  && selectedPresentation.actionKind !== 'retry'"
                class="size-4"
              />
            </Button>
            <template v-if="selectedLab.lifecycle === 'running' && selectedLab.instanceId">
              <Button
                variant="outline"
                :disabled="busy"
                @click="emit('openWorkspace', selectedLab.id)"
              >
                <ExternalLink class="size-4" />
                打开靶场
              </Button>
              <Button
                variant="outline"
                :disabled="busy"
                @click="emit('checkTraining', selectedLab.id)"
              >
                <BadgeCheck class="size-4" />
                验证完成
              </Button>
              <Button
                v-if="selectedLab.accessType"
                variant="outline"
                :disabled="busy"
                @click="emit('requestAccess', selectedLab.id)"
              >
                <KeyRound class="size-4" />
                登录信息
              </Button>
              <Button
                variant="outline"
                :disabled="busy"
                @click="emit('requestReset', selectedLab.id)"
              >
                <RotateCcw class="size-4" />
                重置
              </Button>
              <Button
                variant="ghost"
                :disabled="busy"
                @click="emit('requestStop', selectedLab.id)"
              >
                停止
              </Button>
            </template>
            <p class="text-caption leading-5 text-muted-foreground">
              {{
                selectedLab.agentAccess === 'supported'
                  ? 'Agent 只会获得本次环境的精确地址。'
                  : '启动后，Agent 只会获得本次环境的精确地址。'
              }}
            </p>
          </div>
        </article>
      </div>

      <div v-else class="py-20 text-center">
        <Container class="mx-auto size-7 text-muted-foreground" />
        <p class="mt-4 text-control font-medium">暂无本地靶场</p>
      </div>
    </div>
  </section>
</template>
