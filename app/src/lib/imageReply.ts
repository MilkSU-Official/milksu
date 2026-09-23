import type { Message } from '@/types'

const imageExt = /\.(png|jpe?g|webp|gif)$/i
const deliveryHeading = /^(已生成完成|生成完成|图片已生成|image generated|generated)[.。]?$/i
const labeledMeta = /^(文件|路径|输出|file|path|output|模型|model|规格|尺寸|大小|size|质量|quality|sha-?256|提示词|prompt|provider)(?:（[^）]{0,40}）|\([^)]{0,40}\))?\s*[:：]/i
const deliveryProse = /未覆盖|未改动代码|新建的\s*\.png|did not overwrite|new \.png/i
const hashLine = /\bsha-?256\b/i
const specLine = /(\d+\s*[×x]\s*\d+).*(字节|bytes|png|jpe?g|webp)/i

export interface GeneratedImageOutput {
  id: string
  path: string
}

export function safeGeneratedImagePath(value: string): string {
  const path = String(value ?? '').trim().replaceAll('\\', '/')
  if (!path || path.startsWith('/') || /^[A-Za-z]:/.test(path)) return ''
  if (path.split('/').some(part => !part || part === '..')) return ''
  if (!imageExt.test(path)) return ''
  return path
}

export function imageOutputFromToolMessage(message: Message): GeneratedImageOutput | null {
  if (message.role !== 'tool') return null
  if (String(message.toolName ?? '').toLowerCase() !== 'milksu_imagegen') return null
  if (message.status === 'running') return null
  const text = String(message.content ?? '')
  const start = text.indexOf('{')
  if (start < 0) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start))
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object') return null
  const row = parsed as { status?: unknown, output?: { path?: unknown } }
  if (row.status !== 'completed') return null
  const path = safeGeneratedImagePath(String(row.output?.path ?? ''))
  if (!path) return null
  return { id: message.id, path }
}

export function imageOutputsFromToolMessages(messages: Message[]): GeneratedImageOutput[] {
  const seen = new Set<string>()
  const outputs: GeneratedImageOutput[] = []
  for (const message of messages) {
    const output = imageOutputFromToolMessage(message)
    if (!output || seen.has(output.path)) continue
    seen.add(output.path)
    outputs.push(output)
  }
  return outputs
}

function deliveryNoteLine(line: string, paths: string[]): boolean {
  const text = line.replace(/^[\s>*•·\-]+/, '').trim()
  if (!text) return false
  if (deliveryHeading.test(text)) return true
  if (labeledMeta.test(text)) return true
  if (hashLine.test(text) && /[a-f0-9]{16,}/i.test(text)) return true
  if (specLine.test(text)) return true
  if (deliveryProse.test(text)) return true
  if (imageExt.test(text) && text.split(/\s+/).length <= 2) return true
  const folded = text.replaceAll('\\', '/')
  return paths.some(path => path && folded.includes(path))
}

/** Drop a delivery note once the picture is already in the thread. Keep any other words. */
export function captionBesideGeneratedImages(content: string, paths: string[]): string {
  if (!paths.length) return content
  const kept = String(content ?? '')
    .split(/\r?\n/)
    .filter(line => !deliveryNoteLine(line, paths))
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}
