import { useEffect, useMemo, useRef } from 'react'
import { invokeCommand } from '@/desktop'
import { decorateAgentStream } from '@/lib/agentStreamText'
import { renderMarkdown } from '@/lib/markdown'
import { useT } from '@/hooks/useUiLocale'

const MARKDOWN_STYLES = `
.markdown-content {
  min-width: 0;
  overflow-wrap: anywhere;
}
.markdown-content p,
.markdown-content ul,
.markdown-content ol,
.markdown-content blockquote,
.markdown-content pre,
.markdown-content table {
  margin: 0.7rem 0;
}
.markdown-content :first-child {
  margin-top: 0;
}
.markdown-content :last-child {
  margin-bottom: 0;
}
.markdown-content h1,
.markdown-content h2,
.markdown-content h3,
.markdown-content h4,
.markdown-content h5,
.markdown-content h6 {
  margin: 1.1rem 0 0.55rem;
  color: inherit;
  font-weight: 650;
  letter-spacing: -0.02em;
  line-height: 1.35;
}
.markdown-content h1 { font-size: 1.35rem; }
.markdown-content h2 { font-size: 1.18rem; }
.markdown-content h3,
.markdown-content h4,
.markdown-content h5,
.markdown-content h6 { font-size: 1rem; }
.markdown-content ul,
.markdown-content ol { padding-left: 1.4rem; }
.markdown-content ul { list-style: disc; }
.markdown-content ol { list-style: decimal; }
.markdown-content li + li { margin-top: 0.3rem; }
.markdown-content strong {
  color: inherit;
  font-weight: 650;
}
.markdown-content a {
  color: var(--primary);
  text-decoration: underline;
  text-decoration-color: color-mix(in oklab, var(--primary) 45%, transparent);
  text-underline-offset: 3px;
}
.markdown-content code {
  border: 1px solid color-mix(in oklab, var(--border) 82%, transparent);
  border-radius: 0.3rem;
  background: color-mix(in oklab, var(--muted) 72%, transparent);
  color: inherit;
  padding: 0.08rem 0.32rem;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.88em;
}
.markdown-content .agent-code {
  position: relative;
  overflow: hidden;
  margin: 0.7rem 0;
  border: 1px solid var(--agent-hairline, var(--border));
  border-radius: var(--agent-code-radius, 8px);
  background: var(--agent-code-surface, var(--card));
  box-shadow: var(--agent-float-shadow, none);
}
.markdown-content .agent-code__bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 0.5rem;
  border-bottom: 1px solid var(--agent-hairline, var(--border));
  padding: 0.4rem 0.7rem;
}
.markdown-content .agent-code__lang {
  min-width: 0;
  overflow: hidden;
  color: var(--foreground);
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.75rem;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.markdown-content .agent-code__copy {
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  font-size: 0.72rem;
  cursor: pointer;
}
.markdown-content .agent-code__body,
.markdown-content pre {
  max-width: 100%;
  overflow: auto;
  margin: 0;
  border: 0;
  background: var(--agent-code-inset, var(--card));
  color: var(--foreground);
  padding: 0.55rem 0;
  line-height: 1.7;
}
.markdown-content pre code,
.markdown-content .agent-code code {
  display: block;
  border: 0;
  border-radius: 0;
  background: transparent;
  color: inherit;
  padding: 0;
  font-size: 0.82rem;
}
.markdown-content blockquote {
  border-left: 2px solid var(--primary);
  color: var(--muted-foreground);
  padding-left: 0.9rem;
}
.markdown-content table {
  width: 100%;
  border-collapse: collapse;
  font-size: 0.88rem;
}
.markdown-content th,
.markdown-content td {
  border: 1px solid var(--border);
  padding: 0.45rem 0.6rem;
  text-align: left;
  vertical-align: top;
}
.markdown-content th {
  background: color-mix(in oklab, var(--muted) 75%, transparent);
  font-weight: 600;
}
.markdown-content hr {
  margin: 1rem 0;
  border: 0;
  border-top: 1px solid var(--border);
}
.markdown-content .markdown-image-placeholder {
  color: var(--muted-foreground);
  font-size: 0.88em;
}
.markdown-content-compact p,
.markdown-content-compact ul,
.markdown-content-compact ol,
.markdown-content-compact blockquote,
.markdown-content-compact pre,
.markdown-content-compact table {
  margin: 0.45rem 0;
}
`

export default function MarkdownContent({
  content,
  compact = false,
  streaming = false,
  className,
}: {
  content: string
  compact?: boolean
  streaming?: boolean
  className?: string
}) {
  const t = useT()
  const host = useRef<HTMLDivElement | null>(null)
  const html = useMemo(() => renderMarkdown(content), [content])

  useEffect(() => {
    const root = host.current
    if (!root) return
    for (const block of root.querySelectorAll<HTMLElement>('.agent-code')) {
      if (block.querySelector('.agent-code__copy')) continue
      const bar = block.querySelector('.agent-code__bar') ?? block
      const body = block.querySelector('pre')
      const copy = document.createElement('button')
      copy.type = 'button'
      copy.className = 'agent-code__copy'
      copy.textContent = t('复制', 'Copy')
      copy.addEventListener('click', async event => {
        event.preventDefault()
        try {
          await navigator.clipboard.writeText(body?.innerText ?? block.innerText)
          copy.textContent = t('已复制', 'Copied')
          window.setTimeout(() => {
            copy.textContent = t('复制', 'Copy')
          }, 1500)
        } catch {
          copy.textContent = t('复制', 'Copy')
        }
      })
      bar.append(copy)
    }
    decorateAgentStream(root, streaming)
  }, [html, streaming, t])

  async function openLink(event: React.MouseEvent<HTMLDivElement>) {
    const target = event.target
    if (!(target instanceof Element)) return
    const anchor = target.closest('a')
    if (!anchor) return
    const href = anchor.getAttribute('href')?.trim()
    if (!href || href.startsWith('#')) return
    let url: URL
    try {
      url = new URL(href)
    } catch {
      event.preventDefault()
      return
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      event.preventDefault()
      return
    }
    event.preventDefault()
    await invokeCommand('open_ctf_source_url', { url: url.toString() })
  }

  return (
    <>
      <style>{MARKDOWN_STYLES}</style>
      <div
        ref={host}
        className={`markdown-content break-words${compact ? ' markdown-content-compact' : ''}${className ? ` ${className}` : ''}`}
        onClick={openLink}
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </>
  )
}
