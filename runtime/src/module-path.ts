import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export function moduleDirectory(metaUrl?: string): string {
  try {
    if (typeof __dirname === 'string' && __dirname) return __dirname
  } catch {
    // ESM tests have no __dirname
  }
  try {
    const url = metaUrl || import.meta.url
    if (url) return dirname(fileURLToPath(url))
  } catch {
    // CJS bundle has no import.meta
  }
  return process.cwd()
}

export function createRequireFromModule(metaUrl?: string): NodeJS.Require {
  let filename = ''
  try {
    if (typeof __filename === 'string' && __filename) filename = __filename
  } catch {
    filename = ''
  }
  if (!filename) {
    try {
      const url = metaUrl || import.meta.url
      if (url) filename = fileURLToPath(url)
    } catch {
      filename = ''
    }
  }
  if (!filename) filename = join(process.cwd(), 'package.json')
  return createRequire(filename)
}
