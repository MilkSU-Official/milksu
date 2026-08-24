const workerURL = process.env.MILKSU_PLUGIN_WORKER_URL
const entryURL = process.env.MILKSU_PLUGIN_ENTRY_URL

export async function resolve(specifier, context, nextResolve) {
  if (!workerURL || !entryURL) throw new Error('plugin module guard is not configured')
  if (context.parentURL === entryURL) {
    throw new Error(`plugin bundle must be self-contained; import denied: ${specifier}`)
  }
  const resolved = await nextResolve(specifier, context)
  if (!context.parentURL && resolved.url !== workerURL) {
    throw new Error('only the MilkSU plugin worker may be used as the runtime entry')
  }
  if (context.parentURL === workerURL && resolved.url !== entryURL && !resolved.url.startsWith('node:')) {
    throw new Error(`plugin worker import denied: ${specifier}`)
  }
  return resolved
}
