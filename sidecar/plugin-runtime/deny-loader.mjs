import { pathToFileURL } from 'node:url'

const workerURL = process.env.MILKSU_PLUGIN_WORKER_URL
const entryURL = process.env.MILKSU_PLUGIN_ENTRY_URL

function asFileURL(specifier) {
  if (specifier.startsWith('file:')) return specifier
  if (specifier.startsWith('/') || /^[A-Za-z]:[\\/]/u.test(specifier)) {
    try {
      return pathToFileURL(specifier).href
    } catch {
      return ''
    }
  }
  return ''
}

export async function resolve(specifier, context) {
  if (!workerURL || !entryURL) throw new Error('plugin module guard is not configured')
  if (context.parentURL === entryURL) {
    throw new Error(`plugin bundle must be self-contained; import denied: ${specifier}`)
  }
  // Node 26 defaultResolve realpathSyncs before --allow-fs-read can see the
  // target. Short-circuit known worker, entry, and node: specifiers so the
  // permission model still gates file reads without the resolver probe.
  if (specifier.startsWith('node:')) {
    return { url: specifier, shortCircuit: true }
  }
  const specifierURL = specifier === workerURL || specifier === entryURL
    ? specifier
    : asFileURL(specifier)
  if (specifierURL === workerURL) {
    if (context.parentURL && context.parentURL !== workerURL) {
      throw new Error(`plugin worker import denied: ${specifier}`)
    }
    return { url: workerURL, shortCircuit: true }
  }
  if (specifierURL === entryURL) {
    if (context.parentURL && context.parentURL !== workerURL) {
      throw new Error(`plugin worker import denied: ${specifier}`)
    }
    return { url: entryURL, shortCircuit: true }
  }
  if (!context.parentURL) {
    throw new Error('only the MilkSU plugin worker may be used as the runtime entry')
  }
  if (context.parentURL === workerURL) {
    throw new Error(`plugin worker import denied: ${specifier}`)
  }
  throw new Error(`plugin bundle must be self-contained; import denied: ${specifier}`)
}
