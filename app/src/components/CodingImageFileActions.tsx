import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Download, FolderOpen } from 'lucide-react'
import { Button } from '@/components/ui'
import { menuContentClass, menuItemClass } from '@/components/ui/menu'
import { invokeCommand } from '@/desktop'
import { useT } from '@/hooks/useUiLocale'
import { readHostPlatform, type HostPlatform } from '@/lib/hostPlatform'

type ImageFileAction = 'copy' | 'save' | 'reveal'

function revealLabel(platform: HostPlatform, t: (zh: string, en: string) => string) {
  if (platform === 'win32') return t('在资源管理器中显示', 'Show in Explorer')
  if (platform === 'linux') return t('在文件管理器中显示', 'Show in file manager')
  if (platform === 'darwin') return t('在访达中显示', 'Reveal in Finder')
  return t('查看位置', 'Show location')
}

function menuPosition(x: number, y: number) {
  const width = 196
  const height = 120
  return {
    left: Math.max(8, Math.min(x, window.innerWidth - width - 8)),
    top: Math.max(8, Math.min(y, window.innerHeight - height - 8)),
  }
}

export function useCodingImageFileActions(workspacePath: string) {
  const t = useT()
  const platform = readHostPlatform()
  const [busy, setBusy] = useState<ImageFileAction | ''>('')
  const [copied, setCopied] = useState(false)
  const [notice, setNotice] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number; path: string } | null>(null)
  const showInFolder = revealLabel(platform, t)

  useEffect(() => {
    if (!copied) return
    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    if (!menu) return
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Node | null
      const node = document.querySelector('[data-coding-image-menu]')
      if (target && node?.contains(target)) return
      setMenu(null)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenu(null)
    }
    function closeMenu() {
      setMenu(null)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', closeMenu)
    window.addEventListener('scroll', closeMenu, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', closeMenu)
      window.removeEventListener('scroll', closeMenu, true)
    }
  }, [menu])

  async function run(action: ImageFileAction, relativePath: string) {
    const path = relativePath.trim()
    if (!workspacePath || !path || busy) return
    setNotice('')
    setMenu(null)
    setBusy(action)
    try {
      if (action === 'copy') {
        await invokeCommand('copy_coding_image', { workspacePath, relativePath: path })
        setCopied(true)
      } else if (action === 'save') {
        await invokeCommand('save_coding_image', { workspacePath, relativePath: path })
      } else {
        await invokeCommand('reveal_coding_image', { workspacePath, relativePath: path })
      }
    } catch {
      setNotice(action === 'copy'
        ? t('无法复制这张图片。', 'Could not copy this image.')
        : action === 'save'
          ? t('无法保存这张图片。', 'Could not save this image.')
          : t('无法显示这张图片的位置。', 'Could not show where this image is.'))
    } finally {
      setBusy('')
    }
  }

  function openMenu(event: { preventDefault: () => void; stopPropagation: () => void; clientX: number; clientY: number }, relativePath: string) {
    event.preventDefault()
    event.stopPropagation()
    if (!relativePath.trim()) return
    setMenu({ x: event.clientX, y: event.clientY, path: relativePath })
  }

  const menuNode = menu
    ? createPortal(
      <section
        data-coding-image-menu
        className={`${menuContentClass} coding-image-menu app-no-drag w-max min-w-44`}
        style={{ position: 'fixed', ...menuPosition(menu.x, menu.y) }}
        aria-label={t('图片操作', 'Image actions')}
        onContextMenu={event => event.preventDefault()}
      >
        <button type="button" className={`${menuItemClass} gap-2`} onClick={() => void run('copy', menu.path)}>
          <Copy className="size-4" />{copied ? t('已复制', 'Copied') : t('复制', 'Copy')}
        </button>
        <button type="button" className={`${menuItemClass} gap-2`} onClick={() => void run('save', menu.path)}>
          <Download className="size-4" />{t('下载', 'Download')}
        </button>
        <button type="button" className={`${menuItemClass} gap-2`} onClick={() => void run('reveal', menu.path)}>
          <FolderOpen className="size-4" />{showInFolder}
        </button>
      </section>,
      document.body,
    )
    : null

  function buttons(relativePath: string, className = 'mt-2') {
    const disabled = !workspacePath || !relativePath || Boolean(busy)
    return (
      <div className={`flex max-w-full flex-wrap gap-1 ${className}`} data-testid="coding-image-actions">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 whitespace-nowrap px-2"
          disabled={disabled}
          data-testid="coding-image-copy"
          onClick={() => void run('copy', relativePath)}
        >
          <Copy className="size-3.5" />
          {copied ? t('已复制', 'Copied') : t('复制', 'Copy')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 whitespace-nowrap px-2"
          disabled={disabled}
          data-testid="coding-image-save"
          onClick={() => void run('save', relativePath)}
        >
          <Download className="size-3.5" />
          {t('下载', 'Download')}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 whitespace-nowrap px-2"
          disabled={disabled}
          data-testid="coding-image-reveal"
          aria-label={showInFolder}
          title={showInFolder}
          onClick={() => void run('reveal', relativePath)}
        >
          <FolderOpen className="size-3.5" />
          {showInFolder}
        </Button>
      </div>
    )
  }

  return { buttons, menuNode, notice, openMenu }
}
