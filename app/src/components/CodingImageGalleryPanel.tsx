import { useEffect, useMemo, useRef, useState } from 'react'
import { ImageIcon, LoaderCircle, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui'
import { hasDesktopRuntime, invokeCommand } from '@/desktop'
import { useT } from '@/hooks/useUiLocale'
import { cn } from '@/lib/cn'
import type {
  CodingArtifactPreview,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'

function isImagePath(path: string): boolean {
  return /\.(png|jpe?g|gif|webp)$/i.test(path)
}

export default function CodingImageGalleryPanel({
  workspacePath,
  environment,
  requestedPath,
  refreshToken,
  onSelect,
  onRefresh,
}: {
  workspacePath: string
  environment: CodingEnvironmentSnapshot | null
  requestedPath?: string
  /** Bumped when ImageGen finishes writing so the gallery reloads without a tab switch. */
  refreshToken?: number
  onSelect?: (path: string) => void
  onRefresh?: () => void
}) {
  const t = useT()
  const desktopRuntime = hasDesktopRuntime()
  const paths = useMemo(() => {
    const fromImages = (environment?.images ?? []).filter(isImagePath)
    if (fromImages.length) return fromImages
    return (environment?.artifacts ?? []).filter(isImagePath)
  }, [environment])
  const pathsKey = paths.join('\0')
  const [activePath, setActivePath] = useState('')
  const [preview, setPreview] = useState<CodingArtifactPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const loadGeneration = useRef(0)
  const activePathRef = useRef('')

  useEffect(() => {
    activePathRef.current = activePath
  }, [activePath])

  async function loadPreview(path: string) {
    if (!desktopRuntime || !workspacePath) return
    const relative = path.trim()
    if (!relative || !isImagePath(relative)) return
    const generation = ++loadGeneration.current
    setLoading(true)
    setError('')
    setActivePath(relative)
    onSelect?.(relative)
    try {
      const next = await invokeCommand<CodingArtifactPreview>('get_coding_artifact_preview', {
        workspacePath,
        relativePath: relative,
      })
      if (generation !== loadGeneration.current) return
      setPreview(next)
    } catch (cause) {
      if (generation !== loadGeneration.current) return
      setPreview(null)
      setError(cause instanceof Error
        ? cause.message
        : t('暂时无法预览这张图片。', 'This image cannot be previewed right now.'))
    } finally {
      if (generation === loadGeneration.current) setLoading(false)
    }
  }

  // Prefer an explicit reveal path; otherwise keep the active image or open the newest.
  useEffect(() => {
    const next = String(requestedPath ?? '').trim()
    if (next && isImagePath(next)) {
      void loadPreview(next)
      return
    }
    if (!paths.length) {
      setPreview(null)
      setActivePath('')
      setError('')
      return
    }
    if (activePathRef.current && paths.includes(activePathRef.current)) return
    void loadPreview(paths[0]!)
    // pathsKey captures list membership; loadPreview reads latest workspace/runtime.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestedPath, workspacePath, pathsKey, refreshToken])

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 p-3" data-testid="coding-image-gallery">
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <ImageIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">
          {paths.length
            ? t(`${paths.length} 张项目图片`, `${paths.length} project images`)
            : t('项目图片', 'Project images')}
        </span>
        {onRefresh ? (
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={t('刷新图片', 'Refresh images')}
            title={t('刷新图片', 'Refresh images')}
            onClick={() => onRefresh()}
          >
            <RefreshCw className={cn('size-3.5', loading ? 'animate-spin' : undefined)} />
          </Button>
        ) : null}
      </div>

      {!workspacePath ? (
        <p className="text-caption text-muted-foreground">{t('选择项目', 'Choose a project')}</p>
      ) : !paths.length ? (
        <p className="text-caption text-muted-foreground" />
      ) : (
        <div className="grid grid-cols-2 gap-2 overflow-y-auto pr-0.5">
          {paths.map(path => {
            const active = activePath === path
            return (
              <button
                key={path}
                type="button"
                className={cn(
                  'flex flex-col overflow-hidden rounded-md border text-left transition-[background-color,border-color] duration-[var(--motion-fast)]',
                  active ? 'border-primary bg-accent' : 'border-border bg-card/40 hover:bg-accent/60',
                )}
                aria-pressed={active}
                aria-label={path}
                onClick={() => { void loadPreview(path) }}
              >
                <span className="truncate px-2 py-1.5 text-[11px] text-muted-foreground">{path}</span>
              </button>
            )
          })}
        </div>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-caption text-muted-foreground">
          <LoaderCircle className="size-3.5 animate-spin" />
          {t('加载预览', 'Loading preview')}
        </div>
      ) : null}
      {error ? <p className="text-caption text-destructive">{error}</p> : null}
      {preview?.kind === 'image' && preview.dataUrl ? (
        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-border bg-muted/20 p-2">
          <img
            src={preview.dataUrl}
            alt={preview.relativePath}
            className="mx-auto max-h-full max-w-full object-contain"
          />
        </div>
      ) : null}
    </section>
  )
}
