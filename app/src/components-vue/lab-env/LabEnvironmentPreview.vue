<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
  ActionCard,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  Input,
  NativeSelect,
  NativeSelectOption,
  SegmentedControl,
  SettingsRow,
  SettingsSection,
} from '@felinic/ui'
import { ArrowLeft, Box, Maximize2, Plus, RotateCcw, Smartphone } from 'lucide-vue-next'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import WorkspaceRail from '@/components-vue/WorkspaceRail.vue'
import EnvironmentStrip from '@/components-vue/lab-env/EnvironmentStrip.vue'
import TargetSurfacePreview from '@/components-vue/lab-env/TargetSurfacePreview.vue'
import type { EnvironmentLease, TargetSurfaceKind } from '@/components-vue/lab-env/environmentTypes'
import type { AccountStatus } from '@/types'
import type { ThemeMode } from '@/lib/themeMode'
import { t } from '@/lib/uiLocale'
import { groupLabPackages } from '@/lib/labPackageCategory'
import { useDossierSplit } from '@/lib/useDossierSplit'
import type { AppSection, WorkspaceSection } from '@/lib/workspaceNavigation'

defineOptions({ name: 'LabEnvironmentPreview' })

type LabTab = 'jobs' | 'packages'
type SourceKind = 'local' | 'remote'
type PreviewScreen =
  | 'lab-packages'
  | 'lab-job'
  | 'cve-ready'
  | 'cve-none'
  | 'cve-live'
  | 'cve-shell'
  | 'cve-emulator'
  | 'cve-agent'
  | 'coding-from-cve'
  | 'docker-down'

const accountStatus: AccountStatus = {
  configured: true,
  authenticated: true,
  state: 'active',
  user: { githubLogin: 'preview', displayName: t('交互稿', 'Preview'), avatarUrl: '' },
}
const themeMode = ref<ThemeMode>('dark')
const section = ref<AppSection>('lab')
const labTab = ref<LabTab>('packages')
const labJobId = ref('')
const cveId = ref('')
const codingFrom = ref<'lab' | 'cve'>('cve')
const showNew = ref(false)
const showReproAsk = ref(false)
const newSource = ref<SourceKind>('local')
const selectedPackageId = ref('juice-shop')
const dockerOk = ref(true)
const targetOpen = ref(false)
const agentDriving = ref(false)
const targetKind = ref<TargetSurfaceKind>('browser')

const juiceLease = ref<EnvironmentLease>({
  provider: 'docker',
  state: 'stopped',
  packageName: 'OWASP Juice Shop',
  detail: t('Docker · 无出网', 'Docker · no outbound network'),
})

const packages = computed(() => [
  { id: 'juice-shop', name: 'OWASP Juice Shop', kind: 'Web', kindLabel: 'Web', category: 'web', provider: 'docker', surface: 'browser' as const, port: ':3000', size: t('约 400MB', 'About 400MB') },
  { id: 'webgoat', name: 'WebGoat', kind: 'Web', kindLabel: 'Web', category: 'web', provider: 'docker', surface: 'browser' as const, port: ':8080', size: t('约 800MB', 'About 800MB') },
  { id: 'activemq', name: 'Vulhub ActiveMQ', kind: 'Linux', kindLabel: 'Linux', category: 'linux', provider: 'docker', surface: 'shell' as const, port: ':61616', size: t('约 350MB', 'About 350MB') },
  { id: 'avd-34', name: 'Android API 34', kind: t('模拟器', 'Emulator'), kindLabel: t('安卓', 'Android'), category: 'android', provider: 'android-avd', surface: 'emulator' as const, port: 'adb', size: t('本机 AVD', 'Local AVD') },
])
const packageGroups = computed(() => groupLabPackages(packages.value))

const sourceItems = computed(() => [
  { value: 'local' as const, label: t('本地', 'Local') },
  { value: 'remote' as const, label: t('远程', 'Remote') },
])
const labTabItems = computed(() => [
  { value: 'packages' as const, label: t('题目包', 'Packages') },
  { value: 'jobs' as const, label: t('自定义任务', 'Custom jobs') },
])
const screenItems = computed(() => [
  { value: 'lab-packages' as const, label: t('实验室·包', 'Lab · packages') },
  { value: 'lab-job' as const, label: t('实验室·作业', 'Lab · job') },
  { value: 'cve-ready' as const, label: t('CVE·有包', 'CVE · with package') },
  { value: 'cve-live' as const, label: t('网页靶', 'Web target') },
  { value: 'cve-shell' as const, label: t('终端靶', 'Terminal target') },
  { value: 'cve-emulator' as const, label: t('模拟器', 'Emulator') },
  { value: 'cve-agent' as const, label: t('Agent 操作', 'Agent driving') },
  { value: 'cve-none' as const, label: t('CVE·无包', 'CVE · no package') },
  { value: 'coding-from-cve' as const, label: t('展开 Coding', 'Expand Coding') },
  { value: 'docker-down' as const, label: t('Docker 未运行', 'Docker is not running') },
])
const cveStatusOptions = computed(() => [
  { value: '研究中', label: t('研究中', 'In research') },
  { value: '想研究', label: t('想研究', 'Want to research') },
])

const sidebarSection = computed(() => (section.value === 'chat' ? 'chat' : section.value))
const screen = computed<PreviewScreen>(() => {
  if (!dockerOk.value && section.value !== 'chat') return 'docker-down'
  if (section.value === 'chat') return 'coding-from-cve'
  if (section.value === 'vuln' && cveId.value === 'CVE-2024-3400') return 'cve-none'
  if (section.value === 'vuln' && targetOpen.value) {
    if (agentDriving.value) return 'cve-agent'
    if (targetKind.value === 'shell') return 'cve-shell'
    if (targetKind.value === 'emulator') return 'cve-emulator'
    return 'cve-live'
  }
  if (section.value === 'vuln') return 'cve-ready'
  if (labJobId.value) return 'lab-job'
  return labTab.value === 'packages' ? 'lab-packages' : 'lab-job'
})

const noneLease = computed<EnvironmentLease>(() => ({
  provider: 'none',
  state: 'none',
  detail: t('没有匹配的练习包。仍可按公开描述写报告。', 'No matching practice package. You can still write a report from the public description.'),
}))
const dockerDownLease = computed<EnvironmentLease>(() => ({
  provider: 'docker',
  state: 'docker-down',
  packageName: 'OWASP Juice Shop',
  detail: t('打开 Docker Desktop 后再试。', 'Open Docker Desktop and try again.'),
}))
const userTargetLease = computed<EnvironmentLease>(() => ({
  provider: 'user-attached',
  state: 'ready',
  packageName: t('用户自带靶', 'User-attached target'),
  address: 'http://127.0.0.1:8081',
  detail: t('本机地址 · 不由 MilkSU 启动', 'Local address · not started by MilkSU'),
}))

const cveLease = computed(() => {
  if (!dockerOk.value) return dockerDownLease.value
  if (cveId.value === 'CVE-2024-3400') return noneLease.value
  return juiceLease.value
})
const labLease = computed(() => {
  if (!dockerOk.value) return dockerDownLease.value
  if (labJobId.value === 'url-job') return userTargetLease.value
  return juiceLease.value
})
const codingLease = computed(() => (codingFrom.value === 'lab' ? labLease.value : cveLease.value))
const { width: briefWidth, startResize: startBriefResize } = useDossierSplit('milksu.preview-split.v1', 400)

function applyScreen(next: PreviewScreen) {
  dockerOk.value = next !== 'docker-down'
  showNew.value = false
  showReproAsk.value = false
  targetOpen.value = next === 'cve-live' || next === 'cve-shell' || next === 'cve-emulator' || next === 'cve-agent'
  agentDriving.value = next === 'cve-agent'
  targetKind.value = next === 'cve-shell' ? 'shell' : next === 'cve-emulator' ? 'emulator' : 'browser'
  if (next === 'docker-down') {
    section.value = 'vuln'
    cveId.value = 'CVE-2023-46604'
    juiceLease.value = { ...juiceLease.value, state: 'stopped', address: undefined }
    return
  }
  if (next === 'lab-packages') {
    section.value = 'lab'
    labTab.value = 'packages'
    labJobId.value = ''
    return
  }
  if (next === 'lab-job') {
    section.value = 'lab'
    labTab.value = 'jobs'
    labJobId.value = 'juice-job'
    juiceLease.value = {
      provider: 'docker',
      state: 'ready',
      packageName: 'OWASP Juice Shop',
      address: '127.0.0.1:3000',
      detail: t('Docker · 无出网', 'Docker · no outbound network'),
    }
    return
  }
  if (next === 'cve-none') {
    section.value = 'vuln'
    cveId.value = 'CVE-2024-3400'
    return
  }
  if (next === 'cve-live' || next === 'cve-shell' || next === 'cve-emulator' || next === 'cve-agent') {
    section.value = 'vuln'
    cveId.value = 'CVE-2023-46604'
    if (next === 'cve-shell') {
      juiceLease.value = {
        provider: 'docker',
        state: 'ready',
        packageName: 'Vulhub ActiveMQ',
        address: '127.0.0.1:61616',
        detail: t('Docker · 无出网', 'Docker · no outbound network'),
      }
    } else if (next === 'cve-emulator') {
      juiceLease.value = {
        provider: 'avd',
        state: 'ready',
        packageName: 'Android API 34',
        address: 'emulator-5554',
        detail: t('本机 AVD · 受限 adb', 'Local AVD · restricted adb'),
      }
    } else {
      juiceLease.value = {
        provider: 'docker',
        state: 'ready',
        packageName: 'OWASP Juice Shop',
        address: '127.0.0.1:3000',
        detail: t('Docker · 无出网', 'Docker · no outbound network'),
      }
    }
    return
  }
  if (next === 'coding-from-cve') {
    section.value = 'chat'
    codingFrom.value = 'cve'
    cveId.value = 'CVE-2023-46604'
    juiceLease.value = {
      provider: 'docker',
      state: 'ready',
      packageName: 'OWASP Juice Shop',
      address: '127.0.0.1:3000',
      detail: t('Docker · 无出网', 'Docker · no outbound network'),
    }
    return
  }
  section.value = 'vuln'
  cveId.value = 'CVE-2023-46604'
  juiceLease.value = {
    provider: 'docker',
    state: 'ready',
    packageName: 'OWASP Juice Shop',
    address: '127.0.0.1:3000',
    detail: t('Docker · 无出网', 'Docker · no outbound network'),
  }
}

function navigate(value: WorkspaceSection) {
  if (value === 'ctf') return
  section.value = value
  if (value === 'lab') {
    labTab.value = 'packages'
    labJobId.value = ''
    targetOpen.value = false
    agentDriving.value = false
  }
  if (value === 'vuln') {
    cveId.value = ''
    targetOpen.value = false
    agentDriving.value = false
  }
}

function startJuice() {
  juiceLease.value = {
    provider: 'docker',
    state: 'ready',
    packageName: 'OWASP Juice Shop',
    address: '127.0.0.1:3000',
    detail: t('Docker · 无出网', 'Docker · no outbound network'),
  }
}

function stopJuice() {
  juiceLease.value = {
    provider: 'docker',
    state: 'stopped',
    packageName: 'OWASP Juice Shop',
    detail: t('Docker · 无出网', 'Docker · no outbound network'),
  }
  targetOpen.value = false
  agentDriving.value = false
}

function openTarget() {
  if (juiceLease.value.state !== 'ready' && dockerOk.value) startJuice()
  targetOpen.value = true
}

function retryDocker() {
  dockerOk.value = true
  startJuice()
}

function openPackage(id: string) {
  selectedPackageId.value = id
  startJuice()
  labTab.value = 'jobs'
  if (id === 'avd-34') {
    targetKind.value = 'emulator'
    juiceLease.value = {
      provider: 'avd',
      state: 'ready',
      packageName: 'Android API 34',
      address: 'emulator-5554',
      detail: t('本机 AVD · 受限 adb', 'Local AVD · restricted adb'),
    }
    labJobId.value = 'avd-job'
    targetOpen.value = true
    return
  }
  if (id === 'activemq') {
    targetKind.value = 'shell'
    juiceLease.value = {
      provider: 'docker',
      state: 'ready',
      packageName: 'Vulhub ActiveMQ',
      address: '127.0.0.1:61616',
      detail: t('Docker · 无出网', 'Docker · no outbound network'),
    }
    labJobId.value = 'mq-job'
    targetOpen.value = true
    return
  }
  targetKind.value = 'browser'
  labJobId.value = 'juice-job'
}

function submitNew() {
  showNew.value = false
  labJobId.value = 'url-job'
}

function startRepro() {
  if (cveId.value === 'CVE-2023-46604' && juiceLease.value.state !== 'ready' && dockerOk.value) {
    showReproAsk.value = true
    return
  }
  if (cveLease.value.state === 'ready') {
    targetOpen.value = true
    agentDriving.value = true
  }
}

function confirmStartAndRepro() {
  showReproAsk.value = false
  startJuice()
  targetOpen.value = true
  agentDriving.value = true
}

function expandToCoding(from: 'lab' | 'cve') {
  codingFrom.value = from
  section.value = 'chat'
}

function returnFromCoding() {
  section.value = codingFrom.value === 'lab' ? 'lab' : 'vuln'
}

onMounted(() => {
  const hash = window.location.hash.replace(/^#/, '') as PreviewScreen
  if (screenItems.value.some(item => item.value === hash)) applyScreen(hash)
})
</script>

<template>
  <div class="flex h-screen min-h-0 flex-col bg-background text-foreground" data-testid="lab-env-preview">
    <p class="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-card px-4 text-caption">
      <span class="text-muted-foreground">{{ t('交互稿 · 真组件 · 不写后端', 'Preview · live components · no backend') }}</span>
      <SegmentedControl
        class="ml-auto"
        :model-value="screen"
        :items="screenItems"
        :aria-label="t('画面', 'Screen')"
        @update:model-value="applyScreen($event as PreviewScreen)"
      />
    </p>

    <div class="flex min-h-0 flex-1">
      <WorkspaceRail
        :active-section="sidebarSection"
        :account-status="accountStatus"
        :theme-mode="themeMode"
        collapsed
        @navigate="navigate"
        @toggle-theme="themeMode = themeMode === 'dark' ? 'light' : 'dark'"
      />

      <main class="tactical-page flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
        <template v-if="section === 'lab' && !labJobId">
          <WorkspaceModuleTopBar module="lab" :title="t('实验室', 'Lab')">
            <template #actions>
              <SegmentedControl v-model="labTab" :aria-label="t('实验室分段', 'Lab sections')" :items="labTabItems" />
              <Button
                v-if="labTab === 'jobs'"
                variant="ghost"
                size="icon-sm"
                :aria-label="t('新建自定义任务', 'New custom job')"
                @click="showNew = true"
              >
                <Plus class="size-4" />
              </Button>
            </template>
          </WorkspaceModuleTopBar>

          <section v-if="labTab === 'packages'" class="page-scroll flex-1 bg-background" :aria-label="t('题目包', 'Packages')">
            <div class="page-column page-stack">
              <section
                v-for="group in packageGroups"
                :key="group.category"
                data-testid="lab-pack-group"
                :aria-label="group.label"
              >
                <h2 class="mb-3 flex items-baseline gap-2 text-label font-medium text-muted-foreground">
                  <span>{{ group.label }}</span>
                  <span class="font-mono text-caption">{{ group.packages.length }}</span>
                </h2>
                <div class="grid gap-3 sm:grid-cols-2">
                  <ActionCard
                    v-for="item in group.packages"
                    :key="item.id"
                    data-testid="package-row"
                    :title="item.name"
                    :description="`${item.kind} · ${item.port}`"
                    @click="openPackage(item.id)"
                  >
                    <template #icon>
                      <Smartphone v-if="item.id === 'avd-34'" />
                      <Box v-else />
                    </template>
                  </ActionCard>
                </div>
              </section>
            </div>
          </section>

          <section v-else class="tactical-paper-surface min-h-0 flex-1 overflow-auto bg-card" :aria-label="t('自定义任务', 'Custom jobs')">
            <div class="min-w-[720px]">
              <div class="tactical-desk-head tactical-table-head grid h-12 grid-cols-[minmax(220px,1fr)_80px_88px_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
                <span>{{ t('任务', 'Job') }}</span><span>{{ t('范围', 'Scope') }}</span><span>{{ t('环境', 'Environment') }}</span><span class="sr-only">{{ t('打开', 'Open') }}</span>
              </div>
              <article class="tactical-row grid min-h-[72px] grid-cols-[minmax(220px,1fr)_80px_88px_72px] items-center gap-4 px-6">
                <span class="truncate text-control font-medium">{{ t('本机 8081 探测', 'Local 8081 probe') }}</span>
                <span class="text-body">{{ t('本地', 'Local') }}</span>
                <span class="text-caption">{{ t('用户目标', 'User target') }}</span>
                <Button size="sm" variant="outline" @click="labJobId = 'url-job'">{{ t('打开', 'Open') }}</Button>
              </article>
            </div>
          </section>
        </template>

        <template v-else-if="section === 'lab'">
          <WorkspaceModuleTopBar module="lab" :title="labJobId === 'url-job' ? t('本机 8081 探测', 'Local 8081 probe') : t('Juice Shop 练习', 'Juice Shop practice')" :subtitle="t('本地', 'Local')">
            <template #leading>
              <Button variant="ghost" size="icon-sm" :aria-label="t('返回实验室', 'Back to Lab')" @click="labJobId = ''; targetOpen = false; agentDriving = false">
                <ArrowLeft class="size-4" />
              </Button>
            </template>
            <template #actions>
              <Button variant="outline" size="sm" @click="expandToCoding('lab')">{{ t('进入 Coding', 'Open in Coding') }}</Button>
            </template>
          </WorkspaceModuleTopBar>
          <div class="flex min-h-0 flex-1 overflow-hidden" data-dossier-split>
            <div
              class="page-scroll min-w-0"
              :class="targetOpen && labLease.address ? '' : 'flex-1'"
              :style="targetOpen && labLease.address ? { width: `${briefWidth}px`, flex: 'none' } : undefined"
            >
              <div class="page-stack" :class="targetOpen && labLease.address ? 'page-stack--flush' : 'page-column'">
                <SettingsSection :title="t('题面', 'Brief')">
                  <SettingsRow
                    stack="always"
                    :description="labJobId === 'url-job' ? t('扫一下本机 8081。', 'Probe local port 8081.') : t('对 Juice Shop 做一轮授权练习，过程写入报告。', 'Run an authorized Juice Shop practice round and write the process into the report.')"
                    :divider="false"
                  />
                </SettingsSection>
                <EnvironmentStrip
                  :lease="labLease"
                  @start="startJuice"
                  @stop="stopJuice"
                  @open-target="openTarget"
                  @retry="retryDocker"
                />
                <SettingsSection :title="t('报告', 'Report')">
                  <SettingsRow stack="always" :description="t('摘要、范围、当前状况、步骤会写在 report.md。', 'Summary, scope, current status, and steps are written to report.md.')" :divider="false" />
                </SettingsSection>
              </div>
            </div>
            <div v-if="targetOpen && labLease.address" class="relative flex min-h-0 min-w-0 flex-1">
              <div
                class="dossier-split-handle app-no-drag"
                role="separator"
                aria-orientation="vertical"
                data-testid="dossier-split"
                :aria-label="t('调节题面宽度', 'Resize the brief pane')"
                @pointerdown="startBriefResize"
              />
              <TargetSurfacePreview
                :kind="targetKind"
                :address="labLease.address"
                :driving="agentDriving"
              />
            </div>
          </div>
        </template>

        <template v-else-if="section === 'vuln' && !cveId">
          <WorkspaceModuleTopBar module="cve" title="CVE" />
          <section class="tactical-paper-surface min-h-0 flex-1 overflow-auto bg-card" :aria-label="t('CVE 列表', 'CVE list')">
            <div class="min-w-[720px]">
              <div class="tactical-desk-head tactical-table-head grid h-12 grid-cols-[170px_minmax(240px,1fr)_88px_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
                <span>CVE</span><span>{{ t('标题', 'Title') }}</span><span>{{ t('状态', 'Status') }}</span><span class="sr-only">{{ t('打开', 'Open') }}</span>
              </div>
              <article class="tactical-row grid min-h-[72px] grid-cols-[170px_minmax(240px,1fr)_88px_72px] items-center gap-4 px-6" data-testid="cve-row">
                <span class="font-mono text-body">CVE-2023-46604</span>
                <span class="truncate text-control font-medium">Apache ActiveMQ OpenWire RCE</span>
                <span class="ak-tag ak-tag--compact">{{ t('研究中', 'In research') }}</span>
                <Button size="sm" variant="outline" data-testid="open-cve-ready" @click="cveId = 'CVE-2023-46604'">{{ t('打开', 'Open') }}</Button>
              </article>
              <article class="tactical-row grid min-h-[72px] grid-cols-[170px_minmax(240px,1fr)_88px_72px] items-center gap-4 px-6">
                <span class="font-mono text-body">CVE-2024-3400</span>
                <span class="truncate text-control font-medium">{{ t('PAN-OS GlobalProtect 命令注入', 'PAN-OS GlobalProtect command injection') }}</span>
                <span class="ak-tag ak-tag--compact ak-tag--neutral">{{ t('想研究', 'Want to research') }}</span>
                <Button size="sm" variant="outline" data-testid="open-cve-none" @click="cveId = 'CVE-2024-3400'">{{ t('打开', 'Open') }}</Button>
              </article>
            </div>
          </section>
        </template>

        <template v-else-if="section === 'vuln'">
          <WorkspaceModuleTopBar
            module="cve"
            :title="cveId"
            :subtitle="cveId === 'CVE-2024-3400' ? t('PAN-OS GlobalProtect 命令注入', 'PAN-OS GlobalProtect command injection') : 'Apache ActiveMQ OpenWire RCE'"
          >
            <template #leading>
              <Button variant="ghost" size="icon-sm" :aria-label="t('返回漏洞列表', 'Back to CVE list')" @click="cveId = ''; targetOpen = false; agentDriving = false">
                <ArrowLeft class="size-4" />
              </Button>
            </template>
            <template #actions>
              <NativeSelect model-value="研究中" size="sm" class="w-32" :aria-label="t('状态', 'Status')">
                <NativeSelectOption v-for="option in cveStatusOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </NativeSelectOption>
              </NativeSelect>
              <Button variant="brand" size="sm" data-testid="start-repro" @click="startRepro">{{ t('开始复现', 'Start reproduction') }}</Button>
            </template>
          </WorkspaceModuleTopBar>
          <div class="flex min-h-0 flex-1 overflow-hidden" data-dossier-split>
            <div
              class="page-scroll min-w-0"
              :class="targetOpen && cveLease.address ? '' : 'flex-1'"
              :style="targetOpen && cveLease.address ? { width: `${briefWidth}px`, flex: 'none' } : undefined"
            >
              <div class="page-stack" :class="targetOpen && cveLease.address ? 'page-stack--flush' : 'page-column'">
                <SettingsSection :title="t('摘要', 'Summary')">
                  <SettingsRow
                    stack="always"
                    :description="cveId === 'CVE-2024-3400'
                      ? t('公开描述可在档案里复现阅读。当前切片没有匹配的练习包。', 'The public description can be reread in the dossier. This slice has no matching practice package.')
                      : t('OpenWire 反序列化导致远程代码执行。有白名单练习包时可在本机拉起。', 'OpenWire deserialization leads to remote code execution. An allowlisted practice package can be started locally.')"
                    :divider="false"
                  />
                </SettingsSection>
                <EnvironmentStrip
                  :lease="cveLease"
                  @start="startJuice"
                  @stop="stopJuice"
                  @open-target="openTarget"
                  @retry="retryDocker"
                />
                <SettingsSection :title="t('报告', 'Report')">
                  <SettingsRow stack="always" :description="t('环境就绪不等于复现成功。过程写入 report.md。', 'A ready environment is not a successful reproduction. The process is written to report.md.')" :divider="false" />
                </SettingsSection>
              </div>
            </div>
            <div v-if="targetOpen && cveLease.address" class="relative flex min-h-0 min-w-0 flex-1">
              <div
                class="dossier-split-handle app-no-drag"
                role="separator"
                aria-orientation="vertical"
                data-testid="dossier-split"
                :aria-label="t('调节档案宽度', 'Resize the dossier pane')"
                @pointerdown="startBriefResize"
              />
              <TargetSurfacePreview
                :kind="targetKind"
                :address="cveLease.address"
                :driving="agentDriving"
              />
            </div>
          </div>
        </template>

        <template v-else-if="section === 'chat'">
          <WorkspaceModuleTopBar module="coding" title="Coding" :subtitle="codingFrom === 'lab' ? t('来自实验室', 'From Lab') : t('来自 CVE', 'From CVE')">
            <template #actions>
              <Button variant="outline" size="sm" data-testid="return-domain" @click="returnFromCoding">
                <RotateCcw class="size-3.5" />
                {{ codingFrom === 'lab' ? t('返回实验室', 'Back to Lab') : t('返回 CVE', 'Back to CVE') }}
              </Button>
            </template>
          </WorkspaceModuleTopBar>
          <div class="flex min-h-0 flex-1">
            <aside class="flex w-80 shrink-0 flex-col border-r border-border bg-card" :aria-label="t('任务信息', 'Job info')">
              <header class="flex h-12 items-center gap-2 px-4 text-control font-medium">
                {{ codingFrom === 'lab' ? t('来自实验室', 'From Lab') : t('来自 CVE', 'From CVE') }}
              </header>
              <div class="space-y-3 px-4 py-4 text-body">
                <p class="font-medium">{{ codingFrom === 'lab' ? t('Juice Shop 练习', 'Juice Shop practice') : 'CVE-2023-46604' }}</p>
                <p class="text-caption text-muted-foreground">{{ t('同一会话 · 展开不算离开作业', 'Same session · expanding is not leaving the job') }}</p>
                <EnvironmentStrip compact :lease="codingLease" @start="startJuice" @stop="stopJuice" @open-target="targetOpen = true" @retry="retryDocker" />
              </div>
            </aside>
            <section class="flex min-w-0 flex-1 flex-col">
              <div class="min-h-0 flex-1 px-6 py-6 text-body text-muted-foreground">
                {{ t('Coding 大窗。Agent 只打 Scope 里的当前靶。实验室不嵌整页 Agent。', 'Coding full window. The agent only hits the current target in Scope. Lab does not embed a full-page agent.') }}
              </div>
              <div class="border-t border-border px-6 py-3">
                <p v-if="codingLease.address" class="mb-2 text-caption" data-testid="coding-target-chip">{{ t(`当前靶 ${codingLease.address}`, `Current target ${codingLease.address}`) }}</p>
                <Input disabled :placeholder="t('对话仍是同一条 Coding 会话', 'Chat is still the same Coding session')" />
              </div>
            </section>
          </div>
        </template>
      </main>
    </div>

    <aside
      v-if="section !== 'chat' && ((section === 'lab' && labJobId) || (section === 'vuln' && cveId))"
      class="pointer-events-auto fixed bottom-5 right-5 z-40 w-80 rounded-xl border border-border bg-card shadow-xl"
      data-testid="preview-dock"
    >
      <header class="flex h-9 items-center gap-2 border-b border-border px-3 text-caption">
        <strong class="text-control">{{ t('对话', 'Chat') }}</strong>
        <span class="min-w-0 flex-1 truncate text-muted-foreground">{{ t('引用 Coding', 'Cite Coding') }}</span>
        <span v-if="(section === 'lab' ? labLease.address : cveLease.address)" class="truncate text-caption">
          {{ t(`当前靶 ${section === 'lab' ? labLease.address : cveLease.address}`, `Current target ${section === 'lab' ? labLease.address : cveLease.address}`) }}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          :aria-label="t('进入 Coding', 'Open Coding')"
          data-testid="expand-coding"
          @click="expandToCoding(section === 'lab' ? 'lab' : 'cve')"
        >
          <Maximize2 class="size-3.5" />
        </Button>
      </header>
      <p class="px-3 py-3 text-caption text-muted-foreground">{{ t('小窗就是 Coding 循环。需要终端或 Git 再展开。', 'The small pane is the Coding loop. Expand when you need a terminal or Git.') }}</p>
    </aside>



    <Dialog v-model:open="showNew">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{{ t('自定义任务', 'Custom job') }}</DialogTitle>
          <DialogDescription class="sr-only">{{ t('范围和要求', 'Scope and request') }}</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="submitNew">
          <div>
            <p class="mb-2 text-caption text-muted-foreground">{{ t('范围', 'Scope') }}</p>
            <SegmentedControl v-model="newSource" :aria-label="t('范围', 'Scope')" :items="sourceItems" />
          </div>
          <label class="text-caption text-muted-foreground">{{ t('要求', 'Request') }}
            <textarea class="mt-1 min-h-24 w-full rounded-md border border-border px-3 py-2 text-body" :aria-label="t('要求', 'Request')" />
          </label>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="ghost" @click="showNew = false">{{ t('取消', 'Cancel') }}</Button>
            <Button type="submit" variant="brand">{{ t('启动并打开', 'Start and open') }}</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="showReproAsk">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ t('这个洞有练习包。先启动？', 'This CVE has a practice package. Start it first?') }}</DialogTitle>
        </DialogHeader>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" @click="showReproAsk = false">{{ t('只写报告', 'Report only') }}</Button>
          <Button variant="brand" data-testid="start-and-repro" @click="confirmStartAndRepro">{{ t('启动并复现', 'Start and reproduce') }}</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>

<style scoped>
.dossier-split-handle {
  position: absolute;
  inset: 0 auto 0 0;
  z-index: 2;
  width: 8px;
  margin-left: -3px;
  cursor: col-resize;
  touch-action: none;
  border: 0;
  padding: 0;
  background: transparent;
}
.dossier-split-handle::after {
  position: absolute;
  inset: 0 3px;
  background: transparent;
  content: '';
}
.dossier-split-handle:hover::after,
.dossier-split-handle:focus-visible::after {
  background: var(--brand);
  opacity: .55;
}
</style>
