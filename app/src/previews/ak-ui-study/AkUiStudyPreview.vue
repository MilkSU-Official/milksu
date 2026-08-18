<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { Code2, Flag, Moon, Settings, Sun } from 'lucide-vue-next'
import CtfStudy from './CtfStudy.vue'
import CodingStudy from './CodingStudy.vue'
import SettingsStudy from './SettingsStudy.vue'

type ModuleId = 'ctf' | 'coding' | 'settings'
type Theme = 'dark' | 'light'

const params = new URLSearchParams(window.location.search)
const initialModule = params.get('m')
const initialTheme = params.get('theme')
const moduleId = ref<ModuleId>(initialModule === 'coding' || initialModule === 'settings' ? initialModule : 'ctf')
const theme = ref<Theme>(initialTheme === 'light' ? 'light' : 'dark')
const activeConversation = ref('ez-uds')

const modules: Array<{ id: ModuleId; label: string; icon: typeof Flag }> = [
  { id: 'ctf', label: 'CTF', icon: Flag },
  { id: 'coding', label: 'Coding', icon: Code2 },
  { id: 'settings', label: '设置', icon: Settings },
]

const conversations = [
  { id: 'ez-uds', title: 'EZ_UDS_PLUS', meta: '来自 CTF' },
  { id: 'nc-work', title: 'Does your nc work?', meta: '今日' },
  { id: 'local', title: '无项目任务', meta: '本机' },
]

const titles: Record<ModuleId, { title: string; meta: string }> = {
  ctf: { title: '挑战', meta: '当前题，然后交给 Coding' },
  coding: { title: '任务', meta: '输入和发送' },
  settings: { title: '设置', meta: '正在改的那一行' },
}

const heading = computed(() => titles[moduleId.value])
const ThemeIcon = computed(() => (theme.value === 'dark' ? Sun : Moon))

watch(theme, value => {
  document.documentElement.dataset.akTheme = value
}, { immediate: true })

onMounted(() => {
  document.documentElement.dataset.akTheme = theme.value
})
</script>

<template>
  <div class="study-shell">
    <aside class="study-nav" aria-label="导航">
      <div class="study-rail">
        <div class="study-rail__avatar" aria-hidden="true">M</div>
        <nav class="study-rail__nav" aria-label="模块">
          <button
            v-for="item in modules.filter(item => item.id !== 'settings')"
            :key="item.id"
            type="button"
            class="study-rail__item"
            :class="{ 'is-current': moduleId === item.id }"
            :aria-current="moduleId === item.id ? 'page' : undefined"
            :title="item.label"
            @click="moduleId = item.id"
          >
            <component :is="item.icon" class="size-4" />
            <span>{{ item.label }}</span>
          </button>
        </nav>
        <div class="study-rail__foot">
          <button
            type="button"
            class="study-rail__item"
            :title="theme === 'dark' ? '切换到日间' : '切换到夜间'"
            :aria-label="theme === 'dark' ? '切换到日间' : '切换到夜间'"
            @click="theme = theme === 'dark' ? 'light' : 'dark'"
          >
            <component :is="ThemeIcon" class="size-4" />
            <span>{{ theme === 'dark' ? '日间' : '夜间' }}</span>
          </button>
          <button
            type="button"
            class="study-rail__item"
            :class="{ 'is-current': moduleId === 'settings' }"
            title="设置"
            aria-label="设置"
            @click="moduleId = 'settings'"
          >
            <Settings class="size-4" />
            <span>设置</span>
          </button>
        </div>
      </div>

      <section v-if="moduleId === 'coding'" class="study-history" aria-label="Coding 会话">
        <header class="study-history__head">
          <strong>会话</strong>
          <button type="button" class="study-history__new">新会话</button>
        </header>
        <button
          v-for="item in conversations"
          :key="item.id"
          type="button"
          class="study-history__item"
          :class="{ 'is-current': activeConversation === item.id }"
          @click="activeConversation = item.id"
        >
          <strong>{{ item.title }}</strong>
          <small>{{ item.meta }}</small>
        </button>
      </section>
    </aside>

    <main class="study-main">
      <header class="study-top">
        <div>
          <p class="study-top__kicker">STUDY / 当前壳</p>
          <h1 class="study-top__title">{{ heading.title }}</h1>
          <p class="study-top__meta">{{ heading.meta }}</p>
        </div>
      </header>
      <section class="study-stage">
        <CtfStudy v-if="moduleId === 'ctf'" />
        <CodingStudy v-else-if="moduleId === 'coding'" />
        <SettingsStudy v-else />
      </section>
    </main>
  </div>
</template>
