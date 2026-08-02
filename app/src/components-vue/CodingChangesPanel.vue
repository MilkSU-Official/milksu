<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import {
  Badge,
  Button,
  Input,
} from '@felinic/ui'
import {
  FileDiff,
  GitCommitHorizontal,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  Upload,
} from 'lucide-vue-next'
import { invokeCommand } from '@/desktop'
import CodingDiffHunks from '@/components-vue/CodingDiffHunks.vue'
import type {
  CodingDiffSnapshot,
  CodingEnvironmentSnapshot,
  CodingGitAction,
  CodingGitActionResult,
  CodingGitChange,
  CodingGitHunkAction,
} from '@/codingEnvironmentTypes'

const props = defineProps<{
  workspacePath: string
  environment: CodingEnvironmentSnapshot | null
  running?: boolean
}>()

const emit = defineEmits<{
  review: []
  refresh: []
}>()

const selectedPath = ref('')
const diff = ref<CodingDiffSnapshot | null>(null)
const loading = ref(false)
const error = ref('')
const operation = ref('')
const operationMessage = ref('')
const commitMessage = ref('')

const git = computed(() => props.environment?.git)
const changes = computed(() => git.value?.changes ?? [])
const busy = computed(() => Boolean(props.running || operation.value))
const selectedChange = computed(() => (
  changes.value.find(change => change.path === selectedPath.value)
))

function changeStatus(change: CodingGitChange): string {
  return `${change.indexStatus}${change.worktreeStatus}`
}

async function inspectDiff(change: CodingGitChange) {
  if (!props.workspacePath || loading.value) return
  selectedPath.value = change.path
  loading.value = true
  error.value = ''
  try {
    diff.value = await invokeCommand<CodingDiffSnapshot>(
      'get_coding_diff',
      {
        workspacePath: props.workspacePath,
        relativePath: change.path,
      },
    )
  } catch (reason) {
    diff.value = null
    error.value = reason instanceof Error
      ? reason.message
      : '暂时无法读取文件 Diff。'
  } finally {
    loading.value = false
  }
}

async function applyGitAction(
  action: CodingGitAction,
  relativePath = '',
  message = '',
) {
  if (!props.workspacePath || busy.value) return
  if (
    action === 'discard-worktree'
    && !window.confirm(`丢弃 ${relativePath} 的未暂存修改？此操作无法从 MilkSU 恢复。`)
  ) {
    return
  }
  operation.value = `${action}:${relativePath}`
  operationMessage.value = ''
  error.value = ''
  try {
    const result = await invokeCommand<CodingGitActionResult>(
      'apply_coding_git_action',
      {
        workspacePath: props.workspacePath,
        action,
        relativePath,
        message,
      },
    )
    operationMessage.value = result.message
    if (action === 'commit') commitMessage.value = ''
    if (selectedPath.value) {
      const current = result.snapshot.git.changes?.find(
        change => change.path === selectedPath.value,
      )
      if (current) await inspectDiff(current)
      else {
        selectedPath.value = ''
        diff.value = null
      }
    }
    emit('refresh')
  } catch (reason) {
    error.value = reason instanceof Error
      ? reason.message
      : 'Git 操作失败。'
  } finally {
    operation.value = ''
  }
}

async function commitStagedChanges() {
  await applyGitAction('commit', '', commitMessage.value)
}

async function applyGitHunkAction(action: CodingGitHunkAction, patch: string) {
  const change = selectedChange.value
  if (!props.workspacePath || !change || busy.value) return
  if (
    action === 'discard-hunk'
    && !window.confirm(`撤销 ${change.path} 中选中的代码块？此操作无法从 MilkSU 恢复。`)
  ) {
    return
  }
  operation.value = `${action}:${change.path}`
  operationMessage.value = ''
  error.value = ''
  try {
    const result = await invokeCommand<CodingGitActionResult>(
      'apply_coding_git_hunk_action',
      {
        workspacePath: props.workspacePath,
        action,
        relativePath: change.path,
        patch,
      },
    )
    operationMessage.value = result.message
    const current = result.snapshot.git.changes?.find(
      candidate => candidate.path === selectedPath.value,
    )
    if (current) await inspectDiff(current)
    else {
      selectedPath.value = ''
      diff.value = null
    }
    emit('refresh')
  } catch (reason) {
    error.value = reason instanceof Error
      ? reason.message
      : '代码块操作失败。'
  } finally {
    operation.value = ''
  }
}

watch(
  () => props.workspacePath,
  () => {
    selectedPath.value = ''
    diff.value = null
    error.value = ''
    operationMessage.value = ''
    commitMessage.value = ''
  },
)

watch(changes, current => {
  if (selectedPath.value && !current.some(change => change.path === selectedPath.value)) {
    selectedPath.value = ''
    diff.value = null
    error.value = ''
  }
})
</script>

<template>
  <section class="flex min-h-full flex-col">
    <div class="border-b border-border px-4 py-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <FileDiff class="size-4 text-primary" />
            <p class="text-body font-medium">当前变更</p>
            <Badge
              v-if="git?.isRepository"
              :variant="git.dirty ? 'secondary' : 'outline'"
            >
              {{ git.changedFiles }} 文件
            </Badge>
          </div>
          <p
            v-if="git?.isRepository"
            class="mt-1 font-mono text-caption text-muted-foreground"
          >
            <span>{{ git.branch || 'detached' }}</span>
            <span v-if="git.upstream" class="ml-3">
              ↑{{ git.ahead }} ↓{{ git.behind }}
            </span>
            <span class="ml-3 text-primary">+{{ git.additions }}</span>
            <span class="ml-1 text-destructive">-{{ git.deletions }}</span>
          </p>
          <p v-else class="mt-1 text-caption text-muted-foreground">
            {{ git?.problem || '当前目录不是 Git 仓库。' }}
          </p>
        </div>
        <div class="flex shrink-0 items-center gap-1">
          <Button
            v-if="git?.isRepository && git.dirty"
            variant="ghost"
            size="sm"
            :disabled="busy"
            @click="applyGitAction('stage-all')"
          >
            全部暂存
          </Button>
          <Button
            v-if="git?.isRepository && git.staged"
            variant="ghost"
            size="sm"
            :disabled="busy"
            @click="applyGitAction('unstage-all')"
          >
            全部取消
          </Button>
          <Button
            variant="outline"
            size="sm"
            :disabled="busy || !git?.isRepository"
            @click="emit('review')"
          >
            <SearchCheck class="size-3.5" />
            Agent 审阅
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            :disabled="busy"
            aria-label="刷新 Git 变更"
            @click="emit('refresh')"
          >
            <RefreshCw class="size-3.5" />
          </Button>
        </div>
      </div>
    </div>

    <template v-if="git?.isRepository">
      <div
        v-if="changes.length"
        class="border-b border-border px-3 py-3"
      >
        <div class="mb-2 grid grid-cols-2 gap-2 text-caption text-muted-foreground sm:grid-cols-4">
          <span>暂存 {{ git.staged }}</span>
          <span>修改 {{ git.modified }}</span>
          <span>未跟踪 {{ git.untracked }}</span>
          <span :class="{ 'text-destructive': git.conflicts }">冲突 {{ git.conflicts }}</span>
        </div>
        <div class="max-h-64 space-y-1 overflow-y-auto">
          <div
            v-for="change in changes"
            :key="`${change.indexStatus}${change.worktreeStatus}:${change.path}`"
            class="group flex w-full items-center gap-1 rounded-md px-1 py-0.5 text-caption transition-colors hover:bg-muted"
            :class="{ 'bg-muted': selectedPath === change.path }"
            :title="change.originalPath ? `${change.originalPath} → ${change.path}` : change.path"
          >
            <button
              type="button"
              class="flex min-w-0 flex-1 items-center gap-2 rounded px-1 py-1 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              @click="inspectDiff(change)"
            >
              <span
                class="w-6 shrink-0 font-mono"
                :class="change.conflict
                  ? 'text-destructive'
                  : change.untracked
                    ? 'text-primary'
                    : 'text-muted-foreground'"
              >
                {{ changeStatus(change) }}
              </span>
              <span class="min-w-0 flex-1 truncate">{{ change.path }}</span>
            </button>
            <Button
              v-if="change.staged"
              variant="ghost"
              size="icon-sm"
              :disabled="busy"
              :aria-label="`取消暂存 ${change.path}`"
              :title="`取消暂存 ${change.path}`"
              @click="applyGitAction('unstage', change.path)"
            >
              <Minus class="size-3.5" />
            </Button>
            <Button
              v-if="change.untracked || change.modified"
              variant="ghost"
              size="icon-sm"
              :disabled="busy || change.conflict"
              :aria-label="`暂存 ${change.path}`"
              :title="`暂存 ${change.path}`"
              @click="applyGitAction('stage', change.path)"
            >
              <Plus class="size-3.5" />
            </Button>
            <Button
              v-if="change.modified && !change.staged && !change.untracked && !change.conflict"
              variant="ghost"
              size="icon-sm"
              :disabled="busy"
              :aria-label="`丢弃 ${change.path} 的未暂存修改`"
              :title="`丢弃 ${change.path} 的未暂存修改`"
              @click="applyGitAction('discard-worktree', change.path)"
            >
              <RotateCcw class="size-3.5" />
            </Button>
          </div>
        </div>
        <p
          v-if="git.changesTruncated"
          class="mt-2 text-caption text-muted-foreground"
        >
          仅显示前 80 项。
        </p>
      </div>

      <div class="min-h-0 flex-1 px-4 py-4">
        <div
          v-if="loading"
          class="flex min-h-60 items-center justify-center"
        >
          <LoaderCircle class="size-5 animate-spin text-primary" />
        </div>
        <p v-else-if="error" class="text-caption leading-5 text-destructive">
          {{ error }}
        </p>
        <template v-else-if="diff">
          <p class="mb-3 truncate font-mono text-caption font-medium" :title="diff.path">
            {{ diff.path }}
          </p>
          <div v-if="diff.staged" class="mb-4">
            <p class="mb-1 text-caption font-medium text-muted-foreground">已暂存</p>
            <CodingDiffHunks
              :diff="diff.staged"
              source="staged"
              :busy="busy"
              @apply="applyGitHunkAction"
            />
          </div>
          <div v-if="diff.workingTree">
            <p class="mb-1 text-caption font-medium text-muted-foreground">工作区</p>
            <CodingDiffHunks
              :diff="diff.workingTree"
              source="working-tree"
              :busy="busy"
              @apply="applyGitHunkAction"
            />
          </div>
          <p
            v-if="!diff.staged && !diff.workingTree"
            class="text-caption leading-5 text-muted-foreground"
          >
            {{ selectedChange?.untracked
              ? '未跟踪文件尚未进入 Git Diff；Agent 审阅仍会读取文件内容。'
              : '当前文件没有可显示的文本 Diff。' }}
          </p>
          <p v-if="diff.truncated" class="mt-3 text-caption text-muted-foreground">
            Diff 过长，已截断。
          </p>
        </template>
        <div
          v-else
          class="flex min-h-60 flex-col items-center justify-center text-center"
        >
          <FileDiff class="size-6 text-muted-foreground" />
          <p class="mt-3 text-body font-medium">
            {{ changes.length ? '选择一个文件查看 Diff' : '工作区没有未提交变更' }}
          </p>
          <p class="mt-1 max-w-xs text-caption leading-5 text-muted-foreground">
            Agent 审阅会结合全部变更与周边代码；这里用于逐文件核对证据。
          </p>
        </div>
      </div>

      <div class="border-t border-border px-3 py-3">
        <form class="flex items-center gap-2" @submit.prevent="commitStagedChanges">
          <GitCommitHorizontal class="size-4 shrink-0 text-muted-foreground" />
          <Input
            v-model="commitMessage"
            size="sm"
            emphasis="subtle"
            class="min-w-0 flex-1"
            placeholder="提交说明"
            :disabled="busy || !git.staged || Boolean(git.conflicts)"
          />
          <Button
            type="submit"
            size="sm"
            :disabled="busy || !git.staged || !commitMessage.trim() || Boolean(git.conflicts)"
          >
            提交
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="
              busy
              || !git.branch
              || git.branch === 'detached'
              || Boolean(git.conflicts)
              || Boolean(git.upstream && git.ahead === 0)
            "
            @click="applyGitAction('push')"
          >
            <Upload class="size-3.5" />
            推送<template v-if="git.ahead"> {{ git.ahead }}</template>
          </Button>
        </form>
        <p
          v-if="operationMessage"
          class="mt-2 text-caption text-primary"
        >
          {{ operationMessage }}
        </p>
      </div>
    </template>
  </section>
</template>
