import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'
import hljs from 'highlight.js/lib/core'
import bash from 'highlight.js/lib/languages/bash'
import css from 'highlight.js/lib/languages/css'
import go from 'highlight.js/lib/languages/go'
import java from 'highlight.js/lib/languages/java'
import javascript from 'highlight.js/lib/languages/javascript'
import json from 'highlight.js/lib/languages/json'
import python from 'highlight.js/lib/languages/python'
import rust from 'highlight.js/lib/languages/rust'
import sql from 'highlight.js/lib/languages/sql'
import typescript from 'highlight.js/lib/languages/typescript'
import xml from 'highlight.js/lib/languages/xml'
import yaml from 'highlight.js/lib/languages/yaml'
import { t } from '@/lib/uiLocale'

hljs.registerLanguage('bash', bash)
hljs.registerLanguage('css', css)
hljs.registerLanguage('go', go)
hljs.registerLanguage('html', xml)
hljs.registerLanguage('java', java)
hljs.registerLanguage('javascript', javascript)
hljs.registerLanguage('json', json)
hljs.registerLanguage('python', python)
hljs.registerLanguage('rust', rust)
hljs.registerLanguage('sql', sql)
hljs.registerLanguage('typescript', typescript)
hljs.registerLanguage('xml', xml)
hljs.registerLanguage('yaml', yaml)

const LANG_ALIASES: Record<string, string> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  mts: 'typescript',
  py: 'python',
  rs: 'rust',
  sh: 'bash',
  zsh: 'bash',
  shell: 'bash',
  yml: 'yaml',
  vue: 'xml',
  htm: 'html',
  md: 'markdown',
}

const LANG_LABELS: Record<string, string> = {
  javascript: 'JavaScript',
  typescript: 'TypeScript',
  python: 'Python',
  go: 'Go',
  rust: 'Rust',
  bash: 'Bash',
  json: 'JSON',
  css: 'CSS',
  html: 'HTML',
  xml: 'XML',
  yaml: 'YAML',
  java: 'Java',
  sql: 'SQL',
}

const markdown = new MarkdownIt({
  breaks: true,
  html: false,
  linkify: true,
  typographer: false,
})

const defaultLinkOpen = markdown.renderer.rules.link_open
  ?? ((tokens, index, options, _environment, renderer) => (
    renderer.renderToken(tokens, index, options)
  ))

markdown.renderer.rules.link_open = (tokens, index, options, environment, renderer) => {
  tokens[index].attrSet('target', '_blank')
  tokens[index].attrSet('rel', 'noopener noreferrer')
  return defaultLinkOpen(tokens, index, options, environment, renderer)
}

markdown.renderer.rules.image = (tokens, index) => {
  const description = tokens[index].content.trim() || t('图片', 'Image')
  return `<span class="markdown-image-placeholder">${t(`[图片：${markdown.utils.escapeHtml(description)}]`, `[Image: ${markdown.utils.escapeHtml(description)}]`)}</span>`
}

function resolveLanguage(info: string) {
  const raw = info.trim().split(/\s+/)[0] ?? ''
  const filename = raw.includes('.') ? raw.split(/[/\\]/).at(-1) ?? raw : ''
  const ext = filename.includes('.') ? filename.split('.').at(-1) ?? '' : raw
  const language = LANG_ALIASES[ext.toLowerCase()] || ext.toLowerCase()
  const highlightLang = hljs.getLanguage(language) ? language : ''
  const label = filename
    || LANG_LABELS[highlightLang]
    || (raw ? raw : '')
  return { filename, language: highlightLang, label }
}

function highlightCode(code: string, language: string) {
  if (!language) return markdown.utils.escapeHtml(code)
  try {
    return hljs.highlight(code, { language, ignoreIllegals: true }).value
  } catch {
    return markdown.utils.escapeHtml(code)
  }
}

function renderFence(code: string, info: string) {
  const { filename, language, label } = resolveLanguage(info)
  const highlighted = highlightCode(code.replace(/\n$/, ''), language)
  const lines = highlighted.split('\n')
  const body = lines.map((line, index) => (
    `<span class="agent-code__line"><span class="agent-code__n">${index + 1}</span><span class="agent-code__src">${line || ' '}</span></span>`
  )).join('')
  const langAttr = language ? ` data-lang="${markdown.utils.escapeHtml(language)}"` : ''
  const fileAttr = filename ? ` data-file="${markdown.utils.escapeHtml(filename)}"` : ''
  const heading = markdown.utils.escapeHtml(label)
  return (
    `<div class="agent-code"${langAttr}${fileAttr}>`
    + `<div class="agent-code__bar"><span class="agent-code__lang">${heading}</span></div>`
    + `<pre class="agent-code__body"><code class="${language ? `language-${language}` : ''}">${body}</code></pre>`
    + `</div>`
  )
}

markdown.renderer.rules.fence = (tokens, index) => {
  const token = tokens[index]
  return renderFence(token.content, token.info)
}

const allowedTags = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
  'div',
  'em',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'hr',
  'li',
  'ol',
  'p',
  'pre',
  's',
  'span',
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
]

export function renderMarkdown(content: string) {
  const rendered = markdown.render(content || '')
  return DOMPurify.sanitize(rendered, {
    ALLOWED_ATTR: ['class', 'href', 'rel', 'target', 'title', 'data-lang', 'data-file'],
    ALLOWED_TAGS: allowedTags,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['form', 'iframe', 'img', 'input', 'math', 'object', 'style', 'svg'],
  })
}
