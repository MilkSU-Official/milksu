import { useEffect, useState } from 'react'
import MarkdownContent from '@/components/MarkdownContent'
import { invokeCommand } from '@/desktop'
import type { CodingArtifactPreview } from '@/codingEnvironmentTypes'
import { useT } from '@/hooks/useUiLocale'

export default function ResearchReportPanel({
  workspacePath,
  refreshKey,
  className,
}: {
  workspacePath: string
  refreshKey?: number | string | boolean
  className?: string
}) {
  const t = useT()
  const [preview, setPreview] = useState<CodingArtifactPreview | null>(null)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const workspace = workspacePath.trim()
      if (!workspace) {
        if (!cancelled) setPreview(null)
        return
      }
      try {
        const next = await invokeCommand<CodingArtifactPreview>('get_coding_artifact_preview', {
          workspacePath: workspace,
          relativePath: 'report.md',
        })
        if (!cancelled) setPreview(next)
      } catch {
        try {
          const html = await invokeCommand<CodingArtifactPreview>('get_coding_artifact_preview', {
            workspacePath: workspace,
            relativePath: 'report.html',
          })
          if (!cancelled) setPreview(html)
        } catch {
          if (!cancelled) setPreview(null)
        }
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [workspacePath, refreshKey])

  return (
    <article className={className ? `research-report ${className}` : 'research-report'} data-testid="research-report">
      {preview?.kind === 'markdown' && preview.content ? (
        <MarkdownContent content={preview.content} />
      ) : preview?.kind === 'html' && preview.content ? (
        <iframe
          className="research-report__html"
          sandbox=""
          srcDoc={preview.content}
          title={t('报告', 'Report')}
        />
      ) : null}
      <style>{`
        .research-report { color: #171a1d; }
        .research-report__html { width: 100%; min-height: 24rem; border: 0; background: #fff; }
      `}</style>
    </article>
  )
}
