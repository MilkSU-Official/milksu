import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  CATALOG_SCHEMA,
  CREDENTIAL_SOURCE_BUNDLED,
  CREDENTIAL_SOURCE_PERSONAL,
  ModelCatalogService,
  PROVIDER_TOKENFLUX,
} from './index.ts'
import { imageTransport, isImageModelID } from './imagegen.ts'

test('open reads a cached catalog without contacting the network', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'milksu-catalog-'))
  const cachePath = join(dataDirectory, 'services', 'model-catalog', 'tokenflux.json')
  await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 })
  await writeFile(cachePath, `${JSON.stringify({
    schema: CATALOG_SCHEMA,
    provider: PROVIDER_TOKENFLUX,
    source: 'remote',
    credential_source: CREDENTIAL_SOURCE_PERSONAL,
    key_shape: 'single',
    models: [
      { id: 'grok-4.6', name: 'Grok 4.6', context_window: 500000, max_tokens: 500000, input: ['text', 'image'] },
    ],
    image_models: [
      { id: 'openai-image/gpt-image-2', name: 'GPT Image 2', context_window: 128000, max_tokens: 16384, input: ['text', 'image'] },
    ],
  }, null, 2)}\n`, { mode: 0o600 })

  const service = await ModelCatalogService.open(dataDirectory, () => ({
    providers: { tokenflux: { api_key: 'catalog-secret-must-not-leak', enabled: true } },
  }))
  const snapshot = service.current()
  assert.equal(snapshot.schema, CATALOG_SCHEMA)
  assert.equal(snapshot.source, 'cache')
  assert.equal(snapshot.credential_source, CREDENTIAL_SOURCE_PERSONAL)
  assert.equal(snapshot.models.length, 1)
  assert.equal(snapshot.models[0]?.id, 'grok-4.6')
  assert.equal(snapshot.models[0]?.context_window, 500000)
  const encoded = JSON.stringify(snapshot)
  assert.equal(encoded.includes('catalog-secret-must-not-leak'), false)
  assert.equal(encoded.toLowerCase().includes('api_key'), false)
  const disk = await readFile(service.cachePath, 'utf8')
  assert.equal(disk.includes('catalog-secret-must-not-leak'), false)

  const images = service.imageCatalog()
  assert.equal(images.schema, 'milksu-imagegen-catalog/v1')
  assert.equal(images.models[0]?.id, 'openai-image/gpt-image-2')
  assert.equal(images.models[0]?.vendor, 'openai-image')
})

test('refresh prefers an authenticated catalog and restart reloads the cache', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'milksu-catalog-refresh-'))
  let authorization = ''
  const service = new ModelCatalogService({
    dataDirectory,
    settings: () => ({
      providers: {
        tokenflux: {
          api_key: 'catalog-secret',
          base_url: 'https://tokenflux.dev/v1',
          enabled: true,
        },
      },
    }),
    now: () => new Date('2026-08-13T12:30:00.000Z'),
    publicCatalogURL: 'https://example.invalid/public-models',
    fetchImpl: async (input, init) => {
      authorization = String((init as RequestInit | undefined)?.headers && (init as RequestInit).headers
        ? new Headers((init as RequestInit).headers).get('Authorization')
        : '')
      assert.equal(String(input).includes('example.invalid'), false)
      return new Response(JSON.stringify({
        data: [
          {
            id: 'grok-4.6',
            name: 'Grok 4.6',
            type: 'model',
            context_length: 500000,
            architecture: { input_modalities: ['text', 'image', 'file'] },
          },
          {
            id: 'qwen/embedding',
            name: 'Embedding',
            type: 'embedding',
            context_length: 8192,
            architecture: { input_modalities: ['text'] },
          },
          {
            id: 'openai-image/gpt-image-2',
            name: 'GPT Image 2',
            type: 'model',
            architecture: { input_modalities: ['text', 'image'] },
          },
        ],
      }), { status: 200, headers: { 'Content-Type': 'application/json' } })
    },
  })
  const refreshed = await service.refresh()
  assert.equal(authorization, 'Bearer catalog-secret')
  assert.equal(refreshed.source, 'remote')
  assert.equal(refreshed.credential_source, CREDENTIAL_SOURCE_PERSONAL)
  assert.equal(refreshed.refreshed_at, '2026-08-13T12:30:00.000Z')
  assert.equal(refreshed.models.length, 1)
  assert.equal(refreshed.models[0]?.id, 'grok-4.6')
  assert.deepEqual(refreshed.models[0]?.input, ['text', 'image'])
  assert.equal(refreshed.image_models?.[0]?.id, 'openai-image/gpt-image-2')
  assert.equal(JSON.stringify(refreshed).includes('catalog-secret'), false)

  const restarted = await ModelCatalogService.open(dataDirectory, () => ({}))
  const cached = restarted.current()
  assert.equal(cached.source, 'cache')
  assert.equal(cached.credential_source, CREDENTIAL_SOURCE_PERSONAL)
  assert.equal(cached.models[0]?.id, 'grok-4.6')
})

test('invalid cache falls back to the bundled catalog', async () => {
  const dataDirectory = await mkdtemp(join(tmpdir(), 'milksu-catalog-bundled-'))
  const cachePath = join(dataDirectory, 'services', 'model-catalog', 'tokenflux.json')
  await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 })
  await writeFile(cachePath, '{"schema":"milksu-model-catalog/v1","provider":"tokenflux","source":"remote","models":[{"id":"grok-4.5"}]}\n')
  const service = await ModelCatalogService.open(dataDirectory, () => ({}))
  const snapshot = service.current()
  assert.equal(snapshot.source, 'bundled')
  assert.equal(snapshot.credential_source, CREDENTIAL_SOURCE_BUNDLED)
  assert.ok(snapshot.models.length > 0)
  assert.deepEqual(snapshot.models[0]?.input, ['text', 'image'])
})

test('image model ids use the vendor -image prefix', () => {
  assert.equal(isImageModelID('openai-image/gpt-image-2'), true)
  assert.equal(isImageModelID('openai/gpt-5.6'), false)
  assert.equal(imageTransport('openai-image/gpt-image-2'), 'gpt-image')
  assert.equal(imageTransport('google-image/nano-banana-2'), 'gemini')
  assert.equal(imageTransport('x-ai-image/grok-imagine-image-2.0'), 'images-minimal')
})
