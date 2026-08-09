<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Badge,
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@felinic/ui'
import {
  CheckCircle2,
  GitBranch,
  GitCommitHorizontal,
  LoaderCircle,
  RefreshCw,
  Split,
  TriangleAlert,
} from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import type {
  CodingCollaborationStatus,
  CodingCollaborationWorktree,
} from '@/codingEnvironmentTypes'

const props = defineProps<{
  conversationId?: string
  workspacePath: string
  running?: boolean
  ensureConversation: (title?: string) => string
}>()

const status = ref<CodingCollaborationStatus | null>(null)
const writers = ref<1 | 2>(1)
const loading = ref(false)
const error = ref('')
const finishDialogOpen = ref(false)
const retainedConversationId = ref('')

const taskId = computed(() => (
  props.conversationId || retainedConversationId.value
))
const workspaceName = computed(() => (
  props.workspacePath.replace(/\/+$/, '').split('/').at(-1) || 'Coding'
))
const active = computed(() => Boolean(status.value?.active))
const interruptedPreparation = computed(() => (
  status.value?.phase === 'preparing' && Boolean(status.value?.problem)
))
const busy = computed(() => Boolean(props.running || loading.value))

function shortHead(value?: string) {
  return value ? value.slice(0, 12) : '—'
}

function worktreeState(worktree: CodingCollaborationWorktree) {
  if (worktree.problem) return '边界异常'
  if (worktree.dirty) return '有未提交修改'
  if (worktree.integrated) return '已集成'
  if (worktree.ahead > 0) return `待集成 ${worktree.ahead} 个提交`
  return '已就绪'
}

function worktreeTone(worktree: CodingCollaborationWorktree) {
  if (worktree.problem || worktree.dirty) return 'destructive'
  if (worktree.integrated) return 'secondary'
  return 'outline'
}

async function refresh() {
  if (!taskId.value || !props.workspacePath || loading.value) {
    if (!taskId.value) status.value = null
    return
  }
  loading.value = true
  error.value = ''
  try {
    status.value = await invokeCommand<CodingCollaborationStatus>(
      'get_coding_collaboration',
      {
        conversationId: taskId.value,
        workspacePath: props.workspacePath,
      },
    )
  } catch (reason) {
    error.value = reason instanceof Error
      ? reason.message
      : '暂时无法读取隔离 worktree 状态。'
  } finally {
    loading.value = false
  }
}

async function prepare() {
  if (!props.workspacePath || busy.value) return
  const conversationId = taskId.value || props.ensureConversation(
    `${workspaceName.value} · 隔离 worktree`,
  )
  retainedConversationId.value = conversationId
  loading.value = true
  error.value = ''
  try {
    status.value = await invokeCommand<CodingCollaborationStatus>(
      'prepare_coding_collaboration',
      {
        conversationId,
        workspacePath: props.workspacePath,
        writers: writers.value,
      },
    )
  } catch (reason) {
    error.value = reason instanceof Error
      ? reason.message
      : '无法准备独立 Git worktree。'
  } finally {
    loading.value = false
  }
}

async function finish() {
  if (!taskId.value || !status.value?.canFinish || busy.value) return
  loading.value = true
  error.value = ''
  try {
    status.value = await invokeCommand<CodingCollaborationStatus>(
      'finish_coding_collaboration',
      {
        conversationId: taskId.value,
        workspacePath: props.workspacePath,
      },
    )
    finishDialogOpen.value = false
  } catch (reason) {
    error.value = reason instanceof Error
      ? reason.message
      : '无法安全结束隔离 worktree。'
  } finally {
    loading.value = false
  }
}

defineExpose({ refresh })

watch(
  () => [props.conversationId, props.workspacePath] as const,
  ([conversationId]) => {
    if (conversationId) retainedConversationId.value = conversationId
    status.value = null
    void refresh()
  },
  { immediate: true },
)
</script>

<template>
  <section class="border-b border-border px-4 py-4">
    <div class="flex items-start justify-between gap-3">
      <div>
        <p class="text-body font-medium">独立 Git worktree</p>
        <p class="mt-1 text-caption leading-5 text-muted-foreground">
          写入 Agent 只修改自己的工作树；主 Agent 审阅、提交、集成并运行最终测试。
        </p>
      </div>
      <Badge :variant="active ? 'secondary' : interruptedPreparation ? 'destructive' : 'outline'">
        {{ active ? '已启用' : interruptedPreparation ? '需恢复' : '未启用' }}
      </Badge>
    </div>

    <div
      v-if="!active && !interruptedPreparation"
      class="mt-4 rounded-lg border border-border bg-muted/20 p-3"
    >
      <p class="text-caption font-medium">写入槽数量</p>
      <div class="mt-2 grid grid-cols-2 gap-2">
        <Button
          :variant="writers === 1 ? 'secondary' : 'outline'"
          size="sm"
          :disabled="busy"
          @click="writers = 1"
        >
          1 个 writer
        </Button>
        <Button
          :variant="writers === 2 ? 'secondary' : 'outline'"
          size="sm"
          :disabled="busy"
          @click="writers = 2"
        >
          2 个 writer
        </Button>
      </div>
      <p class="mt-3 text-caption leading-5 text-muted-foreground">
        准备前主工作树必须干净且已有提交。只有任务确实可独立拆分时才选择两个。
      </p>
      <Button
        class="mt-3 w-full"
        size="sm"
        :disabled="busy || !workspacePath"
        @click="prepare"
      >
        <LoaderCircle v-if="loading" class="size-4 animate-spin" />
        <Split v-else class="size-4" />
        准备协作 worktree
      </Button>
    </div>

    <div v-else class="mt-4 space-y-3">
      <div class="rounded-lg bg-primary/5 px-3 py-3">
        <div class="flex items-center gap-2">
          <GitBranch class="size-4 text-primary" />
          <p class="text-caption font-medium">
            基线 {{ status?.baseBranch }} · {{ shortHead(status?.baseHead) }}
          </p>
        </div>
        <p class="mt-2 text-caption leading-5 text-muted-foreground">
          <template v-if="interruptedPreparation">
            创建过程被中断；MilkSU 只会清理已记录且仍安全的临时 worktree，不会删除冲突的外部分支。
          </template>
          <template v-else>
            请求批准档会逐次确认委托；替我审批与完全访问会在已锁定的 worktree 范围内自动执行。
          </template>
        </p>
      </div>

      <article
        v-for="worktree in status?.worktrees"
        :key="worktree.id"
        class="rounded-lg border border-border px-3 py-3"
      >
        <div class="flex items-center justify-between gap-2">
          <div class="flex min-w-0 items-center gap-2">
            <GitCommitHorizontal class="size-4 shrink-0 text-primary" />
            <p class="truncate text-body font-medium">{{ worktree.id }}</p>
          </div>
          <Badge :variant="worktreeTone(worktree)">
            {{ worktreeState(worktree) }}
          </Badge>
        </div>
        <p
          class="mt-2 truncate font-mono text-caption"
          :title="worktree.branch"
        >
          {{ worktree.branch }}
        </p>
        <p
          class="mt-1 truncate font-mono text-caption text-muted-foreground"
          :title="worktree.path"
        >
          {{ worktree.path }}
        </p>
        <div class="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-caption text-muted-foreground">
          <span>HEAD {{ shortHead(worktree.head) }}</span>
          <span>领先 {{ worktree.ahead }}</span>
          <span>落后基线 {{ worktree.behind }}</span>
        </div>
        <p
          v-if="worktree.problem"
          class="mt-2 text-caption leading-5 text-destructive"
        >
          {{ worktree.problem }}
        </p>
      </article>

      <div class="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          class="flex-1"
          :disabled="busy"
          @click="refresh"
        >
          <RefreshCw :class="['size-4', { 'animate-spin': loading }]" />
          刷新
        </Button>
        <Button
          variant="outline"
          size="sm"
          class="flex-1"
          :disabled="busy || !status?.canFinish"
          @click="finishDialogOpen = true"
        >
          <CheckCircle2 class="size-4" />
          安全结束
        </Button>
      </div>
      <p
        v-if="!status?.canFinish"
        class="text-caption leading-5 text-muted-foreground"
      >
        {{
          interruptedPreparation
            ? '已创建的 writer 必须无修改和新增提交，且缺失路径必须仍可验证为 MilkSU 的预留项。'
            : '所有 writer 必须无未提交修改，且其提交已合并或 cherry-pick 到主工作树后才能结束。'
        }}
      </p>
    </div>

    <div
      v-if="status?.problem || error"
      class="mt-3 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-3"
    >
      <TriangleAlert class="mt-0.5 size-4 shrink-0 text-destructive" />
      <p class="text-caption leading-5 text-destructive">
        {{ error || status?.problem }}
      </p>
    </div>
  </section>

  <Dialog v-model:open="finishDialogOpen">
    <DialogContent>
      <DialogHeader>
        <DialogTitle>结束隔离 worktree？</DialogTitle>
        <DialogDescription>
          <template v-if="interruptedPreparation">
            MilkSU 已确认中断前创建的 worktree 没有修改或新增提交。继续后只移除 MilkSU
            已持久记录的临时项；导致冲突的外部分支会保留。
          </template>
          <template v-else>
            MilkSU 已确认 worktree 干净且所有提交都已进入主工作树。继续后将移除这些
            worktree 和对应临时分支，主分支提交不会被删除。
          </template>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button variant="outline" @click="finishDialogOpen = false">取消</Button>
        <Button :disabled="loading" @click="finish">
          <LoaderCircle v-if="loading" class="size-4 animate-spin" />
          确认安全结束
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>
