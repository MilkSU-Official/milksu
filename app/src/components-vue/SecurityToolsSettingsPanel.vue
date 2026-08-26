<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Button, Switch } from '@felinic/ui'
import {
  Binary,
  Bot,
  Braces,
  Check,
  ChevronDown,
  ChevronUp,
  Circle,
  FileSearch,
  Network,
  RefreshCw,
  ScanSearch,
  TerminalSquare,
  Wrench,
  X,
} from 'lucide-vue-next'
import { invokeCommand, listenEvent } from '@/desktop'
import { t } from '@/lib/uiLocale'
import type {
  SecurityToolCodingHandoff,
  SecurityToolSetupSnapshot,
  SecurityToolSnapshot,
} from '@/securityToolsTypes'

const emit = defineEmits<{
  codingHandoff: [handoff: SecurityToolCodingHandoff]
}>()

const tools = ref<SecurityToolSnapshot[]>([])
const selectedID = ref('ida-pro')
const loading = ref(true)
const checking = ref(false)
const actionBusy = ref(false)
const schemaOpen = ref(false)
const setup = ref<SecurityToolSetupSnapshot | null>(null)
const error = ref('')
let unlistenSetup: (() => void) | undefined

const selectedTool = computed(() => (
  tools.value.find(tool => tool.id === selectedID.value) ?? tools.value[0]
))
const configuring = computed(() => (
  setup.value?.toolId === selectedTool.value?.id && setup.value.state === 'running'
))
const iconFor = (id: string) => ({
  'ida-pro': Binary,
  capa: ScanSearch,
  codeql: Braces,
  'burp-suite': Network,
  shannon: Bot,
}[id] ?? Wrench)

function toneFor(tool: SecurityToolSnapshot) {
  if (tool.usableByAgent) return 'ready'
  if (tool.status === 'detected' || tool.status === 'configuring') return 'attention'
  if (tool.status === 'failed') return 'error'
  return 'idle'
}

async function loadTools() {
  loading.value = true
  error.value = ''
  try {
    tools.value = await invokeCommand<SecurityToolSnapshot[]>('list_security_tools')
    if (!tools.value.some(tool => tool.id === selectedID.value) && tools.value[0]) {
      selectedID.value = tools.value[0].id
    }
  } catch (reason) {
    error.value = t(`无法检测本机工具：${String(reason)}`, `Could not detect local tools: ${String(reason)}`)
  } finally {
    loading.value = false
  }
}

async function selectTool(id: string) {
  selectedID.value = id
  schemaOpen.value = false
  error.value = ''
  try {
    const current = await invokeCommand<SecurityToolSetupSnapshot>('get_security_tool_setup', { id })
    setup.value = current.state === 'idle' ? null : current
  } catch {
    setup.value = null
  }
}

async function setEnabled(enabled: boolean) {
  const tool = selectedTool.value
  if (!tool) return
  actionBusy.value = true
  error.value = ''
  try {
    await invokeCommand('set_security_tool_enabled', { id: tool.id, enabled })
    tools.value = tools.value.map(item => item.id === tool.id
      ? { ...item, enabled, usableByAgent: enabled && item.status === 'ready' && item.codingSupported }
      : item)
  } catch (reason) {
    error.value = t(`无法更新工具：${String(reason)}`, `Could not update tool: ${String(reason)}`)
  } finally {
    actionBusy.value = false
  }
}

async function startSetup() {
  const tool = selectedTool.value
  if (!tool?.setupSupported) return
  actionBusy.value = true
  error.value = ''
  try {
    setup.value = await invokeCommand<SecurityToolSetupSnapshot>('start_security_tool_setup', { id: tool.id })
  } catch (reason) {
    error.value = t(`无法开始配置：${String(reason)}`, `Could not start setup: ${String(reason)}`)
  } finally {
    actionBusy.value = false
  }
}

async function checkTool() {
  const tool = selectedTool.value
  if (!tool) return
  checking.value = true
  error.value = ''
  try {
    const checked = await invokeCommand<SecurityToolSnapshot>('check_security_tool', { id: tool.id })
    tools.value = tools.value.map(item => item.id === checked.id ? checked : item)
    if (checked.status === 'ready') setup.value = null
  } catch (reason) {
    error.value = t(`健康检查失败：${String(reason)}`, `Health check failed: ${String(reason)}`)
  } finally {
    checking.value = false
  }
}

async function openCodingSetup() {
  const tool = selectedTool.value
  if (!tool) return
  actionBusy.value = true
  error.value = ''
  try {
    const handoff = await invokeCommand<SecurityToolCodingHandoff>(
      'prepare_security_tool_coding_handoff',
      { id: tool.id },
    )
    emit('codingHandoff', handoff)
  } catch (reason) {
    error.value = t(`无法准备 Coding 任务：${String(reason)}`, `Could not prepare Coding task: ${String(reason)}`)
  } finally {
    actionBusy.value = false
  }
}

onMounted(async () => {
  unlistenSetup = await listenEvent<SecurityToolSetupSnapshot>('security-tool-setup', event => {
    if (event.payload.toolId !== selectedID.value) return
    setup.value = event.payload
    if (event.payload.state === 'completed' || event.payload.state === 'failed') {
      void loadTools()
    }
  })
  await loadTools()
  await selectTool(selectedID.value)
})

onBeforeUnmount(() => unlistenSetup?.())
</script>

<template>
  <section class="security-tools-panel" :aria-label="t('本机安全工具', 'Local security tools')">
    <div class="mb-6 flex items-start justify-between gap-5">
      <div>
        <p class="text-control text-muted-foreground">{{ t('本机安全工具', 'Local security tools') }}</p>
      </div>
      <Button variant="ghost" size="sm" :loading="loading" @click="loadTools">
        <RefreshCw class="size-3.5" />{{ t('重新检测', 'Recheck') }}
      </Button>
    </div>

    <div v-if="error" class="mb-4 rounded-[8px] border border-destructive/45 bg-destructive/10 px-4 py-3 text-caption text-destructive">
      {{ error }}
    </div>

    <div v-if="loading && !tools.length" class="grid min-h-[34rem] place-items-center rounded-[8px] border border-border text-control text-muted-foreground">
      {{ t('正在检测本机工具', 'Detecting local tools') }}
    </div>

    <div v-else-if="selectedTool" class="tool-workbench grid min-h-[39rem] grid-cols-[minmax(18rem,0.8fr)_minmax(28rem,1.2fr)] overflow-hidden rounded-[8px] border border-border">
      <nav class="border-r border-border" :aria-label="t('安全工具目录', 'Security tools')">
        <button
          v-for="tool in tools"
          :key="tool.id"
          type="button"
          class="tool-row"
          :class="tool.id === selectedID ? 'is-selected' : ''"
          :aria-current="tool.id === selectedID ? 'true' : undefined"
          :data-testid="`security-tool-${tool.id}`"
          @click="selectTool(tool.id)"
        >
          <span class="tool-icon"><component :is="iconFor(tool.id)" class="size-5" /></span>
          <span class="min-w-0 flex-1 text-left">
            <strong class="block truncate text-base font-semibold">{{ tool.name }}</strong>
            <small class="mt-0.5 block truncate text-caption text-muted-foreground">{{ tool.purpose }}</small>
          </span>
          <span class="tool-status" :data-tone="toneFor(tool)">{{ tool.statusLabel }}</span>
        </button>
      </nav>

      <article v-if="configuring" class="min-w-0 px-9 py-7" aria-live="polite">
        <header class="border-b border-border pb-5">
          <p class="tactical-label text-primary">{{ t('正在准备', 'Preparing') }}</p>
          <h2 class="tactical-display mt-1 text-4xl">{{ selectedTool.name }}</h2>
          <p class="mt-2 text-control text-muted-foreground">{{ setup?.summary }}</p>
        </header>

        <div class="pt-7">
          <div class="flex items-center gap-4">
            <div class="h-1.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div class="h-full bg-primary transition-[width] duration-300" :style="{ width: `${setup?.percent ?? 0}%` }" />
            </div>
            <span class="w-11 text-right font-mono text-sm text-primary">{{ setup?.percent ?? 0 }}%</span>
          </div>

          <ol class="mt-8 space-y-0">
            <li v-for="(step, index) in setup?.steps ?? []" :key="step.id" class="relative flex min-h-20 gap-4">
              <div v-if="index < (setup?.steps?.length ?? 0) - 1" class="absolute left-[13px] top-7 h-[calc(100%-0.2rem)] w-px bg-border" />
              <span
                class="relative z-10 grid size-7 shrink-0 place-items-center rounded-full border bg-background"
                :class="step.status === 'completed' ? 'border-primary text-primary' : step.status === 'running' ? 'border-primary text-primary shadow-[0_0_14px_color-mix(in_srgb,var(--brand)_35%,transparent)]' : step.status === 'failed' ? 'border-destructive text-destructive' : 'border-border text-muted-foreground'"
              >
                <Check v-if="step.status === 'completed'" class="size-4" />
                <X v-else-if="step.status === 'failed'" class="size-3.5" />
                <span v-else-if="step.status === 'running'" class="size-2 animate-pulse rounded-full bg-primary" />
                <span v-else class="font-mono text-[10px]">{{ index + 1 }}</span>
              </span>
              <div class="pb-5">
                <p class="text-control font-medium">{{ step.label }}</p>
                <p class="mt-1 text-caption text-muted-foreground">{{ step.detail || (step.status === 'pending' ? t('等待中', 'Waiting') : t('进行中', 'Running')) }}</p>
              </div>
            </li>
          </ol>


        </div>
      </article>

      <article v-else class="min-w-0 px-9 py-7" data-testid="security-tool-detail">
        <header class="flex items-start justify-between gap-5 border-b border-border pb-5">
          <div class="min-w-0">
            <h2 class="tactical-display text-4xl">{{ selectedTool.name }}</h2>
            <p class="mt-1 text-control text-muted-foreground">{{ selectedTool.purpose }}</p>
          </div>
          <div class="flex shrink-0 items-center gap-4 pt-1">
            <span class="tool-status text-control" :data-tone="toneFor(selectedTool)">{{ selectedTool.statusLabel }}</span>
            <Switch
              :model-value="selectedTool.enabled"
              :disabled="actionBusy"
              :aria-label="t(`允许 Coding 自动使用 ${selectedTool.name}`, `Allow Coding to use ${selectedTool.name} automatically`)"
              @update:model-value="setEnabled(Boolean($event))"
            />
          </div>
        </header>

        <dl class="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-6 gap-y-3 border-b border-border py-5 text-control">
          <dt>{{ t('连接', 'Connection') }}</dt><dd>{{ selectedTool.connection }}</dd>
          <dt>{{ t('版本', 'Version') }}</dt><dd>{{ selectedTool.version || t('待检测', 'Pending') }}</dd>
          <dt>{{ t('模型调用', 'Model use') }}</dt><dd>{{ selectedTool.usableByAgent ? t('已加入自动能力目录', 'Added to auto-capability catalog') : t('尚未加入能力目录', 'Not in capability catalog') }}</dd>
          <dt>{{ t('运行方式', 'Runtime') }}</dt><dd>{{ selectedTool.runtime }}</dd>
        </dl>

        <section class="py-5" aria-labelledby="security-tool-capabilities">
          <h3 id="security-tool-capabilities" class="text-base font-semibold">{{ t('能力', 'Capabilities') }}</h3>
          <div class="mt-4 grid gap-3.5">
            <div v-for="capability in selectedTool.capabilities" :key="capability" class="flex items-center gap-3 text-control">
              <span class="grid size-5 place-items-center rounded-[8px] border border-border text-primary">
                <Check v-if="selectedTool.usableByAgent" class="size-3.5" />
                <Circle v-else class="size-2 fill-current" />
              </span>
              <span>{{ capability }}</span>
            </div>
          </div>
        </section>

        <div v-if="selectedTool.problem" class="border border-info-border px-4 py-3 text-caption leading-5 text-info">
          {{ selectedTool.problem }}
        </div>

        <div class="mt-7 flex flex-wrap items-center gap-3">
          <Button
            v-if="selectedTool.setupSupported && selectedTool.status !== 'ready'"
            variant="outline"
            class="border-primary/60 text-primary hover:bg-primary/10"
            :loading="actionBusy"
            @click="startSetup"
          >
            <Wrench class="size-4" />{{ selectedTool.primaryAction || t('开始准备', 'Start setup') }}
          </Button>
          <Button
            v-if="selectedTool.codingSupported && selectedTool.status !== 'ready'"
            variant="outline"
            :disabled="actionBusy"
            @click="openCodingSetup"
          >
            <TerminalSquare class="size-4" />{{ t('在 Coding 中配置', 'Configure in Coding') }}
          </Button>
          <Button variant="ghost" :loading="checking" @click="checkTool">
            <RefreshCw class="size-4" />{{ t('运行健康检查', 'Run health check') }}
          </Button>
          <Button variant="ghost" @click="schemaOpen = !schemaOpen">
            <FileSearch class="size-4" />
            {{ schemaOpen ? t('收起工具 Schema', 'Hide tool schema') : t('查看工具 Schema', 'View tool schema') }}
            <ChevronUp v-if="schemaOpen" class="size-3.5" />
            <ChevronDown v-else class="size-3.5" />
          </Button>
        </div>

        <section v-if="schemaOpen" class="mt-5 rounded-[8px] border border-border bg-muted/30 px-4 py-3" :aria-label="t('工具 Schema 摘要', 'Tool schema summary')">
          <code class="block whitespace-pre-wrap text-caption leading-6 text-muted-foreground">{{ selectedTool.schema.join('\n') }}</code>
        </section>
      </article>
    </div>
  </section>
</template>

<style scoped>
.tool-row { position: relative; display: flex; min-height: 5.8rem; width: calc(100% - 1rem); align-items: center; gap: 1rem; margin: 0.15rem 0.5rem; border: 0; border-radius: 8px; background: transparent; padding: 1rem 1.1rem; color: hsl(var(--foreground)); cursor: pointer; }
.tool-row:hover { background: var(--hover-2); }
.tool-row.is-selected { background: var(--hover-2); box-shadow: none; }
.tool-icon { display: grid; width: 2.8rem; height: 2.8rem; flex: 0 0 auto; place-items: center; border: 1px solid hsl(var(--border)); border-radius: 8px; color: hsl(var(--foreground)); }
.tool-row.is-selected .tool-icon { border-color: var(--border); color: var(--foreground); }
.tool-status { flex: 0 0 auto; font-size: .77rem; font-weight: 650; }
.tool-status[data-tone='ready'] { color: var(--brand); }
.tool-status[data-tone='attention'] { color: hsl(var(--warning)); }
.tool-status[data-tone='error'] { color: hsl(var(--destructive)); }
.tool-status[data-tone='idle'] { color: hsl(var(--muted-foreground)); }
dl dt { color: hsl(var(--muted-foreground)); }
dl dd { min-width: 0; color: hsl(var(--foreground)); }
@media (max-width: 1050px) { .tool-workbench { grid-template-columns: minmax(15rem, .72fr) minmax(24rem, 1.28fr); } }
@media (max-width: 860px) { .tool-workbench { grid-template-columns: 1fr; } .tool-workbench > nav { border-right: 0; border-bottom: 1px solid hsl(var(--border)); } }
</style>
