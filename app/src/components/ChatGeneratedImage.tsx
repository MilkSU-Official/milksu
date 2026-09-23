import { useEffect, useRef, useState } from 'react'
import { invokeCommand } from '@/desktop'
import { useCodingImageFileActions } from '@/components/CodingImageFileActions'
import { useT } from '@/hooks/useUiLocale'
import type { CodingArtifactPreview } from '@/codingEnvironmentTypes'
import { X } from 'lucide-react'

export default function ChatGeneratedImage({
  workspacePath,
  path,
}: {
  workspacePath: string
  path: string
}) {
  const t = useT()
  const imageActions = useCodingImageFileActions(workspacePath)
  const lightbox = useRef<HTMLDialogElement | null>(null)
  const actionsRow = useRef<HTMLDivElement | null>(null)
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)
  const name = path.split('/').pop() || path

  useEffect(() => {
    if (!workspacePath || !path) return
    let cancelled = false
    setSrc('')
    setFailed(false)
    void invokeCommand<CodingArtifactPreview>('get_coding_artifact_preview', {
      workspacePath,
      relativePath: path,
    }).then(preview => {
      if (cancelled) return
      if (preview.kind === 'image' && preview.dataUrl) setSrc(preview.dataUrl)
      else setFailed(true)
    }).catch(() => {
      if (!cancelled) setFailed(true)
    })
    return () => {
      cancelled = true
    }
  }, [workspacePath, path])

  useEffect(() => {
    if (!src) return
    const frame = requestAnimationFrame(() => revealActions())
    return () => cancelAnimationFrame(frame)
  }, [src])

  function revealActions() {
    const row = actionsRow.current
    const scroller = row?.closest('.chat-edge-scroll')
    if (!row || !(scroller instanceof HTMLElement)) return
    const column = row.closest('.chat-column')
    const style = column instanceof HTMLElement ? getComputedStyle(column) : null
    const edge = Number.parseFloat(style?.getPropertyValue('--chat-edge-bottom') || '') || 0
    const feather = Number.parseFloat(style?.getPropertyValue('--chat-edge-feather') || '') || 0
    const view = scroller.getBoundingClientRect()
    const bounds = row.getBoundingClientRect()
    const limit = view.bottom - edge - feather - 8
    if (bounds.top < view.bottom && bounds.bottom > limit) {
      scroller.scrollTop += bounds.bottom - limit
    }
  }

  function openLightbox() {
    if (!src) return
    lightbox.current?.showModal()
  }

  function closeLightbox() {
    lightbox.current?.close()
  }

  return (
    <article
      className="agent-turn mb-7 min-w-0 w-full"
      data-testid="generated-image"
      onContextMenu={event => imageActions.openMenu(event, path)}
    >
      {src ? (
        <button
          type="button"
          className="agent-generated-image"
          aria-label={t(`查看 ${name}`, `View ${name}`)}
          onClick={openLightbox}
        >
          <img src={src} alt={name} onLoad={revealActions} />
        </button>
      ) : (
        failed ? (
          <p className="agent-generated-image__status">
            {t('这张图片暂时无法显示。', 'This image cannot be shown right now.')}
          </p>
        ) : (
          <div className="agent-generated-image agent-generated-image--pending" aria-busy="true" />
        )
      )}
      <div ref={actionsRow}>{imageActions.buttons(path)}</div>
      {imageActions.notice ? (
        <p className="mt-1 text-caption text-destructive">{imageActions.notice}</p>
      ) : null}
      {imageActions.menuNode}
      <dialog
        ref={lightbox}
        className="agent-attachment-lightbox"
        aria-label={t('图片预览', 'Image preview')}
        onClick={event => {
          if (event.target === event.currentTarget) closeLightbox()
        }}
        onCancel={event => {
          event.preventDefault()
          closeLightbox()
        }}
      >
        <header className="agent-attachment-lightbox__bar">
          <p className="truncate">{name}</p>
          <button
            type="button"
            aria-label={t('关闭', 'Close')}
            onClick={closeLightbox}
          >
            <X className="size-4" />
          </button>
        </header>
        {src ? <img src={src} alt={name} /> : null}
        <div className="px-3 pb-3">
          {imageActions.buttons(path, '')}
        </div>
      </dialog>
    </article>
  )
}
