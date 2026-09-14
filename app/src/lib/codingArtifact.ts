import DOMPurify from 'dompurify'
import { t } from '@/lib/uiLocale'
import type {
  CodingArtifactPreview,
  CodingEnvironmentSnapshot,
} from '@/codingEnvironmentTypes'

// Preview accepts any UTF-8 file. This narrower set only decides which changed
// paths become candidate chips, so it stays on the formats an agent writes as a
// deliverable rather than every touched source file. Keep it in step with
// suggestedArtifactExtensions in internal/codingenv/artifact_list.go.
const suggestedExtensions = new Set([
  '.csv',
  '.diff',
  '.gif',
  '.htm',
  '.html',
  '.jpeg',
  '.jpg',
  '.json',
  '.log',
  '.markdown',
  '.md',
  '.patch',
  '.png',
  '.txt',
  '.webp',
  '.xml',
  '.yaml',
  '.yml',
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

export function isSuggestedArtifactPath(path: string): boolean {
  if (!isArtifactPathSafe(path)) return false
  const normalized = path.trim().toLowerCase()
  const separator = normalized.lastIndexOf('.')
  return separator >= 0 && suggestedExtensions.has(normalized.slice(separator))
}

export function suggestedArtifactPaths(
  environment: CodingEnvironmentSnapshot | null,
): string[] {
  const seen = new Set<string>()
  return (environment?.git.changes ?? [])
    .map(change => change.path)
    .filter(path => {
      if (!path || seen.has(path) || !isSuggestedArtifactPath(path)) return false
      seen.add(path)
      return true
    })
    .slice(0, 12)
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
