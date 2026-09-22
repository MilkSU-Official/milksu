/**
 * Curated ImageGen catalog. Chat / Coding models must never appear here.
 * MilkSU calls OpenAI-compatible /v1/images/generations against TokenFlux
 * (tokenflux.dev) or a personal OpenAI-compatible relay.
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

export const BUILTIN_IMAGEGEN_MODELS: readonly ImageGenCatalogModel[] = [
  {
    id: 'openai/gpt-image-2',
    name: 'GPT Image 2',
    vendor: 'openai',
    platform: 'OpenAI',
    supportsEdit: true,
  },
  {
    id: 'openai/gpt-image-1',
    name: 'GPT Image 1',
    vendor: 'openai',
    platform: 'OpenAI',
    supportsEdit: true,
  },
  {
    id: 'xai/grok-imagine-image',
    name: 'Grok Imagine',
    vendor: 'xai',
    platform: 'xAI',
    supportsEdit: true,
  },
  {
    id: 'xai/grok-imagine-image-2.0',
    name: 'Grok Imagine 2.0',
    vendor: 'xai',
    platform: 'xAI',
    supportsEdit: true,
  },
  {
    id: 'google/imagen-4.0-generate-001',
    name: 'Imagen 4',
    vendor: 'google',
    platform: 'Google',
    supportsEdit: false,
  },
  {
    id: 'google/imagen-3.0-generate-002',
    name: 'Imagen 3',
    vendor: 'google',
    platform: 'Google',
    supportsEdit: false,
  },
  {
    id: 'black-forest-labs/flux-2-pro',
    name: 'FLUX.2 Pro',
    vendor: 'black-forest-labs',
    platform: 'Black Forest Labs',
    supportsEdit: false,
  },
  {
    id: 'black-forest-labs/flux-schnell',
    name: 'FLUX Schnell',
    vendor: 'black-forest-labs',
    platform: 'Black Forest Labs',
    supportsEdit: false,
  },
  {
    id: 'ideogram-ai/ideogram-v3',
    name: 'Ideogram V3',
    vendor: 'ideogram',
    platform: 'Ideogram',
    supportsEdit: false,
  },
  {
    id: 'recraft-ai/recraft-v3',
    name: 'Recraft V3',
    vendor: 'recraft',
    platform: 'Recraft',
    supportsEdit: false,
  },
]

export function isImageGenModelID(id: string): boolean {
  const needle = String(id ?? '').trim()
  return BUILTIN_IMAGEGEN_MODELS.some(model => model.id === needle)
}

export function imageGenModelLabel(id: string): string {
  const needle = String(id ?? '').trim()
  const found = BUILTIN_IMAGEGEN_MODELS.find(model => model.id === needle)
  return found ? `${found.platform} · ${found.name}` : needle
}

export const DEFAULT_IMAGEGEN_PROVIDER = 'tokenflux'
export const DEFAULT_IMAGEGEN_MODEL = 'openai/gpt-image-2'
export const DEFAULT_IMAGEGEN_SOURCE = 'account' as const
export const IMAGEGEN_MODEL_OFF = '__imagegen_off__'
