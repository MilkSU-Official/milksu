export const IMAGEGEN_SCHEMA = 'milksu-imagegen-catalog/v1'
export const TRANSPORT_GPT_IMAGE = 'gpt-image'
export const TRANSPORT_IMAGES = 'images-minimal'
export const TRANSPORT_GEMINI = 'gemini'

export type ImageGenModel = {
  id: string
  name: string
  vendor: string
  platform: string
  supports_edit: boolean
}

export type ImageGenSnapshot = {
  schema: string
  models: ImageGenModel[]
}

export function isImageModelID(id: string): boolean {
  id = String(id ?? '').trim()
  const slash = id.indexOf('/')
  if (slash <= '-image'.length || slash >= id.length - 1) return false
  if (/[ \t\r\n\x00]/u.test(id)) return false
  const vendor = id.slice(0, slash)
  return vendor.endsWith('-image') && vendor.length > '-image'.length
}

export function imageTransport(id: string): string {
  if (!isImageModelID(id)) return ''
  const lower = id.trim().toLowerCase()
  const slash = lower.indexOf('/')
  const vendor = slash > 0 ? lower.slice(0, slash) : lower
  if (vendor === 'google-image') return TRANSPORT_GEMINI
  if (lower.includes('gpt-image')) return TRANSPORT_GPT_IMAGE
  return TRANSPORT_IMAGES
}

export function supportsEdit(id: string): boolean {
  const lower = String(id ?? '').trim().toLowerCase()
  return lower.includes('gpt-image') || lower.includes('grok-imagine')
}

export function describeImageModel(id: string, name: string): ImageGenModel {
  id = String(id ?? '').trim()
  name = String(name ?? '').trim()
  if (!name || name === id) name = id
  const slash = id.indexOf('/')
  const vendor = slash > 0 ? id.slice(0, slash) : id
  return { id, name, vendor, platform: vendor, supports_edit: supportsEdit(id) }
}
