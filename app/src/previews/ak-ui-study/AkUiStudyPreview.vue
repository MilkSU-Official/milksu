<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
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

const modules: Array<{ id: ModuleId; label: string; meta: string }> = [
  { id: 'ctf', label: 'CTF', meta: '题目与提交' },
  { id: 'coding', label: 'Coding', meta: '会话与执行' },
  { id: 'settings', label: '设置', meta: '账户与本机' },
]

const titles: Record<ModuleId, { title: string; meta: string }> = {
  ctf: { title: '挑战', meta: '当前重心：选中题目，然后交给 Coding' },
  coding: { title: '任务', meta: '当前重心：写下一条指令并发送' },
  settings: { title: '设置', meta: '当前重心：正在改的那一行' },
}

const heading = computed(() => titles[moduleId.value])

watch(theme, value => {
  document.documentElement.dataset.akTheme = value
}, { immediate: true })

onMounted(() => {
  document.documentElement.dataset.akTheme = theme.value
})
</script>

<template>
  <div class="study-shell">
    <aside class="study-rail">
      <div class="study-rail__brand">
        <p class="study-rail__kicker">STUDY / AK-UI 0.2.1</p>
        <p class="study-rail__name">MilkSU</p>
      </div>

      <nav class="study-rail__nav" aria-label="研究模块">
        <button
          v-for="item in modules"
          :key="item.id"
          type="button"
          class="ak-command"
          :class="moduleId === item.id ? 'ak-command--cyan' : 'ak-command--dark'"
          :aria-current="moduleId === item.id ? 'page' : undefined"
          @click="moduleId = item.id"
        >
          <span class="ak-command__label">{{ item.label }}</span>
          <span class="ak-command__meta">{{ item.meta }}</span>
        </button>
      </nav>

      <div class="study-rail__foot">
        <div class="ak-status" :class="theme === 'dark' ? '' : 'ak-status--warning'">
          <span class="ak-status__signal" />
          <span class="ak-status__label">{{ theme === 'dark' ? 'Night' : 'Day' }}</span>
          <span class="ak-status__detail">静态预览，无 Runtime</span>
        </div>
        <button
          type="button"
          class="ak-button ak-button--outline"
          style="width: 100%"
          @click="theme = theme === 'dark' ? 'light' : 'dark'"
        >
          <span class="ak-button__label">{{ theme === 'dark' ? '日间' : '夜间' }}</span>
        </button>
      </div>
    </aside>

    <main class="study-main">
      <header class="study-top">
        <div>
          <h1 class="study-top__title ak-font-serif">{{ heading.title }}</h1>
          <p class="study-top__meta">{{ heading.meta }}</p>
        </div>
        <div class="ak-segmented" role="group" aria-label="模块">
          <button
            v-for="item in modules"
            :key="item.id"
            type="button"
            class="ak-segmented__item"
            :aria-pressed="moduleId === item.id"
            @click="moduleId = item.id"
          >{{ item.label }}</button>
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
