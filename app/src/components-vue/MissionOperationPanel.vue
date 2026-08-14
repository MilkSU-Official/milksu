<script setup lang="ts">
import { computed } from 'vue'
import { FileCheck2, ScanSearch, ShieldCheck, Target } from 'lucide-vue-next'
import type { DomainTaskContextPresentation } from '@/lib/domainTaskContext'

const props = defineProps<{
  presentation: DomainTaskContextPresentation
  running?: boolean
}>()

const phases = computed(() => props.presentation.kind === 'ctf'
  ? [
      { label: '读取与解析', state: '已就绪' },
      { label: '逻辑分析', state: props.running ? '进行中' : '待行动' },
      { label: '验证关键点', state: '待开始' },
      { label: '提出结论', state: '待开始' },
    ]
  : [
      { label: '来源整理', state: '已就绪' },
      { label: '影响分析', state: props.running ? '进行中' : '待行动' },
      { label: '安全验证', state: '待开始' },
      { label: '形成结论', state: '待开始' },
    ])
</script>

<template>
  <section class="mission-operation" aria-label="当前任务">
    <article class="tactical-paper mission-operation__paper">
      <header class="mission-operation__paper-head">
        <span class="tactical-label">Active operation</span>
        <span class="tactical-label">{{ presentation.kind.toUpperCase() }} / {{ presentation.meta[0] || 'LOCAL' }}</span>
      </header>
      <div class="mission-operation__identity">
        <div class="min-w-0">
          <p class="tactical-display mission-operation__title">{{ presentation.title }}</p>
          <span v-if="presentation.meta[0]" class="mission-operation__category">{{ presentation.meta[0] }}</span>
        </div>
        <div class="mission-operation__file">
          <span class="tactical-label">File no.</span>
          <strong>{{ presentation.meta[1] || presentation.moduleLabel }}</strong>
        </div>
      </div>
      <ol class="mission-phase-rail" aria-label="任务阶段">
        <li
          v-for="(phase, index) in phases"
          :key="phase.label"
          :class="{ active: index === 0, running: index === 1 && running }"
        >
          <span class="mission-phase-rail__index">{{ index + 1 }}</span>
          <span class="min-w-0">
            <strong>{{ phase.label }}</strong>
            <small>{{ phase.state }}</small>
          </span>
        </li>
      </ol>
    </article>

    <article class="tactical-acid-panel mission-objective-band">
      <Target class="size-11 shrink-0" />
      <div class="min-w-0 flex-1">
        <span class="tactical-label">Objective</span>
        <p>{{ presentation.objective }}</p>
      </div>
      <div class="mission-objective-band__priority">
        <span class="tactical-label">Priority</span>
        <strong>High</strong>
      </div>
    </article>

    <section class="tactical-command-surface mission-activity" aria-label="活动记录">
      <header>
        <span class="tactical-section-heading">活动记录</span>
        <span class="tactical-label">Live feed</span>
      </header>
      <article class="mission-activity__row">
        <span class="mission-activity__icon"><FileCheck2 /></span>
        <div class="min-w-0 flex-1">
          <time>任务接入</time>
          <strong>已读取任务与材料</strong>
        </div>
        <span class="mission-activity__state">已完成</span>
      </article>
      <article class="mission-activity__row">
        <span class="mission-activity__icon"><ScanSearch v-if="presentation.kind === 'ctf'" /><ShieldCheck v-else /></span>
        <div class="min-w-0 flex-1">
          <time>{{ running ? 'Agent 执行中' : '等待指令' }}</time>
          <strong>{{ running ? '正在推进当前目标' : '发送指令后开始分析' }}</strong>
        </div>
        <span class="mission-activity__state" :class="{ active: running }">{{ running ? '进行中' : '待开始' }}</span>
      </article>
    </section>
  </section>
</template>

<style scoped>
.mission-operation { display: grid; gap: 1rem; width: 100%; }
.mission-operation__paper { padding: 1.1rem 1.35rem 0; box-shadow: 0 18px 42px rgb(0 0 0 / .26); }
.mission-operation__paper-head { display: flex; align-items: center; justify-content: space-between; gap: 1rem; border-bottom: 1px solid rgb(17 19 21 / .3); padding-bottom: .6rem; color: var(--tactical-paper-muted); }
.mission-operation__identity { display: flex; align-items: end; justify-content: space-between; gap: 1.5rem; padding: .45rem 0 .9rem; }
.mission-operation__title { max-width: 100%; overflow-wrap: anywhere; font-size: clamp(2.25rem, 7cqi, 4.6rem); line-height: .94; }
.mission-operation__category { display: inline-block; margin-top: .55rem; border: 1px solid color-mix(in srgb, var(--tactical-acid) 72%, var(--tactical-paper-ink)); background: color-mix(in srgb, var(--tactical-acid) 20%, transparent); padding: .18rem .65rem; color: var(--tactical-paper-ink); font-size: .75rem; }
.mission-operation__file { display: grid; min-width: 8rem; gap: .25rem; color: var(--tactical-paper-muted); text-align: right; }
.mission-operation__file strong { color: var(--tactical-paper-ink); font-family: 'SFMono-Regular', monospace; font-size: .75rem; }
.mission-phase-rail { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); margin: 0; padding: 0; border: 1px solid rgb(17 19 21 / .4); list-style: none; }
.mission-phase-rail li { display: flex; min-width: 0; min-height: 4.25rem; align-items: center; gap: .7rem; padding: .55rem .8rem; border-right: 1px solid rgb(17 19 21 / .28); color: var(--tactical-paper-muted); }
.mission-phase-rail li:last-child { border-right: 0; }
.mission-phase-rail li.active { background: color-mix(in srgb, var(--tactical-acid) 76%, var(--tactical-paper)); color: var(--tactical-paper-ink); }
.mission-phase-rail li.running { background: color-mix(in srgb, var(--tactical-acid) 18%, transparent); color: var(--tactical-paper-ink); }
.mission-phase-rail__index { display: grid; width: 1.7rem; height: 1.7rem; flex: none; place-items: center; border: 1px solid currentColor; border-radius: 50%; font-family: var(--font-display); font-size: 1rem; font-weight: 700; }
.mission-phase-rail strong, .mission-phase-rail small { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.mission-phase-rail strong { font-size: .8rem; }
.mission-phase-rail small { margin-top: .2rem; font-size: .65rem; }
.mission-objective-band { display: flex; min-height: 7.15rem; align-items: center; gap: 1.15rem; padding: 1rem 1.4rem; color: var(--tactical-acid); }
.mission-objective-band p { margin-top: .35rem; overflow-wrap: anywhere; color: var(--tactical-acid); font-size: clamp(1.05rem, 2.8cqi, 1.42rem); font-weight: 700; line-height: 1.3; }
.mission-objective-band__priority { display: grid; min-width: 7rem; gap: .35rem; border: 1px solid var(--tactical-acid); padding: .65rem; text-align: center; }
.mission-objective-band__priority strong { font-family: var(--font-display); font-size: 1.05rem; text-transform: uppercase; }
.mission-activity { padding: .85rem 1rem 1rem; color: var(--foreground); box-shadow: none; }
.mission-activity > header { display: flex; align-items: center; justify-content: space-between; gap: 1rem; border-bottom: 1px solid var(--night-border); padding: 0 .2rem .65rem; color: var(--muted-foreground); }
.mission-activity__row { display: flex; min-height: 5.2rem; align-items: center; gap: 1rem; margin-top: .65rem; border: 1px solid var(--night-border); background: var(--night-card); padding: .65rem .9rem; }
.mission-activity__icon { display: grid; width: 3.35rem; height: 3.35rem; flex: none; place-items: center; border: 1px solid var(--tactical-acid); color: var(--tactical-acid); }
.mission-activity__icon :deep(svg) { width: 1.65rem; height: 1.65rem; }
.mission-activity time { display: block; color: var(--muted-foreground); font-family: 'SFMono-Regular', monospace; font-size: .68rem; }
.mission-activity strong { display: block; margin-top: .4rem; font-size: 1.05rem; }
.mission-activity__state { background: color-mix(in srgb, var(--tactical-acid) 14%, transparent); padding: .25rem .55rem; color: var(--tactical-acid); font-size: .75rem; }
.mission-activity__state.active { box-shadow: inset 2px 0 0 var(--tactical-acid); }
@container chat-main (max-width: 56rem) {
  .mission-phase-rail { grid-template-columns: repeat(2, 1fr); }
  .mission-phase-rail li:nth-child(2) { border-right: 0; }
  .mission-phase-rail li:nth-child(-n+2) { border-bottom: 1px solid rgb(17 19 21 / .28); }
  .mission-operation__file, .mission-objective-band__priority { display: none; }
  .mission-operation__identity { align-items: start; }
}

@container chat-main (max-width: 38rem) {
  .mission-operation__paper { padding-inline: .85rem; }
  .mission-operation__paper-head { align-items: flex-start; flex-direction: column; gap: .25rem; }
  .mission-phase-rail { grid-template-columns: 1fr; }
  .mission-phase-rail li { border-right: 0; border-bottom: 1px solid rgb(17 19 21 / .28); }
  .mission-phase-rail li:last-child { border-bottom: 0; }
  .mission-objective-band { align-items: flex-start; padding-inline: 1rem; }
  .mission-objective-band > :deep(svg) { width: 2rem; height: 2rem; }
  .mission-activity__row { align-items: flex-start; flex-wrap: wrap; }
}
</style>
