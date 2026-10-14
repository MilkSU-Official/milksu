import { lstat, readdir, readFile, stat } from 'node:fs/promises'
import { extname, join, relative } from 'node:path'
import {
  artifactImageMediaType,
  detectContentType,
  fromSlash,
  isMilkSUInternalPath,
  resolveArtifactPreviewPath,
  resolveWorkspace,
  toSlash,
} from './paths.ts'

const suggestedArtifactExtensions = new Set([
  '.csv', '.diff', '.gif', '.htm', '.html', '.jpeg', '.jpg', '.json', '.log',
  '.markdown', '.md', '.patch', '.png', '.txt', '.webp', '.xml', '.yaml', '.yml',
])

const MAX_SUGGESTED_ARTIFACTS = 12
const MAX_ARTIFACT_SCAN_ENTRIES = 6000
const MAX_ARTIFACT_SCAN_DEPTH = 6
const ARTIFACT_RECENCY_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_ARTIFACT_TEXT_PREVIEW_BYTES = 2 << 20
const MAX_ARTIFACT_IMAGE_PREVIEW_BYTES = 8 << 20

export type ArtifactPreview = {
  relativePath: string
  kind: string
  mediaType: string
  content?: string
  dataUrl?: string
  sizeBytes: number
}

type ArtifactCandidate = { path: string; modified: number }

function isSuggestedArtifactPath(path: string): boolean {
  return suggestedArtifactExtensions.has(extname(path).toLowerCase())
}

class ArtifactScan {
  workspace: string
  budget: number
  seen: Set<string>
  notBefore: number
  candidates: ArtifactCandidate[] = []

  constructor(workspace: string, budget: number, seen: Set<string>, notBefore: number) {
    this.workspace = workspace
    this.budget = budget
    this.seen = seen
    this.notBefore = notBefore
  }

  async classifyRoots(roots: string[]): Promise<{ directories: string[]; files: string[] }> {
    const ordered: Array<{ path: string; modified: number }> = []
    const files: string[] = []
    for (const root of roots) {
      const path = join(this.workspace, fromSlash(root))
      let info
      try {
        info = await stat(path)
      } catch {
        continue
      }
      if (info.isDirectory()) {
        ordered.push({ path, modified: Math.floor(info.mtimeMs / 1000) })
        continue
      }
      if (info.isFile()) files.push(path)
    }
    ordered.sort((a, b) => b.modified - a.modified)
    return { directories: ordered.map((item) => item.path), files }
  }

  async consider(path: string): Promise<void> {
    let info
    try {
      info = await lstat(path)
    } catch {
      return
    }
    if (!info.isFile()) return
    const rel = relative(this.workspace, path)
    if (!rel) return
    this.record(toSlash(rel), info.mtimeMs)
  }

  record(path: string, modifiedMs: number): void {
    if (modifiedMs < this.notBefore) return
    if (!isSuggestedArtifactPath(path) || isMilkSUInternalPath(path)) return
    if (this.seen.has(path)) return
    this.seen.add(path)
    this.candidates.push({ path, modified: Math.floor(modifiedMs / 1000) })
  }

  async walk(directory: string, depth: number): Promise<void> {
    if (this.budget <= 0 || depth > MAX_ARTIFACT_SCAN_DEPTH) return
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      return
    }
    const directories: Array<{ name: string; modified: number }> = []
    for (const entry of entries) {
      if (this.budget <= 0) return
      this.budget -= 1
      const name = entry.name
      if (name === '.git' || name === '.milksu') continue
      let info
      try {
        info = await stat(join(directory, name))
      } catch {
        continue
      }
      if (entry.isDirectory()) {
        directories.push({ name, modified: Math.floor(info.mtimeMs / 1000) })
        continue
      }
      if (!info.isFile()) continue
      const rel = relative(this.workspace, join(directory, name))
      if (!rel) continue
      this.record(toSlash(rel), info.mtimeMs)
    }
    directories.sort((a, b) => b.modified - a.modified)
    for (const entry of directories) {
      await this.walk(join(directory, entry.name), depth + 1)
    }
  }

  newestFirst(): string[] {
    this.candidates.sort((a, b) => {
      if (a.modified !== b.modified) return b.modified - a.modified
      return a.path < b.path ? -1 : a.path > b.path ? 1 : 0
    })
    return this.candidates.map((item) => item.path)
  }
}

export async function discoverArtifacts(
  workspace: string,
  changes: Array<{ path: string }>,
  scanRoots: string[],
): Promise<string[]> {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const change of changes) {
    const path = toSlash(change.path.trim())
    if (!path || !isSuggestedArtifactPath(path)) continue
    if (seen.has(path)) continue
    seen.add(path)
    paths.push(path)
    if (paths.length >= MAX_SUGGESTED_ARTIFACTS) return paths
  }
  const scan = new ArtifactScan(
    workspace,
    MAX_ARTIFACT_SCAN_ENTRIES,
    seen,
    Date.now() - ARTIFACT_RECENCY_WINDOW_MS,
  )
  const { directories, files } = await scan.classifyRoots(scanRoots)
  for (const file of files) await scan.consider(file)
  for (const directory of directories) await scan.walk(directory, 0)
  for (const found of scan.newestFirst()) {
    paths.push(found)
    if (paths.length >= MAX_SUGGESTED_ARTIFACTS) break
  }
  return paths
}

export async function inspectArtifactPreview(
  workspace: string,
  relativePath: string,
): Promise<ArtifactPreview> {
  const resolvedWorkspace = await resolveWorkspace(workspace)
  const { cleaned, absolute } = await resolveArtifactPreviewPath(resolvedWorkspace, relativePath)
  const extension = extname(cleaned).toLowerCase()
  const preview: ArtifactPreview = { relativePath: toSlash(cleaned), kind: 'text', mediaType: 'text/plain', sizeBytes: 0 }
  let limit = MAX_ARTIFACT_TEXT_PREVIEW_BYTES
  switch (extension) {
    case '.md':
    case '.markdown':
      preview.kind = 'markdown'
      preview.mediaType = 'text/markdown'
      break
    case '.html':
    case '.htm':
      preview.kind = 'html'
      preview.mediaType = 'text/html'
      break
    case '.png':
    case '.jpg':
    case '.jpeg':
    case '.gif':
    case '.webp':
      preview.kind = 'image'
      limit = MAX_ARTIFACT_IMAGE_PREVIEW_BYTES
      break
    default:
      break
  }
  const data = await readFile(absolute)
  const info = await lstat(absolute)
  if (!info.isFile()) throw new Error('artifact preview is not a regular file')
  if (info.size > limit || data.length > limit) {
    throw new Error(`artifact preview exceeds ${limit} bytes`)
  }
  preview.sizeBytes = data.length
  if (preview.kind !== 'image') {
    const text = data.toString('utf8')
    if (data.includes(0) || Buffer.byteLength(text, 'utf8') !== data.length) {
      throw new Error('artifact preview text must be valid UTF-8')
    }
    preview.content = text
    return preview
  }
  const detected = detectContentType(data)
  const expected = artifactImageMediaType(extension)
  if (detected !== expected) {
    throw new Error(`artifact preview content type ${JSON.stringify(detected)} does not match ${extension}`)
  }
  preview.mediaType = detected
  preview.dataUrl = `data:${detected};base64,${data.toString('base64')}`
  return preview
}

export { MAX_ARTIFACT_IMAGE_PREVIEW_BYTES }
