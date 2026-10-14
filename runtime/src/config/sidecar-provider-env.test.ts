import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { exportSidecarProviderEnvironment } from './sidecar-provider-env.ts'
import type { AppSettings } from './settings-store.ts'

const FAKE_RELAY = 'sk-test-tokenflux-relay'
const FAKE_PERSONAL = 'sk-test-tokenflux-personal'
const FAKE_ANTHROPIC = 'sk-test-anthropic'

function envValue(environment: string[], name: string): string {
  const prefix = `${name}=`
  const entry = environment.find((item) => item.startsWith(prefix))
  return entry ? entry.slice(prefix.length) : ''
}

function decodeRoutes(environment: string[]): {
  deepseekOfficial: boolean
  providers?: Record<string, {
    api?: string
    baseURL?: string
    apiKeyEnv: string
    displayName?: string
    compat?: { supportsDeveloperRole?: boolean }
    models?: Array<{
      id: string
      image?: boolean
      contextWindow?: number
      reasoningEfforts?: Record<string, string>
    }>
  }>
} {
  const raw = envValue(environment, 'MILKSU_DSH_PI_AI_ROUTES')
  assert.notEqual(raw, '', 'MILKSU_DSH_PI_AI_ROUTES missing')
  return JSON.parse(raw) as ReturnType<typeof decodeRoutes>
}

test('relay TokenFlux mounts DSH pi-ai route and keeps keys out of DEEPSEEK_API_KEY', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-dsh-relay-'))
  const previous = process.env.MILKSU_HOME
  process.env.MILKSU_HOME = home
  try {
    const environment = exportSidecarProviderEnvironment({
      active_provider: 'tokenflux',
      active_model: 'deepseek-flash',
      providers: { tokenflux: { enabled: true } },
      relay: { enabled: true, url: 'https://tokenflux.dev/v1', key: FAKE_RELAY },
    } as AppSettings)
    assert.equal(envValue(environment, 'TOKENFLUX_API_KEY'), FAKE_RELAY)
    assert.equal(envValue(environment, 'DEEPSEEK_API_KEY'), '')
    const routes = decodeRoutes(environment)
    const route = routes.providers?.tokenflux
    assert.ok(route)
    assert.equal(route.api, 'openai-completions')
    assert.equal(route.baseURL, 'https://tokenflux.dev/v1')
    assert.equal(route.apiKeyEnv, 'TOKENFLUX_API_KEY')
    assert.equal(route.displayName, 'TokenFlux')
    assert.equal(route.compat?.supportsDeveloperRole, false)
    assert.equal(route.models?.[0]?.id, 'deepseek-flash')
    assert.equal(route.models?.[0]?.reasoningEfforts?.low, 'low')
    assert.equal(route.models?.[0]?.reasoningEfforts?.max, 'max')
    assert.equal(JSON.stringify(routes).includes(FAKE_RELAY), false)
  } finally {
    if (previous === undefined) delete process.env.MILKSU_HOME
    else process.env.MILKSU_HOME = previous
  }
})

test('personal TokenFlux key mounts the same route; catalog drops image-only models', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-dsh-routes-'))
  await mkdir(join(home, 'data', 'services', 'model-catalog'), { recursive: true })
  await writeFile(join(home, 'data', 'services', 'model-catalog', 'tokenflux.json'), JSON.stringify({
    schema: 'milksu-model-catalog/v1',
    provider: 'tokenflux',
    models: [
      {
        id: 'deepseek/deepseek-flash',
        name: 'DeepSeek Flash',
        context_window: 1000000,
        max_tokens: 393216,
        input: ['text', 'image'],
      },
      {
        id: 'openai/gpt-5.4',
        name: 'GPT-5.4',
        context_window: 1050000,
        max_tokens: 128000,
        input: ['text'],
      },
      {
        id: 'x-ai/grok-4.6-image',
        name: 'Grok Image',
        context_window: 500000,
        max_tokens: 32768,
        input: ['text', 'image'],
        image_transport: 'openai-images',
      },
    ],
  }))
  const previous = process.env.MILKSU_HOME
  process.env.MILKSU_HOME = home
  try {
    const environment = exportSidecarProviderEnvironment({
      active_provider: 'tokenflux',
      active_model: 'deepseek/deepseek-flash',
      providers: {
        tokenflux: {
          enabled: true,
          api_key: FAKE_PERSONAL,
          base_url: 'https://tokenflux.dev/v1',
        },
      },
    } as AppSettings)
    assert.equal(envValue(environment, 'TOKENFLUX_API_KEY'), FAKE_PERSONAL)
    assert.equal(envValue(environment, 'DEEPSEEK_API_KEY'), '')
    const routes = decodeRoutes(environment)
    const models = routes.providers?.tokenflux?.models ?? []
    assert.equal(models.length, 2)
    assert.equal(models[0]?.id, 'deepseek/deepseek-flash')
    assert.equal(models[0]?.image, true)
    assert.equal(models[0]?.contextWindow, 1000000)
    assert.equal(models[0]?.reasoningEfforts?.low, 'low')
    assert.equal(models[0]?.reasoningEfforts?.max, 'max')
    assert.equal(models[1]?.id, 'openai/gpt-5.4')
    assert.equal(models[1]?.image, undefined)
    assert.equal(models.some((item) => item.id.includes('image')), false)
  } finally {
    if (previous === undefined) delete process.env.MILKSU_HOME
    else process.env.MILKSU_HOME = previous
  }
})

test('TokenFlux custom relay aliases its provider id onto the DSH tokenflux route', async () => {
  const home = await mkdtemp(join(tmpdir(), 'milksu-dsh-custom-'))
  const previous = process.env.MILKSU_HOME
  process.env.MILKSU_HOME = home
  try {
    const environment = exportSidecarProviderEnvironment({
      active_provider: 'custom-relay-product-loop',
      active_model: 'deepseek/deepseek-flash',
      providers: {
        'custom-relay-product-loop': {
          enabled: true,
          custom: true,
          name: 'product-loop',
          api_key: FAKE_PERSONAL,
          base_url: 'https://tokenflux.dev/v1',
          models: ['deepseek/deepseek-flash'],
        },
      },
    } as AppSettings)
    assert.equal(envValue(environment, 'TOKENFLUX_API_KEY'), FAKE_PERSONAL)
    assert.equal(envValue(environment, 'DEEPSEEK_API_KEY'), '')
    const routes = decodeRoutes(environment)
    assert.equal(routes.deepseekOfficial, false)
    assert.equal(routes.providers?.tokenflux?.api, 'openai-completions')
    assert.equal(routes.providers?.tokenflux?.apiKeyEnv, 'TOKENFLUX_API_KEY')
    assert.equal(routes.providers?.tokenflux?.compat?.supportsDeveloperRole, false)
    const alias = routes.providers?.['custom-relay-product-loop']
    assert.ok(alias)
    assert.equal(alias.api, 'openai-completions')
    assert.equal(alias.baseURL, 'https://tokenflux.dev/v1')
    assert.equal(alias.apiKeyEnv, 'TOKENFLUX_API_KEY')
    assert.equal(alias.displayName, 'product-loop')
    assert.equal(alias.compat?.supportsDeveloperRole, false)
    assert.equal(alias.models?.[0]?.id, 'deepseek/deepseek-flash')
  } finally {
    if (previous === undefined) delete process.env.MILKSU_HOME
    else process.env.MILKSU_HOME = previous
  }
})

test('catalog provider with a personal key is a pi-ai directory route', () => {
  const environment = exportSidecarProviderEnvironment({
    active_provider: 'anthropic',
    active_model: 'claude-sonnet',
    providers: {
      anthropic: { enabled: true, api_key: FAKE_ANTHROPIC, name: 'Anthropic' },
    },
  } as AppSettings)
  const routes = decodeRoutes(environment)
  assert.equal(routes.deepseekOfficial, false)
  const route = routes.providers?.anthropic
  assert.ok(route)
  assert.equal(route.apiKeyEnv, 'ANTHROPIC_API_KEY')
  assert.equal(route.api, undefined)
  assert.equal(route.models, undefined)
  assert.equal(envValue(environment, 'DEEPSEEK_API_KEY'), '')
})
