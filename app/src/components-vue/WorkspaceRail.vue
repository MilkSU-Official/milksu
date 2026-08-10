<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Badge, Button } from '@felinic/ui'
import {
  Bug,
  Code2,
  Flag,
  Moon,
  Settings,
  Sun,
  X,
} from 'lucide-vue-next'
import milksuAppIcon from '@/assets/milksu-app-icon.png'
import AbilityRadar from '@/components-vue/AbilityRadar.vue'
import { useNSSCTFTraining } from '@/composables/useNSSCTFTraining'
import { invokeCommand } from '@/desktop'
import type { ThemeMode } from '@/lib/themeMode'
import type { BuildTracking } from '@/types'
import {
  WORKSPACE_RAIL_ITEMS,
  type WorkspaceSection,
} from '@/lib/workspaceNavigation'

const props = defineProps<{
  activeSection: WorkspaceSection | 'settings'
  themeMode: ThemeMode
}>()

const emit = defineEmits<{
  navigate: [value: WorkspaceSection]
  settings: []
  toggleTheme: []
}>()

const icons = {
  ctf: Flag,
  vuln: Bug,
  chat: Code2,
} as const

const abilityOpen = ref(false)
const training = useNSSCTFTraining()
const buildTracking = ref<BuildTracking | null>(null)
let abilityCloseTimer: number | undefined

const abilityLoading = training.loading
const abilityError = training.error
const abilityDimensions = computed(() => training.dashboard.value?.dimensions ?? [])
const judgeVerifiedSolvedCount = computed(() => (
  training.dashboard.value?.judgeVerifiedSolvedCount ?? 0
))
const userConfirmedSolvedCount = computed(() => (
  training.dashboard.value?.userConfirmedSolvedCount ?? 0
))
// Only packaged beta identity shows the badge; Stable and development shells stay clean.
const isBetaChannel = computed(() => {
  if (buildTracking.value?.development) return false
  if (buildTracking.value?.missing) return false
  return String(buildTracking.value?.channel ?? '').toLowerCase() === 'beta'
    && String(buildTracking.value?.appId ?? '') === 'com.milksu.app.beta'
})
const themeToggleLabel = computed(() => (
  props.themeMode === 'dark' ? '切换到日间模式' : '切换到夜间模式'
))
const ThemeToggleIcon = computed(() => (
  props.themeMode === 'dark' ? Sun : Moon
))

onMounted(() => {
  void invokeCommand<BuildTracking>('get_build_tracking')
    .then(value => { buildTracking.value = value })
    .catch(() => { buildTracking.value = null })
})

async function toggleAbilityProfile() {
  cancelAbilityClose()
  abilityOpen.value = !abilityOpen.value
  if (abilityOpen.value && !training.dashboard.value && !abilityLoading.value) {
    await training.load()
  }
}

function cancelAbilityClose() {
  if (abilityCloseTimer !== undefined) window.clearTimeout(abilityCloseTimer)
  abilityCloseTimer = undefined
}

function scheduleAbilityClose() {
  cancelAbilityClose()
  if (!abilityOpen.value) return
  abilityCloseTimer = window.setTimeout(() => {
    abilityOpen.value = false
    abilityCloseTimer = undefined
  }, 180)
}

onBeforeUnmount(cancelAbilityClose)

function navigate(value: WorkspaceSection) {
  abilityOpen.value = false
  emit('navigate', value)
}

function openSettings() {
  abilityOpen.value = false
  emit('settings')
}
</script>

<template>
  <div
    class="app-drag relative flex w-[4.75rem] shrink-0 flex-col border-r border-border bg-sidebar"
    data-shell-traffic-safe
  >
    <!--
      Shell traffic-light safe region: pairs with BrowserWindow titleBarStyle hiddenInset
      and trafficLightPosition. Uses layout padding (not screenshot hardcoding) so the
      logo / first nav control stays below the red-yellow-green cluster on macOS.
    -->
    <div
      class="workspace-rail-traffic-safe relative flex items-end justify-center border-b border-border"
      @pointerenter="cancelAbilityClose"
      @pointerleave="scheduleAbilityClose"
      @keydown.esc="abilityOpen = false"
    >
      <Button
        variant="ghost"
        size="icon"
        class="app-no-drag relative size-12 rounded-2xl p-1.5"
        aria-label="查看能力画像"
        :aria-expanded="abilityOpen"
        @click="toggleAbilityProfile"
      >
        <img
          :src="milksuAppIcon"
          alt="MilkSU"
          class="size-9 rounded-xl border border-border bg-white object-cover"
        >
        <span
          v-if="isBetaChannel"
          class="pointer-events-none absolute -right-1 -top-1 rounded-md bg-indigo-600 px-1 py-0.5 text-[9px] font-semibold leading-none tracking-wide text-white"
          aria-label="Beta 渠道"
          data-testid="beta-channel-badge"
        >
          BETA
        </span>
      </Button>

      <section
        v-if="abilityOpen"
        class="app-no-drag absolute left-[4.5rem] top-3 z-50 w-80 rounded-2xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
        aria-label="个人能力画像"
      >
        <div class="flex items-start justify-between gap-3">
          <div>
            <p class="text-label font-medium">能力画像</p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">
              只展示有证据的 CTF 训练维度；冷启动方向不会被模型猜测填分。
            </p>
          </div>
          <Button variant="ghost" size="icon-sm" aria-label="关闭能力画像" @click="abilityOpen = false">
            <X class="size-4" />
          </Button>
        </div>

        <div v-if="abilityLoading" class="mt-5 rounded-xl border border-border bg-muted/30 px-3 py-4 text-body text-muted-foreground">
          正在读取本机训练画像
        </div>
        <div v-else-if="abilityError" class="mt-5 rounded-xl border border-destructive/30 bg-destructive/10 px-3 py-4 text-body text-destructive">
          {{ abilityError }}
        </div>
        <template v-else-if="abilityDimensions.length">
          <AbilityRadar class="mt-4" :dimensions="abilityDimensions" />
          <div class="mt-4 flex flex-wrap gap-2">
            <Badge variant="outline">
              Judge 验证 {{ judgeVerifiedSolvedCount }}
            </Badge>
            <Badge variant="secondary">
              用户确认 {{ userConfirmedSolvedCount }}
            </Badge>
          </div>
          <p class="mt-3 text-caption leading-5 text-muted-foreground">
            画像只汇总有证据的维度；Judge 计数不能描述为完整 CTF 成绩。
          </p>
        </template>
        <div v-else class="mt-5 rounded-xl border border-border bg-muted/30 px-3 py-4 text-body text-muted-foreground">
          暂无训练记录。完成真实 Judge 或用户确认步骤后，这里会出现六维画像。
        </div>
      </section>
    </div>

    <nav class="app-no-drag flex flex-col gap-1.5 px-2 py-3" aria-label="全局工作区">
      <Button
        v-for="item in WORKSPACE_RAIL_ITEMS"
        :key="item.id"
        :variant="activeSection === item.id ? 'secondary' : 'ghost'"
        :class="[
          'workspace-rail-item relative h-auto min-h-12 flex-col gap-0.5 px-1 py-1.5',
          activeSection === item.id ? 'workspace-rail-active' : '',
        ]"
        :aria-label="item.label"
        :aria-current="activeSection === item.id ? 'page' : undefined"
        :title="item.label"
        :data-ui-selected="activeSection === item.id ? '' : undefined"
        @click="navigate(item.id)"
      >
        <component :is="icons[item.id]" class="size-4" />
        <span>{{ item.label }}</span>
      </Button>
    </nav>

    <div class="flex-1" />

    <div class="app-no-drag space-y-1.5 border-t border-border p-2">
      <Button
        variant="ghost"
        class="workspace-rail-control relative h-12 w-full"
        :aria-label="themeToggleLabel"
        :title="themeToggleLabel"
        @click="emit('toggleTheme')"
      >
        <component :is="ThemeToggleIcon" class="size-4" />
      </Button>

      <Button
        :variant="activeSection === 'settings' ? 'secondary' : 'ghost'"
        class="workspace-rail-control relative h-12 w-full"
        :class="activeSection === 'settings' ? 'workspace-rail-active' : ''"
        aria-label="设置"
        title="设置"
        :data-ui-selected="activeSection === 'settings' ? '' : undefined"
        @click="openSettings"
      >
        <Settings class="size-4" />
      </Button>
    </div>
  </div>
</template>

<style scoped>
/*
  Traffic-light safe inset for macOS hiddenInset chrome.
  Height + top padding leave a reliable gap under the window controls so the
  logo and first nav item do not sit under the red/yellow/green buttons.
*/
.workspace-rail-traffic-safe {
  box-sizing: border-box;
  min-height: 5.75rem;
  padding-top: 2.1rem;
  padding-bottom: 0.5rem;
}

.workspace-rail-item {
  font-size: var(--text-body);
  line-height: var(--text-body--line-height);
  letter-spacing: var(--text-body--letter-spacing);
}

.workspace-rail-item,
.workspace-rail-control {
  --border-hairline: transparent;
  --selected-border: transparent;
}

.workspace-rail-active {
  color: var(--brand);
}

.workspace-rail-control {
  color: var(--muted-foreground);
}

.workspace-rail-control:hover,
.workspace-rail-control:focus-visible {
  color: var(--foreground);
}

.workspace-rail-active::after {
  position: absolute;
  inset-block: 0.75rem;
  inset-inline-start: 0.125rem;
  width: 0.1875rem;
  border-radius: 999px;
  background: var(--brand);
  content: '';
}
</style>
