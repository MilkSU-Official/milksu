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
  Input,
  Textarea,
} from '@felinic/ui'
import {
  FileDiff,
  GitCommitHorizontal,
  GitPullRequestCreate,
  LoaderCircle,
  Minus,
  Plus,
  RefreshCw,
  RotateCcw,
  SearchCheck,
  Upload,
} from 'lucide-vue-next'
import { hasDesktopRuntime, invokeCommand } from '@/desktop'
import CodingDiffHunks from '@/components-vue/CodingDiffHunks.vue'
import type {
  CodingDiffSnapshot,
  CodingEnvironmentSnapshot,
  CodingGitAction,
  CodingGitActionResult,
  CodingGitChange,
  CodingGitDeliveryEvidence,
  CodingGitHunkAction,
  CodingPullRequestPreview,
  CodingPullRequestPublishResult,
} from '@/codingEnvironmentTypes'

const props = defineProps<{
  workspacePath: string
  environment: CodingEnvironmentSnapshot | null
  running?: boolean
}>()

const emit = defineEmits<{
  review: []
  refresh: []
  deliveryEvidence: [evidence: CodingGitDeliveryEvidence]
}>()

const selectedPath = ref('')
const diff = ref<CodingDiffSnapshot | null>(null)
const loading = ref(false)
const error = ref('')
const operation = ref('')
const operationMessage = ref('')
const commitMessage = ref('')
const pullRequestDialogOpen = ref(false)
const pullRequestLoading = ref(false)
const pullRequestPreview = ref<CodingPullRequestPreview | null>(null)
const pullRequestResult = ref<CodingPullRequestPublishResult | null>(null)
const pullRequestTitle = ref('')
const pullRequestBody = ref('')
const pullRequestError = ref('')
const deliveryCopyNotice = ref('')
const pullRequestAcceptanceCopyNotice = ref('')
const desktopRuntime = hasDesktopRuntime()

const git = computed(() => props.environment?.git)
const changes = computed(() => git.value?.changes ?? [])
const busy = computed(() => Boolean(props.running || operation.value))
const selectedChange = computed(() => (
  changes.value.find(change => change.path === selectedPath.value)
))
const authorizedPullRequestRepository = 'MilkSU-Official/milksu'
const authorizedPullRequestRepositoryUrl = 'https://github.com/MilkSU-Official/milksu'

function changeStatus(change: CodingGitChange): string {
  return `${change.indexStatus}${change.worktreeStatus}`
}

function redactConfirmationToken(value: string, token?: string) {
  if (!token) return value
  return value.split(token).join('[confirmation token redacted]')
}

function validatePullRequestPreview(preview: CodingPullRequestPreview) {
  if (
    preview.repository !== authorizedPullRequestRepository
    || preview.repositoryUrl !== authorizedPullRequestRepositoryUrl
  ) {
    throw new Error('Pull Request 发布只允许当前授权的 MilkSU 私有仓库。')
  }
  if (!preview.private) {
    throw new Error('Pull Request 发布目标必须是当前授权的 MilkSU 私有仓库。')
  }
  if (!preview.remote.trim() || !preview.sourceBranch.trim() || !preview.targetBranch.trim() || !preview.headCommit.trim()) {
    throw new Error('Pull Request 预览缺少仓库、分支或提交信息，请重新准备。')
  }
  if (!preview.confirmationToken.trim()) {
    throw new Error('Pull Request 预览缺少一次性确认，请重新准备。')
  }
}

function emitGitDeliveryEvidence(
  action: CodingGitDeliveryEvidence['action'],
  snapshot: CodingEnvironmentSnapshot,
  message: string,
  pullRequest?: CodingGitDeliveryEvidence['pullRequest'],
) {
  const git = snapshot.git
  emit('deliveryEvidence', {
    action,
    branch: git.branch,
    upstream: git.upstream,
    head: git.head,
    capturedAt: snapshot.capturedAt || new Date().toISOString(),
    message,
    pullRequest,
  })
}

const deliveryStateLabel = computed(() => {
  if (!git.value?.isRepository) return '不可交付'
  if (git.value.conflicts > 0) return '冲突待处理'
  if (git.value.dirty) return '变更待提交'
  if (git.value.ahead > 0) return '提交待推送'
  return '已收口'
})

const gitNextStep = computed<{
  label: string
  detail: string
  action: 'review' | 'stage-all' | 'commit' | 'push' | 'prepare-pr' | 'none'
  cta: string
  disabled: boolean
}>(() => {
  const current = git.value
  if (!current?.isRepository) {
    return {
      label: '选择 Git 仓库',
      detail: current?.problem || '当前目录不是 Git 仓库，无法审阅 Diff、暂存、提交或推送。',
      action: 'none',
      cta: '不可交付',
      disabled: true,
    }
  }
  if (current.conflicts > 0) {
    return {
      label: '先处理冲突',
      detail: `${current.conflicts} 个冲突文件需要人工或 Agent 审阅；不要直接提交。`,
      action: 'review',
      cta: 'Agent 审阅',
      disabled: busy.value,
    }
  }
  if (current.dirty && current.staged === 0) {
    return {
      label: '审阅 Diff 并暂存',
      detail: `${current.changedFiles} 个文件有变更；先看 Diff，再暂存准备提交。`,
      action: 'stage-all',
      cta: '全部暂存',
      disabled: busy.value || !current.changedFiles,
    }
  }
  if (current.staged > 0) {
    return {
      label: '提交已暂存变更',
      detail: commitMessage.value.trim()
        ? `${current.staged} 个文件已暂存，将使用下方提交说明创建 commit。`
        : `${current.staged} 个文件已暂存；请先填写提交说明。`,
      action: 'commit',
      cta: commitMessage.value.trim() ? '提交' : '等待提交说明',
      disabled: busy.value || !commitMessage.value.trim(),
    }
  }
  if (current.ahead > 0) {
    return {
      label: '推送当前分支',
      detail: `${current.branch || '当前分支'} ahead ${current.ahead}；推送到授权远端后才能准备 PR。`,
      action: 'push',
      cta: `推送 ${current.ahead}`,
      disabled: busy.value || !current.branch || current.branch === 'detached',
    }
  }
  if (!current.upstream) {
    return {
      label: '设置上游后再 PR',
      detail: '当前分支没有 upstream；先推送并设置授权远端，再准备 PR。',
      action: 'push',
      cta: '推送分支',
      disabled: busy.value || !current.branch || current.branch === 'detached',
    }
  }
  return {
    label: '准备草稿 PR',
    detail: '工作区干净且已同步；下一步是预览 MilkSU 私有仓库草稿 PR，并进行一次性确认。',
    action: 'prepare-pr',
    cta: '准备 PR',
    disabled: busy.value || pullRequestLoading.value || !current.branch || current.branch === 'detached',
  }
})

const deliverySummary = computed(() => {
  const current = git.value
  if (!current?.isRepository) {
    return [
      '# MilkSU Git 交付摘要',
      `- 状态：不可交付`,
      `- 原因：${current?.problem || '当前目录不是 Git 仓库'}`,
    ].join('\n')
  }
  return [
    '# MilkSU Git 交付摘要',
    `- 状态：${deliveryStateLabel.value}`,
    `- 工作区：${props.workspacePath || '未选择'}`,
    `- 分支：${current.branch || 'detached'}`,
    `- HEAD：${current.head || '未知'}`,
    `- 上游：${current.upstream || '未设置'}`,
    `- 同步：ahead ${current.ahead} / behind ${current.behind}`,
    `- 变更：${current.changedFiles} 文件；暂存 ${current.staged}；修改 ${current.modified}；未跟踪 ${current.untracked}；冲突 ${current.conflicts}`,
    `- Diff：+${current.additions} / -${current.deletions}`,
    `- 下一步：${current.conflicts > 0
      ? '先解决冲突'
      : current.dirty
        ? '审阅 Diff，暂存并提交'
        : current.ahead > 0
          ? 'push 到授权远端'
          : '可作为本轮 Git 交付证据'}`,
  ].join('\n')
})

const pullRequestAcceptancePrompt = computed(() => {
  const current = git.value
  const lines = [
    '继续 MilkSU Git / PR 交付验收。',
    '',
    `工作区：${props.workspacePath || '未选择'}`,
    `Git 状态：${deliveryStateLabel.value}`,
    current?.isRepository
      ? `分支：${current.branch || 'detached'}；上游：${current.upstream || '未设置'}；HEAD：${current.head || '未知'}；ahead ${current.ahead} / behind ${current.behind}`
      : `不可交付：${current?.problem || '当前目录不是 Git 仓库'}`,
    '',
    '验收清单：',
    '1. 先确认工作区干净、当前分支已 push 到授权远端，且没有未暂存/已暂存/冲突变更。',
    '2. 点击“准备 PR”，只允许预览 MilkSU-Official/milksu 私有仓库、当前分支、目标分支和 HEAD commit。',
    '3. 在确认弹窗里核对仓库、远端、源分支、目标分支和提交；一次性确认 token 不能出现在 UI、日志、错误或复制文本里。',
    '4. 只有用户确认后才创建或复用草稿 PR；不得向引用的开源项目、upstream 或非 MilkSU 私有仓库发布。',
    '5. 创建后读回 PR number、URL、state、draft、source branch、target branch 和 head commit；读回失败时不要重复创建，先让用户核对。',
    '',
    '边界：不要读取、输出或迁移 Provider/API Key；不要把 push 当成 PR 已发布；不要把预览态写成托管平台写入成功。',
  ]
  return lines.join('\n')
})

async function copyDeliverySummary() {
  deliveryCopyNotice.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(deliverySummary.value)
    deliveryCopyNotice.value = '已复制'
  } catch {
    deliveryCopyNotice.value = '复制失败，请手动选择摘要'
  }
}

async function copyPullRequestAcceptancePrompt() {
  pullRequestAcceptanceCopyNotice.value = ''
  try {
    if (!navigator.clipboard?.writeText) throw new Error('clipboard unavailable')
    await navigator.clipboard.writeText(pullRequestAcceptancePrompt.value)
    pullRequestAcceptanceCopyNotice.value = '已复制'
  } catch {
    pullRequestAcceptanceCopyNotice.value = '复制失败，请手动选择 PR 验收清单'
  }
}

async function runGitNextStep() {
  if (gitNextStep.value.disabled) return
  if (gitNextStep.value.action === 'review') {
    emit('review')
    return
  }
  if (gitNextStep.value.action === 'stage-all') {
    await applyGitAction('stage-all')
    return
  }
  if (gitNextStep.value.action === 'commit') {
    await commitStagedChanges()
    return
  }
  if (gitNextStep.value.action === 'push') {
    await applyGitAction('push')
    return
  }
  if (gitNextStep.value.action === 'prepare-pr') {
    await preparePullRequest()
  }
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
    if (action === 'commit' || action === 'push') {
      emitGitDeliveryEvidence(action, result.snapshot, result.message)
    }
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

async function preparePullRequest() {
  if (!props.workspacePath || busy.value || pullRequestLoading.value) return
  pullRequestLoading.value = true
  pullRequestError.value = ''
  pullRequestResult.value = null
  operationMessage.value = ''
  error.value = ''
  try {
    const preview = await invokeCommand<CodingPullRequestPreview>(
      'prepare_coding_pull_request',
      { workspacePath: props.workspacePath },
    )
    validatePullRequestPreview(preview)
    pullRequestPreview.value = preview
    pullRequestTitle.value = preview.suggestedTitle
    pullRequestBody.value = ''
    pullRequestDialogOpen.value = true
  } catch (reason) {
    pullRequestPreview.value = null
    pullRequestError.value = reason instanceof Error
      ? reason.message
      : '无法准备 Pull Request。'
    error.value = pullRequestError.value
  } finally {
    pullRequestLoading.value = false
  }
}

async function publishPullRequest() {
  const preview = pullRequestPreview.value
  if (
    !preview
    || !props.workspacePath
    || pullRequestLoading.value
    || !pullRequestTitle.value.trim()
  ) return
  pullRequestLoading.value = true
  pullRequestError.value = ''
  try {
    const result = await invokeCommand<CodingPullRequestPublishResult>(
      'publish_coding_pull_request',
      {
        workspacePath: props.workspacePath,
        confirmationToken: preview.confirmationToken,
        title: pullRequestTitle.value,
        body: pullRequestBody.value,
      },
    )
    pullRequestResult.value = result
    pullRequestPreview.value = null
    operationMessage.value = result.verified
      ? result.created
        ? `已创建并验证草稿 PR #${result.number}`
        : `当前分支已有已验证的草稿 PR #${result.number}`
      : `草稿 PR #${result.number} 已创建，但读回验证未完成`
    emit('deliveryEvidence', {
      action: 'pull-request',
      branch: result.sourceBranch,
      head: result.headCommit,
      capturedAt: new Date().toISOString(),
      message: operationMessage.value,
      pullRequest: {
        number: result.number,
        url: result.url,
        verified: result.verified,
        created: result.created,
      },
    })
  } catch (reason) {
    pullRequestError.value = redactConfirmationToken(reason instanceof Error
      ? reason.message
      : '创建 Pull Request 失败。', preview.confirmationToken)
    pullRequestPreview.value = null
    pullRequestDialogOpen.value = false
    error.value = pullRequestError.value
  } finally {
    pullRequestLoading.value = false
  }
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
    pullRequestDialogOpen.value = false
    pullRequestPreview.value = null
    pullRequestResult.value = null
    pullRequestError.value = ''
  },
)

watch(
  () => [git.value?.branch, git.value?.head] as const,
  (current, previous) => {
    if (
      current[0] !== previous?.[0]
      || current[1] !== previous?.[1]
    ) {
      pullRequestDialogOpen.value = false
      pullRequestPreview.value = null
      pullRequestResult.value = null
      pullRequestError.value = ''
    }
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
            {{ !desktopRuntime
              ? '浏览器预览不能读取 Git 状态；请在 MilkSU 桌面 App 中验收真实 Diff、暂存、提交和推送。'
              : git?.problem || '当前目录不是 Git 仓库。' }}
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
      <div class="border-b border-border bg-primary/5 px-4 py-3" aria-label="Git 交付下一步">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="text-caption font-medium text-muted-foreground">下一步</p>
            <p class="mt-1 text-body font-medium">{{ gitNextStep.label }}</p>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">
              {{ gitNextStep.detail }}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="shrink-0"
            :disabled="gitNextStep.disabled"
            aria-label="执行 Git 交付下一步"
            @click="runGitNextStep"
          >
            {{ gitNextStep.cta }}
          </Button>
        </div>
      </div>

      <details class="border-b border-border bg-muted/20 px-4 py-3">
        <summary class="cursor-pointer text-caption font-medium text-muted-foreground">
          Git 交付摘要
        </summary>
        <pre class="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-md bg-background px-3 py-2 font-mono text-caption leading-5">{{ deliverySummary }}</pre>
        <div class="mt-2 flex items-center justify-between gap-2">
          <span class="text-caption text-muted-foreground">
            {{ deliveryCopyNotice || '复制后可写入本轮验收记录或交给下一位 Agent。' }}
          </span>
          <Button type="button" variant="outline" size="sm" @click="copyDeliverySummary">
            复制交付摘要
          </Button>
        </div>
      </details>

      <div
        class="border-b border-border bg-background px-4 py-3"
        aria-label="PR 发布验收接力"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-caption font-medium text-muted-foreground">PR 发布验收</p>
              <Badge variant="outline">单独确认</Badge>
            </div>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">
              Push 只证明 Git 远端同步；草稿 PR 是托管平台写入，必须先预览 MilkSU 私有仓库、分支和 HEAD，再由用户确认。
            </p>
            <p class="mt-2 text-caption text-muted-foreground">
              {{ pullRequestAcceptanceCopyNotice || '复制后可交给下一轮 Agent 或用户按清单完成 PR 验收。' }}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="shrink-0"
            @click="copyPullRequestAcceptancePrompt"
          >
            复制 PR 验收
          </Button>
        </div>
      </div>

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
          <Button
            type="button"
            variant="outline"
            size="sm"
            :disabled="
              busy
              || pullRequestLoading
              || git.dirty
              || !git.branch
              || git.branch === 'detached'
              || !git.upstream
              || Boolean(git.ahead)
              || Boolean(git.conflicts)
            "
            @click="preparePullRequest"
          >
            <LoaderCircle
              v-if="pullRequestLoading && !pullRequestDialogOpen"
              class="size-3.5 animate-spin"
            />
            <GitPullRequestCreate v-else class="size-3.5" />
            准备 PR
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

    <div
      v-else
      class="flex min-h-80 flex-1 flex-col items-center justify-center px-8 text-center"
      aria-label="Git 交付运行时边界"
    >
      <FileDiff class="size-7 text-muted-foreground" />
      <p class="mt-4 text-label font-medium">
        {{ desktopRuntime ? '当前目录不可交付' : '浏览器预览不能读取 Git 状态' }}
      </p>
      <p class="mt-2 max-w-sm text-body leading-6 text-muted-foreground">
        <template v-if="desktopRuntime">
          {{ git?.problem || '请选择一个 Git 仓库，再审阅 Diff、暂存、提交和推送。' }}
        </template>
        <template v-else>
          这里只能验证 Git 交付面板的文案和入口。真实 Diff/Hunk、stage、commit、push 和 PR
          发布确认需要在打包后的 MilkSU App 中执行。
        </template>
      </p>
      <div class="mt-4 w-full max-w-sm rounded-lg border border-primary/20 bg-primary/5 px-3 py-3 text-left" aria-label="Git 交付下一步">
        <p class="text-caption font-medium text-muted-foreground">下一步</p>
        <p class="mt-1 text-body font-medium">
          {{ desktopRuntime ? '选择 Git 仓库' : '打开桌面 App 验收 Git' }}
        </p>
        <p class="mt-1 text-caption leading-5 text-muted-foreground">
          {{ desktopRuntime
            ? '选择一个 Git 仓库后，MilkSU 才能读取 Diff、暂存、提交、推送和 PR 状态。'
            : '浏览器预览只能看入口；真实 Git 交付必须在打包后的 MilkSU App 中完成。' }}
        </p>
      </div>
      <div
        class="mt-3 w-full max-w-sm rounded-lg border border-border bg-background px-3 py-3 text-left"
        aria-label="PR 发布验收接力"
      >
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="flex items-center gap-2">
              <p class="text-caption font-medium text-muted-foreground">PR 发布验收</p>
              <Badge variant="outline">单独确认</Badge>
            </div>
            <p class="mt-1 text-caption leading-5 text-muted-foreground">
              Push 只证明 Git 远端同步；草稿 PR 是托管平台写入，必须先预览 MilkSU 私有仓库、分支和 HEAD，再由用户确认。
            </p>
            <p class="mt-2 text-caption text-muted-foreground">
              {{ pullRequestAcceptanceCopyNotice || '复制后可交给下一轮 Agent 或用户按清单完成 PR 验收。' }}
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            class="shrink-0"
            @click="copyPullRequestAcceptancePrompt"
          >
            复制 PR 验收
          </Button>
        </div>
      </div>
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

    <Dialog v-model:open="pullRequestDialogOpen">
      <DialogContent class="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>发布 MilkSU 草稿 PR</DialogTitle>
          <DialogDescription>
            这是独立的托管平台写入确认。令牌只在当前 App 进程中保留五分钟，仓库状态变化后必须重新准备。
          </DialogDescription>
        </DialogHeader>

        <template v-if="pullRequestResult">
          <div class="space-y-3 text-body">
            <div
              class="rounded-lg border px-3 py-3"
              :class="pullRequestResult.verified
                ? 'border-primary/30 bg-primary/5'
                : 'border-amber-500/30 bg-amber-500/5'"
            >
              <p
                class="font-medium"
                :class="pullRequestResult.verified ? 'text-primary' : 'text-amber-500'"
              >
                <template v-if="pullRequestResult.verified">
                  {{ pullRequestResult.created ? '已创建并验证' : '已找到并验证现有' }}草稿 PR
                  #{{ pullRequestResult.number }}
                </template>
                <template v-else>
                  草稿 PR #{{ pullRequestResult.number }} 已创建，但读回验证未完成
                </template>
              </p>
              <p class="mt-1 break-all font-mono text-caption text-muted-foreground">
                {{ pullRequestResult.url }}
              </p>
              <p
                v-if="pullRequestResult.problem"
                class="mt-2 text-caption leading-5 text-amber-500"
              >
                {{ pullRequestResult.problem }}。请先在仓库中核对，不要重复创建。
              </p>
            </div>
            <dl class="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-caption">
              <dt class="text-muted-foreground">仓库</dt>
              <dd class="font-mono">{{ pullRequestResult.repository }}</dd>
              <dt class="text-muted-foreground">源分支</dt>
              <dd class="break-all font-mono">{{ pullRequestResult.sourceBranch }}</dd>
              <dt class="text-muted-foreground">目标分支</dt>
              <dd class="break-all font-mono">{{ pullRequestResult.targetBranch }}</dd>
              <dt class="text-muted-foreground">提交</dt>
              <dd class="break-all font-mono">{{ pullRequestResult.headCommit }}</dd>
            </dl>
          </div>
          <DialogFooter>
            <Button type="button" @click="pullRequestDialogOpen = false">
              完成
            </Button>
          </DialogFooter>
        </template>

        <template v-else-if="pullRequestPreview">
          <div class="space-y-4">
            <div class="rounded-lg border border-border bg-muted/30 px-3 py-3">
              <dl class="grid grid-cols-[7rem_minmax(0,1fr)] gap-x-3 gap-y-2 text-caption">
                <dt class="text-muted-foreground">仓库</dt>
                <dd class="flex min-w-0 items-center gap-2 font-mono">
                  <span class="truncate">{{ pullRequestPreview.repository }}</span>
                  <Badge variant="outline">Private</Badge>
                </dd>
                <dt class="text-muted-foreground">远端</dt>
                <dd class="font-mono">{{ pullRequestPreview.remote }}</dd>
                <dt class="text-muted-foreground">源分支</dt>
                <dd class="break-all font-mono">{{ pullRequestPreview.sourceBranch }}</dd>
                <dt class="text-muted-foreground">目标分支</dt>
                <dd class="break-all font-mono">{{ pullRequestPreview.targetBranch }}</dd>
                <dt class="text-muted-foreground">提交</dt>
                <dd class="break-all font-mono">{{ pullRequestPreview.headCommit }}</dd>
              </dl>
            </div>
            <p
              v-if="pullRequestPreview.existingNumber"
              class="rounded-lg border border-primary/30 bg-primary/5 px-3 py-2 text-caption leading-5 text-primary"
            >
              当前分支已有匹配的草稿 PR #{{ pullRequestPreview.existingNumber }}。
              确认后会使用并读回验证这个 PR，不会重复创建。
            </p>

            <template v-if="!pullRequestPreview.existingNumber">
              <label class="block space-y-1.5 text-caption">
                <span class="font-medium">标题</span>
                <Input
                  v-model="pullRequestTitle"
                  size="sm"
                  :disabled="pullRequestLoading"
                  aria-label="Pull Request 标题"
                />
              </label>
              <label class="block space-y-1.5 text-caption">
                <span class="font-medium">说明</span>
                <Textarea
                  v-model="pullRequestBody"
                  class="min-h-28 resize-y"
                  :disabled="pullRequestLoading"
                  placeholder="可选：说明改动、测试和验收结果"
                  aria-label="Pull Request 说明"
                />
              </label>
            </template>
            <p class="text-caption leading-5 text-amber-500">
              最终动作只会在 MilkSU-Official/milksu 创建草稿 PR；不会向 upstream 或引用的开源项目发布。
            </p>
            <p v-if="pullRequestError" class="text-caption leading-5 text-destructive">
              {{ pullRequestError }}
            </p>
          </div>
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              :disabled="pullRequestLoading"
              @click="pullRequestDialogOpen = false"
            >
              取消
            </Button>
            <Button
              type="button"
              :disabled="pullRequestLoading || !pullRequestTitle.trim()"
              @click="publishPullRequest"
            >
              <LoaderCircle v-if="pullRequestLoading" class="size-3.5 animate-spin" />
              <GitPullRequestCreate v-else class="size-3.5" />
              {{ pullRequestPreview.existingNumber
                ? '确认使用现有草稿 PR'
                : '确认创建草稿 PR' }}
            </Button>
          </DialogFooter>
        </template>
      </DialogContent>
    </Dialog>
  </section>
</template>
