<script setup lang="ts">
import { computed } from 'vue'
import { Button, Input } from '@felinic/ui'
import { ArrowLeft, ArrowRight, Globe2, RefreshCw, Smartphone, SquareTerminal } from 'lucide-vue-next'
import { t } from '@/lib/uiLocale'
import type { TargetSurfaceKind } from './environmentTypes'

defineOptions({ name: 'TargetSurfacePreview' })

const props = defineProps<{
  kind: TargetSurfaceKind
  address: string
  driving?: boolean
}>()

const kindLabel = computed(() => ({
  browser: t('浏览器', 'Browser'),
  shell: t('终端', 'Terminal'),
  emulator: t('模拟器', 'Emulator'),
  device: t('真机', 'Device'),
}[props.kind]))

const drivingText = computed(() => {
  if (!props.driving) return t('人和 Agent 共用这个靶', 'You and the agent share this target')
  if (props.kind === 'shell') return t('Agent 正在敲命令，你看见同一份终端', 'The agent is typing commands. You see the same terminal.')
  if (props.kind === 'emulator' || props.kind === 'device') return t('Agent 正在点屏幕，你看见同一台设备', 'The agent is tapping the screen. You see the same device.')
  return t('Agent 正在点页面，你看见同一页', 'The agent is clicking the page. You see the same view.')
})
</script>

<template>
  <section class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-background" data-testid="target-surface" :data-kind="kind">
    <header class="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2">
      <template v-if="kind === 'browser'">
        <Button variant="ghost" size="icon-sm" disabled :aria-label="t('后退', 'Back')"><ArrowLeft class="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" disabled :aria-label="t('前进', 'Forward')"><ArrowRight class="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" disabled :aria-label="t('重新加载', 'Reload')"><RefreshCw class="size-4" /></Button>
        <Input
          class="h-8 min-w-0 flex-1 rounded-full bg-muted/55 px-3 font-mono text-caption"
          :model-value="`http://${address}`"
          :aria-label="t('靶地址', 'Target address')"
          readonly
        />
      </template>
      <template v-else-if="kind === 'shell'">
        <SquareTerminal class="ml-2 size-4 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate font-mono text-caption">{{ address }} · bash</span>
      </template>
      <template v-else>
        <Smartphone class="ml-2 size-4 shrink-0 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate font-mono text-caption">{{ address }}</span>
      </template>
      <span class="ak-tag ak-tag--compact ak-tag--advanced mr-2">{{ t('当前靶', 'Current target') }} · {{ kindLabel }}</span>
    </header>

    <div v-if="kind === 'browser'" class="relative min-h-0 flex-1 bg-white text-[#171a1d]">
      <div class="absolute inset-0 overflow-auto px-10 py-8">
        <p class="text-xs tracking-[0.2em] text-[#888]">OWASP JUICE SHOP</p>
        <h1 class="mt-2 text-2xl font-semibold">Login</h1>
        <label class="mt-6 block text-sm">Email
          <input class="mt-1 h-9 w-full rounded border border-[#d0d0d0] px-3" value="admin@juice-sh.op" readonly>
        </label>
        <label class="mt-3 block text-sm">Password
          <input class="mt-1 h-9 w-full rounded border border-[#d0d0d0] px-3" value="••••••••" readonly>
        </label>
        <button type="button" class="relative mt-5 rounded bg-[#5460c0] px-4 py-2 text-sm text-white">
          Log in
          <span v-if="driving" class="pointer-events-none absolute -inset-1 rounded ring-2 ring-[var(--signal-gold)] ring-offset-2" />
        </button>
      </div>
    </div>

    <div v-else-if="kind === 'shell'" class="relative min-h-0 flex-1 bg-[#0e1012] px-4 py-4 font-mono text-caption text-[#d7d7d2]" data-testid="target-shell">
      <p class="text-muted-foreground">milksu-env 127.0.0.1:61616</p>
      <p class="mt-2">$ nmap -p 61616 127.0.0.1</p>
      <p>61616/tcp open  activemq</p>
      <p class="mt-2">$ nc 127.0.0.1 61616</p>
      <p :class="driving ? 'text-[var(--signal-gold)]' : ''">OpenWire handshake …</p>
      <p v-if="driving" class="mt-2 text-[var(--signal-gold)]">█</p>
    </div>

    <div v-else class="relative grid min-h-0 flex-1 place-items-center bg-[#0e1012]" data-testid="target-emulator">
      <div class="relative h-[78%] aspect-[9/19] rounded-[1.6rem] border border-border bg-[#111] p-2 shadow-xl">
        <div class="flex h-full flex-col overflow-hidden rounded-[1.2rem] bg-[#1a1c1e]">
          <p class="px-3 py-2 text-center text-[10px] text-muted-foreground">Android API 34</p>
          <div class="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-4 text-center">
            <p class="text-body">{{ t('设置', 'Settings') }}</p>
            <button type="button" class="relative rounded-md border border-border px-3 py-1.5 text-caption">
              {{ t('关于手机', 'About phone') }}
              <span v-if="driving" class="pointer-events-none absolute -inset-1 rounded ring-2 ring-[var(--signal-gold)]" />
            </button>
          </div>
        </div>
      </div>
    </div>

    <p
      v-if="driving"
      class="pointer-events-none absolute bottom-12 left-3 z-10 rounded-md border border-border bg-card px-3 py-1.5 text-caption"
      data-testid="agent-driving"
    >
      {{ drivingText }}
    </p>

    <footer class="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border px-3 text-caption text-muted-foreground">
      <span class="inline-flex items-center gap-1.5">
        <Globe2 v-if="kind === 'browser'" class="size-3.5" />
        <SquareTerminal v-else-if="kind === 'shell'" class="size-3.5" />
        <Smartphone v-else class="size-3.5" />
        {{ kind === 'browser' ? t('隔离 profile · 只打 Scope', 'Isolated profile · Scope only') : kind === 'shell' ? t('受管终端 · 只打租约', 'Managed terminal · lease only') : t('本机模拟器 · 受限 adb', 'Local emulator · restricted adb') }}
      </span>
      <span>{{ driving ? t('Agent 在操作，你也可以动手', 'The agent is driving. You can still act.') : t('人和 Agent 共用这个靶', 'You and the agent share this target') }}</span>
    </footer>
  </section>
</template>
