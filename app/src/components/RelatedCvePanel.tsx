import { useEffect, useState } from 'react'
import MarkdownContent from '@/components/MarkdownContent'
import { invokeCommand } from '@/desktop'
import type { CodingArtifactPreview } from '@/codingEnvironmentTypes'

export default function RelatedCvePanel({
  workspacePath,
  refreshKey,
  className,
}: {
  workspacePath: string
  refreshKey?: number | string | boolean
  className?: string
}) {
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
          relativePath: 'related.md',
        })
        if (!cancelled) setPreview(next)
      } catch {
        if (!cancelled) setPreview(null)
      }
    }
    void load()
    return () => {
      cancelled = true
    }
  }, [workspacePath, refreshKey])

  return (
    <article className={className ? `related-cve-panel ${className}` : 'related-cve-panel'} data-testid="related-cves">
      {preview?.kind === 'markdown' && preview.content ? (
        <MarkdownContent content={preview.content} />
      ) : null}
    </article>
  )
}
