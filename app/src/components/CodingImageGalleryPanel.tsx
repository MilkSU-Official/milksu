import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageIcon, LoaderCircle } from 'lucide-react'
import { Button, Input } from '@/components/ui'
import { hasDesktopRuntime, invokeCommand } from '@/desktop'
import { useT } from '@/hooks/useUiLocale'
import { cn } from '@/lib/cn'
import type {
  CodingArtifactPreview,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'

const thumbConcurrency = 3

type ImageSource = 'generated' | 'project'

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(path)
}

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/')
}

function imageBaseName(path: string): string {
  const normalized = normalizePath(path)
  const slash = normalized.lastIndexOf('/')
  return slash >= 0 ? normalized.slice(slash + 1) : normalized
}

function imageFolder(path: string): string {
  const normalized = normalizePath(path)
  const slash = normalized.lastIndexOf('/')
  return slash >= 0 ? normalized.slice(0, slash) : ''
}

function imageSource(path: string, untracked: ReadonlySet<string>): ImageSource {
  const normalized = normalizePath(path)
  if (/(^|\/)generated(\/|$)/.test(normalized)) return 'generated'
  if (untracked.has(normalized)) return 'generated'
  return 'project'
}

type Thumb = {
  url?: string
  failed?: boolean
}

export default function CodingImageGalleryPanel({
  workspacePath,
  environment,
  requestedPath,
  refreshToken,
  onSelect,
}: {
  workspacePath: string
  environment: CodingEnvironmentSnapshot | null
  requestedPath?: string
  /** Bumped when ImageGen finishes writing so the gallery reloads without a tab switch. */
  refreshToken?: number
  onSelect?: (path: string) => void
}) {
  const t = useT()
  const desktopRuntime = hasDesktopRuntime()
  const untracked = useMemo(() => {
    const paths = new Set<string>()
    for (const change of environment?.git?.changes ?? []) {
      if (change.untracked) paths.add(normalizePath(change.path))
    }
    return paths
  }, [environment?.git?.changes])
  const entries = useMemo(() => (
    (environment?.images ?? [])
      .map(path => normalizePath(path))
      .filter(isImagePath)
      .map(path => ({ path, source: imageSource(path, untracked) }))
  ), [environment?.images, untracked])
  const generated = useMemo(() => entries.filter(entry => entry.source === 'generated'), [entries])
  const project = useMemo(() => entries.filter(entry => entry.source === 'project'), [entries])
  const [kind, setKind] = useState<ImageSource>('generated')
  const [query, setQuery] = useState('')

  useEffect(() => {
    setQuery('')
  }, [workspacePath])

  useEffect(() => {
    if (entries.length === 0) setQuery('')
  }, [entries.length])
  const requested = normalizePath(String(requestedPath ?? '').trim())
  const visible = useMemo(() => {
    const source = kind === 'generated'
      ? (generated.length ? generated : project)
      : (project.length ? project : generated)
    const needle = query.trim().toLocaleLowerCase()
    if (!needle) return source
    return source.filter(entry => entry.path.toLocaleLowerCase().includes(needle))
  }, [generated, project, kind, query])
  const paths = useMemo(() => visible.map(entry => entry.path), [visible])
  const loadPaths = useMemo(() => {
    const next = entries.map(entry => entry.path)
    if (requested && isImagePath(requested) && !next.includes(requested)) next.unshift(requested)
    return next
  }, [entries, requested])
  const loadPathsKey = loadPaths.join('\0')
  const [activePath, setActivePath] = useState('')
  const [thumbs, setThumbs] = useState<Record<string, Thumb>>({})
  const activePathRef = useRef('')

  useEffect(() => {
    activePathRef.current = activePath
  }, [activePath])

  useEffect(() => {
    if (requested && imageSource(requested, untracked) === 'generated') setKind('generated')
  }, [requested, untracked])

  useEffect(() => {
    if (generated.length === 0 && project.length > 0) setKind('project')
  }, [generated.length, project.length])

  useEffect(() => {
    const next = requested && isImagePath(requested) ? requested : ''
    if (next && (paths.includes(next) || !paths.length)) {
      setActivePath(next)
      return
    }
    if (!paths.length) {
      setActivePath('')
      return
    }
    if (activePathRef.current && paths.includes(activePathRef.current)) return
    setActivePath(paths[0]!)
  }, [requested, paths])

  useEffect(() => {
    if (!desktopRuntime || !workspacePath || !loadPaths.length) return
    let cancelled = false
    setThumbs(current => {
      const kept: Record<string, Thumb> = {}
      for (const path of loadPaths) {
        const existing = current[path]
        if (existing) kept[path] = existing
      }
      return kept
    })
    const queue = [...loadPaths]
    async function worker() {
      for (;;) {
        const path = queue.shift()
        if (!path || cancelled) return
        try {
          const preview = await invokeCommand<CodingArtifactPreview>('get_coding_artifact_preview', {
            workspacePath,
            relativePath: path,
          })
          if (cancelled) return
          const url = preview.kind === 'image' ? preview.dataUrl : ''
          setThumbs(current => ({
            ...current,
            [path]: url ? { url } : { failed: true },
          }))
        } catch {
          if (cancelled) return
          setThumbs(current => ({ ...current, [path]: { failed: true } }))
        }
      }
    }
    void Promise.all(Array.from(
      { length: Math.min(thumbConcurrency, loadPaths.length) },
      () => worker(),
    ))
    return () => {
      cancelled = true
    }
    // loadPathsKey captures membership; worker reads the latest workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [desktopRuntime, workspacePath, loadPathsKey, refreshToken])

  function selectImage(path: string) {
    setActivePath(path)
    onSelect?.(path)
  }

  const activeThumb = activePath ? thumbs[activePath] : undefined
  const showKinds = generated.length > 0 && project.length > 0
  const folder = activePath ? imageFolder(activePath) : ''

  return (
    <section className="flex h-full min-h-0 flex-col" data-testid="coding-image-gallery">
      <div className="flex shrink-0 flex-col gap-2 border-b border-border px-2 py-1">
        <div className="flex items-center gap-1">
          <Input
            value={query}
            className="h-7 min-w-0 flex-1"
            placeholder={t('搜索', 'Search')}
            aria-label={t('搜索图片', 'Search images')}
            onChange={event => setQuery(event.target.value)}
          />
        </div>
        {entries.length && showKinds ? (
            <div className="flex gap-1">
              {([
                ['generated', t('生成', 'Generated'), generated.length],
                ['project', t('项目', 'Project'), project.length],
              ] as const).map(([value, label, count]) => (
                <Button
                  key={value}
                  type="button"
                  size="sm"
                  variant={kind === value ? 'default' : 'outline'}
                  className="h-7 rounded-md px-2.5"
                  aria-pressed={kind === value}
                  onClick={() => setKind(value)}
                >
                  {`${label} ${count}`}
                </Button>
              ))}
            </div>
        ) : null}
      </div>

      {paths.length ? (
        <div className="flex min-h-0 flex-1 flex-col">
          <div className="shrink-0 border-b border-border">
            <div className="flex max-h-52 min-h-28 items-center justify-center p-3">
              {activeThumb?.url ? (
                <img
                  src={activeThumb.url}
                  alt={imageBaseName(activePath)}
                  className="max-h-44 max-w-full object-contain"
                />
              ) : activeThumb?.failed ? (
                <p className="px-3 text-center text-caption text-destructive">
                  {t('暂时无法预览这张图片。', 'This image cannot be previewed right now.')}
                </p>
              ) : (
                <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
              )}
            </div>
            <p className="truncate px-3 pb-2 text-center text-caption text-muted-foreground" title={activePath}>
              {folder ? `${folder}/` : ''}{imageBaseName(activePath)}
            </p>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <div className="grid grid-cols-2 gap-2 p-3">
              {paths.map(path => {
                const thumb = thumbs[path]
                const active = activePath === path
                return (
                  <button
                    key={path}
                    type="button"
                    className={cn(
                      'flex min-w-0 flex-col overflow-hidden rounded-md border bg-muted/30 text-left',
                      'transition-[border-color,transform] duration-[120ms] ease-[var(--ease-out)] active:scale-[0.97]',
                      active ? 'border-primary' : 'border-border',
                    )}
                    aria-pressed={active}
                    aria-label={path}
                    title={path}
                    onClick={() => selectImage(path)}
                  >
                    <span className="relative aspect-square w-full bg-muted/40">
                      {thumb?.url ? (
                        <img src={thumb.url} alt="" className="size-full object-cover" />
                      ) : (
                        <span className="flex size-full items-center justify-center text-muted-foreground">
                          {thumb?.failed
                            ? <ImageIcon className="size-3.5" />
                            : <LoaderCircle className="size-3.5 animate-spin" />}
                        </span>
                      )}
                    </span>
                    <span className="truncate px-1.5 py-1 text-[11px] text-muted-foreground">{imageBaseName(path)}</span>
                  </button>
                )
              })}
            </div>
          </div>
        </div>
      ) : entries.length > 0 && query.trim() ? (
        <p className="px-3 py-3 text-caption text-muted-foreground">{t('没有匹配项', 'No matches')}</p>
      ) : workspacePath && environment == null ? (
        <div className="flex min-h-0 flex-1 items-center justify-center">
          <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
        </div>
      ) : null}
    </section>
  )
}
