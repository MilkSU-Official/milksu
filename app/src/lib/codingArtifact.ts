import DOMPurify from 'dompurify'
import type {
  CodingArtifactPreview,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'

const previewableExtensions = new Set([
  '.gif',
  '.htm',
  '.html',
  '.jpeg',
  '.jpg',
  '.markdown',
  '.md',
  '.png',
  '.webp',
])

const safeEmbeddedImage = /^data:image\/(?:png|jpeg|gif|webp);base64,/i
const resourceAttributes = [
  'action',
  'data',
  'formaction',
  'href',
  'ping',
  'poster',
  'src',
  'srcdoc',
  'srcset',
  'xlink:href',
]

export function isPreviewableArtifactPath(path: string): boolean {
  const trimmed = path.trim()
  if (
    !trimmed
    || trimmed.startsWith('/')
    || trimmed.startsWith('\\')
    || trimmed.includes('\0')
  ) {
    return false
  }
  const segments = trimmed.split(/[\\/]+/)
  if (segments.some(segment => segment === '..')) return false
  const normalized = trimmed.toLowerCase()
  const separator = normalized.lastIndexOf('.')
  return separator >= 0 && previewableExtensions.has(normalized.slice(separator))
}

export function suggestedArtifactPaths(
  environment: CodingEnvironmentSnapshot | null,
): string[] {
  const seen = new Set<string>()
  return (environment?.git.changes ?? [])
    .map(change => change.path)
    .filter(path => {
      if (!path || seen.has(path) || !isPreviewableArtifactPath(path)) return false
      seen.add(path)
      return true
    })
    .slice(0, 12)
}

export function artifactKindLabel(kind: CodingArtifactPreview['kind']): string {
  if (kind === 'markdown') return 'Markdown'
  if (kind === 'html') return 'HTML'
  return '图片'
}

export function buildArtifactHTMLDocument(content: string): string {
  const sanitized = DOMPurify.sanitize(content || '', {
    WHOLE_DOCUMENT: true,
    FORBID_TAGS: [
      'base',
      'embed',
      'form',
      'iframe',
      'input',
      'link',
      'math',
      'meta',
      'object',
      'script',
      'svg',
    ],
  })
  const document = new DOMParser().parseFromString(sanitized, 'text/html')
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of resourceAttributes) {
      const value = element.getAttribute(attribute)
      if (
        element.tagName === 'IMG'
        && attribute === 'src'
        && value
        && safeEmbeddedImage.test(value)
      ) {
        continue
      }
      element.removeAttribute(attribute)
    }
  }

  const policy = [
    "default-src 'none'",
    "base-uri 'none'",
    "connect-src 'none'",
    "font-src data:",
    "form-action 'none'",
    "frame-src 'none'",
    'img-src data:',
    "media-src 'none'",
    "object-src 'none'",
    "script-src 'none'",
    "style-src 'unsafe-inline'",
  ].join('; ')
  const csp = document.createElement('meta')
  csp.setAttribute('http-equiv', 'Content-Security-Policy')
  csp.setAttribute('content', policy)
  document.head.prepend(csp)
  return `<!doctype html>${document.documentElement.outerHTML}`
}
