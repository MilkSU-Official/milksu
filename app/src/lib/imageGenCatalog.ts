/**
 * Image routes are catalog ids whose composite-key prefix ends in `-image`
 * (`openai-image/…`, `google-image/…`, `x-ai-image/…`). Chat prefixes stay
 * without that suffix. The live catalog supplies the ids.
 */

export interface ImageGenCatalogModel {
  id: string
  name: string
  vendor: string
  platform: string
  supportsEdit: boolean
}

export interface ImageGenCatalogSnapshot {
  schema: string
  models: ImageGenCatalogModel[]
}

export const IMAGEGEN_CATALOG_SCHEMA = 'milksu-imagegen-catalog/v1'

const imageVendorSuffix = '-image'

/** True when the vendor prefix ends with `-image` and a model id follows. */
export function isImageGenModelID(id: string): boolean {
  const needle = String(id ?? '').trim()
  const slash = needle.indexOf('/')
  if (slash <= imageVendorSuffix.length || slash >= needle.length - 1) return false
  if (/[\s\u0000]/.test(needle)) return false
  const vendor = needle.slice(0, slash)
  return vendor.endsWith(imageVendorSuffix) && vendor.length > imageVendorSuffix.length
}

/** Request protocol for an image id. Empty when the prefix is not an image group. */
export function imageGenTransport(id: string): '' | 'gpt-image' | 'images-minimal' | 'gemini' {
  if (!isImageGenModelID(id)) return ''
  const lower = String(id).trim().toLowerCase()
  const vendor = lower.slice(0, lower.indexOf('/'))
  if (vendor === 'google-image') return 'gemini'
  if (lower.includes('gpt-image')) return 'gpt-image'
  return 'images-minimal'
}

/** GPT Image and Grok Imagine accept reference edits. Other image routes do not. */
export function imageGenSupportsEdit(id: string): boolean {
  const needle = String(id ?? '').trim().toLowerCase()
  return needle.includes('gpt-image') || needle.includes('grok-imagine')
}

export function imageGenModelLabel(id: string, name?: string): string {
  const needle = String(id ?? '').trim()
  const display = String(name ?? '').trim()
  if (display && display !== needle) return display
  return needle
}

export const DEFAULT_IMAGEGEN_PROVIDER = 'tokenflux'
export const DEFAULT_IMAGEGEN_SOURCE = 'account' as const
export const IMAGEGEN_MODEL_OFF = '__imagegen_off__'
