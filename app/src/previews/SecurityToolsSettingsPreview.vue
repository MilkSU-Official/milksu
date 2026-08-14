<script setup lang="ts">
import { computed, onBeforeUnmount, ref, type Component } from 'vue'
import { Button, Checkbox, Switch } from '@felinic/ui'
import {
  ArrowLeft,
  Binary,
  Bot,
  Braces,
  FileSearch,
  Info,
  Network,
  ScanSearch,
  ShieldCheck,
} from 'lucide-vue-next'
import AppSidebar from '@/components-vue/AppSidebar.vue'
import { applyThemeMode, nextThemeMode, type ThemeMode } from '@/lib/themeMode'
import type { AccountStatus } from '@/types'

type ToolId = 'ida' | 'burp' | 'capa' | 'codeql' | 'shannon'
type ToolTone = 'ready' | 'attention' | 'idle'
type HealthState = 'idle' | 'checking' | 'passed'

interface SecurityTool {
  id: ToolId
  name: string
  purpose: string
  icon: Component
  status: string
  tone: ToolTone
  available: boolean
  connection: string
  version: string
  permission: string
  runtime: string
  capabilities: string[]
  warning: string
  schema: string[]
}

const tools: SecurityTool[] = [
  {
    id: 'ida',
    name: 'IDA Pro',
    purpose: '交互式反汇编与二进制分析',
    icon: Binary,
    status: '可用',
    tone: 'ready',
    available: true,
    connection: 'idalib MCP',
    version: '9.1',
    permission: '只读分析 + 注释',
    runtime: '连接现有 IDA',
    capabilities: ['读取函数与反编译结果', '读取交叉引用', '重命名符号', '写入注释'],
    warning: '不会开放二进制补丁或任意脚本执行',
    schema: ['read.functions', 'read.xrefs', 'symbol.rename', 'comment.write'],
  },
  {
    id: 'burp',
    name: 'Burp Suite',
    purpose: 'Web 安全测试与代理抓包',
    icon: Network,
    status: '可用',
    tone: 'ready',
    available: true,
    connection: 'PortSwigger MCP',
    version: '2026.3',
    permission: '只读历史',
    runtime: '连接现有 Burp',
    capabilities: ['读取 Proxy 历史', '读取 Repeater 请求', '查看请求与响应', '引用到当前任务'],
    warning: '发送、扫描与配置修改需要准确目标和单独确认',
    schema: ['proxy.history.read', 'repeater.item.read', 'message.read', 'evidence.reference'],
  },
  {
    id: 'capa',
    name: 'capa',
    purpose: '识别二进制能力与行为特征',
    icon: ScanSearch,
    status: '可用',
    tone: 'ready',
    available: true,
    connection: '本地 CLI Adapter',
    version: '9.0',
    permission: '工作区只读',
    runtime: '本地受限进程',
    capabilities: ['识别能力规则', '输出匹配证据', '读取样本元数据', '保存分析报告'],
    warning: '只读取当前工作区内明确选择的样本',
    schema: ['capability.match', 'evidence.read', 'sample.metadata', 'report.write'],
  },
  {
    id: 'codeql',
    name: 'CodeQL',
    purpose: '代码查询与漏洞分析',
    icon: Braces,
    status: '未配置',
    tone: 'idle',
    available: false,
    connection: 'Taskflow CodeQL MCP',
    version: '待检测',
    permission: '工作区只读',
    runtime: '本地数据库',
    capabilities: ['创建分析数据库', '运行固定查询', '读取发现结果', '保存查询证据'],
    warning: '不上传仓库；执行查询前先固定工作区和数据库路径',
    schema: ['database.create', 'query.run', 'finding.read', 'evidence.write'],
  },
  {
    id: 'shannon',
    name: 'Shannon',
    purpose: '授权目标的安全任务 Worker',
    icon: Bot,
    status: '未配置',
    tone: 'idle',
    available: false,
    connection: '受管 Worker',
    version: '待固定',
    permission: '显式目标 Scope',
    runtime: '隔离容器',
    capabilities: ['检查 Worker 健康', '启动授权任务', '读取任务状态', '读取最终报告'],
    warning: '仅允许本地或明确授权目标，不接受任意公网目标',
    schema: ['worker.health', 'authorized_run.start', 'run.status', 'report.read'],
  },
]

const accountStatus: AccountStatus = {
  configured: false,
  authenticated: false,
  state: 'unconfigured',
}
const themeMode = ref<ThemeMode>('dark')
const selectedId = ref<ToolId>('ida')
const enabled = ref<Record<ToolId, boolean>>({
  ida: true,
  burp: true,
  capa: true,
  codeql: false,
  shannon: false,
})
const capabilityState = ref<Record<string, boolean>>({})
const schemaOpen = ref(false)
const healthState = ref<HealthState>('idle')
let healthTimer: ReturnType<typeof setTimeout> | undefined

for (const tool of tools) {
  for (const capability of tool.capabilities) {
    capabilityState.value[`${tool.id}:${capability}`] = false
  }
}

applyThemeMode(themeMode.value)

const selectedTool = computed(() => tools.find(tool => tool.id === selectedId.value) ?? tools[0])
const visibleStatus = computed(() => {
  if (healthState.value === 'checking') return '检测中'
  if (healthState.value === 'passed') return '正常'
  return selectedTool.value.status
})

function selectTool(id: ToolId) {
  selectedId.value = id
  schemaOpen.value = false
  healthState.value = 'idle'
  if (healthTimer) clearTimeout(healthTimer)
}

function setEnabled(value: boolean) {
  if (!selectedTool.value.available) return
  enabled.value[selectedTool.value.id] = value
}

function setCapability(capability: string, value: boolean) {
  capabilityState.value[`${selectedTool.value.id}:${capability}`] = value
}

function runHealthCheck() {
  if (!selectedTool.value.available || healthState.value === 'checking') return
  healthState.value = 'checking'
  healthTimer = setTimeout(() => {
    healthState.value = 'passed'
  }, 650)
}

function toggleTheme() {
  themeMode.value = nextThemeMode(themeMode.value)
  applyThemeMode(themeMode.value)
}

onBeforeUnmount(() => {
  if (healthTimer) clearTimeout(healthTimer)
})
</script>

<template>
  <div class="security-tools-prototype flex h-screen min-h-[720px] min-w-0 overflow-hidden bg-background text-foreground">
    <AppSidebar
      active-section="settings"
      :account-status="accountStatus"
      :active-conversation-id="null"
      :conversations="[]"
      ctf-section="catalog"
      :theme-mode="themeMode"
      @toggle-theme="toggleTheme"
    />

    <main class="settings-page tactical-page flex min-w-0 flex-1 flex-col bg-background">
      <header class="app-drag tactical-command-surface mx-3 mt-3 flex h-16 shrink-0 items-center px-5 text-white">
        <Button variant="ghost" size="icon-sm" class="app-no-drag mr-3" aria-label="返回">
          <ArrowLeft class="size-4" />
        </Button>
        <div>
          <p class="text-lg font-semibold tracking-[-0.02em]">设置</p>
          <p class="text-caption text-muted-foreground">应用、Coding、账户与本地数据</p>
        </div>
      </header>

      <div class="flex min-h-0 flex-1">
        <nav class="settings-nav settings-nav-surface tactical-dark-surface app-no-drag w-56 shrink-0 border-r px-3 py-5" aria-label="设置分类">
          <button v-for="label in ['通用', '模型与额度', 'Coding', '浏览器与控制', 'CVE']" :key="label" type="button" class="settings-nav-item">
            {{ label }}
          </button>
          <button type="button" class="settings-nav-item active" aria-current="page">安全工具</button>
        </nav>

        <section class="min-h-0 min-w-0 flex-1 overflow-y-auto px-7 py-8" aria-labelledby="security-tools-title">
          <div class="mx-auto w-full max-w-6xl">
            <header class="mb-7">
              <p class="tactical-label text-muted-foreground">Settings</p>
              <h1 id="security-tools-title" class="tactical-display mt-1 text-5xl">安全工具</h1>
              <p class="mt-2 text-control text-muted-foreground">连接、授权并检查本地安全能力</p>
            </header>

            <div class="tool-workbench grid min-h-[650px] grid-cols-[minmax(18rem,0.78fr)_minmax(25rem,1.22fr)] border-y border-border" data-testid="security-tool-workbench">
              <nav class="tool-index border-r border-border" aria-label="安全工具目录">
                <button
                  v-for="tool in tools"
                  :key="tool.id"
                  type="button"
                  class="tool-row tactical-row"
                  :class="tool.id === selectedId ? 'is-selected' : ''"
                  :aria-current="tool.id === selectedId ? 'true' : undefined"
                  :data-testid="`security-tool-${tool.id}`"
                  @click="selectTool(tool.id)"
                >
                  <span class="tool-icon" aria-hidden="true"><component :is="tool.icon" class="size-5" /></span>
                  <span class="min-w-0 flex-1 text-left">
                    <strong class="block truncate text-base font-semibold">{{ tool.name }}</strong>
                    <small class="mt-0.5 block truncate text-caption text-muted-foreground">{{ tool.purpose }}</small>
                  </span>
                  <span class="tool-status" :data-tone="tool.tone">{{ tool.status }}</span>
                </button>
              </nav>

              <article class="tool-detail min-w-0 px-9 py-7" :aria-labelledby="`tool-detail-${selectedTool.id}`" data-testid="security-tool-detail">
                <header class="flex items-start justify-between gap-5 border-b border-border pb-5">
                  <div class="min-w-0">
                    <h2 :id="`tool-detail-${selectedTool.id}`" class="tactical-display text-4xl">{{ selectedTool.name }}</h2>
                    <p class="mt-1 text-control text-muted-foreground">{{ selectedTool.purpose }}</p>
                  </div>
                  <div class="flex shrink-0 items-center gap-4 pt-1">
                    <span class="tool-status text-control" :data-tone="selectedTool.tone" aria-live="polite">{{ visibleStatus }}</span>
                    <Switch
                      :model-value="enabled[selectedTool.id]"
                      :disabled="!selectedTool.available"
                      :aria-label="`启用${selectedTool.name}`"
                      @update:model-value="setEnabled(Boolean($event))"
                    />
                  </div>
                </header>

                <dl class="tool-facts grid grid-cols-[7rem_minmax(0,1fr)] gap-x-6 gap-y-3 border-b border-border py-5 text-control">
                  <dt>连接</dt><dd>{{ selectedTool.connection }}</dd>
                  <dt>版本</dt><dd>{{ selectedTool.version }}</dd>
                  <dt>权限</dt><dd>{{ selectedTool.permission }}</dd>
                  <dt>运行方式</dt><dd>{{ selectedTool.runtime }}</dd>
                </dl>

                <section class="py-5" aria-labelledby="allowed-capabilities">
                  <h3 id="allowed-capabilities" class="text-base font-semibold">允许的能力</h3>
                  <div class="mt-4 grid gap-3.5">
                    <label v-for="capability in selectedTool.capabilities" :key="capability" class="capability-row flex w-fit items-center gap-3 text-control">
                      <Checkbox
                        :model-value="capabilityState[`${selectedTool.id}:${capability}`]"
                        :disabled="!selectedTool.available"
                        :aria-label="capability"
                        @update:model-value="setCapability(capability, Boolean($event))"
                      />
                      <span>{{ capability }}</span>
                    </label>
                  </div>
                </section>

                <div class="scope-note flex items-start gap-3 border border-info-border px-4 py-3 text-control text-info">
                  <Info class="mt-0.5 size-4 shrink-0" />
                  <span>{{ selectedTool.warning }}</span>
                </div>

                <div class="mt-7 flex flex-wrap items-center gap-4">
                  <Button
                    variant="outline"
                    class="health-check"
                    :disabled="!selectedTool.available || healthState === 'checking'"
                    @click="runHealthCheck"
                  >
                    <ShieldCheck class="size-4" />
                    {{ healthState === 'checking' ? '正在检查' : healthState === 'passed' ? '检查通过' : '运行健康检查' }}
                  </Button>
                  <Button variant="ghost" class="schema-action" @click="schemaOpen = !schemaOpen">
                    <FileSearch class="size-4" />
                    {{ schemaOpen ? '收起 MCP Schema' : '查看 MCP Schema' }}
                  </Button>
                </div>

                <section v-if="schemaOpen" class="schema-preview mt-5 border-l-2 border-info px-4 py-3" aria-label="MCP Schema 摘要">
                  <p class="tactical-label text-info">Reviewed tools</p>
                  <code class="mt-2 block whitespace-pre-wrap text-caption leading-6 text-muted-foreground">{{ selectedTool.schema.join('\n') }}</code>
                </section>
              </article>
            </div>
          </div>
        </section>
      </div>
    </main>
  </div>
</template>

<style scoped>
.settings-nav-surface { border-color: color-mix(in srgb, var(--border-hairline) 72%, transparent); background-color: rgb(17 18 15 / .68); background-image: var(--tactical-carbon-image); background-size: 640px 640px; box-shadow: inset -1px 0 0 rgb(255 255 255 / .025); }
.settings-nav-item { position: relative; display: flex; min-height: 3rem; width: 100%; align-items: center; border: 0; background: transparent; padding: 0 1rem; color: var(--muted-foreground); text-align: left; cursor: pointer; }
.settings-nav-item:hover { color: var(--foreground); background: var(--overlay-hover-light); }
.settings-nav-item.active { color: var(--brand); background: var(--focus-panel); }
.settings-nav-item.active::before { position: absolute; inset-block: .55rem; left: 0; width: 3px; background: var(--brand); content: ''; }
.tool-workbench { grid-template-columns: minmax(18rem, .78fr) minmax(25rem, 1.22fr); }
.tool-row { display: grid; min-height: 6.05rem; width: 100%; grid-template-columns: 2.75rem minmax(0, 1fr) auto; align-items: center; gap: .9rem; border-left: 4px solid transparent; padding: 1rem 1.25rem 1rem 1rem; color: var(--foreground); cursor: pointer; }
.tool-row:hover, .tool-row:focus-visible { background: var(--overlay-hover-light); outline: 0; }
.tool-row.is-selected { border-left-color: var(--tactical-acid); background: var(--focus-panel); }
.tool-icon { display: grid; width: 2.5rem; height: 2.5rem; place-items: center; border: 1px solid var(--border-hairline); color: var(--foreground); }
.tool-status { color: var(--muted-foreground); font-size: var(--text-caption); white-space: nowrap; }
.tool-status[data-tone='ready'] { color: var(--success-foreground); }
.tool-status[data-tone='attention'] { color: var(--warning-foreground); }
.tool-facts dt { color: var(--muted-foreground); }
.tool-facts dd { min-width: 0; overflow-wrap: anywhere; }
.capability-row { min-height: 1.5rem; cursor: pointer; }
.capability-row:has([data-disabled]) { color: var(--muted-foreground); cursor: default; }
.scope-note { background: var(--info-soft); }
.health-check { border-color: var(--success-border); color: var(--success-foreground); }
.schema-action { color: var(--info-foreground); }
.schema-preview { background: var(--info-soft); }
.tool-detail :deep([data-slot='switch'][data-state='checked']),
.tool-detail :deep([data-slot='checkbox'][data-state='checked']) { background: var(--tactical-acid); color: var(--brand-foreground); }
@media (max-width: 1040px) {
  .tool-workbench { grid-template-columns: minmax(15rem, .72fr) minmax(22rem, 1.28fr); }
  .tool-detail { padding-inline: 1.5rem; }
}
@media (max-width: 820px) {
  .settings-nav { width: 10.5rem; }
  .tool-workbench { grid-template-columns: 1fr; }
  .tool-index { border-right: 0; border-bottom: 1px solid var(--border); }
  .tool-row { min-height: 4.75rem; }
}
@media (max-height: 820px) {
  .tool-workbench { min-height: 30rem; }
  .tool-row { min-height: 4.8rem; padding-block: .75rem; }
  .tool-detail { padding-block: 1.1rem; padding-inline: 1.5rem; }
  .tool-detail > header { padding-bottom: .8rem; }
  .tool-facts { gap-row: .32rem; padding-block: .8rem; }
  .tool-detail > section { padding-block: .8rem; }
  .tool-detail > section > div { margin-top: .6rem; gap: .5rem; }
  .scope-note { padding-block: .55rem; }
  .tool-detail > .mt-7 { margin-top: .8rem; }
}
</style>
