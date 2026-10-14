import { copyFile, lstat, mkdir, open, readdir, stat } from 'node:fs/promises'
import { dirname, extname, isAbsolute, join, relative } from 'node:path'
import { MAX_ARTIFACT_IMAGE_PREVIEW_BYTES } from './artifacts.ts'
import {
  artifactImageMediaType,
  detectContentType,
  fromSlash,
  isMilkSUInternalPath,
  resolveArtifactPreviewPath,
  resolveWorkspace,
  toSlash,
} from './paths.ts'

const imageGalleryExtensions = new Set(['.gif', '.jpeg', '.jpg', '.png', '.webp'])
const MAX_GALLERY_IMAGES = 48
const MAX_IMAGE_SCAN_ENTRIES = 8000
const MAX_IMAGE_SCAN_DEPTH = 8
const IMAGE_RECENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function isGalleryImagePath(path: string): boolean {
  return imageGalleryExtensions.has(extname(path).toLowerCase())
}

function isGalleryNoisePath(path: string): boolean {
  for (const segment of toSlash(path).split('/')) {
    if (['dist', 'build', 'coverage', 'node_modules', '.next', 'target'].includes(segment)) return true
  }
  return false
}

type ImageCandidate = { path: string; modified: number }

class ImageScan {
  workspace: string
  budget: number
  seen: Set<string>
  notBefore: number
  candidates: ImageCandidate[] = []

  constructor(workspace: string, budget: number, seen: Set<string>, notBefore: number) {
    this.workspace = workspace
    this.budget = budget
    this.seen = seen
    this.notBefore = notBefore
  }

  async classifyRoots(roots: string[]): Promise<{ directories: string[]; files: string[] }> {
    const ordered: Array<{ path: string; modified: number }> = []
    const files: string[] = []
    const seenRoot = new Set<string>()
    for (const root of roots) {
      const path = join(this.workspace, fromSlash(root))
      if (seenRoot.has(path)) continue
      seenRoot.add(path)
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
    if (!isGalleryImagePath(path) || isMilkSUInternalPath(path) || isGalleryNoisePath(path)) return
    if (this.seen.has(path)) return
    this.candidates.push({ path, modified: Math.floor(modifiedMs / 1000) })
  }

  async walk(directory: string, depth: number): Promise<void> {
    if (this.budget <= 0 || depth > MAX_IMAGE_SCAN_DEPTH) return
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
      if (name === '.git' || name === 'node_modules' || name === '.milksu' || isGalleryNoisePath(name)) continue
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

export async function discoverImages(
  workspace: string,
  changes: Array<{ path: string }>,
  scanRoots: string[],
): Promise<string[]> {
  const seen = new Set<string>()
  const paths: string[] = []
  for (const change of changes) {
    const path = toSlash(change.path.trim())
    if (!path || !isGalleryImagePath(path) || isMilkSUInternalPath(path) || isGalleryNoisePath(path)) continue
    if (seen.has(path)) continue
    seen.add(path)
    paths.push(path)
    if (paths.length >= MAX_GALLERY_IMAGES) return paths
  }
  const roots = [...scanRoots, 'generated', 'images', 'assets']
  const scan = new ImageScan(
    workspace,
    MAX_IMAGE_SCAN_ENTRIES,
    seen,
    Date.now() - IMAGE_RECENCY_WINDOW_MS,
  )
  const { directories, files } = await scan.classifyRoots(roots)
  for (const file of files) await scan.consider(file)
  for (const directory of directories) await scan.walk(directory, 0)
  for (const found of scan.newestFirst()) {
    if (seen.has(found)) continue
    seen.add(found)
    paths.push(found)
    if (paths.length >= MAX_GALLERY_IMAGES) break
  }
  return paths
}

export async function workspaceImageFile(workspace: string, relativePath: string): Promise<string> {
  const resolvedWorkspace = await resolveWorkspace(workspace)
  const { cleaned, absolute } = await resolveArtifactPreviewPath(resolvedWorkspace, relativePath)
  const expected = artifactImageMediaType(extname(cleaned).toLowerCase())
  if (!expected) throw new Error('workspace image must be PNG, JPEG, GIF, or WebP')
  const handle = await open(absolute, 'r')
  try {
    const info = await handle.stat()
    if (!info.isFile()) throw new Error('workspace image is not a regular file')
    if (info.size <= 0 || info.size > MAX_ARTIFACT_IMAGE_PREVIEW_BYTES) {
      throw new Error('workspace image has an invalid size')
    }
    const header = Buffer.alloc(512)
    const read = await handle.read(header, 0, 512, 0)
    const detected = detectContentType(header.subarray(0, read.bytesRead))
    if (detected !== expected) {
      throw new Error(`workspace image content type ${JSON.stringify(detected)} does not match ${extname(cleaned)}`)
    }
  } finally {
    await handle.close()
  }
  return absolute
}

export async function copyRegularFile(source: string, destination: string): Promise<void> {
  const sourceInfo = await lstat(source)
  if (!sourceInfo.isFile()) throw new Error('image source is not a regular file')
  const dest = destination.trim()
  if (!dest) throw new Error('image destination is empty')
  if (!isAbsolute(dest)) throw new Error('image destination must be absolute')
  const cleanedDest = dest
  const cleanedSource = source
  if (cleanedSource === cleanedDest) throw new Error('image destination is the source file')
  await mkdir(dirname(cleanedDest), { recursive: true, mode: 0o755 })
  await copyFile(cleanedSource, cleanedDest)
}

export function imageSaveFilter(absolute: string): { name: string; extensions: string[] } {
  switch (extname(absolute).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return { name: 'JPEG', extensions: ['jpg', 'jpeg'] }
    case '.gif':
      return { name: 'GIF', extensions: ['gif'] }
    case '.webp':
      return { name: 'WebP', extensions: ['webp'] }
    default:
      return { name: 'PNG', extensions: ['png'] }
  }
}
