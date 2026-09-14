import DOMPurify from 'dompurify'
import { t } from '@/lib/uiLocale'
import type {
  CodingArtifactPreview,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'

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

// The preview gate is path safety only. Which formats render is the desktop
// runtime's answer, and it reports an unreadable file as an error rather than
// leaving the control refusing paths the backend would have accepted.
export function isArtifactPathSafe(path: string): boolean {
  const trimmed = path.trim()
  if (
    !trimmed
    || trimmed.startsWith('/')
    || trimmed.startsWith('\\')
    || trimmed.includes('\0')
  ) {
    return false
  }
  return !trimmed.split(/[\\/]+/).some(segment => segment === '..')
}

// Which paths are worth offering is the desktop runtime's answer: only it can
// see the ignored output directories and the workspaces outside Git where an
// agent also writes. This keeps the path-safety gate and nothing else.
export function suggestedArtifactPaths(
  environment: CodingEnvironmentSnapshot | null,
): string[] {
  const seen = new Set<string>()
  return (environment?.artifacts ?? []).filter(path => {
    if (!path || seen.has(path) || !isArtifactPathSafe(path)) return false
    seen.add(path)
    return true
  })
}

export function artifactKindLabel(kind: CodingArtifactPreview['kind']): string {
  if (kind === 'markdown') return 'Markdown'
  if (kind === 'html') return 'HTML'
  if (kind === 'text') return t('文本', 'Text')
  return t('图片', 'Image')
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
