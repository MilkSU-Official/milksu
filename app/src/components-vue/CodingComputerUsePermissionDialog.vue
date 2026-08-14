<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@felinic/ui'
import {
  Accessibility,
  CheckCircle2,
  CircleDot,
  ExternalLink,
  LoaderCircle,
  PackageCheck,
} from 'lucide-vue-next'
import permissionGuide from '@/assets/computer-use-permissions-guide.png'
import type {
  CodingComputerUsePermission,
  CodingComputerUseStatus,
} from '@/codingEnvironmentTypes'

const props = withDefaults(defineProps<{
  open: boolean
  status: CodingComputerUseStatus | null
  requesting?: CodingComputerUsePermission | null
  error?: string
  pollIntervalMs?: number
}>(), {
  requesting: null,
  error: '',
  pollIntervalMs: 1200,
})

const emit = defineEmits<{
  'update:open': [open: boolean]
  requestPermissions: [permission: CodingComputerUsePermission]
  poll: []
  complete: []
}>()

const permissionsReady = computed(() => Boolean(
  props.status?.permissions.accessibility
  && props.status.permissions.screenRecording,
))
const grantedCount = computed(() => Number(Boolean(props.status?.permissions.accessibility))
  + Number(Boolean(props.status?.permissions.screenRecording)))
const componentDescription = computed(() => {
  if (!props.status?.available) {
    return props.status?.problem || '正在检查本地组件。'
  }
  if (permissionsReady.value) return '运行正常，系统授权已完整生效。'
  return '运行正常，等待系统授权。'
})

let pollTimer: number | null = null
let completionEmitted = false

function stopPolling() {
  if (pollTimer === null) return
  window.clearInterval(pollTimer)
  pollTimer = null
}

function startPolling() {
  stopPolling()
  emit('poll')
  pollTimer = window.setInterval(() => emit('poll'), props.pollIntervalMs)
}

function updateOpen(open: boolean) {
  emit('update:open', open)
}

watch(
  () => props.open,
  open => {
    if (open) {
      completionEmitted = false
      startPolling()
      return
    }
    stopPolling()
  },
  { immediate: true },
)

watch(permissionsReady, ready => {
  if (!props.open || !ready || completionEmitted) return
  completionEmitted = true
  stopPolling()
  emit('complete')
})

onBeforeUnmount(stopPolling)
</script>

<template>
  <Dialog :open="open" @update:open="updateOpen">
    <DialogContent
      class="computer-use-permission-dialog tactical-floating-surface max-h-[calc(100vh-2rem)] overflow-y-auto border-border bg-card p-0 text-foreground shadow-2xl sm:max-w-[min(72rem,calc(100vw-3rem))]"
    >
      <div class="px-6 pb-4 pt-6 sm:px-9 sm:pt-8">
        <div class="flex flex-wrap items-start justify-between gap-5">
          <div class="min-w-0">
            <p class="font-mono text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              Computer Use Setup
            </p>
            <DialogTitle class="mt-2 text-2xl font-semibold tracking-tight sm:text-3xl">
              开启 Computer Use
            </DialogTitle>
            <DialogDescription
              class="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground"
            >
              完成两项 macOS 系统授权后，MilkSU 会自动继续当前任务。
            </DialogDescription>
          </div>
          <div class="flex items-center gap-2 pt-1 text-xs text-muted-foreground" aria-live="polite">
            <LoaderCircle v-if="!permissionsReady" class="size-4 animate-spin" />
            <CheckCircle2 v-else class="size-4 text-primary" />
            <span>{{ permissionsReady ? '授权已完成' : '持续检测中' }}</span>
            <span class="font-mono text-foreground">{{ grantedCount }} / 2</span>
          </div>
        </div>

        <div class="mt-7 grid gap-6 lg:grid-cols-[minmax(17rem,0.78fr)_minmax(25rem,1.22fr)]">
          <figure class="permission-guide min-w-0 overflow-hidden border border-border bg-muted/20">
            <img
              :src="permissionGuide"
              alt="在 macOS 系统设置中为 MilkSU 开启权限的示意图"
              class="aspect-square w-full object-cover"
            >
            <figcaption class="border-t border-border px-4 py-3 text-center text-xs text-muted-foreground">
              在系统设置中找到 MilkSU 并开启对应权限
            </figcaption>
          </figure>

          <section class="permission-list min-w-0 border border-border bg-muted/15" aria-label="Computer Use 系统授权">
            <div class="permission-row">
              <div class="permission-icon">
                <Accessibility class="size-5" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="font-medium">辅助功能</p>
                <p class="mt-1 text-xs leading-5 text-muted-foreground">
                  允许 MilkSU 点击、输入和滚动所选 App。
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-3">
                <span
                  class="hidden items-center gap-1.5 text-xs sm:flex"
                  :class="status?.permissions.accessibility ? 'text-primary' : 'text-amber-500'"
                >
                  <CheckCircle2 v-if="status?.permissions.accessibility" class="size-3.5" />
                  <CircleDot v-else class="size-3.5" />
                  {{ status?.permissions.accessibility ? '已授权' : '待授权' }}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="Boolean(status?.permissions.accessibility) || requesting === 'accessibility'"
                  aria-label="打开辅助功能系统设置"
                  @click="emit('requestPermissions', 'accessibility')"
                >
                  <LoaderCircle v-if="requesting === 'accessibility'" class="size-3.5 animate-spin" />
                  <ExternalLink v-else class="size-3.5" />
                  {{ status?.permissions.accessibility ? '已完成' : '打开设置' }}
                </Button>
              </div>
            </div>

            <div class="permission-row border-t border-border">
              <div class="permission-icon permission-icon--recording">
                <CircleDot class="size-5" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="font-medium">屏幕录制</p>
                <p class="mt-1 text-xs leading-5 text-muted-foreground">
                  允许 MilkSU 识别所选窗口的可见内容。
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-3">
                <span
                  class="hidden items-center gap-1.5 text-xs sm:flex"
                  :class="status?.permissions.screenRecording ? 'text-primary' : 'text-amber-500'"
                >
                  <CheckCircle2 v-if="status?.permissions.screenRecording" class="size-3.5" />
                  <CircleDot v-else class="size-3.5" />
                  {{ status?.permissions.screenRecording ? '已授权' : '待授权' }}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  :disabled="Boolean(status?.permissions.screenRecording) || requesting === 'screen-recording'"
                  aria-label="打开屏幕录制系统设置"
                  @click="emit('requestPermissions', 'screen-recording')"
                >
                  <LoaderCircle v-if="requesting === 'screen-recording'" class="size-3.5 animate-spin" />
                  <ExternalLink v-else class="size-3.5" />
                  {{ status?.permissions.screenRecording ? '已完成' : '打开设置' }}
                </Button>
              </div>
            </div>

            <div class="permission-row border-t border-border">
              <div class="permission-icon">
                <PackageCheck class="size-5" />
              </div>
              <div class="min-w-0 flex-1">
                <p class="font-medium">Computer Use 组件</p>
                <p class="mt-1 text-xs leading-5 text-muted-foreground">
                  {{ componentDescription }}
                </p>
              </div>
              <div
                class="flex shrink-0 items-center gap-1.5 text-xs"
                :class="status?.available ? 'text-primary' : 'text-muted-foreground'"
              >
                <CheckCircle2 v-if="status?.available" class="size-4" />
                <LoaderCircle v-else class="size-4 animate-spin" />
                {{ status?.available ? '运行正常' : '检测中' }}
              </div>
            </div>
          </section>
        </div>

        <p
          v-if="error"
          class="mt-4 border border-destructive/40 bg-destructive/10 px-4 py-3 text-xs leading-5 text-destructive"
          role="alert"
        >
          {{ error }}
        </p>
      </div>

      <footer class="flex flex-wrap items-center justify-between gap-4 border-t border-primary/25 bg-muted/15 px-6 py-4 sm:px-9">
        <div class="flex min-w-0 items-center gap-3 text-xs text-muted-foreground">
          <LoaderCircle v-if="!permissionsReady" class="size-4 shrink-0 animate-spin text-primary" />
          <CheckCircle2 v-else class="size-4 shrink-0 text-primary" />
          <span>
            {{ permissionsReady ? '授权完成，正在恢复当前任务。' : '正在轮询系统权限；返回 MilkSU 后状态会自动更新。' }}
          </span>
        </div>
        <Button variant="ghost" size="sm" @click="updateOpen(false)">
          稍后处理
        </Button>
      </footer>
    </DialogContent>
  </Dialog>
</template>

<style scoped>
.computer-use-permission-dialog {
  clip-path: polygon(0 14px, 14px 0, calc(100% - 18px) 0, 100% 18px, 100% calc(100% - 14px), calc(100% - 14px) 100%, 0 100%);
}

.permission-guide {
  clip-path: polygon(0 10px, 10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
}

.permission-list {
  clip-path: polygon(0 10px, 10px 0, 100% 0, 100% calc(100% - 10px), calc(100% - 10px) 100%, 0 100%);
}

.permission-row {
  display: flex;
  min-height: 6.5rem;
  align-items: center;
  gap: 1rem;
  padding: 1.15rem 1.25rem;
}

.permission-icon {
  display: grid;
  width: 2.75rem;
  height: 2.75rem;
  flex: 0 0 auto;
  place-items: center;
  border: 1px solid color-mix(in srgb, var(--primary) 70%, transparent);
  color: var(--primary);
  background: color-mix(in srgb, var(--primary) 8%, transparent);
  clip-path: polygon(0 8px, 8px 0, 100% 0, 100% calc(100% - 8px), calc(100% - 8px) 100%, 0 100%);
}

.permission-icon--recording {
  border-radius: 9999px;
  clip-path: none;
}

@media (max-width: 640px) {
  .permission-row {
    align-items: flex-start;
    flex-wrap: wrap;
  }

  .permission-row > :last-child {
    margin-left: 3.75rem;
  }
}
</style>
