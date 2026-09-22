import { useEffect, useMemo, useState } from 'react'
import { ImageIcon, LoaderCircle } from 'lucide-react'
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
  onSelect,
}: {
  workspacePath: string
  environment: CodingEnvironmentSnapshot | null
  requestedPath?: string
  onSelect?: (path: string) => void
}) {
  const t = useT()
  const desktopRuntime = hasDesktopRuntime()
  const paths = useMemo(() => {
    const fromImages = (environment?.images ?? []).filter(isImagePath)
    if (fromImages.length) return fromImages
    return (environment?.artifacts ?? []).filter(isImagePath)
  }, [environment])
  const [activePath, setActivePath] = useState('')
  const [preview, setPreview] = useState<CodingArtifactPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    const next = String(requestedPath ?? '').trim()
    if (next && isImagePath(next)) {
      void loadPreview(next)
    }
  }, [requestedPath, workspacePath])

  async function loadPreview(path: string) {
    if (!desktopRuntime || !workspacePath || loading) return
    const relative = path.trim()
    if (!relative || !isImagePath(relative)) return
    setLoading(true)
    setError('')
    setActivePath(relative)
    onSelect?.(relative)
    try {
      const next = await invokeCommand<CodingArtifactPreview>('get_coding_artifact_preview', {
        workspacePath,
        relativePath: relative,
      })
      setPreview(next)
    } catch (cause) {
      setPreview(null)
      setError(cause instanceof Error ? cause.message : t('暂时无法预览这张图片。', 'This image cannot be previewed right now.'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col gap-3 p-3" data-testid="coding-image-gallery">
      <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <ImageIcon className="size-3.5 shrink-0" />
        <span className="min-w-0 truncate">
          {paths.length
            ? t(`${paths.length} 张项目图片`, `${paths.length} project images`)
            : t('项目图片', 'Project images')}
        </span>
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
