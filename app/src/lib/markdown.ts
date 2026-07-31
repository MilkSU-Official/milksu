import DOMPurify from 'dompurify'
import MarkdownIt from 'markdown-it'

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
  const description = tokens[index].content.trim() || '图片'
  return `<span class="markdown-image-placeholder">[图片：${markdown.utils.escapeHtml(description)}]</span>`
}

const allowedTags = [
  'a',
  'blockquote',
  'br',
  'code',
  'del',
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
  'strong',
  'table',
  'tbody',
  'td',
  'th',
  'thead',
  'tr',
  'ul',
  'span',
]

export function renderMarkdown(content: string) {
  const rendered = markdown.render(content || '')
  return DOMPurify.sanitize(rendered, {
    ALLOWED_ATTR: ['class', 'href', 'rel', 'target', 'title'],
    ALLOWED_TAGS: allowedTags,
    ALLOW_DATA_ATTR: false,
    FORBID_TAGS: ['form', 'iframe', 'img', 'input', 'math', 'object', 'style', 'svg'],
  })
}
