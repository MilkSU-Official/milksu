<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import {
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
} from '@felinic/ui'
import { ArrowLeft, Maximize2, Plus, RotateCcw } from 'lucide-vue-next'
import WorkspaceModuleTopBar from '@/components-vue/WorkspaceModuleTopBar.vue'
import WorkspaceRail from '@/components-vue/WorkspaceRail.vue'
import EnvironmentStrip from '@/components-vue/lab-env/EnvironmentStrip.vue'
import TargetSurfacePreview from '@/components-vue/lab-env/TargetSurfacePreview.vue'
import type { EnvironmentLease, TargetSurfaceKind } from '@/components-vue/lab-env/environmentTypes'
import type { AccountStatus } from '@/types'
import type { ThemeMode } from '@/lib/themeMode'
import type { AppSection, WorkspaceSection } from '@/lib/workspaceNavigation'

defineOptions({ name: 'LabEnvironmentPreview' })

type LabTab = 'jobs' | 'packages'
type SourceKind = 'package' | 'local' | 'remote'
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
  user: { githubLogin: 'preview', displayName: '交互稿', avatarUrl: '' },
}
const themeMode = ref<ThemeMode>('dark')
const section = ref<AppSection>('lab')
const labTab = ref<LabTab>('packages')
const labJobId = ref('')
const cveId = ref('')
const codingFrom = ref<'lab' | 'cve'>('cve')
const showNew = ref(false)
const showReproAsk = ref(false)
const newSource = ref<SourceKind>('package')
const selectedPackageId = ref('juice-shop')
const dockerOk = ref(true)
const targetOpen = ref(false)
const agentDriving = ref(false)
const targetKind = ref<TargetSurfaceKind>('browser')

const juiceLease = ref<EnvironmentLease>({
  provider: 'docker',
  state: 'stopped',
  packageName: 'OWASP Juice Shop',
  detail: 'Docker · 无出网',
})

const packages = [
  { id: 'juice-shop', name: 'OWASP Juice Shop', kind: 'Web', port: ':3000', size: '约 400MB' },
  { id: 'webgoat', name: 'WebGoat', kind: 'Web', port: ':8080', size: '约 800MB' },
  { id: 'activemq', name: 'Vulhub ActiveMQ', kind: 'Linux', port: ':61616', size: '约 350MB' },
  { id: 'avd-34', name: 'Android API 34', kind: '模拟器', port: 'adb', size: '本机 AVD' },
] as const

const sourceItems = [
  { value: 'package' as const, label: '题目包' },
  { value: 'local' as const, label: '本机地址' },
  { value: 'remote' as const, label: '远程' },
]
const labTabItems = [
  { value: 'jobs' as const, label: '作业' },
  { value: 'packages' as const, label: '题目包' },
]
const screenItems = [
  { value: 'lab-packages' as const, label: '实验室·包' },
  { value: 'lab-job' as const, label: '实验室·作业' },
  { value: 'cve-ready' as const, label: 'CVE·有包' },
  { value: 'cve-live' as const, label: '网页靶' },
  { value: 'cve-shell' as const, label: '终端靶' },
  { value: 'cve-emulator' as const, label: '模拟器' },
  { value: 'cve-agent' as const, label: 'Agent 操作' },
  { value: 'cve-none' as const, label: 'CVE·无包' },
  { value: 'coding-from-cve' as const, label: '展开 Coding' },
  { value: 'docker-down' as const, label: 'Docker 未运行' },
]
const cveStatusOptions = [
  { value: '研究中', label: '研究中' },
  { value: '想研究', label: '想研究' },
]

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
  detail: '没有匹配的练习包。仍可按公开描述写报告。',
}))
const dockerDownLease = computed<EnvironmentLease>(() => ({
  provider: 'docker',
  state: 'docker-down',
  packageName: 'OWASP Juice Shop',
  detail: '打开 Docker Desktop 后再试。',
}))
const userTargetLease = computed<EnvironmentLease>(() => ({
  provider: 'user-attached',
  state: 'ready',
  packageName: '用户自带靶',
  address: 'http://127.0.0.1:8081',
  detail: '本机地址 · 不由 MilkSU 启动',
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
      detail: 'Docker · 无出网',
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
        detail: 'Docker · 无出网',
      }
    } else if (next === 'cve-emulator') {
      juiceLease.value = {
        provider: 'avd',
        state: 'ready',
        packageName: 'Android API 34',
        address: 'emulator-5554',
        detail: '本机 AVD · 受限 adb',
      }
    } else {
      juiceLease.value = {
        provider: 'docker',
        state: 'ready',
        packageName: 'OWASP Juice Shop',
        address: '127.0.0.1:3000',
        detail: 'Docker · 无出网',
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
      detail: 'Docker · 无出网',
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
    detail: 'Docker · 无出网',
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
    detail: 'Docker · 无出网',
  }
}

function stopJuice() {
  juiceLease.value = {
    provider: 'docker',
    state: 'stopped',
    packageName: 'OWASP Juice Shop',
    detail: 'Docker · 无出网',
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
      detail: '本机 AVD · 受限 adb',
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
      detail: 'Docker · 无出网',
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
  if (newSource.value === 'package' && selectedPackageId.value === 'juice-shop') {
    startJuice()
    labJobId.value = 'juice-job'
    return
  }
  if (newSource.value !== 'package') labJobId.value = 'url-job'
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
  if (screenItems.some(item => item.value === hash)) applyScreen(hash)
})
</script>

<template>
  <div class="flex h-screen min-h-0 flex-col bg-background text-foreground" data-testid="lab-env-preview">
    <p class="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-card px-4 text-caption">
      <span class="text-muted-foreground">交互稿 · 真组件 · 不写后端</span>
      <SegmentedControl
        class="ml-auto"
        :model-value="screen"
        :items="screenItems"
        aria-label="画面"
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
          <WorkspaceModuleTopBar module="lab" title="实验室">
            <template #actions>
              <SegmentedControl v-model="labTab" aria-label="实验室分段" :items="labTabItems" />
              <Button variant="brand" size="sm" @click="showNew = true">
                <Plus class="size-4" />
                新作业
              </Button>
            </template>
          </WorkspaceModuleTopBar>

          <section v-if="labTab === 'packages'" class="min-h-0 flex-1 overflow-auto bg-background" aria-label="题目包">
            <div class="grid gap-4 px-6 py-6 sm:grid-cols-2">
              <article
                v-for="item in packages"
                :key="item.id"
                class="rounded-xl border border-border bg-card p-5"
                data-testid="package-row"
              >
                <span class="ak-tag ak-tag--compact">{{ item.kind }}</span>
                <h2 class="mt-3 text-control font-medium">{{ item.name }}</h2>
                <p class="mt-2 text-caption text-muted-foreground">{{ item.port }} · {{ item.size }}</p>
                <Button
                  class="mt-4"
                  size="sm"
                  variant="outline"
                  data-testid="start-package"
                  @click="openPackage(item.id)"
                >
                  打开
                </Button>
              </article>
            </div>
          </section>

          <section v-else class="tactical-paper-surface min-h-0 flex-1 overflow-auto bg-card" aria-label="实验室列表">
            <div class="min-w-[720px]">
              <div class="tactical-desk-head tactical-table-head grid h-12 grid-cols-[minmax(220px,1fr)_80px_88px_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
                <span>作业</span><span>范围</span><span>环境</span><span class="sr-only">打开</span>
              </div>
              <article class="tactical-row grid min-h-[72px] grid-cols-[minmax(220px,1fr)_80px_88px_72px] items-center gap-4 px-6">
                <span class="truncate text-control font-medium">Juice Shop 练习</span>
                <span class="text-body">本地</span>
                <span class="text-caption">{{ juiceLease.state === 'ready' ? '就绪' : '已停止' }}</span>
                <Button size="sm" variant="outline" data-testid="open-juice-job" @click="labJobId = 'juice-job'">打开</Button>
              </article>
              <article class="tactical-row grid min-h-[72px] grid-cols-[minmax(220px,1fr)_80px_88px_72px] items-center gap-4 px-6">
                <span class="truncate text-control font-medium">本机 8081 探测</span>
                <span class="text-body">本地</span>
                <span class="text-caption">自带靶</span>
                <Button size="sm" variant="outline" @click="labJobId = 'url-job'">打开</Button>
              </article>
            </div>
          </section>
        </template>

        <template v-else-if="section === 'lab'">
          <WorkspaceModuleTopBar module="lab" :title="labJobId === 'url-job' ? '本机 8081 探测' : 'Juice Shop 练习'" subtitle="本地">
            <template #leading>
              <Button variant="ghost" size="icon-sm" aria-label="返回实验室" @click="labJobId = ''; targetOpen = false; agentDriving = false">
                <ArrowLeft class="size-4" />
              </Button>
            </template>
            <template #actions>
              <Button variant="brand" size="sm" @click="openTarget(); agentDriving = true">开始</Button>
            </template>
          </WorkspaceModuleTopBar>
          <div class="flex min-h-0 flex-1 overflow-hidden">
            <div class="min-h-0 min-w-0 flex-1 overflow-auto" :class="targetOpen ? 'max-w-md border-r border-border' : ''">
              <div class="space-y-5 px-6 py-6" :class="targetOpen ? '' : 'mx-auto max-w-5xl'">
                <section class="rounded-xl border border-border bg-card p-6">
                  <h2 class="text-label font-medium">作业</h2>
                  <p class="mt-3 text-body leading-6">{{ labJobId === 'url-job' ? '扫一下本机 8081。' : '对 Juice Shop 做一轮授权练习，过程写入报告。' }}</p>
                </section>
                <EnvironmentStrip
                  :lease="labLease"
                  @start="startJuice"
                  @stop="stopJuice"
                  @open-target="openTarget"
                  @retry="retryDocker"
                />
                <section class="rounded-xl border border-border bg-card p-6">
                  <h2 class="text-label font-medium">报告</h2>
                  <p class="mt-3 text-body leading-6 text-muted-foreground">摘要、范围、当前状况、步骤会写在 report.md。</p>
                </section>
                <section v-if="targetOpen" class="rounded-xl border border-border bg-card p-4">
                  <p class="text-caption text-muted-foreground">对话 · 引用 Coding</p>
                  <p class="mt-2 text-body">先看右边的活靶。Agent 动手时你能看见。</p>
                  <Input class="mt-3" disabled placeholder="对这个靶说你想做什么" />
                </section>
              </div>
            </div>
            <TargetSurfacePreview
              v-if="targetOpen && labLease.address"
              :kind="targetKind"
              :address="labLease.address"
              :driving="agentDriving"
            />
          </div>
        </template>

        <template v-else-if="section === 'vuln' && !cveId">
          <WorkspaceModuleTopBar module="cve" title="CVE" />
          <section class="tactical-paper-surface min-h-0 flex-1 overflow-auto bg-card" aria-label="CVE 列表">
            <div class="min-w-[720px]">
              <div class="tactical-desk-head tactical-table-head grid h-12 grid-cols-[170px_minmax(240px,1fr)_88px_72px] items-center gap-4 border-b border-border px-6 text-caption text-muted-foreground">
                <span>CVE</span><span>标题</span><span>状态</span><span class="sr-only">打开</span>
              </div>
              <article class="tactical-row grid min-h-[72px] grid-cols-[170px_minmax(240px,1fr)_88px_72px] items-center gap-4 px-6" data-testid="cve-row">
                <span class="font-mono text-body">CVE-2023-46604</span>
                <span class="truncate text-control font-medium">Apache ActiveMQ OpenWire RCE</span>
                <span class="ak-tag ak-tag--compact">研究中</span>
                <Button size="sm" variant="outline" data-testid="open-cve-ready" @click="cveId = 'CVE-2023-46604'">打开</Button>
              </article>
              <article class="tactical-row grid min-h-[72px] grid-cols-[170px_minmax(240px,1fr)_88px_72px] items-center gap-4 px-6">
                <span class="font-mono text-body">CVE-2024-3400</span>
                <span class="truncate text-control font-medium">PAN-OS GlobalProtect 命令注入</span>
                <span class="ak-tag ak-tag--compact ak-tag--neutral">想研究</span>
                <Button size="sm" variant="outline" data-testid="open-cve-none" @click="cveId = 'CVE-2024-3400'">打开</Button>
              </article>
            </div>
          </section>
        </template>

        <template v-else-if="section === 'vuln'">
          <WorkspaceModuleTopBar
            module="cve"
            :title="cveId"
            :subtitle="cveId === 'CVE-2024-3400' ? 'PAN-OS GlobalProtect 命令注入' : 'Apache ActiveMQ OpenWire RCE'"
          >
            <template #leading>
              <Button variant="ghost" size="icon-sm" aria-label="返回漏洞列表" @click="cveId = ''; targetOpen = false; agentDriving = false">
                <ArrowLeft class="size-4" />
              </Button>
            </template>
            <template #actions>
              <NativeSelect model-value="研究中" size="sm" class="w-32" aria-label="状态">
                <NativeSelectOption v-for="option in cveStatusOptions" :key="option.value" :value="option.value">
                  {{ option.label }}
                </NativeSelectOption>
              </NativeSelect>
              <Button variant="brand" size="sm" data-testid="start-repro" @click="startRepro">开始复现</Button>
            </template>
          </WorkspaceModuleTopBar>
          <div class="flex min-h-0 flex-1 overflow-hidden">
            <div class="min-h-0 min-w-0 flex-1 overflow-auto" :class="targetOpen ? 'max-w-md border-r border-border' : ''">
              <div class="space-y-5 px-6 py-6" :class="targetOpen ? '' : 'mx-auto max-w-5xl'">
                <section class="rounded-xl border border-border bg-card p-6">
                  <p class="text-body leading-6 text-muted-foreground">
                    {{ cveId === 'CVE-2024-3400'
                      ? '公开描述可在档案里复现阅读。当前切片没有匹配的练习包。'
                      : 'OpenWire 反序列化导致远程代码执行。有白名单练习包时可在本机拉起。' }}
                  </p>
                </section>
                <EnvironmentStrip
                  :lease="cveLease"
                  @start="startJuice"
                  @stop="stopJuice"
                  @open-target="openTarget"
                  @retry="retryDocker"
                />
                <section class="rounded-xl border border-border bg-card p-6">
                  <h2 class="text-label font-medium">报告</h2>
                  <p class="mt-3 text-body leading-6 text-muted-foreground">环境就绪不等于复现成功。过程写入 report.md。</p>
                </section>
                <section v-if="targetOpen" class="rounded-xl border border-border bg-card p-4">
                  <p class="text-caption text-muted-foreground">对话 · 引用 Coding</p>
                  <p class="mt-2 text-body">右侧是活靶面（网页 / 终端 / 模拟器）。Agent 打同一面，步骤写进报告。</p>
                  <Input class="mt-3" disabled placeholder="继续指挥这一轮复现" />
                </section>
              </div>
            </div>
            <TargetSurfacePreview
              v-if="targetOpen && cveLease.address"
              :kind="targetKind"
              :address="cveLease.address"
              :driving="agentDriving"
            />
          </div>
        </template>

        <template v-else-if="section === 'chat'">
          <WorkspaceModuleTopBar module="coding" title="Coding" :subtitle="codingFrom === 'lab' ? '来自实验室' : '来自 CVE'">
            <template #actions>
              <Button variant="outline" size="sm" data-testid="return-domain" @click="returnFromCoding">
                <RotateCcw class="size-3.5" />
                {{ codingFrom === 'lab' ? '返回实验室' : '返回 CVE' }}
              </Button>
            </template>
          </WorkspaceModuleTopBar>
          <div class="flex min-h-0 flex-1">
            <aside class="flex w-80 shrink-0 flex-col border-r border-border bg-card" aria-label="任务信息">
              <header class="flex h-12 items-center gap-2 px-4 text-control font-medium">
                来自 {{ codingFrom === 'lab' ? '实验室' : 'CVE' }}
              </header>
              <div class="space-y-3 px-4 py-4 text-body">
                <p class="font-medium">{{ codingFrom === 'lab' ? 'Juice Shop 练习' : 'CVE-2023-46604' }}</p>
                <p class="text-caption text-muted-foreground">同一会话 · 展开不算离开作业</p>
                <EnvironmentStrip compact :lease="codingLease" @start="startJuice" @stop="stopJuice" @open-target="targetOpen = true" @retry="retryDocker" />
              </div>
            </aside>
            <section class="flex min-w-0 flex-1 flex-col">
              <div class="min-h-0 flex-1 px-6 py-6 text-body text-muted-foreground">
                Coding 大窗。Agent 只打 Scope 里的当前靶。实验室不嵌整页 Agent。
              </div>
              <div class="border-t border-border px-6 py-3">
                <p v-if="codingLease.address" class="mb-2 text-caption" data-testid="coding-target-chip">当前靶 {{ codingLease.address }}</p>
                <Input disabled placeholder="对话仍是同一条 Coding 会话" />
              </div>
            </section>
          </div>
        </template>
      </main>
    </div>

    <aside
      v-if="!targetOpen && (section === 'lab' && labJobId || section === 'vuln' && cveId)"
      class="pointer-events-auto fixed bottom-5 right-5 z-40 w-80 rounded-xl border border-border bg-card shadow-xl"
      data-testid="preview-dock"
    >
      <header class="flex h-9 items-center gap-2 border-b border-border px-3 text-caption">
        <strong class="text-control">对话</strong>
        <span class="min-w-0 flex-1 truncate text-muted-foreground">引用 Coding</span>
        <span v-if="(section === 'lab' ? labLease.address : cveLease.address)" class="truncate text-caption">
          当前靶 {{ section === 'lab' ? labLease.address : cveLease.address }}
        </span>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label="进入 Coding"
          data-testid="expand-coding"
          @click="expandToCoding(section === 'lab' ? 'lab' : 'cve')"
        >
          <Maximize2 class="size-3.5" />
        </Button>
      </header>
      <p class="px-3 py-3 text-caption text-muted-foreground">小窗就是 Coding 循环。需要终端或 Git 再展开。</p>
    </aside>



    <Dialog v-model:open="showNew">
      <DialogContent class="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>新作业</DialogTitle>
          <DialogDescription class="sr-only">来源和练习包</DialogDescription>
        </DialogHeader>
        <form class="grid gap-4" @submit.prevent="submitNew">
          <div>
            <p class="mb-2 text-caption text-muted-foreground">来源</p>
            <SegmentedControl v-model="newSource" aria-label="来源" :items="sourceItems" />
          </div>
          <button
            v-if="newSource === 'package'"
            type="button"
            class="rounded-md border border-border px-3 py-3 text-left"
            data-testid="pick-juice"
            @click="selectedPackageId = 'juice-shop'"
          >
            <span class="text-control font-medium">OWASP Juice Shop</span>
            <span class="mt-1 block text-caption text-muted-foreground">Web 练习靶 · :3000</span>
          </button>
          <label v-else class="text-caption text-muted-foreground">要求
            <textarea class="mt-1 min-h-24 w-full rounded-md border border-border px-3 py-2 text-body" aria-label="要求" />
          </label>
          <div class="flex justify-end gap-2">
            <Button type="button" variant="ghost" @click="showNew = false">取消</Button>
            <Button type="submit" variant="brand">启动并打开</Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <Dialog v-model:open="showReproAsk">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>这个洞有练习包。先启动？</DialogTitle>
        </DialogHeader>
        <div class="flex justify-end gap-2">
          <Button variant="ghost" @click="showReproAsk = false">只写报告</Button>
          <Button variant="brand" data-testid="start-and-repro" @click="confirmStartAndRepro">启动并复现</Button>
        </div>
      </DialogContent>
    </Dialog>
  </div>
</template>
