<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue'
import {
  Bug,
  Code2,
  Flag,
  FlaskConical,
  LogOut,
  Moon,
  Settings,
  Sun,
  SunMoon,
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
import { t } from '@/lib/uiLocale'

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
  lab: FlaskConical,
  chat: Code2,
} as const

const menuOpen = ref(false)
const menuRoot = ref<HTMLElement | null>(null)
const buildTracking = ref<BuildTracking | null>(null)
const avatarSource = computed(() => props.accountStatus.user?.avatarUrl || profileAvatar)

const isBetaChannel = computed(() => {
  if (buildTracking.value?.development || buildTracking.value?.missing) return false
  return String(buildTracking.value?.channel ?? '').toLowerCase() === 'beta'
    && String(buildTracking.value?.appId ?? '') === 'com.milksu.app.beta'
})
const themeToggleLabel = computed(() => (
  props.themeMode === 'system'
    ? t('当前跟随系统，切换到日间模式', 'Following system. Switch to light mode')
    : props.themeMode === 'light'
      ? t('当前日间模式，切换到夜间模式', 'Light mode. Switch to dark mode')
      : t('当前夜间模式，切换到跟随系统', 'Dark mode. Switch to follow system')
))
const ThemeToggleIcon = computed(() => (
  props.themeMode === 'system' ? SunMoon : props.themeMode === 'light' ? Sun : Moon
))
const themeModeLabel = computed(() => (
  props.themeMode === 'system'
    ? t('跟随系统', 'System')
    : props.themeMode === 'light'
      ? t('日间', 'Light')
      : t('夜间', 'Dark')
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
        :aria-label="t('打开用户菜单', 'Open user menu')"
        :aria-expanded="menuOpen"
        @click.stop="menuOpen = !menuOpen"
      >
        <span class="ak-media--album workspace-rail-profile__album">
          <img
            :src="avatarSource"
            :alt="t('用户头像', 'User avatar')"
            class="workspace-rail-profile__mark"
          >
          <span
            v-if="isBetaChannel"
            class="pointer-events-none absolute -right-2 -top-2 bg-indigo-600 px-1 py-0.5 text-[9px] font-semibold leading-none tracking-wide text-white"
            :aria-label="t('Beta 渠道', 'Beta channel')"
            data-testid="beta-channel-badge"
          >BETA</span>
        </span>
      </button>

      <section
        v-if="menuOpen"
        class="app-no-drag absolute left-[4.6rem] top-10 z-50 w-52 overflow-hidden border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
        :aria-label="t('用户菜单', 'User menu')"
      >
        <button class="user-menu-item" @click="openProfile"><UserRound class="size-4" />{{ t('个人资料', 'Profile') }}</button>
        <button class="user-menu-item" @click="openSettings"><Settings class="size-4" />{{ t('设置', 'Settings') }}</button>
        <button v-if="accountStatus.state === 'active'" class="user-menu-item" @click="menuOpen = false; emit('accountLogout')"><LogOut class="size-4" />{{ t('退出登录', 'Sign out') }}</button>
        <button v-else-if="accountStatus.configured" class="user-menu-item" @click="menuOpen = false; emit('accountLogin')"><LogOut class="size-4 rotate-180" />{{ t('使用 GitHub 登录', 'Sign in with GitHub') }}</button>
        <button v-else class="user-menu-item text-muted-foreground" disabled><LogOut class="size-4" />{{ t('账户未配置', 'Account not configured') }}</button>
      </section>
    </div>

    <nav class="app-no-drag workspace-rail-nav" :aria-label="t('全局工作区', 'Workspace')">
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
        :aria-label="t('设置', 'Settings')"
        :title="t('设置', 'Settings')"
        :data-ui-selected="activeSection === 'settings' ? '' : undefined"
        @click="openSettings"
      >
        <Settings class="size-4" />
        <span>{{ t('设置', 'Settings') }}</span>
      </button>
    </div>
  </div>
</template>

<style scoped>
.workspace-rail-traffic-safe {
  box-sizing: border-box;
  min-height: calc(var(--shell-title-safe-top) + 3.65rem);
  padding-top: var(--shell-title-safe-top);
  padding-bottom: .45rem;
}
.workspace-rail {
  color: var(--foreground);
  background: var(--background);
}
.workspace-rail-profile {
  display: grid;
  width: 2.9rem;
  height: 2.9rem;
  border: 0;
  place-items: center;
  background: transparent;
  cursor: pointer;
}
.workspace-rail-profile__album {
  margin: 0;
  border-width: 3px;
  border-color: #f8f7f2;
  box-shadow: 0 5px 12px rgb(0 0 0 / .4);
}
.workspace-rail-profile__album::before {
  top: 2px;
  left: -5px;
  border-width: 3px;
  border-color: #f8f7f2;
}
.workspace-rail-profile__mark {
  display: block;
  width: 32px;
  height: 32px;
  border: 0;
  background: #222;
  object-fit: cover;
}
@media (prefers-reduced-motion: reduce) {
  .workspace-rail-profile__album {
    transform: none;
  }
  .workspace-rail-profile__album::before {
    display: none;
  }
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
  background: #05a7dc;
  box-shadow: 0 0 1.4rem color-mix(in srgb, #05a7dc 55%, transparent);
}
.workspace-rail-item:not(.is-current):hover,
.workspace-rail-item:not(.is-current):focus-visible { color: var(--foreground); background: var(--overlay-hover); }
.workspace-rail-item, .workspace-rail-control { --border-hairline: transparent; --selected-border: transparent; }
.user-menu-item { display: flex; width: 100%; align-items: center; gap: .65rem; border: 0; border-radius: 0; background: transparent; padding: .65rem .7rem; color: var(--foreground); font-size: var(--text-body); cursor: pointer; }
.user-menu-item:hover:not(:disabled), .user-menu-item:focus-visible { background: var(--muted); outline: 0; }
.user-menu-item:disabled { cursor: default; opacity: .55; }
</style>
