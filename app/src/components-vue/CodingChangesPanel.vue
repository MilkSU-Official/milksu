<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import {
  Badge,
  Button,
} from '@felinic/ui'
import {
  FileDiff,
  LoaderCircle,
  RefreshCw,
} from 'lucide-vue-next'
import { desktopErrorMessage, hasDesktopRuntime, invokeCommand } from '@/desktop'
import CodingDiffHunks from '@/components-vue/CodingDiffHunks.vue'
import ExternalEditorIcon from '@/components-vue/ExternalEditorIcon.vue'
import {
  externalEditorLabel,
  normalizePreferredExternalEditor,
} from '@/lib/externalEditor'
import type {
  CodingDiffSnapshot,
  CodingEnvironmentSnapshot,
  CodingGitChange,
} from '@/codingEnvironmentTypes'

const props = defineProps<{
  workspacePath: string
  environment: CodingEnvironmentSnapshot | null
  running?: boolean
  focusPath?: string
  preferredEditor?: string
}>()

const emit = defineEmits<{
  review: []
  refresh: []
}>()

const selectedPath = ref('')
const fileDiffs = ref<Record<string, CodingDiffSnapshot | null>>({})
const fileDiffErrors = ref<Record<string, string>>({})
const loadingPaths = ref<Record<string, boolean>>({})
const loadingAll = ref(false)
const error = ref('')
const openingPaths = ref<string[]>([])
const openErrors = ref<Record<string, string>>({})
const desktopRuntime = hasDesktopRuntime()
const scrollRoot = ref<HTMLElement | null>(null)

const git = computed(() => props.environment?.git)
const changes = computed(() => git.value?.changes ?? [])
const busy = computed(() => Boolean(props.running))
const maxInlineDiffFiles = 40
const editorId = computed(() => normalizePreferredExternalEditor(props.preferredEditor))
const editorLabel = computed(() => externalEditorLabel(editorId.value))
const openEditorAriaLabel = computed(() => `用 ${editorLabel.value} 打开`)

function changeStatus(change: CodingGitChange): string {
  return `${change.indexStatus}${change.worktreeStatus}`
}

async function loadFileDiff(change: CodingGitChange) {
  if (!props.workspacePath || loadingPaths.value[change.path]) return
  loadingPaths.value = { ...loadingPaths.value, [change.path]: true }
  try {
    const snapshot = await invokeCommand<CodingDiffSnapshot>(
      'get_coding_diff',
      {
        workspacePath: props.workspacePath,
        relativePath: change.path,
      },
    )
    fileDiffs.value = { ...fileDiffs.value, [change.path]: snapshot }
    const nextErrors = { ...fileDiffErrors.value }
    delete nextErrors[change.path]
    fileDiffErrors.value = nextErrors
  } catch (reason) {
    fileDiffs.value = { ...fileDiffs.value, [change.path]: null }
    fileDiffErrors.value = {
      ...fileDiffErrors.value,
      [change.path]: reason instanceof Error
        ? reason.message
        : '暂时无法读取文件 Diff。',
    }
  } finally {
    const nextLoading = { ...loadingPaths.value }
    delete nextLoading[change.path]
    loadingPaths.value = nextLoading
  }
}

async function loadVisibleDiffs() {
  if (!props.workspacePath || !changes.value.length) {
    fileDiffs.value = {}
    fileDiffErrors.value = {}
    return
  }
  loadingAll.value = true
  error.value = ''
  const targets = changes.value.slice(0, maxInlineDiffFiles)
  await Promise.all(targets.map(change => loadFileDiff(change)))
  loadingAll.value = false
}

function fileCardId(path: string) {
  return `coding-change-file:${path}`
}

function escapeAttributeSelector(value: string) {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function openInEditor(path: string) {
  if (!desktopRuntime || !props.workspacePath || openingPaths.value.includes(path)) return
  openingPaths.value = [...openingPaths.value, path]
  const nextErrors = { ...openErrors.value }
  delete nextErrors[path]
  openErrors.value = nextErrors
  try {
    await invokeCommand('open_coding_file_in_editor', {
      workspacePath: props.workspacePath,
      relativePath: path,
    })
  } catch (reason) {
    openErrors.value = {
      ...openErrors.value,
      [path]: desktopErrorMessage(reason) || `无法用 ${editorLabel.value} 打开。`,
    }
  } finally {
    openingPaths.value = openingPaths.value.filter(item => item !== path)
  }
}

async function scrollToPath(path: string) {
  if (!path) return
  selectedPath.value = path
  await nextTick()
  const selector = `[data-change-path="${escapeAttributeSelector(path)}"]`
  const root = scrollRoot.value
  const card = root?.querySelector<HTMLElement>(selector)
    ?? document.querySelector<HTMLElement>(selector)
  if (card && typeof card.scrollIntoView === 'function') {
    card.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }
}

watch(
  () => props.workspacePath,
  () => {
    selectedPath.value = ''
    fileDiffs.value = {}
    fileDiffErrors.value = {}
    loadingPaths.value = {}
    error.value = ''
  },
)

watch(
  changes,
  current => {
    if (selectedPath.value && !current.some(change => change.path === selectedPath.value)) {
      selectedPath.value = ''
    }
    void loadVisibleDiffs()
  },
  { immediate: true },
)

watch(
  () => [props.focusPath, changes.value] as const,
  async ([path, current]) => {
    if (!path) return
    const change = current.find(item => item.path === path)
    if (!change) return
    if (!fileDiffs.value[path] && !fileDiffErrors.value[path]) {
      await loadFileDiff(change)
    }
    await scrollToPath(path)
  },
  { immediate: true },
)
</script>

<template>
  <section class="coding-changes-panel flex min-h-full flex-col text-foreground">
    <div class="border-b border-border px-4 py-3">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <div class="flex items-center gap-2">
            <FileDiff class="size-4 text-primary" />
            <p class="text-body font-medium">变更</p>
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
            {{ !desktopRuntime
              ? '浏览器预览不能读取 Git 状态；请在 MilkSU 桌面 App 中查看真实 Diff。'
              : git?.problem || '当前目录不是 Git 仓库。' }}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon-sm"
          :disabled="busy || loadingAll"
          aria-label="刷新 Git 变更"
          @click="emit('refresh'); loadVisibleDiffs()"
        >
          <RefreshCw class="size-3.5" :class="{ 'animate-spin': loadingAll }" />
        </Button>
      </div>
    </div>

    <template v-if="git?.isRepository">
      <div
        ref="scrollRoot"
        class="coding-changes-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
        aria-label="文件变更列表"
      >
        <p v-if="error" class="text-caption leading-5 text-destructive">
          {{ error }}
        </p>
        <div
          v-if="loadingAll && !changes.length"
          class="flex min-h-40 items-center justify-center"
        >
          <LoaderCircle class="size-5 animate-spin text-primary" />
        </div>
        <article
          v-for="change in changes.slice(0, maxInlineDiffFiles)"
          :id="fileCardId(change.path)"
          :key="`${change.indexStatus}${change.worktreeStatus}:${change.path}`"
          :data-change-path="change.path"
          class="overflow-hidden rounded-lg border border-border bg-card text-card-foreground"
          :class="{ 'ring-1 ring-primary/50': selectedPath === change.path }"
        >
          <header class="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
            <span
              class="w-6 shrink-0 font-mono text-caption"
              :class="change.conflict
                ? 'text-destructive'
                : change.untracked
                  ? 'text-primary'
                  : 'text-muted-foreground'"
            >
              {{ changeStatus(change) }}
            </span>
            <button
              type="button"
              class="min-w-0 flex-1 truncate text-left font-mono text-caption font-medium hover:text-primary"
              :title="change.originalPath ? `${change.originalPath} → ${change.path}` : change.path"
              @click="scrollToPath(change.path)"
            >
              {{ change.path }}
            </button>
            <LoaderCircle
              v-if="loadingPaths[change.path]"
              class="size-3.5 shrink-0 animate-spin text-muted-foreground"
            />
            <button
              type="button"
              class="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground"
              :disabled="!desktopRuntime || !workspacePath || openingPaths.includes(change.path)"
              :aria-label="openEditorAriaLabel"
              :title="openEditorAriaLabel"
              @click="openInEditor(change.path)"
            >
              <LoaderCircle
                v-if="openingPaths.includes(change.path)"
                class="size-3.5 animate-spin"
              />
              <ExternalEditorIcon v-else :editor="editorId" />
            </button>
          </header>
          <p
            v-if="openErrors[change.path]"
            class="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-caption text-destructive"
          >
            {{ openErrors[change.path] }}
          </p>
          <div class="px-2 py-2">
            <p
              v-if="fileDiffErrors[change.path]"
              class="px-1 text-caption leading-5 text-destructive"
            >
              {{ fileDiffErrors[change.path] }}
            </p>
            <template v-else-if="fileDiffs[change.path]">
              <div v-if="fileDiffs[change.path]?.staged" class="mb-3">
                <p class="mb-1 px-1 text-caption font-medium text-muted-foreground">已暂存</p>
                <CodingDiffHunks
                  :diff="fileDiffs[change.path]!.staged!"
                  source="staged"
                  read-only
                />
              </div>
              <div v-if="fileDiffs[change.path]?.workingTree">
                <p
                  v-if="fileDiffs[change.path]?.staged"
                  class="mb-1 px-1 text-caption font-medium text-muted-foreground"
                >
                  工作区
                </p>
                <CodingDiffHunks
                  :diff="fileDiffs[change.path]!.workingTree!"
                  source="working-tree"
                  read-only
                />
              </div>
              <p
                v-if="!fileDiffs[change.path]?.staged && !fileDiffs[change.path]?.workingTree"
                class="px-1 text-caption leading-5 text-muted-foreground"
              >
                {{ change.untracked
                  ? '未跟踪文件尚未进入 Git Diff。'
                  : '当前文件没有可显示的文本 Diff。' }}
              </p>
              <p
                v-if="fileDiffs[change.path]?.truncated"
                class="mt-2 px-1 text-caption text-muted-foreground"
              >
                Diff 过长，已截断。
              </p>
            </template>
            <p
              v-else-if="!loadingPaths[change.path]"
              class="px-1 text-caption text-muted-foreground"
            >
              尚未加载 Diff。
            </p>
          </div>
        </article>
        <p
          v-if="changes.length > maxInlineDiffFiles"
          class="px-1 text-caption text-muted-foreground"
        >
          仅展开前 {{ maxInlineDiffFiles }} 个文件的 Diff。
        </p>
        <div
          v-else-if="!changes.length && !loadingAll"
          class="flex min-h-40 flex-col items-center justify-center text-center"
        >
          <FileDiff class="size-6 text-muted-foreground" />
          <p class="mt-3 text-body font-medium">工作区没有未提交变更</p>
        </div>
      </div>
    </template>

    <div
      v-else
      class="flex min-h-80 flex-1 flex-col items-center justify-center px-8 text-center"
      aria-label="Git 变更空状态"
    >
      <FileDiff class="size-7 text-muted-foreground" />
      <p class="mt-4 text-label font-medium">
        {{ desktopRuntime ? '当前目录没有可显示的变更' : '浏览器预览不能读取 Git 状态' }}
      </p>
      <p class="mt-2 max-w-sm text-body leading-6 text-muted-foreground">
        <template v-if="desktopRuntime">
          {{ git?.problem || '请选择一个 Git 仓库后查看文件级 Diff。' }}
        </template>
        <template v-else>
          真实 Diff 需要在打包后的 MilkSU App 中读取。
        </template>
      </p>
      <Button
        type="button"
        variant="outline"
        size="sm"
        class="mt-4"
        :disabled="busy"
        @click="emit('refresh')"
      >
        <RefreshCw class="size-3.5" />
        重新读取 Git 状态
      </Button>
    </div>
  </section>
</template>
