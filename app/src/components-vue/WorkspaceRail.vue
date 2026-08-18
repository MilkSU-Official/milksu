<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Bug,
  Code2,
  Flag,
  LogOut,
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
    class="app-drag workspace-rail relative flex w-[12rem] shrink-0 flex-col"
    :class="{ 'workspace-rail--collapsed': collapsed !== false }"
    data-shell-traffic-safe
  >
    <div
      ref="menuRoot"
      class="workspace-rail-traffic-safe relative px-2"
      @keydown.esc="menuOpen = false"
    >
      <button
        type="button"
        class="app-no-drag workspace-rail-profile"
        aria-label="打开用户菜单"
        :aria-expanded="menuOpen"
        @click.stop="menuOpen = !menuOpen"
      >
        <img
          :src="avatarSource"
          alt="用户头像"
          class="workspace-rail-profile__mark"
        >
        <span class="workspace-rail-profile__copy">
          <strong>{{ accountStatus.user?.displayName || accountStatus.user?.githubLogin || 'MilkSU' }}</strong>
          <small>{{ isBetaChannel ? 'BETA' : '本机' }}</small>
        </span>
      </button>

      <section
        v-if="menuOpen"
        class="app-no-drag absolute left-[12.25rem] top-10 z-50 w-52 overflow-hidden border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
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
        class="ak-command workspace-rail-item"
        :class="activeSection === item.id ? 'ak-command--cyan' : 'ak-command--dark'"
        :aria-label="item.label"
        :aria-current="activeSection === item.id ? 'page' : undefined"
        :title="item.label"
        :data-ui-selected="activeSection === item.id ? '' : undefined"
        @click="navigate(item.id)"
      >
        <component :is="icons[item.id]" class="ak-command__watermark size-8" />
        <strong class="ak-command__label">{{ item.label }}</strong>
      </button>
    </nav>

    <div class="flex-1" />

    <div class="app-no-drag workspace-rail-foot">
      <button
        type="button"
        class="workspace-rail-control"
        :aria-label="themeToggleLabel"
        :title="themeToggleLabel"
        @click="emit('toggleTheme')"
      >
        <component :is="ThemeToggleIcon" class="size-4" />
        <span>{{ props.themeMode === 'dark' ? '日间' : '夜间' }}</span>
      </button>

      <button
        type="button"
        class="ak-command workspace-rail-item"
        :class="activeSection === 'settings' ? 'ak-command--paper' : 'ak-command--dark'"
        aria-label="设置"
        title="设置"
        :data-ui-selected="activeSection === 'settings' ? '' : undefined"
        @click="openSettings"
      >
        <Settings class="ak-command__watermark size-8" />
        <strong class="ak-command__label">设置</strong>
      </button>
    </div>
  </div>
</template>

<style scoped>
.workspace-rail-traffic-safe { box-sizing: border-box; min-height: 5.75rem; padding-top: 2.1rem; padding-bottom: .65rem; }
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
  padding: 0 .7rem .85rem;
  background: var(--ak-surface-canvas, #111315);
}
.workspace-rail-profile {
  display: grid;
  width: 100%;
  min-height: 3.4rem;
  padding: .35rem .45rem;
  border: 0;
  align-items: center;
  grid-template-columns: auto minmax(0, 1fr);
  gap: .65rem;
  color: var(--foreground);
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.workspace-rail-profile__mark {
  width: 2.15rem;
  height: 2.15rem;
  border: 1px solid rgba(248, 248, 245, .35);
  background: #fff;
  object-fit: cover;
}
.workspace-rail-profile__copy { display: grid; min-width: 0; }
.workspace-rail-profile__copy strong {
  overflow: hidden;
  font-family: "Noto Serif SC", serif;
  font-size: 1rem;
  font-weight: 900;
  letter-spacing: -.04em;
  line-height: 1.1;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.workspace-rail-profile__copy small {
  color: var(--muted-foreground);
  font-family: var(--ak-font-mono, ui-monospace, monospace);
  font-size: .62rem;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
}
.workspace-rail-nav,
.workspace-rail-foot { display: grid; gap: .55rem; }
.workspace-rail-nav { padding-top: .35rem; }
.workspace-rail-item {
  width: 100%;
  min-height: 4.35rem;
  font-size: var(--text-body);
  line-height: var(--text-body--line-height);
  letter-spacing: var(--text-body--letter-spacing);
}
.workspace-rail-item :deep(.ak-command__label) { font-size: 1.35rem; }
.workspace-rail-item, .workspace-rail-control { --border-hairline: transparent; --selected-border: transparent; }
.workspace-rail-control {
  display: flex;
  min-height: 2.4rem;
  padding: 0 .55rem;
  border: 0;
  align-items: center;
  gap: .5rem;
  color: var(--muted-foreground);
  background: transparent;
  cursor: pointer;
  font-size: var(--text-body);
}
.workspace-rail-control:hover,
.workspace-rail-control:focus-visible { color: var(--foreground); }
.user-menu-item { display: flex; width: 100%; align-items: center; gap: .65rem; border: 0; border-radius: 0; background: transparent; padding: .65rem .7rem; color: var(--foreground); font-size: var(--text-body); cursor: pointer; }
.user-menu-item:hover:not(:disabled), .user-menu-item:focus-visible { background: var(--muted); outline: 0; }
.user-menu-item:disabled { cursor: default; opacity: .55; }
</style>
