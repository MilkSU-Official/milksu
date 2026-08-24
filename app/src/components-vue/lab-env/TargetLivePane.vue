<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { Button, Input } from '@felinic/ui'
import { ArrowLeft, ArrowRight, Globe2, RefreshCw, Smartphone, SquareTerminal } from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import { codingBrowserViewportSyncKey } from '@/lib/codingBrowserTabs'
import type { EnvLease } from '@/envbroker'

defineOptions({ name: 'TargetLivePane' })

const props = defineProps<{
  lease: EnvLease
  conversationId?: string
}>()

const emit = defineEmits<{
  attachComputerUse: []
}>()

const probe = ref('')
const probeError = ref('')
const viewport = ref<HTMLElement | null>(null)
let lastViewport = ''
let observer: ResizeObserver | null = null

const surface = () => String(props.lease.surface || 'browser')

async function syncViewport() {
  const conversationId = props.conversationId?.trim()
  const node = viewport.value
  if (!conversationId || !node || surface() !== 'browser') return
  const rect = node.getBoundingClientRect()
  const geometry = {
    conversationId,
    x: rect.left,
    y: rect.top,
    width: rect.width,
    height: rect.height,
    visible: rect.width > 8 && rect.height > 8,
  }
  const key = codingBrowserViewportSyncKey(geometry)
  if (key === lastViewport) return
  lastViewport = key
  try {
    await invokeCommand('set_coding_browser_viewport', geometry)
  } catch {
    // Packaged overlay is best-effort in tests and preview.
  }
}

async function openBrowser() {
  const conversationId = props.conversationId?.trim()
  const address = props.lease.address?.trim()
  if (!conversationId || !address) return
  const url = address.includes('://') ? address : `http://${address}`
  try {
    await invokeCommand('start_coding_browser', { conversationId, initialUrl: url })
    await syncViewport()
  } catch {
    // Renderer tests have no native browser view.
  }
}

async function runProbe() {
  probeError.value = ''
  try {
    probe.value = await invokeCommand<string>('probe_env_lease', {
      ownerKind: props.lease.ownerKind,
      ownerId: props.lease.ownerId,
    })
  } catch (reason) {
    probeError.value = reason instanceof Error ? reason.message : String(reason)
  }
}

onMounted(() => {
  observer = new ResizeObserver(() => {
    void syncViewport()
  })
  if (viewport.value) observer.observe(viewport.value)
  if (surface() === 'browser') void openBrowser()
  if (surface() === 'shell') void runProbe()
})

watch(() => [props.lease.address, props.lease.surface, props.conversationId], () => {
  if (surface() === 'browser') void openBrowser()
  if (surface() === 'shell') void runProbe()
})

onBeforeUnmount(() => {
  observer?.disconnect()
  const conversationId = props.conversationId?.trim()
  if (conversationId && surface() === 'browser') {
    void invokeCommand('set_coding_browser_viewport', {
      conversationId,
      x: 0,
      y: 0,
      width: 1,
      height: 1,
      visible: false,
    }).catch(() => undefined)
  }
})
</script>

<template>
  <section class="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden border-l border-border bg-background" data-testid="target-surface" :data-kind="lease.surface">
    <header class="flex h-12 shrink-0 items-center gap-1.5 border-b border-border px-2">
      <template v-if="surface() === 'browser'">
        <Button variant="ghost" size="icon-sm" disabled><ArrowLeft class="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" disabled><ArrowRight class="size-4" /></Button>
        <Button variant="ghost" size="icon-sm" disabled><RefreshCw class="size-4" /></Button>
        <Input class="h-8 min-w-0 flex-1 rounded-full bg-muted/55 px-3 font-mono text-caption" :model-value="lease.address ? `http://${lease.address}` : ''" readonly />
      </template>
      <template v-else-if="surface() === 'shell'">
        <SquareTerminal class="ml-2 size-4 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate font-mono text-caption">{{ lease.address }} · bash</span>
      </template>
      <template v-else>
        <Smartphone class="ml-2 size-4 text-muted-foreground" />
        <span class="min-w-0 flex-1 truncate font-mono text-caption">{{ lease.address }}</span>
      </template>
      <span class="ak-tag ak-tag--compact ak-tag--advanced mr-2">当前靶</span>
    </header>

    <div v-if="surface() === 'browser'" ref="viewport" class="relative min-h-0 flex-1 bg-white" data-coding-browser-viewport>
      <div class="absolute inset-0 grid place-items-center text-caption text-muted-foreground">
        隔离浏览器贴在这个槽上。地址钉死租约。
      </div>
    </div>
    <pre v-else-if="surface() === 'shell'" class="min-h-0 flex-1 overflow-auto bg-[#0e1012] px-4 py-4 font-mono text-caption text-[#d7d7d2]">{{ probeError || probe || `curl ${lease.address}` }}</pre>
    <div v-else class="grid min-h-0 flex-1 place-items-center bg-[#0e1012] px-6 text-center">
      <div>
        <p class="text-body">本机模拟器窗口已启动</p>
        <p class="mt-2 font-mono text-caption text-muted-foreground">{{ lease.address }}</p>
        <p class="mt-3 text-caption text-muted-foreground">点屏幕请用 Computer Use 锁到这个窗口。adb 只走租约串口。</p>
        <Button class="mt-4" variant="brand" size="sm" data-testid="attach-computer-use" @click="emit('attachComputerUse')">
          接入 Computer Use
        </Button>
      </div>
    </div>

    <footer class="flex h-9 shrink-0 items-center justify-between gap-3 border-t border-border px-3 text-caption text-muted-foreground">
      <span class="inline-flex items-center gap-1.5">
        <Globe2 v-if="surface() === 'browser'" class="size-3.5" />
        <SquareTerminal v-else-if="surface() === 'shell'" class="size-3.5" />
        <Smartphone v-else class="size-3.5" />
        人和 Agent 共用这个靶
      </span>
    </footer>
  </section>
</template>
