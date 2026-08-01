<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import {
  Alert,
  AlertDescription,
  Button,
  Input,
  NativeSelect,
  NativeSelectOption,
  SegmentedControl,
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
  SettingsRow,
  SettingsSection,
} from '@felinic/ui'
import {
  AlertCircle,
  ArrowLeft,
  Check,
  Download,
  FileWarning,
  FolderOpen,
  KeyRound,
  ShieldCheck,
} from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import type {
  AppSettings,
  LocalDataBackupExport,
  LocalDataStatus,
  LocalDiagnosticExport,
  ModelProbeResult,
  ModelSelection,
} from '@/types'
import {
  PROVIDERS,
  PROVIDER_GROUPS,
  providerModelLabel,
  withAppSettingsDefaults,
} from '@/types'

const props = defineProps<{
  settings: AppSettings | null
  initialCategory: 'general' | 'apikeys'
}>()

const emit = defineEmits<{
  close: []
  settingsChange: [value: AppSettings]
}>()

const category = ref(props.initialCategory)
const working = ref<AppSettings | null>(null)
const saving = ref(false)
const verifying = ref(false)
const localDataLoading = ref(false)
const backupExporting = ref(false)
const diagnosticExporting = ref(false)
const localData = ref<LocalDataStatus | null>(null)
const notice = ref<{ tone: 'ok' | 'error'; text: string } | null>(null)

function cloneSettings(value: AppSettings): AppSettings {
  return JSON.parse(JSON.stringify(value)) as AppSettings
}

watch(() => props.settings, value => {
  working.value = value ? cloneSettings(withAppSettingsDefaults(value)) : null
  if (working.value) {
    ensureProvider(working.value.active_provider)
  }
}, { immediate: true })
watch(() => props.initialCategory, value => { category.value = value })
onMounted(() => {
  void loadLocalData()
})

const provider = computed(() => (
  working.value ? working.value.providers[working.value.active_provider] : undefined
))
const providerInfo = computed(() => (
  PROVIDERS.find(item => item.id === working.value?.active_provider)
))
const modelOptions = PROVIDERS.flatMap(item => item.models.map(model => ({
  key: `${item.id}:${model}`,
  provider: item.id,
  model,
  kind: item.kind,
  label: providerModelLabel(item.id, model),
})))
const visionModelOptions = PROVIDERS.flatMap(item => item.visionModels.map(model => ({
  key: `${item.id}:${model}`,
  provider: item.id,
  model,
  kind: item.kind,
  label: providerModelLabel(item.id, model),
})))
const visionProviderGroups = PROVIDER_GROUPS
  .map(group => ({
    ...group,
    options: visionModelOptions.filter(item => item.kind === group.kind),
  }))
  .filter(group => group.options.length)

function routeKey(selection: ModelSelection) {
  return `${selection.provider}:${selection.model}`
}

function setRoute(kind: 'fast' | 'deep', value: string) {
  if (!working.value) return
  const [routeProvider, routeModel] = value.split(':')
  if (!routeProvider || !routeModel) return
  working.value.model_routing[kind] = {
    provider: routeProvider,
    model: routeModel,
  }
}

function visionRouteKey() {
  const vision = working.value?.model_routing.vision
  return vision ? routeKey(vision) : 'local-ocr'
}

function setVisionRoute(value: string) {
  if (!working.value) return
  if (value === 'local-ocr') {
    working.value.model_routing.vision = undefined
    return
  }
  const [routeProvider, routeModel] = value.split(':')
  if (!routeProvider || !routeModel) return
  working.value.model_routing.vision = {
    provider: routeProvider,
    model: routeModel,
  }
}

function ensureProvider(id: string) {
  if (!working.value) return
  const info = PROVIDERS.find(item => item.id === id)
  if (!working.value.providers[id]) {
    working.value.providers[id] = {
      api_key: '',
      has_api_key: false,
      base_url: info?.defaultBaseUrl,
      enabled: true,
    }
  } else if (!working.value.providers[id].base_url && info?.defaultBaseUrl) {
    working.value.providers[id].base_url = info.defaultBaseUrl
  }
  working.value.active_provider = id
  if (info && !info.models.includes(working.value.active_model)) working.value.active_model = info.models[0]
}

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let amount = value
  let unit = 0
  while (amount >= 1024 && unit < units.length - 1) {
    amount /= 1024
    unit++
  }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`
}

async function loadLocalData() {
  localDataLoading.value = true
  try {
    localData.value = await invokeCommand<LocalDataStatus>('get_local_data_status')
  } catch (reason) {
    notice.value = { tone: 'error', text: `无法读取本地数据状态：${String(reason)}` }
  } finally {
    localDataLoading.value = false
  }
}

async function revealLocalData() {
  try {
    await invokeCommand('reveal_local_data_directory')
  } catch (reason) {
    notice.value = { tone: 'error', text: `无法打开本地数据目录：${String(reason)}` }
  }
}

async function exportLocalDataBackup() {
  backupExporting.value = true
  notice.value = null
  try {
    const exported = await invokeCommand<LocalDataBackupExport>('export_local_data_backup')
    if (exported.cancelled) return
    notice.value = {
      tone: 'ok',
      text: `已导出 ${exported.fileCount} 个文件（${formatBytes(exported.bytes)}）；凭据库、浏览器配对令牌和 PI 认证文件未写入备份。`,
    }
  } catch (reason) {
    notice.value = { tone: 'error', text: `备份导出失败：${String(reason)}` }
  } finally {
    backupExporting.value = false
  }
}

async function exportLocalDiagnostics() {
  diagnosticExporting.value = true
  notice.value = null
  try {
    const exported = await invokeCommand<LocalDiagnosticExport>('export_local_diagnostics')
    if (exported.cancelled) return
    notice.value = {
      tone: 'ok',
      text: `诊断包已导出（${formatBytes(exported.bytes)}，${exported.eventCount} 条脱敏运行事件）；不包含会话正文、附件或凭据。`,
    }
  } catch (reason) {
    notice.value = { tone: 'error', text: `诊断包导出失败：${String(reason)}` }
  } finally {
    diagnosticExporting.value = false
  }
}

async function save() {
  if (!working.value) return
  saving.value = true
  notice.value = null
  try {
    await invokeCommand('save_settings_cmd', { newSettings: working.value })
    const refreshed = await invokeCommand<AppSettings>('get_settings')
    working.value = cloneSettings(refreshed)
    emit('settingsChange', refreshed)
    if (category.value === 'general') {
      notice.value = { tone: 'ok', text: '通用设置已保存。' }
      return
    }
    verifying.value = true
    try {
      const result = await invokeCommand<ModelProbeResult>('test_agent_model')
      const verifiedSettings = await invokeCommand<AppSettings>('get_settings')
      working.value = cloneSettings(verifiedSettings)
      emit('settingsChange', verifiedSettings)
      notice.value = {
        tone: 'ok',
        text: `已保存并验证 ${result.provider}/${result.model}，PI 响应 ${result.latencyMs} ms。`,
      }
    } catch (reason) {
      notice.value = {
        tone: 'error',
        text: `凭据已保存，但 PI 模型验证失败：${String(reason)}`,
      }
    } finally {
      verifying.value = false
    }
  } catch (reason) {
    const refreshed = await invokeCommand<AppSettings>('get_settings').catch(() => working.value)
    if (refreshed) {
      working.value = cloneSettings(refreshed)
      emit('settingsChange', refreshed)
    }
    const sessionOnly = refreshed && (
      Object.values(refreshed.providers).some(item => item.session_only)
      || refreshed.relay?.session_only
      || refreshed.nssctf_arena?.session_only
    )
    notice.value = { tone: 'error', text: sessionOnly
      ? `${String(reason)} 当前密钥仅保留在本次运行内，退出应用后需要重新输入。`
      : `设置未保存：${String(reason)}` }
  } finally {
    saving.value = false
  }
}

</script>

<template>
  <main class="flex min-w-0 flex-1 flex-col bg-muted/20">
    <header class="app-drag flex h-14 shrink-0 items-center border-b border-border bg-background px-5">
      <Button variant="ghost" size="icon-sm" class="app-no-drag mr-3" aria-label="返回" @click="$emit('close')">
        <ArrowLeft class="size-4" />
      </Button>
      <div>
        <p class="text-control font-medium">设置</p>
        <p class="text-caption text-muted-foreground">模型、凭据与本地偏好</p>
      </div>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto px-6 py-8">
      <div class="mx-auto max-w-2xl">
        <SegmentedControl
          v-model="category"
          class="mb-7 w-fit"
          aria-label="设置分类"
          :items="[
            { value: 'general', label: '通用' },
            { value: 'apikeys', label: '模型与凭据' },
          ]"
        />

        <Alert v-if="notice" :variant="notice.tone === 'error' ? 'destructive' : 'default'" class="mb-5">
          <AlertCircle v-if="notice.tone === 'error'" class="size-4" />
          <Check v-else class="size-4" />
          <AlertDescription>{{ notice.text }}</AlertDescription>
        </Alert>

        <template v-if="working && category === 'general'">
          <SettingsSection title="应用">
            <SettingsRow label="界面语言" description="M3 MVP 默认使用简体中文">
              <NativeSelect v-model="working.locale" size="sm" aria-label="界面语言">
                <NativeSelectOption value="zh">简体中文</NativeSelectOption>
                <NativeSelectOption value="en">English</NativeSelectOption>
              </NativeSelect>
            </SettingsRow>
            <SettingsRow label="本地优先" description="会话与研究记录保留在本机，凭据不写入设置文件">
              <ShieldCheck class="size-4 text-muted-foreground" />
            </SettingsRow>
          </SettingsSection>
          <SettingsSection title="本地数据" class="mt-6">
            <SettingsRow
              stack="always"
              label="数据与备份"
              :description="localDataLoading
                ? '正在统计本地数据'
                : localData
                  ? `${localData.fileCount} 个文件 · ${formatBytes(localData.bytes)}`
                  : '会话、训练记录与附件保存在当前用户目录'"
            >
              <p
                v-if="localData?.directory"
                class="mb-3 truncate font-mono text-caption text-muted-foreground"
                :title="localData.directory"
              >
                {{ localData.directory }}
              </p>
              <div class="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" @click="revealLocalData">
                  <FolderOpen class="size-3.5" />
                  打开数据目录
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :loading="backupExporting"
                  @click="exportLocalDataBackup"
                >
                  <Download class="size-3.5" />
                  导出安全备份
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  :loading="diagnosticExporting"
                  @click="exportLocalDiagnostics"
                >
                  <FileWarning class="size-3.5" />
                  导出诊断包
                </Button>
              </div>
              <p class="mt-3 text-caption leading-5 text-muted-foreground">
                备份包含会话、训练记录、附件和一致的 SQLite 快照；凭据库、浏览器配对令牌和 PI 认证文件不会写入。会话正文按原样备份。
              </p>
              <p class="mt-1 text-caption leading-5 text-muted-foreground">
                诊断包只包含版本、运行状态、数据库健康检查和脱敏错误事件，便于排查启动与连接问题。
              </p>
            </SettingsRow>
          </SettingsSection>
          <div class="mt-6 flex justify-end">
            <Button :loading="saving" @click="save">保存设置</Button>
          </div>
        </template>

        <template v-else-if="working">
          <SettingsSection title="模型编排">
            <SettingsRow
              label="默认方式"
              description="自动模式会按任务选模型；每个对话仍可在顶部手动覆盖"
            >
              <SegmentedControl
                v-model="working.model_routing.default_mode"
                :items="[
                  { value: 'auto', label: '自动' },
                  { value: 'manual', label: '固定' },
                ]"
              />
            </SettingsRow>
            <SettingsRow
              v-if="working.model_routing.default_mode === 'auto'"
              label="快速执行"
              description="普通 Coding、CTF 解题和工具迭代"
            >
              <Select
                :model-value="routeKey(working.model_routing.fast)"
                @update:model-value="value => setRoute('fast', String(value ?? ''))"
              >
                <SelectTrigger
                  size="sm"
                  class="min-w-64"
                  aria-label="快速执行模型"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent size="sm" align="end" :align-offset="0" class="min-w-80">
                  <template
                    v-for="(group, groupIndex) in PROVIDER_GROUPS"
                    :key="`fast:${group.kind}`"
                  >
                    <SelectSeparator v-if="groupIndex > 0" />
                    <SelectGroup>
                      <SelectLabel>{{ group.label }}</SelectLabel>
                      <SelectItem
                        v-for="option in modelOptions.filter(item => item.kind === group.kind)"
                        :key="`fast:${option.key}`"
                        :value="option.key"
                      >
                        {{ option.label }}
                      </SelectItem>
                    </SelectGroup>
                  </template>
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow
              v-if="working.model_routing.default_mode === 'auto'"
              label="深度策略"
              description="策略 Agent、卡关复盘与复杂路线评审"
            >
              <Select
                :model-value="routeKey(working.model_routing.deep)"
                @update:model-value="value => setRoute('deep', String(value ?? ''))"
              >
                <SelectTrigger
                  size="sm"
                  class="min-w-64"
                  aria-label="深度策略模型"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent size="sm" align="end" :align-offset="0" class="min-w-80">
                  <template
                    v-for="(group, groupIndex) in PROVIDER_GROUPS"
                    :key="`deep:${group.kind}`"
                  >
                    <SelectSeparator v-if="groupIndex > 0" />
                    <SelectGroup>
                      <SelectLabel>{{ group.label }}</SelectLabel>
                      <SelectItem
                        v-for="option in modelOptions.filter(item => item.kind === group.kind)"
                        :key="`deep:${option.key}`"
                        :value="option.key"
                      >
                        {{ option.label }}
                      </SelectItem>
                    </SelectGroup>
                  </template>
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow
              v-else
              label="固定模型"
              description="所有 Coding 与 CTF Agent 默认使用当前凭据区选中的模型"
            >
              <span class="text-caption text-muted-foreground">
                {{ providerModelLabel(working.active_provider, working.active_model) }}
              </span>
            </SettingsRow>
            <SettingsRow
              label="图片理解"
              description="DeepSeek 等纯文本模型会先在本机 OCR；选定视觉模型后，图表、布局和界面图片会自动交给它补充理解"
            >
              <Select
                :model-value="visionRouteKey()"
                @update:model-value="value => setVisionRoute(String(value ?? 'local-ocr'))"
              >
                <SelectTrigger
                  size="sm"
                  class="min-w-64"
                  aria-label="图片理解模型"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent size="sm" align="end" :align-offset="0" class="min-w-80">
                  <SelectItem value="local-ocr">
                    仅本地 OCR · 图片不发送给其他模型
                  </SelectItem>
                  <template
                    v-for="group in visionProviderGroups"
                    :key="`vision:${group.kind}`"
                  >
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>{{ group.label }}视觉模型</SelectLabel>
                      <SelectItem
                        v-for="option in group.options"
                        :key="`vision:${option.key}`"
                        :value="option.key"
                      >
                        {{ option.label }}
                      </SelectItem>
                    </SelectGroup>
                  </template>
                </SelectContent>
              </Select>
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="模型凭据" class="mt-6">
            <SettingsRow
              label="提供商"
              :description="providerInfo
                ? `${providerInfo.kind === 'relay' ? '中转站' : '原厂'} · ${providerInfo.summary}`
                : '选择要配置和验证的模型服务'"
            >
              <Select
                :model-value="working.active_provider"
                @update:model-value="value => ensureProvider(String(value ?? ''))"
              >
                <SelectTrigger
                  size="sm"
                  class="min-w-40"
                  aria-label="提供商"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent size="sm" align="end" :align-offset="0" class="min-w-48">
                  <template
                    v-for="(group, groupIndex) in PROVIDER_GROUPS"
                    :key="group.kind"
                  >
                    <SelectSeparator v-if="groupIndex > 0" />
                    <SelectGroup>
                      <SelectLabel>{{ group.label }}</SelectLabel>
                      <SelectItem
                        v-for="item in group.providers"
                        :key="item.id"
                        :value="item.id"
                      >
                        {{ item.name }}
                      </SelectItem>
                    </SelectGroup>
                  </template>
                </SelectContent>
              </Select>
            </SettingsRow>
            <SettingsRow label="模型">
              <NativeSelect
                v-model="working.active_model"
                size="sm"
                class="min-w-56"
                aria-label="模型"
              >
                <NativeSelectOption
                  v-for="model in PROVIDERS.find(item => item.id === working?.active_provider)?.models ?? []"
                  :key="model"
                  :value="model"
                >
                  {{ model }}
                </NativeSelectOption>
              </NativeSelect>
            </SettingsRow>
            <SettingsRow
              stack="always"
              label="Base URL"
              :description="providerInfo?.kind === 'relay'
                ? '中转站的 OpenAI 兼容接口地址；修改后会重启并重新验证 Agent'
                : '原厂 API 地址；需要代理或兼容网关时可在这里修改'"
            >
              <Input
                v-if="provider"
                :model-value="provider.base_url ?? providerInfo?.defaultBaseUrl ?? ''"
                type="url"
                autocomplete="url"
                :placeholder="providerInfo?.defaultBaseUrl"
                @update:model-value="value => { provider!.base_url = String(value).trim() }"
              />
            </SettingsRow>
            <SettingsRow
              stack="always"
              label="API Key"
              :description="provider?.session_only ? '本地数据库写入失败；当前仅在本次运行可用' : provider?.has_api_key ? '已保存在本机 SQLite 凭据库；不会写入设置文件' : '保存在本机 SQLite 凭据库；仅当前系统用户可读'"
            >
              <Input
                v-if="provider"
                :model-value="provider.api_key"
                type="password"
                autocomplete="off"
                :placeholder="PROVIDERS.find(item => item.id === working?.active_provider)?.placeholder"
                @update:model-value="value => {
                  provider!.api_key = String(value)
                  if (value) provider!.session_only = false
                }"
              />
            </SettingsRow>
          </SettingsSection>

          <SettingsSection title="NSSCTF Agent Arena" class="mt-6">
            <SettingsRow
              stack="always"
              label="Arena Token"
              :description="working.nssctf_arena?.session_only ? '本地数据库写入失败；当前仅在本次运行可用' : working.nssctf_arena?.has_token ? '已保存在本机 SQLite 凭据库' : '保存在本机 SQLite 凭据库，用于真实限时题获取与 Flag 提交'"
            >
              <Input
                :model-value="working.nssctf_arena?.token ?? ''"
                type="password"
                autocomplete="off"
                placeholder="NSSCTF Agent Token"
                @update:model-value="value => {
                  working!.nssctf_arena = {
                    token: String(value),
                    has_token: working!.nssctf_arena?.has_token ?? false,
                    session_only: value ? false : working!.nssctf_arena?.session_only,
                  }
                }"
              />
            </SettingsRow>
          </SettingsSection>

          <div class="mt-6 flex items-center justify-between gap-4">
            <p class="flex items-center gap-2 text-caption text-muted-foreground">
              <KeyRound class="size-3.5" />
              凭据写入本机 SQLite；保存后立即重启 Agent 会话引擎
            </p>
            <Button :loading="saving || verifying" @click="save">
              {{ verifying ? '正在验证 PI' : '保存并验证' }}
            </Button>
          </div>
        </template>
      </div>
    </div>
  </main>
</template>
