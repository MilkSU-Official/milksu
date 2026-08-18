<script setup lang="ts">
import { computed, ref } from 'vue'

interface Challenge {
  id: string
  title: string
  category: string
  difficulty: string
  status: string
  summary: string
}

const filter = ref<'all' | 'open'>('all')
const selectedId = ref('p7550')

const rows: Challenge[] = [
  {
    id: 'daily',
    title: '[SWPUCTF 2022 新生赛] Does your nc work?',
    category: 'Pwn',
    difficulty: '简单',
    status: '未开始',
    summary: '每日挑战。先确认本机 nc 通路，再进入题目环境。',
  },
  {
    id: 'p7550',
    title: '[Polarisctf 2026] EZ_UDS_PLUS',
    category: 'IoT',
    difficulty: '困难',
    status: '未开始',
    summary: '车联网安全测试员在 UDS 诊断中发现 ECU 的 22 服务存在漏洞。目标是读出与 EZ_UDS 一致的算法结果。',
  },
  {
    id: 'p7549',
    title: '[Polarisctf 2026] EZ_UDS',
    category: 'IoT',
    difficulty: '困难',
    status: '未开始',
    summary: '同一系列的基础题，可作为对照材料。',
  },
  {
    id: 'p7499',
    title: '[DesCTF 2026] VINe',
    category: 'IoT',
    difficulty: '困难',
    status: '未开始',
    summary: '固件与协议交叉的题目，尚未展开。',
  },
]

const visible = computed(() => (
  filter.value === 'all' ? rows : rows.filter(row => row.status === '未开始')
))
const selected = computed(() => rows.find(row => row.id === selectedId.value) ?? rows[1])
const handed = ref(false)
</script>

<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;gap:1rem;padding:1rem 1.35rem 0.35rem">
      <div class="ak-segmented" role="group" aria-label="筛选">
        <button type="button" class="ak-segmented__item" :aria-pressed="filter === 'all'" @click="filter = 'all'">全部</button>
        <button type="button" class="ak-segmented__item" :aria-pressed="filter === 'open'" @click="filter = 'open'">未开始</button>
      </div>
      <p class="study-top__meta" style="margin:0">共 {{ visible.length }} 题 · 静态目录</p>
    </div>

    <table class="study-table">
      <thead>
        <tr>
          <th>编号</th>
          <th>题目</th>
          <th>类别</th>
          <th>难度</th>
          <th>状态</th>
        </tr>
      </thead>
      <tbody>
        <tr
          v-for="row in visible"
          :key="row.id"
          :class="{ 'is-selected': row.id === selectedId }"
          @click="selectedId = row.id; handed = false"
        >
          <td>{{ row.id.toUpperCase() }}</td>
          <td>{{ row.title }}</td>
          <td>{{ row.category }}</td>
          <td>{{ row.difficulty }}</td>
          <td>{{ row.status }}</td>
        </tr>
      </tbody>
    </table>

    <article class="study-focus" :aria-label="selected.title">
      <div class="ak-notice">
        <span class="ak-notice__code">FOCUS<br />当前题</span>
        <div class="ak-notice__body">
          <strong class="ak-notice__title">{{ selected.title }}</strong>
          <p class="ak-notice__message">{{ selected.summary }}</p>
          <div style="display:flex;align-items:center;justify-content:space-between;gap:1rem;margin-top:1rem">
            <span class="ak-status">
              <span class="ak-status__signal" />
              <span class="ak-status__label">{{ selected.category }}</span>
              <span class="ak-status__detail">{{ selected.difficulty }} · {{ selected.status }}</span>
            </span>
            <button
              type="button"
              class="ak-button ak-button--action"
              @click="handed = true"
            >
              <span class="ak-button__label">{{ handed ? '已交给 Coding' : '交给 Coding' }}</span>
            </button>
          </div>
        </div>
      </div>
    </article>
  </div>
</template>
