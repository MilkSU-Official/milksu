import { createHash } from 'node:crypto'
import { mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync, closeSync } from 'node:fs'
import { join } from 'node:path'
import { RESEARCH_RUN_ID_PATTERN } from './types.ts'

export type Artifact = {
  sha256: string
  mediaType: string
  relativePath: string
}

function validateIdentifier(label: string, value: string): void {
  if (!RESEARCH_RUN_ID_PATTERN.test(value)) {
    throw new Error(`invalid ${label}`)
  }
}

function verifyFile(path: string, expected: string): void {
  const data = readFileSync(path)
  const digest = createHash('sha256').update(data).digest('hex')
  if (digest !== expected) throw new Error('artifact digest mismatch')
}

export class ArtifactStore {
  readonly root: string

  constructor(root: string) {
    this.root = root
    mkdirSync(root, { recursive: true, mode: 0o700 })
  }

  admit(jobId: string, source: string, mediaType: string, data: Uint8Array): Artifact {
    if (!source) throw new Error('artifact source is required')
    validateIdentifier('job id', jobId)
    if (!mediaType) throw new Error('artifact media type is required')
    const digest = createHash('sha256').update(data).digest('hex')
    const directory = join(this.root, jobId)
    mkdirSync(directory, { recursive: true, mode: 0o700 })
    const filePath = join(directory, digest)
    try {
      const fd = openSync(filePath, 'wx', 0o600)
      try {
        writeSync(fd, data)
      } finally {
        closeSync(fd)
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'EEXIST') throw new Error(`create artifact: ${error instanceof Error ? error.message : error}`)
      verifyFile(filePath, digest)
    }
    return {
      sha256: digest,
      mediaType,
      relativePath: `${jobId}/${digest}`,
    }
  }

  read(jobId: string, sha256: string): Buffer {
    validateIdentifier('job id', jobId)
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new Error('invalid artifact digest')
    const filePath = join(this.root, jobId, sha256)
    try {
      statSync(filePath)
    } catch {
      throw new Error('read artifact: file does not exist')
    }
    verifyFile(filePath, sha256)
    return readFileSync(filePath)
  }

  removeJob(jobId: string): void {
    validateIdentifier('job id', jobId)
    rmSync(join(this.root, jobId), { recursive: true, force: true })
  }
}
