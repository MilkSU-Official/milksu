/**
 * Unpackaged desktop:start needs these files on disk.
 * --no-build skips compile; missing any of them exits immediately.
 */

import { stat } from 'node:fs/promises'
import { join } from 'node:path'

export function desktopDevArtifactPaths(root) {
  return {
    runtime: join(root, 'runtime', 'dist', 'main.cjs'),
    renderer: join(root, 'app', 'dist', 'index.html'),
    electron: join(root, 'desktop', 'node_modules', 'electron'),
  }
}

export async function missingDesktopDevArtifacts(root) {
  const missing = []
  for (const [name, candidate] of Object.entries(desktopDevArtifactPaths(root))) {
    try {
      await stat(candidate)
    } catch {
      missing.push(name)
    }
  }
  return missing
}

export function formatMissingDesktopDevArtifacts(missing) {
  if (!Array.isArray(missing) || missing.length === 0) return ''
  const parts = [`desktop:start --no-build missing ${missing.join(', ')}`]
  if (missing.includes('electron')) parts.push('run npm --prefix desktop install')
  if (missing.some(name => name !== 'electron')) {
    parts.push('run npm run desktop:build-dev')
  }
  return parts.join('; ')
}
