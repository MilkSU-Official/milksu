import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Button, Input, Popover, PopoverContent, PopoverTrigger } from '@/components/ui'
import { Check, ChevronDown, ChevronRight, FolderOpen, FolderPlus, FolderX, Home, LoaderCircle, Plus, X } from 'lucide-react'
import { invokeCommand } from '@/desktop'
import { useT } from '@/hooks/useUiLocale'
import { cn } from '@/lib/cn'
import type { CodingRecentProject } from '@/codingEnvironmentTypes'

const FLYOUT_WIDTH = 256
const FLYOUT_GAP = 4

type WorkspaceMenuSub = 'recent' | 'new'

function pathBaseName(path: string) {
  return path.split(/[\\/]/).filter(Boolean).pop() || path
}

export default function ComposerWorkspaceMenu({
  workspaceName,
  workspacePath,
  homeDirectory,
  recentProjects,
  disabled,
  split,
  empty,
  chipLabel,
  chipTitle,
  ariaLabel,
  onChooseWorkspace,
  onSelectWorkspace,
  onForgetWorkspace,
  onClearWorkspace,
}: {
  workspaceName?: string
  workspacePath?: string
  homeDirectory?: string
  recentProjects?: CodingRecentProject[]
  disabled?: boolean
  split?: boolean
  empty?: boolean
  chipLabel: string
  chipTitle: string
  ariaLabel: string
  onChooseWorkspace?: () => void
  onSelectWorkspace?: (path: string) => void
  onForgetWorkspace?: (path: string) => void
  onClearWorkspace?: () => void
}) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [sub, setSub] = useState<WorkspaceMenuSub | null>(null)
  const [flyoutPos, setFlyoutPos] = useState<{ top: number; left: number } | null>(null)
  const [parent, setParent] = useState('')
  const [newName, setNewName] = useState('')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const panelRef = useRef<HTMLDivElement | null>(null)
  const flyoutRef = useRef<HTMLDivElement | null>(null)

  const selectedName = workspaceName?.trim() || ''
  const hasSelectedWorkspace = Boolean(workspacePath?.trim())
  const recents = (recentProjects ?? []).slice(0, 8)
  const defaultName = t('未命名项目', 'Untitled project')

  useEffect(() => {
    if (open) return
    setSub(null)
    setNewName('')
    setCreateError('')
    setParent(homeDirectory?.trim() ?? '')
  }, [open, homeDirectory])

  // The second-level panel portals to body: nested inside the glass panel its
  // backdrop-filter would lose the page backdrop and render almost clear.
  useLayoutEffect(() => {
    if (!sub) {
      setFlyoutPos(null)
      return
    }
    const rect = panelRef.current?.getBoundingClientRect()
    if (!rect) return
    let left = rect.right + FLYOUT_GAP
    if (left + FLYOUT_WIDTH > window.innerWidth - 8) left = rect.left - FLYOUT_WIDTH - FLYOUT_GAP
    setFlyoutPos({ top: rect.top, left: Math.max(8, left) })
  }, [sub])

  function showSub(next: WorkspaceMenuSub) {
    setSub(next)
    if (next === 'new') setParent(current => current.trim() || homeDirectory?.trim() || '')
  }

  function close() {
    setOpen(false)
  }

  function selectRecent(path: string) {
    const next = path.trim()
    if (!next) return
    onSelectWorkspace?.(next)
    close()
  }

  function browseFolder() {
    onChooseWorkspace?.()
    close()
  }

  function clearWorkspace() {
    if (hasSelectedWorkspace) onClearWorkspace?.()
    close()
  }

  async function chooseParent() {
    try {
      const selected = await invokeCommand<string>('choose_agent_workspace')
      if (selected?.trim()) setParent(selected.trim())
    } catch (reason) {
      console.error(reason)
    }
  }

  async function createProject() {
    const parentDir = parent.trim()
    if (!parentDir || creating) return
    setCreating(true)
    setCreateError('')
    try {
      const created = await invokeCommand<string>('create_agent_workspace', {
        parent: parentDir,
        name: newName.trim() || defaultName,
      })
      if (created?.trim()) {
        onSelectWorkspace?.(created.trim())
        close()
      }
    } catch (reason) {
      console.error(reason)
      setCreateError(t('无法创建项目文件夹。', 'Could not create the project folder.'))
    } finally {
      setCreating(false)
    }
  }

  const subTriggerClass = (active: boolean) => cn(
    'flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-label',
    active ? 'bg-accent' : 'hover:bg-accent',
  )

  // The flyout portals to document.body, so Radix sees its clicks and focus as
  // "outside" the popover and would dismiss the whole menu. Let it stay open.
  function keepOpenInsideFlyout(event: Event) {
    const target = event.target
    if (target instanceof Node && flyoutRef.current?.contains(target)) event.preventDefault()
  }

  const flyout = sub && flyoutPos ? createPortal(
    <div
      ref={flyoutRef}
      className="fixed z-50 w-64 rounded-md border border-border bg-popover p-1 text-popover-foreground"
      style={{ top: flyoutPos.top, left: flyoutPos.left }}
      onPointerDown={event => event.stopPropagation()}
      onPointerUp={event => event.stopPropagation()}
      onClick={event => event.stopPropagation()}
      onTouchStart={event => event.stopPropagation()}
      onContextMenu={event => event.stopPropagation()}
    >
      {sub === 'recent' ? (
        <>
          <div className="max-h-56 overflow-y-auto">
            {recents.length ? recents.map(project => (
              <div key={project.path} className="group flex h-[30px] items-center gap-1 rounded-md px-1 hover:bg-accent">
                <button
                  type="button"
                  className="flex h-full min-w-0 flex-1 items-center gap-2 px-1 text-left"
                  title={project.path}
                  onClick={() => selectRecent(project.path)}
                >
                  <FolderOpen className="size-3.5 shrink-0 opacity-70" />
                  <span className="min-w-0 flex-1 truncate text-label">{project.name || pathBaseName(project.path)}</span>
                  {project.path.trim() === workspacePath?.trim() ? <Check className="size-3.5 shrink-0 text-primary" /> : null}
                </button>
                <button
                  type="button"
                  className="grid size-5 shrink-0 place-items-center rounded opacity-0 transition-opacity group-hover:opacity-100 hover:bg-accent"
                  aria-label={t(`忘记项目 ${project.name || project.path}`, `Forget project ${project.name || project.path}`)}
                  title={t('从最近项目移除', 'Remove from recent projects')}
                  onClick={event => {
                    event.stopPropagation()
                    onForgetWorkspace?.(project.path)
                  }}
                >
                  <X className="size-3" />
                </button>
              </div>
            )) : (
              <p className="px-2 py-1.5 text-caption text-muted-foreground">{t('还没有最近项目', 'No recent projects yet')}</p>
            )}
          </div>
          <div className="mt-1 border-t border-border pt-1">
            <button
              type="button"
              className={subTriggerClass(false)}
              onClick={browseFolder}
            >
              <FolderPlus className="size-3.5 shrink-0" />
              <span className="min-w-0 flex-1 truncate">{t('浏览其他文件夹…', 'Browse for a folder…')}</span>
            </button>
          </div>
        </>
      ) : (
        <div className="p-1">
          <Input
            value={newName}
            autoFocus
            onChange={event => setNewName(event.target.value)}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              void createProject()
            }}
            className="h-8"
            placeholder={defaultName}
            aria-label={t('项目名称', 'Project name')}
          />
          <div className="mt-2 flex items-center gap-1.5 text-caption text-muted-foreground">
            <Home className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate" title={parent}>{parent || t('先选择位置', 'Pick a location first')}</span>
            <Button type="button" variant="ghost" size="sm" className="h-6 shrink-0 px-1.5" disabled={creating} onClick={() => void chooseParent()}>
              {t('更改…', 'Change…')}
            </Button>
          </div>
          {createError ? <p className="mt-2 text-caption text-destructive">{createError}</p> : null}
          <Button type="button" size="sm" className="mt-2 w-full" disabled={creating || !parent.trim()} onClick={() => void createProject()}>
            {creating ? <LoaderCircle className="size-3.5 animate-spin" /> : null}
            {t('创建', 'Create')}
          </Button>
        </div>
      )}
    </div>,
    document.body,
  ) : null

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'chat-composer__chip chat-composer__chip--workspace',
            empty ? 'chat-composer__chip--workspace-empty' : '',
            split ? 'chat-composer__chip--workspace-split' : '',
          )}
          disabled={disabled}
          aria-label={ariaLabel}
          title={chipTitle}
        >
          <FolderOpen className="size-3.5 shrink-0" />
          <span className="chat-composer__chip__label">{chipLabel}</span>
          <ChevronDown className="chat-composer__chip__chevron size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-60 overflow-visible border-0 bg-transparent p-0 shadow-none"
        onInteractOutside={keepOpenInsideFlyout}
        onFocusOutside={keepOpenInsideFlyout}
        onPointerDownOutside={keepOpenInsideFlyout}
      >
        <div ref={panelRef} className="relative w-60 rounded-md border border-border bg-popover p-1 text-popover-foreground">
          {hasSelectedWorkspace && selectedName ? (
            <button
              type="button"
              className="flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-left text-label hover:bg-accent"
              title={workspacePath}
              onClick={close}
            >
              <FolderOpen className="size-3.5 shrink-0 text-primary" />
              <span className="min-w-0 flex-1 truncate">{selectedName}</span>
              <Check className="size-3.5 shrink-0 text-primary" />
            </button>
          ) : null}
          {hasSelectedWorkspace && selectedName ? <div className="mx-2 my-1 h-px bg-border" /> : null}
          <button
            type="button"
            className={subTriggerClass(sub === 'recent')}
            onPointerEnter={() => showSub('recent')}
            onClick={() => showSub('recent')}
          >
            <FolderPlus className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('使用现有文件夹', 'Use existing folder')}</span>
            <ChevronRight className="size-3 shrink-0 opacity-60" />
          </button>
          <button
            type="button"
            className={subTriggerClass(sub === 'new')}
            onPointerEnter={() => showSub('new')}
            onClick={() => showSub('new')}
          >
            <Plus className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('新建空白项目', 'New blank project')}</span>
            <ChevronRight className="size-3 shrink-0 opacity-60" />
          </button>
          <button
            type="button"
            className={subTriggerClass(false)}
            onClick={clearWorkspace}
          >
            <FolderX className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 truncate">{t('不使用文件夹', 'No folder')}</span>
          </button>
        </div>
      </PopoverContent>
      {flyout}
    </Popover>
  )
}
