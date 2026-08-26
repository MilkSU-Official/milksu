import { readFile } from 'node:fs/promises'

export function renderLinuxPkgbuild({ version, sha256, template }) {
  if (!/^\d+\.\d+\.\d+$/u.test(String(version ?? ''))) {
    throw new Error(`invalid Linux package version: ${version}`)
  }
  if (!/^[0-9a-f]{64}$/u.test(String(sha256 ?? ''))) {
    throw new Error('Linux PKGBUILD sha256 must be 64 hex characters')
  }
  return String(template)
    .replaceAll('@VERSION@', version)
    .replaceAll('@SHA256@', sha256)
}

export async function readLinuxPkgbuildTemplate(path) {
  return readFile(path, 'utf8')
}
