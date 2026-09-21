/**
 * Load the gitignored product-loop local env file.
 * Public keys may go onto process.env. Secrets stay in coordinator memory
 * so the frontend can type them; they are never written onto process.env
 * or spawned into desktop / sidecar. Never logs secret values.
 * Not imported by App startup.
 */

import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { repositoryRoot } from './desktop-gui-driver.mjs'
import { TOKENFLUX_BASE_URL } from './product-loop-catalog.mjs'

export const PRODUCT_LOOP_LOCAL_ENV_RELATIVE = 'docs/developer/product-loop.local.env'

/** TokenFlux catalog id. Custom relays at tokenflux.dev use this when models are left blank. */
export const TOKENFLUX_CATALOG_DEFAULT_MODEL = 'deepseek/deepseek-flash'
export const DEEPSEEK_OFFICIAL_BASE_URL = 'https://api.deepseek.com'
export const DEEPSEEK_OFFICIAL_MODEL = 'deepseek-chat'

export const PRODUCT_LOOP_LOCAL_SECRET_KEYS = Object.freeze([
  'DEEPSEEK_API_KEY',
  'TOKENFLUX_API_KEY',
])

export const PRODUCT_LOOP_LOCAL_PUBLIC_KEYS = Object.freeze([
  'CUSTOM_RELAY_BASE_URL',
  'CUSTOM_RELAY_MODELS',
  'CUSTOM_RELAY_NAME',
  'ACCOUNT_HAS_QUOTA',
])

const ALLOWED_KEYS = new Set([
  ...PRODUCT_LOOP_LOCAL_SECRET_KEYS,
  ...PRODUCT_LOOP_LOCAL_PUBLIC_KEYS,
])

const heldSecrets = Object.create(null)

export function productLoopLocalEnvPath(root = repositoryRoot) {
  return join(root, PRODUCT_LOOP_LOCAL_ENV_RELATIVE)
}

export function parseProductLoopLocalEnv(text) {
  const values = {}
  const unknown = []
  for (const rawLine of String(text ?? '').split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const cut = line.indexOf('=')
    if (cut <= 0) continue
    const name = line.slice(0, cut).trim()
    let value = line.slice(cut + 1).trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!name || !value) continue
    if (!ALLOWED_KEYS.has(name)) {
      unknown.push(name)
      continue
    }
    if (name === 'CUSTOM_RELAY_BASE_URL') {
      assertAllowedRelayURL(value)
    }
    values[name] = value
  }
  return { values, unknown }
}

export function assertAllowedRelayURL(value) {
  const url = String(value ?? '').trim()
  if (!url) return
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('CUSTOM_RELAY_BASE_URL must be an absolute URL')
  }
  if (parsed.protocol !== 'https:') {
    throw new Error('CUSTOM_RELAY_BASE_URL must use https')
  }
  const host = parsed.hostname.toLowerCase()
  if (host === 'tokenflux.ai' || host.endsWith('.tokenflux.ai')) {
    throw new Error('TokenFlux traffic must use https://tokenflux.dev/v1')
  }
  if (host === 'tokenflux.dev' && parsed.origin + parsed.pathname.replace(/\/$/, '') !== TOKENFLUX_BASE_URL) {
    throw new Error(`official TokenFlux endpoint must be ${TOKENFLUX_BASE_URL}`)
  }
}

export function resetProductLoopLocalSecrets() {
  for (const name of Object.keys(heldSecrets)) delete heldSecrets[name]
}

export function productLoopLocalSecret(name) {
  if (!PRODUCT_LOOP_LOCAL_SECRET_KEYS.includes(name)) return ''
  return String(heldSecrets[name] ?? '').trim()
}

function officialTokenFluxURL(url) {
  try {
    return new URL(String(url ?? '').trim()).hostname.toLowerCase() === 'tokenflux.dev'
  } catch {
    return false
  }
}

function pushRelayAttempt(attempts, item) {
  const name = String(item?.name ?? '').trim()
  const value = String(item?.value ?? '').trim()
  const baseUrl = String(item?.baseUrl ?? '').trim()
  const model = String(item?.model ?? '').trim()
  if (!name || !value || !baseUrl || !model) return
  if (attempts.some(row => row.name === name && row.baseUrl === baseUrl && row.model === model)) return
  attempts.push({ name, value, baseUrl, model })
}

export function productLoopRelayAttempts(env = process.env) {
  const configuredUrl = String(env.CUSTOM_RELAY_BASE_URL ?? '').trim() || TOKENFLUX_BASE_URL
  const configuredModels = resolveCustomRelayModels(env)
  const tokenflux = productLoopLocalSecret('TOKENFLUX_API_KEY')
  const deepseek = productLoopLocalSecret('DEEPSEEK_API_KEY')
  const attempts = []
  if (officialTokenFluxURL(configuredUrl)) {
    pushRelayAttempt(attempts, {
      name: 'DEEPSEEK_API_KEY',
      value: deepseek,
      baseUrl: DEEPSEEK_OFFICIAL_BASE_URL,
      model: DEEPSEEK_OFFICIAL_MODEL,
    })
    pushRelayAttempt(attempts, {
      name: 'TOKENFLUX_API_KEY',
      value: tokenflux,
      baseUrl: configuredUrl,
      model: configuredModels || TOKENFLUX_CATALOG_DEFAULT_MODEL,
    })
    return attempts
  }
  const model = configuredModels || DEEPSEEK_OFFICIAL_MODEL
  pushRelayAttempt(attempts, {
    name: 'DEEPSEEK_API_KEY',
    value: deepseek,
    baseUrl: configuredUrl,
    model,
  })
  pushRelayAttempt(attempts, {
    name: 'TOKENFLUX_API_KEY',
    value: tokenflux,
    baseUrl: configuredUrl,
    model,
  })
  return attempts
}

export function productLoopRelayCredential() {
  const attempt = productLoopRelayAttempts()[0]
  if (!attempt) return { name: '', value: '' }
  return { name: attempt.name, value: attempt.value }
}

function holdSecret(name, value) {
  const next = String(value ?? '').trim()
  if (!PRODUCT_LOOP_LOCAL_SECRET_KEYS.includes(name) || !next) return false
  heldSecrets[name] = next
  return true
}

function captureEnvSecrets(env = process.env) {
  for (const name of PRODUCT_LOOP_LOCAL_SECRET_KEYS) {
    if (productLoopLocalSecret(name)) continue
    holdSecret(name, env[name])
  }
}

export async function applyProductLoopLocalEnv(env = process.env, options = {}) {
  const path = options.path ?? productLoopLocalEnvPath(options.root)
  let text
  try {
    text = await readFile(path, 'utf8')
  } catch (error) {
    if (error && error.code === 'ENOENT') {
      captureEnvSecrets(env)
      return { loaded: false, applied: [], unknown: [], path }
    }
    throw error
  }
  const parsed = parseProductLoopLocalEnv(text)
  const applied = []
  for (const [name, value] of Object.entries(parsed.values)) {
    if (PRODUCT_LOOP_LOCAL_SECRET_KEYS.includes(name)) {
      if (holdSecret(name, value)) applied.push(name)
      continue
    }
    if (String(env[name] ?? '').trim()) continue
    env[name] = value
    applied.push(name)
  }
  captureEnvSecrets(env)
  const models = resolveCustomRelayModels(env)
  if (models && !String(env.CUSTOM_RELAY_MODELS ?? '').trim()) {
    env.CUSTOM_RELAY_MODELS = models
    applied.push('CUSTOM_RELAY_MODELS')
  }
  return { loaded: true, applied, unknown: parsed.unknown, path }
}

export function resolveCustomRelayModels(env = process.env) {
  const listed = String(env.CUSTOM_RELAY_MODELS ?? '').trim()
  if (listed) return listed
  const url = String(env.CUSTOM_RELAY_BASE_URL ?? '').trim() || TOKENFLUX_BASE_URL
  try {
    assertAllowedRelayURL(url)
  } catch {
    return ''
  }
  let parsed
  try {
    parsed = new URL(url)
  } catch {
    return ''
  }
  if (parsed.hostname.toLowerCase() !== 'tokenflux.dev') return ''
  return TOKENFLUX_CATALOG_DEFAULT_MODEL
}

export function describeProductLoopLocalEnv(applied = {}) {
  const names = [...(applied.applied ?? [])].filter(name => ALLOWED_KEYS.has(name))
  const publicValues = {}
  const env = applied.env ?? process.env
  for (const name of PRODUCT_LOOP_LOCAL_PUBLIC_KEYS) {
    const value = String(env[name] ?? '').trim()
    if (value) publicValues[name] = value
  }
  return {
    loaded: Boolean(applied.loaded),
    applied: names,
    unknown: [...(applied.unknown ?? [])],
    publicValues,
  }
}
