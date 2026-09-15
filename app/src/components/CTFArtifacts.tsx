import { useMemo, useState } from 'react'
import { Badge, Button } from '@/components/ui'
import {
  ChevronDown,
  ChevronUp,
  FileArchive,
  FileText,
  LoaderCircle,
  ShieldCheck,
} from 'lucide-react'
import { invokeCommand } from '@/desktop'
import { useT } from '@/hooks/useUiLocale'
import type { CTFArtifactPreview, CTFProjection } from '@/ctfTypes'
import type { ArtifactRecord } from '@/runtimeTypes'

export default function CTFArtifacts({
  projection,
}: {
  projection: CTFProjection
}) {
  const t = useT()
  const [selectedId, setSelectedId] = useState('')
  const [preview, setPreview] = useState<CTFArtifactPreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [expanded, setExpanded] = useState(false)

  const artifacts = useMemo(() => (
    expanded || projection.artifacts.length <= 5
      ? projection.artifacts
      : projection.artifacts.slice(-5)
  ), [expanded, projection.artifacts])

  function artifactLabel(artifact: ArtifactRecord) {
    const material = projection.challenge.materials.find(item => item.artifactId === artifact.id)
    if (material) return material.name
    if (artifact.source.startsWith('action:')) return t('Agent 生成制品', 'Agent-generated artifact')
    return artifact.source || t('Runtime 制品', 'Runtime artifact')
  }

  function formatBytes(size: number) {
    if (size < 1024) return `${size} B`
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KiB`
    return `${(size / 1024 / 1024).toFixed(1)} MiB`
  }

  async function selectArtifact(artifact: ArtifactRecord) {
    if (selectedId === artifact.id && preview) {
      setSelectedId('')
      setPreview(null)
      return
    }
    setSelectedId(artifact.id)
    setPreview(null)
    setError('')
    setLoading(true)
    try {
      setPreview(await invokeCommand<CTFArtifactPreview>('get_ctf_artifact_preview', {
        id: projection.job.id,
        artifactId: artifact.id,
      }))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  return (
    <details className="group overflow-hidden rounded-menu-shell border border-border bg-card px-5 py-4" aria-labelledby="artifacts-title">
      <summary className="flex cursor-pointer list-none items-start justify-between gap-4 [&::-webkit-details-marker]:hidden">
        <div>
          <h2 id="artifacts-title" className="flex items-center gap-2 text-label font-medium">
            <FileArchive className="size-4" />
            {t('证据制品', 'Evidence artifacts')}
          </h2>
        </div>
        <span className="flex items-center gap-2">
          <Badge variant="outline">{projection.artifacts.length}</Badge>
          <ChevronDown className="size-4 text-muted-foreground transition-transform group-open:rotate-180" />
        </span>
      </summary>

      <div className="mt-4 space-y-2 border-t border-border pt-4">
        {artifacts.map(artifact => (
          <article key={artifact.id} className="overflow-hidden rounded-lg border border-border">
            <button
              type="button"
              className="flex w-full items-center gap-3 px-3 py-3 text-left transition-colors hover:bg-muted/50"
              aria-expanded={selectedId === artifact.id}
              onClick={() => { void selectArtifact(artifact) }}
            >
              <FileText className="size-4 shrink-0 text-muted-foreground" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-control font-medium">{artifactLabel(artifact)}</span>
                <span className="mt-0.5 block truncate text-caption text-muted-foreground">
                  {artifact.mediaType} · {formatBytes(artifact.size)}
                </span>
              </span>
              {selectedId === artifact.id
                ? <ChevronUp className="size-4 shrink-0" />
                : <ChevronDown className="size-4 shrink-0 text-muted-foreground" />}
            </button>

            {selectedId === artifact.id ? (
              <div className="border-t border-border bg-muted/20 p-3">
                {loading ? (
                  <LoaderCircle className="size-4 animate-spin text-muted-foreground" />
                ) : error ? (
                  <p className="text-caption leading-5 text-destructive">{error}</p>
                ) : preview ? (
                  <>
                    <dl className="grid gap-2 text-caption sm:grid-cols-[88px_minmax(0,1fr)]">
                      <dt className="text-muted-foreground">SHA-256</dt>
                      <dd className="break-all font-mono">{preview.artifact.sha256}</dd>
                      <dt className="text-muted-foreground">{t('来源', 'Source')}</dt>
                      <dd className="break-all">{preview.artifact.source}</dd>
                      <dt className="text-muted-foreground">{t('存储标识', 'Storage ID')}</dt>
                      <dd className="break-all font-mono">{preview.artifact.relativePath}</dd>
                    </dl>
                    {preview.previewable ? (
                      <div className="mt-3">
                        <div className="mb-2 flex items-center justify-between gap-3">
                          <p className="text-caption font-medium">{t('只读文本预览', 'Read-only text preview')}</p>
                          {preview.truncated ? <Badge variant="secondary">{t('前 128 KiB', 'First 128 KiB')}</Badge> : null}
                        </div>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-md border border-border bg-background p-3 font-mono text-caption leading-5">{preview.content}</pre>
                      </div>
                    ) : (
                      <p className="mt-3 flex gap-2 rounded-md border border-border bg-background p-3 text-caption leading-5 text-muted-foreground">
                        <ShieldCheck className="mt-0.5 size-3.5 shrink-0" />
                        {preview.reason}
                      </p>
                    )}
                  </>
                ) : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      {projection.artifacts.length > 5 ? (
        <Button
          variant="link"
          size="text"
          className="mt-3"
          onClick={() => setExpanded(value => !value)}
        >
          {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
          {expanded ? t('只看最近 5 个', 'Show last 5') : t(`查看全部 ${projection.artifacts.length} 个`, `View all ${projection.artifacts.length}`)}
        </Button>
      ) : null}
    </details>
  )
}
