<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Bug,
  Code2,
  Flag,
  LogOut,
  Monitor,
  Moon,
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
  themeMode: ThemeMode
  /** Icon-only rail (product default). Expanded labels are optional. */
  collapsed?: boolean
}>()

const emit = defineEmits<{
  navigate: [value: WorkspaceSection]
  profile: []
  accountLogin: []
  accountLogout: []
  settings: []
  toggleTheme: []
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
  props.themeMode === 'system'
    ? '当前跟随系统，切换到日间模式'
    : props.themeMode === 'light'
      ? '当前日间模式，切换到夜间模式'
      : '当前夜间模式，切换到跟随系统'
))
const ThemeToggleIcon = computed(() => (
  props.themeMode === 'system' ? Monitor : props.themeMode === 'light' ? Sun : Moon
))
const themeModeLabel = computed(() => (
  props.themeMode === 'system' ? '跟随系统' : props.themeMode === 'light' ? '日间' : '夜间'
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
    class="app-drag workspace-rail relative flex w-[4.75rem] shrink-0 flex-col"
    :class="{ 'workspace-rail--collapsed': collapsed !== false }"
    data-shell-traffic-safe
  >
    <div
      ref="menuRoot"
      class="workspace-rail-traffic-safe relative flex items-end justify-center px-1"
      @keydown.esc="menuOpen = false"
    >
      <button
        type="button"
        class="app-no-drag workspace-rail-profile"
        aria-label="打开用户菜单"
        :aria-expanded="menuOpen"
        @click.stop="menuOpen = !menuOpen"
      >
        <span class="relative">
          <img
            :src="avatarSource"
            alt="用户头像"
            class="workspace-rail-profile__mark"
          >
          <span
            v-if="isBetaChannel"
            class="pointer-events-none absolute -right-2 -top-2 bg-indigo-600 px-1 py-0.5 text-[9px] font-semibold leading-none tracking-wide text-white"
            aria-label="Beta 渠道"
            data-testid="beta-channel-badge"
          >BETA</span>
        </span>
      </button>

      <section
        v-if="menuOpen"
        class="app-no-drag absolute left-[4.6rem] top-10 z-50 w-52 overflow-hidden border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
        aria-label="用户菜单"
      >
        <button class="user-menu-item" @click="openProfile"><UserRound class="size-4" />个人资料</button>
        <button class="user-menu-item" @click="openSettings"><Settings class="size-4" />设置</button>
        <button v-if="accountStatus.state === 'active'" class="user-menu-item" @click="menuOpen = false; emit('accountLogout')"><LogOut class="size-4" />退出登录</button>
        <button v-else-if="accountStatus.configured" class="user-menu-item" @click="menuOpen = false; emit('accountLogin')"><LogOut class="size-4 rotate-180" />使用 GitHub 登录</button>
        <button v-else class="user-menu-item text-muted-foreground" disabled><LogOut class="size-4" />账户未配置</button>
      </section>
    </div>

    <nav class="app-no-drag workspace-rail-nav" aria-label="全局工作区">
      <button
        v-for="item in WORKSPACE_RAIL_ITEMS"
        :key="item.id"
        type="button"
        class="workspace-rail-item"
        :class="{ 'is-current': activeSection === item.id }"
        :aria-label="item.label"
        :aria-current="activeSection === item.id ? 'page' : undefined"
        :title="item.label"
        :data-ui-selected="activeSection === item.id ? '' : undefined"
        @click="navigate(item.id)"
      >
        <component :is="icons[item.id]" class="size-4" />
        <span>{{ item.label }}</span>
      </button>
    </nav>

    <div class="flex-1" />

    <div class="app-no-drag workspace-rail-foot">
      <button
        type="button"
        class="workspace-rail-item"
        :aria-label="themeToggleLabel"
        :title="themeToggleLabel"
        @click="emit('toggleTheme')"
      >
        <component :is="ThemeToggleIcon" class="size-4" />
        <span>{{ themeModeLabel }}</span>
      </button>

      <button
        type="button"
        class="workspace-rail-item"
        :class="{ 'is-current': activeSection === 'settings' }"
        aria-label="设置"
        title="设置"
        :data-ui-selected="activeSection === 'settings' ? '' : undefined"
        @click="openSettings"
      >
        <Settings class="size-4" />
        <span>设置</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.workspace-rail-traffic-safe { box-sizing: border-box; min-height: 5.75rem; padding-top: 2.1rem; padding-bottom: .45rem; }
.workspace-rail {
  color: var(--night-foreground);
  --foreground: var(--night-foreground);
  --card-foreground: var(--night-foreground);
  --muted-foreground: var(--night-muted-foreground);
  --border: var(--night-border);
  --border-hairline: var(--night-border-hairline);
  --input: var(--night-input);
  --card: var(--night-card);
  --popover: var(--night-popover);
  --popover-foreground: var(--night-foreground);
  --secondary: var(--night-muted);
  --secondary-foreground: var(--night-foreground);
  --accent: var(--night-accent);
  --accent-foreground: var(--night-foreground);
  background: var(--ak-surface-canvas, #111315);
}
.workspace-rail-profile {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  border: 0;
  place-items: center;
  background: transparent;
  cursor: pointer;
}
.workspace-rail-profile__mark {
  width: 2rem;
  height: 2rem;
  border: 1px solid rgba(248, 248, 245, .28);
  background: #fff;
  object-fit: cover;
}
.workspace-rail-nav,
.workspace-rail-foot { display: grid; gap: .15rem; padding: 0 .35rem .35rem; }
.workspace-rail-item {
  display: grid;
  width: 100%;
  min-height: 3.15rem;
  padding: .4rem .15rem;
  border: 0;
  place-items: center;
  gap: .2rem;
  color: var(--muted-foreground);
  background: transparent;
  cursor: pointer;
  font-size: var(--text-body);
  line-height: var(--text-body--line-height);
  letter-spacing: var(--text-body--letter-spacing);
}
.workspace-rail-item span {
  font-size: 10px;
  line-height: 1.15;
}
.workspace-rail-item.is-current {
  color: #111315;
  background: var(--brand);
}
.workspace-rail-item:not(.is-current):hover,
.workspace-rail-item:not(.is-current):focus-visible { color: var(--foreground); background: var(--overlay-hover); }
.workspace-rail-item, .workspace-rail-control { --border-hairline: transparent; --selected-border: transparent; }
.user-menu-item { display: flex; width: 100%; align-items: center; gap: .65rem; border: 0; border-radius: 0; background: transparent; padding: .65rem .7rem; color: var(--foreground); font-size: var(--text-body); cursor: pointer; }
.user-menu-item:hover:not(:disabled), .user-menu-item:focus-visible { background: var(--muted); outline: 0; }
.user-menu-item:disabled { cursor: default; opacity: .55; }
</style>
