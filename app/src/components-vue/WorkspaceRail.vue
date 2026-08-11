<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import { Button } from '@felinic/ui'
import {
  Bug,
  Code2,
  Flag,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Settings,
  Sun,
  UserRound,
} from 'lucide-vue-next'
import profileAvatar from '@/assets/ctf-learner-avatar.png'
import { invokeCommand } from '@/desktop'
import type { ThemeMode } from '@/lib/themeMode'
import type { AccountStatus, BuildTracking } from '@/types'
import {
  WORKSPACE_RAIL_ITEMS,
  type AppSection,
  type WorkspaceSection,
} from '@/lib/workspaceNavigation'

const props = defineProps<{
  activeSection: AppSection
  accountStatus: AccountStatus
  contextAvailable?: boolean
  contextOpen?: boolean
  themeMode: ThemeMode
}>()

const emit = defineEmits<{
  navigate: [value: WorkspaceSection]
  profile: []
  accountLogin: []
  accountLogout: []
  settings: []
  toggleTheme: []
  toggleContext: []
}>()

const icons = {
  ctf: Flag,
  vuln: Bug,
  chat: Code2,
} as const

const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)
const buildTracking = ref<BuildTracking | null>(null)
const avatarSource = computed(() => props.accountStatus.user?.avatarUrl || profileAvatar)

// AbilityRadar.vue is intentionally retained but no longer mounted globally.
// If the six-axis view returns, it belongs to a future evidence-backed CTF-only page,
// never the user's cross-product profile.

const isBetaChannel = computed(() => {
  if (buildTracking.value?.development || buildTracking.value?.missing) return false
  return String(buildTracking.value?.channel ?? '').toLowerCase() === 'beta'
    && String(buildTracking.value?.appId ?? '') === 'com.milksu.app.beta'
})
const themeToggleLabel = computed(() => (
  props.themeMode === 'dark' ? '切换到日间模式' : '切换到夜间模式'
))
const ThemeToggleIcon = computed(() => (
  props.themeMode === 'dark' ? Sun : Moon
))

function closeOnOutsidePointer(event: PointerEvent) {
  if (!menuRoot.value?.contains(event.target as Node)) menuOpen.value = false
}

onMounted(() => {
  document.addEventListener('pointerdown', closeOnOutsidePointer)
  void invokeCommand<BuildTracking>('get_build_tracking')
    .then(value => { buildTracking.value = value })
    .catch(() => { buildTracking.value = null })
})

onBeforeUnmount(() => document.removeEventListener('pointerdown', closeOnOutsidePointer))

function navigate(value: WorkspaceSection) {
  menuOpen.value = false
  emit('navigate', value)
}

function openProfile() {
  menuOpen.value = false
  emit('profile')
}

function openSettings() {
  menuOpen.value = false
  emit('settings')
}
</script>

<template>
  <div
    class="app-drag relative flex w-[4.75rem] shrink-0 flex-col border-r border-border bg-sidebar"
    data-shell-traffic-safe
  >
    <div
      ref="menuRoot"
      class="workspace-rail-traffic-safe relative flex items-end justify-center border-b border-border"
      @keydown.esc="menuOpen = false"
    >
      <Button
        variant="ghost"
        class="app-no-drag relative size-12 rounded-2xl p-1.5"
        aria-label="打开用户菜单"
        :aria-expanded="menuOpen"
        @click.stop="menuOpen = !menuOpen"
      >
        <span class="relative">
          <img
            :src="avatarSource"
            alt="用户头像"
            class="size-9 rounded-full border-2 border-primary bg-white object-cover"
          >
          <i class="absolute bottom-0 right-0 size-3 rounded-full border-2 border-sidebar bg-primary" aria-hidden="true" />
          <span
            v-if="isBetaChannel"
            class="pointer-events-none absolute -right-2 -top-2 rounded-md bg-indigo-600 px-1 py-0.5 text-[9px] font-semibold leading-none tracking-wide text-white"
            aria-label="Beta 渠道"
            data-testid="beta-channel-badge"
          >BETA</span>
        </span>
      </Button>

      <section
        v-if="menuOpen"
        class="app-no-drag absolute left-[4.5rem] top-10 z-50 w-48 overflow-hidden rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
        aria-label="用户菜单"
      >
        <button class="user-menu-item" @click="openProfile"><UserRound class="size-4" />个人资料</button>
        <button class="user-menu-item" @click="openSettings"><Settings class="size-4" />设置</button>
        <button v-if="accountStatus.state === 'active'" class="user-menu-item" @click="menuOpen = false; emit('accountLogout')"><LogOut class="size-4" />退出登录</button>
        <button v-else-if="accountStatus.configured" class="user-menu-item" @click="menuOpen = false; emit('accountLogin')"><LogOut class="size-4 rotate-180" />使用 GitHub 登录</button>
        <button v-else class="user-menu-item text-muted-foreground" disabled><LogOut class="size-4" />账户未配置</button>
      </section>
    </div>

    <nav class="app-no-drag flex flex-col gap-1.5 px-2 py-3" aria-label="全局工作区">
      <Button
        v-for="item in WORKSPACE_RAIL_ITEMS"
        :key="item.id"
        :variant="activeSection === item.id ? 'secondary' : 'ghost'"
        :class="[
          'workspace-rail-item relative h-auto min-h-12 px-3 py-2',
          'flex-col gap-0.5 px-1 py-1.5',
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
        v-if="contextAvailable"
        variant="ghost"
        class="workspace-rail-control relative h-12 w-full"
        :aria-label="contextOpen ? '收起会话' : '展开会话'"
        :title="contextOpen ? '收起会话' : '展开会话'"
        :aria-expanded="contextOpen"
        aria-controls="coding-context-sidebar"
        @click="emit('toggleContext')"
      >
        <PanelLeftClose v-if="contextOpen" class="size-4" />
        <PanelLeftOpen v-else class="size-4" />
      </Button>

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
.workspace-rail-traffic-safe { box-sizing: border-box; min-height: 5.75rem; padding-top: 2.1rem; padding-bottom: .5rem; }
.workspace-rail-item { font-size: var(--text-body); line-height: var(--text-body--line-height); letter-spacing: var(--text-body--letter-spacing); }
.workspace-rail-item, .workspace-rail-control { --border-hairline: transparent; --selected-border: transparent; }
.workspace-rail-active { color: var(--brand); }
.workspace-rail-control { color: var(--muted-foreground); }
.workspace-rail-control:hover, .workspace-rail-control:focus-visible { color: var(--foreground); }
.workspace-rail-active::after { position: absolute; inset-block: .75rem; inset-inline-start: .125rem; width: .1875rem; border-radius: 999px; background: var(--brand); content: ''; }
.user-menu-item { display: flex; width: 100%; align-items: center; gap: .65rem; border: 0; border-radius: .55rem; background: transparent; padding: .65rem .7rem; color: var(--foreground); font-size: var(--text-body); cursor: pointer; }
.user-menu-item:hover:not(:disabled), .user-menu-item:focus-visible { background: var(--muted); outline: 0; }
.user-menu-item:disabled { cursor: default; opacity: .55; }
</style>
