import { forwardRef, useEffect, useImperativeHandle, useMemo, useState } from 'react'
import { Badge, Button, Input } from '@/components/ui'
import { FileImage, LoaderCircle, Search } from 'lucide-react'
import { hasDesktopRuntime, invokeCommand } from '@/desktop'
import MarkdownContent from '@/components/MarkdownContent'
import { redactProviderCredentials } from '@/lib/redaction'
import {
  artifactKindLabel,
  buildArtifactHTMLDocument,
  isArtifactPathSafe,
  suggestedArtifactPaths,
} from '@/lib/codingArtifact'
import { useT } from '@/hooks/useUiLocale'
import type {
  CodingArtifactPreview,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'

export type CodingArtifactPreviewPanelHandle = {
  refresh: () => Promise<void>
}

function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KiB`
  return `${(value / (1024 * 1024)).toFixed(1)} MiB`
}

const CodingArtifactPreviewPanel = forwardRef<CodingArtifactPreviewPanelHandle, {
  workspacePath: string
  environment: CodingEnvironmentSnapshot | null
  requestedPath?: string
  onPreviewed?: (preview: CodingArtifactPreview) => void
}>(function CodingArtifactPreviewPanel({
  workspacePath,
  environment,
  requestedPath,
  onPreviewed,
}, ref) {
  const t = useT()
  const [relativePath, setRelativePath] = useState('')
  const [preview, setPreview] = useState<CodingArtifactPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const desktopRuntime = hasDesktopRuntime()
  const suggestions = useMemo(() => suggestedArtifactPaths(environment), [environment])
  const htmlSource = preview?.kind === 'html'
    ? buildArtifactHTMLDocument(redactProviderCredentials(preview.content ?? ''))
    : ''

  const artifactNextStep = useMemo(() => {
    if (!desktopRuntime) {
      return {
        label: t('打开桌面 App 验收产物', 'Open the desktop app to review artifacts'),
        detail: '',
        cta: t('桌面 App 中验收', 'Review in desktop app'),
        disabled: true,
      }
    }
    if (preview) {
      return {
        label: preview.relativePath,
        detail: `${artifactKindLabel(preview.kind)} · ${formatBytes(preview.sizeBytes)}`,
        cta: t('重新预览', 'Preview again'),
        disabled: loading,
      }
    }
    if (suggestions.length) {
      return {
        label: t('预览第一个候选产物', 'Preview the first candidate'),
        detail: t(`${suggestions.length} 个可预览候选`, `${suggestions.length} previewable candidates`),
        cta: t('预览候选', 'Preview candidate'),
        disabled: loading,
      }
    }
    return {
      label: t('输入产物相对路径', 'Enter an artifact relative path'),
      detail: '',
      cta: t('等待路径', 'Waiting for a path'),
      disabled: true,
    }
  }, [desktopRuntime, preview, suggestions, loading, t])

  async function refresh(nextPath = relativePath) {
    if (loading) return
    const path = nextPath.trim()
    setError('')
    if (!workspacePath) {
      setPreview(null)
      setError(t('请先选择 Coding 项目。', 'Choose a Coding project first.'))
      return
    }
    if (!path) {
      setPreview(null)
      setError(t('请输入工作区内的相对路径。', 'Enter a relative path inside the workspace.'))
      return
    }
    if (!isArtifactPathSafe(path)) {
      setPreview(null)
      setError(t('请输入工作区内的相对路径。', 'Enter a relative path inside the workspace.'))
      return
    }
    if (!desktopRuntime) {
      setPreview(null)
      setError(t('浏览器预览不能读取工作区文件；请在打包后的 MilkSU App 中验收真实产物。', 'Browser preview cannot read workspace files. Review real artifacts in the packaged MilkSU app.'))
      return
    }
    setLoading(true)
    try {
      const next = await invokeCommand<CodingArtifactPreview>(
        'get_coding_artifact_preview',
        { workspacePath, relativePath: path },
      )
      setPreview(next)
      setRelativePath(next.relativePath)
      onPreviewed?.(next)
    } catch (reason) {
      setPreview(null)
      setError(reason instanceof Error
        ? reason.message
        : t('暂时无法预览这个产物。', 'This artifact cannot be previewed right now.'))
    } finally {
      setLoading(false)
    }
  }

  function selectSuggestion(path: string) {
    setRelativePath(path)
    void refresh(path)
  }

  function runArtifactNextStep() {
    if (artifactNextStep.disabled) return
    if (preview || relativePath.trim()) {
      void refresh()
      return
    }
    const first = suggestions[0]
    if (first) selectSuggestion(first)
  }

  useImperativeHandle(ref, () => ({ refresh }), [relativePath, workspacePath, loading])

  useEffect(() => {
    setRelativePath('')
    setPreview(null)
    setError('')
  }, [workspacePath])

  useEffect(() => {
    const next = String(requestedPath ?? '').trim()
    if (!next || next === relativePath) return
    setRelativePath(next)
    void refresh(next)
  }, [requestedPath])

  useEffect(() => {
    if (!relativePath && suggestions.length) setRelativePath(suggestions[0])
  }, [suggestions])

  const capturedAt = environment?.capturedAt
  const [previousCapturedAt, setPreviousCapturedAt] = useState(capturedAt)
  useEffect(() => {
    if (capturedAt && previousCapturedAt && capturedAt !== previousCapturedAt && preview && relativePath) {
      void refresh()
    }
    setPreviousCapturedAt(capturedAt)
  }, [capturedAt])

  return (
    <section className="flex min-h-full flex-col">
      <form
        className="border-b border-border px-4 py-3"
        onSubmit={event => {
          event.preventDefault()
          void refresh()
        }}
      >
        <div className="flex items-center gap-2">
          <Input
            value={relativePath}
            onChange={event => setRelativePath(event.target.value)}
            className="min-w-0 font-mono text-caption"
            autoComplete="off"
            disabled={loading}
            spellCheck={false}
            placeholder={t('例如 docs/report.md', 'e.g. docs/report.md')}
            aria-label={t('工作区产物相对路径', 'Workspace artifact relative path')}
          />
          <Button type="submit" size="sm" disabled={loading}>
            {loading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Search className="size-3.5" />}
            {t('预览', 'Preview')}
          </Button>
        </div>
        {suggestions.length ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {suggestions.map(path => (
              <Button
                key={path}
                type="button"
                variant="outline"
                size="sm"
                className="h-7 max-w-full font-mono text-caption"
                title={redactProviderCredentials(path)}
                disabled={loading}
                onClick={() => selectSuggestion(path)}
              >
                <span className="truncate">{redactProviderCredentials(path)}</span>
              </Button>
            ))}
          </div>
        ) : null}

        {!desktopRuntime ? (
          <p className="mt-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-caption leading-5 text-muted-foreground">
            {t('当前是浏览器预览，只能验证面板文案和入口；真实读取工作区产物需要 MilkSU 桌面运行时。', 'This is a browser preview for copy and entry points only. Reading real workspace artifacts needs the MilkSU desktop runtime.')}
          </p>
        ) : null}
        <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 px-3 py-3" aria-label={t('产物预览下一步', 'Artifact preview next step')}>
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-caption font-medium text-muted-foreground">{t('下一步', 'Next step')}</p>
              <p className="mt-1 text-body font-medium">{artifactNextStep.label}</p>
              {artifactNextStep.detail ? (
                <p className="mt-1 text-caption leading-5 text-muted-foreground">{artifactNextStep.detail}</p>
              ) : null}
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="shrink-0"
              disabled={artifactNextStep.disabled}
              aria-label={t('执行产物预览下一步', 'Run the next artifact preview step')}
              onClick={runArtifactNextStep}
            >
              {artifactNextStep.cta}
            </Button>
          </div>
        </div>
      </form>

      {error ? (
        <p className="border-b border-border px-4 py-3 text-caption leading-5 text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      {preview ? (
        <>
          <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
            <p className="min-w-0 truncate font-mono text-caption" title={redactProviderCredentials(preview.relativePath)}>
              {redactProviderCredentials(preview.relativePath)}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <Badge variant="outline">{artifactKindLabel(preview.kind)}</Badge>
              <span className="text-caption text-muted-foreground">{formatBytes(preview.sizeBytes)}</span>
            </div>
          </div>
          {preview.kind === 'markdown' ? (
            <div className="min-h-0 flex-1 overflow-auto px-6 py-5">
              <MarkdownContent content={redactProviderCredentials(preview.content ?? '')} />
            </div>
          ) : preview.kind === 'html' ? (
            <iframe
              className="min-h-[32rem] flex-1 bg-white"
              srcDoc={htmlSource}
              sandbox=""
              title={t('Coding HTML 产物预览', 'Coding HTML artifact preview')}
            />
          ) : preview.kind === 'text' ? (
            <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
              <pre className="whitespace-pre-wrap break-words font-mono text-caption leading-5">
                {redactProviderCredentials(preview.content ?? '')}
              </pre>
            </div>
          ) : (
            <div className="flex min-h-[28rem] flex-1 items-center justify-center overflow-auto bg-black/20 p-4">
              <img
                src={preview.dataUrl}
                alt={redactProviderCredentials(preview.relativePath)}
                className="max-h-full max-w-full object-contain"
              />
            </div>
          )}
        </>
      ) : !loading ? (
        <div className="flex min-h-80 flex-1 flex-col items-center justify-center px-8 text-center">
          <FileImage className="size-7 text-muted-foreground" />
        </div>
      ) : null}
    </section>
  )
})

export default CodingArtifactPreviewPanel
