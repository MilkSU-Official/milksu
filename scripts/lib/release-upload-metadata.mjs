import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { stat, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'

export const RELEASE_UPLOAD_SCHEMA = 'milksu.release-upload/v2'

export function hashFile(file, algorithm, encoding) {
  const hash = createHash(algorithm)
  return new Promise((resolve, reject) => {
    const stream = createReadStream(file)
    stream.on('data', chunk => hash.update(chunk))
    stream.once('end', () => resolve(hash.digest(encoding)))
    stream.once('error', reject)
  })
}

export async function writeReleaseUploadMetadata({
  releaseDirectory,
  platform,
  arch,
  version,
  tracking,
  artifacts,
}) {
  const objectPrefix = `releases/stable/${platform}/${arch}/${version}`
  const mapped = []
  for (const artifact of artifacts) {
    const filePath = join(releaseDirectory, artifact.fileName)
    const size = (await stat(filePath)).size
    const entry = {
      kind: artifact.kind,
      fileName: basename(filePath),
      objectKey: `${objectPrefix}/${basename(filePath)}`,
      sha256: await hashFile(filePath, 'sha256', 'hex'),
      size,
    }
    if (artifact.kind === 'zip' || artifact.kind === 'nsis') {
      entry.sha512 = await hashFile(filePath, 'sha512', 'base64')
    }
    mapped.push(entry)
  }
  const metadata = {
    schema: RELEASE_UPLOAD_SCHEMA,
    channel: 'stable',
    platform,
    arch,
    version,
    minimumVersion: String(process.env.MILKSU_MINIMUM_UPDATE_VERSION ?? '0.1.0').trim() || '0.1.0',
    commitSha: String(tracking.gitCommit ?? ''),
    trackingId: String(tracking.trackingId ?? ''),
    title: String(process.env.MILKSU_RELEASE_TITLE ?? `MilkSU ${version}`).trim() || `MilkSU ${version}`,
    notes: String(process.env.MILKSU_RELEASE_NOTES ?? `MilkSU ${version}`).trim() || `MilkSU ${version}`,
    artifacts: mapped,
    manifestObjectKey: `${objectPrefix}/release-metadata.json`,
  }
  const metadataPath = join(releaseDirectory, 'release-metadata.json')
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 })
  return metadataPath
}
