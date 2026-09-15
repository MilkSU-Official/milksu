import { useEffect, useMemo, useRef, useState } from 'react'
import { Badge, Button } from '@/components/ui'
import { FileDiff, LoaderCircle, RefreshCw } from 'lucide-react'
import { desktopErrorMessage, hasDesktopRuntime, invokeCommand } from '@/desktop'
import CodingDiffHunks from '@/components/CodingDiffHunks'
import ExternalEditorIcon from '@/components/ExternalEditorIcon'
import {
  externalEditorLabel,
  normalizePreferredExternalEditor,
} from '@/lib/externalEditor'
import { useT } from '@/hooks/useUiLocale'
import type {
  CodingDiffSnapshot,
  CodingEnvironmentSnapshot,
  CodingGitChange,
} from '@/codingEnvironmentTypes'

export default function CodingChangesPanel({
  workspacePath,
  environment,
  running,
  focusPath,
  preferredEditor,
  onReview: _onReview,
  onRefresh,
}: {
  workspacePath: string
  environment: CodingEnvironmentSnapshot | null
  running?: boolean
  focusPath?: string
  preferredEditor?: string
  onReview?: () => void
  onRefresh?: () => void
}) {
  const t = useT()
  const [selectedPath, setSelectedPath] = useState('')
  const [fileDiffs, setFileDiffs] = useState<Record<string, CodingDiffSnapshot | null>>({})
  const [fileDiffErrors, setFileDiffErrors] = useState<Record<string, string>>({})
  const [loadingPaths, setLoadingPaths] = useState<Record<string, boolean>>({})
  const [loadingAll, setLoadingAll] = useState(false)
  const [error, setError] = useState('')
  const [openingPaths, setOpeningPaths] = useState<string[]>([])
  const [openErrors, setOpenErrors] = useState<Record<string, string>>({})
  const desktopRuntime = hasDesktopRuntime()
  const scrollRoot = useRef<HTMLElement | null>(null)

  const git = environment?.git
  const changes = git?.changes ?? []
  const busy = Boolean(running)
  const maxInlineDiffFiles = 40
  const editorId = normalizePreferredExternalEditor(preferredEditor)
  const editorLabel = externalEditorLabel(editorId)
  const openEditorAriaLabel = t(`用 ${editorLabel} 打开`, `Open with ${editorLabel}`)

  function changeStatus(change: CodingGitChange): string {
    return `${change.indexStatus}${change.worktreeStatus}`
  }

  async function loadFileDiff(change: CodingGitChange) {
    if (!workspacePath || loadingPaths[change.path]) return
    setLoadingPaths(current => ({ ...current, [change.path]: true }))
    try {
      const snapshot = await invokeCommand<CodingDiffSnapshot>(
        'get_coding_diff',
        { workspacePath, relativePath: change.path },
      )
      setFileDiffs(current => ({ ...current, [change.path]: snapshot }))
      setFileDiffErrors(current => {
        const next = { ...current }
        delete next[change.path]
        return next
      })
    } catch (reason) {
      setFileDiffs(current => ({ ...current, [change.path]: null }))
      setFileDiffErrors(current => ({
        ...current,
        [change.path]: reason instanceof Error
          ? reason.message
          : t('暂时无法读取文件 Diff。', 'This file diff cannot be read right now.'),
      }))
    } finally {
      setLoadingPaths(current => {
        const next = { ...current }
        delete next[change.path]
        return next
      })
    }
  }

  async function loadVisibleDiffs() {
    if (!workspacePath || !changes.length) {
      setFileDiffs({})
      setFileDiffErrors({})
      return
    }
    setLoadingAll(true)
    setError('')
    const targets = changes.slice(0, maxInlineDiffFiles)
    await Promise.all(targets.map(change => loadFileDiff(change)))
    setLoadingAll(false)
  }

  function fileCardId(path: string) {
    return `coding-change-file:${path}`
  }

  function escapeAttributeSelector(value: string) {
    return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  }

  async function openInEditor(path: string) {
    if (!desktopRuntime || !workspacePath || openingPaths.includes(path)) return
    setOpeningPaths(current => [...current, path])
    setOpenErrors(current => {
      const next = { ...current }
      delete next[path]
      return next
    })
    try {
      await invokeCommand('open_coding_file_in_editor', {
        workspacePath,
        relativePath: path,
      })
    } catch (reason) {
      setOpenErrors(current => ({
        ...current,
        [path]: desktopErrorMessage(reason) || t(`无法用 ${editorLabel} 打开。`, `Could not open with ${editorLabel}.`),
      }))
    } finally {
      setOpeningPaths(current => current.filter(item => item !== path))
    }
  }

  async function scrollToPath(path: string) {
    if (!path) return
    setSelectedPath(path)
    await Promise.resolve()
    const selector = `[data-change-path="${escapeAttributeSelector(path)}"]`
    const root = scrollRoot.current
    const card = root?.querySelector<HTMLElement>(selector)
      ?? document.querySelector<HTMLElement>(selector)
    if (card && typeof card.scrollIntoView === 'function') {
      card.scrollIntoView({ block: 'start', behavior: 'smooth' })
    }
  }

  useEffect(() => {
    setSelectedPath('')
    setFileDiffs({})
    setFileDiffErrors({})
    setLoadingPaths({})
    setError('')
  }, [workspacePath])

  const changeKey = useMemo(() => changes.map(change => `${change.path}:${change.indexStatus}${change.worktreeStatus}`).join('|'), [changes])

  useEffect(() => {
    if (selectedPath && !changes.some(change => change.path === selectedPath)) {
      setSelectedPath('')
    }
    void loadVisibleDiffs()
  }, [workspacePath, changeKey])

  useEffect(() => {
    if (!focusPath) return
    const change = changes.find(item => item.path === focusPath)
    if (!change) return
    void (async () => {
      if (!fileDiffs[focusPath] && !fileDiffErrors[focusPath]) {
        await loadFileDiff(change)
      }
      await scrollToPath(focusPath)
    })()
  }, [focusPath, changeKey])

  return (
    <section className="coding-changes-panel flex min-h-full flex-col text-foreground">
      <div className="border-b border-border px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <FileDiff className="size-4 text-primary" />
              <p className="text-body font-medium">{t('变更', 'Changes')}</p>
              {git?.isRepository ? (
                <Badge variant={git.dirty ? 'secondary' : 'outline'}>
                  {t(`${git.changedFiles} 文件`, `${git.changedFiles} files`)}
                </Badge>
              ) : null}
            </div>
            {git?.isRepository ? (
              <p className="mt-1 font-mono text-caption text-muted-foreground">
                <span>{git.branch || 'detached'}</span>
                {git.upstream ? <span className="ml-3">↑{git.ahead} ↓{git.behind}</span> : null}
                <span className="ml-3 text-primary">+{git.additions}</span>
                <span className="ml-1 text-destructive">-{git.deletions}</span>
              </p>
            ) : (
              <p className="mt-1 text-caption text-muted-foreground">
                {!desktopRuntime
                  ? t('浏览器预览不能读取 Git 状态；请在 MilkSU 桌面 App 中查看真实 Diff。', 'Browser preview cannot read Git status. View the real diff in the MilkSU desktop app.')
                  : git?.problem || t('当前目录不是 Git 仓库。', 'This directory is not a Git repository.')}
              </p>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            disabled={busy || loadingAll}
            aria-label={t('刷新 Git 变更', 'Refresh Git changes')}
            onClick={() => {
              onRefresh?.()
              void loadVisibleDiffs()
            }}
          >
            <RefreshCw className={`size-3.5${loadingAll ? ' animate-spin' : ''}`} />
          </Button>
        </div>
      </div>

      {git?.isRepository ? (
        <div
          ref={element => {
            scrollRoot.current = element
          }}
          className="coding-changes-scroll min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3"
          aria-label={t('文件变更列表', 'Changed files')}
        >
          {error ? <p className="text-caption leading-5 text-destructive">{error}</p> : null}
          {loadingAll && !changes.length ? (
            <div className="flex min-h-40 items-center justify-center">
              <LoaderCircle className="size-5 animate-spin text-primary" />
            </div>
          ) : null}
          {changes.slice(0, maxInlineDiffFiles).map(change => {
            const diff = fileDiffs[change.path]
            return (
              <article
                key={`${change.indexStatus}${change.worktreeStatus}:${change.path}`}
                id={fileCardId(change.path)}
                data-change-path={change.path}
                className={`overflow-hidden rounded-lg border border-border bg-card text-card-foreground${selectedPath === change.path ? ' ring-1 ring-primary/50' : ''}`}
              >
                <header className="flex items-center gap-2 border-b border-border bg-muted/30 px-3 py-2">
                  <span
                    className={`w-6 shrink-0 font-mono text-caption ${
                      change.conflict
                        ? 'text-destructive'
                        : change.untracked
                          ? 'text-primary'
                          : 'text-muted-foreground'
                    }`}
                  >
                    {changeStatus(change)}
                  </span>
                  <button
                    type="button"
                    className="min-w-0 flex-1 truncate text-left font-mono text-caption font-medium hover:text-primary"
                    title={change.originalPath ? `${change.originalPath} → ${change.path}` : change.path}
                    onClick={() => void scrollToPath(change.path)}
                  >
                    {change.path}
                  </button>
                  {loadingPaths[change.path] ? <LoaderCircle className="size-3.5 shrink-0 animate-spin text-muted-foreground" /> : null}
                  <button
                    type="button"
                    className="flex size-7 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-background/70 hover:text-foreground"
                    disabled={!desktopRuntime || !workspacePath || openingPaths.includes(change.path)}
                    aria-label={openEditorAriaLabel}
                    title={openEditorAriaLabel}
                    onClick={() => void openInEditor(change.path)}
                  >
                    {openingPaths.includes(change.path) ? (
                      <LoaderCircle className="size-3.5 animate-spin" />
                    ) : (
                      <ExternalEditorIcon editor={editorId} />
                    )}
                  </button>
                </header>
                {openErrors[change.path] ? (
                  <p className="border-b border-destructive/30 bg-destructive/10 px-3 py-1.5 text-caption text-destructive">
                    {openErrors[change.path]}
                  </p>
                ) : null}
                <div className="px-2 py-2">
                  {fileDiffErrors[change.path] ? (
                    <p className="px-1 text-caption leading-5 text-destructive">{fileDiffErrors[change.path]}</p>
                  ) : diff ? (
                    <>
                      {diff.staged ? (
                        <div className="mb-3">
                          <p className="mb-1 px-1 text-caption font-medium text-muted-foreground">{t('已暂存', 'Staged')}</p>
                          <CodingDiffHunks diff={diff.staged} source="staged" readOnly />
                        </div>
                      ) : null}
                      {diff.workingTree ? (
                        <div>
                          {diff.staged ? (
                            <p className="mb-1 px-1 text-caption font-medium text-muted-foreground">{t('工作区', 'Working tree')}</p>
                          ) : null}
                          <CodingDiffHunks diff={diff.workingTree} source="working-tree" readOnly />
                        </div>
                      ) : null}
                      {!diff.staged && !diff.workingTree ? (
                        <p className="px-1 text-caption leading-5 text-muted-foreground">
                          {change.untracked
                            ? t('未跟踪文件尚未进入 Git Diff。', 'Untracked files are not in the Git diff yet.')
                            : t('当前文件没有可显示的文本 Diff。', 'This file has no displayable text diff.')}
                        </p>
                      ) : null}
                      {diff.truncated ? (
                        <p className="mt-2 px-1 text-caption text-muted-foreground">
                          {t('Diff 过长，已截断。', 'Diff is too long and was truncated.')}
                        </p>
                      ) : null}
                    </>
                  ) : !loadingPaths[change.path] ? (
                    <p className="px-1 text-caption text-muted-foreground">{t('尚未加载 Diff。', 'Diff is not loaded yet.')}</p>
                  ) : null}
                </div>
              </article>
            )
          })}
          {changes.length > maxInlineDiffFiles ? (
            <p className="px-1 text-caption text-muted-foreground">
              {t(`仅展开前 ${maxInlineDiffFiles} 个文件的 Diff。`, `Only the first ${maxInlineDiffFiles} file diffs are expanded.`)}
            </p>
          ) : !changes.length && !loadingAll ? (
            <div className="flex min-h-40 flex-col items-center justify-center text-center">
              <FileDiff className="size-6 text-muted-foreground" />
              <p className="mt-3 text-body font-medium">{t('工作区没有未提交变更', 'No uncommitted changes in the workspace')}</p>
            </div>
          ) : null}
        </div>
      ) : (
        <div
          className="flex min-h-80 flex-1 flex-col items-center justify-center px-8 text-center"
          aria-label={t('Git 变更空状态', 'Empty Git changes')}
        >
          <FileDiff className="size-7 text-muted-foreground" />
          <p className="mt-4 text-label font-medium">
            {desktopRuntime ? t('当前目录没有可显示的变更', 'This directory has no displayable changes') : t('浏览器预览不能读取 Git 状态', 'Browser preview cannot read Git status')}
          </p>
          <p className="mt-2 max-w-sm text-body leading-6 text-muted-foreground">
            {desktopRuntime
              ? git?.problem || t('请选择一个 Git 仓库后查看文件级 Diff。', 'Choose a Git repository to view file-level diffs.')
              : t('真实 Diff 需要在打包后的 MilkSU App 中读取。', 'The real diff must be read in the packaged MilkSU app.')}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-4"
            disabled={busy}
            onClick={() => onRefresh?.()}
          >
            <RefreshCw className="size-3.5" />
            {t('重新读取 Git 状态', 'Reload Git status')}
          </Button>
        </div>
      )}
    </section>
  )
}
