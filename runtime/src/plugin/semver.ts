const STRICT_SEMVER = /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:-((?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9][0-9]*|[0-9A-Za-z-]*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/

export type SemanticVersion = {
  major: number
  minor: number
  patch: number
  prerelease: string[]
}

export function parseSemanticVersion(value: string): SemanticVersion {
  const match = STRICT_SEMVER.exec(String(value ?? '').trim())
  if (!match) throw new Error(`"${value}" is not strict semantic versioning`)
  const parts = [match[1], match[2], match[3]].map((part) => {
    const parsed = Number(part)
    if (!Number.isSafeInteger(parsed)) throw new Error('semantic version component is too large')
    return parsed
  })
  return {
    major: parts[0]!,
    minor: parts[1]!,
    patch: parts[2]!,
    prerelease: match[4] ? match[4].split('.') : [],
  }
}

export function compareSemanticVersions(leftValue: string, rightValue: string): number {
  const left = parseSemanticVersion(leftValue)
  const right = parseSemanticVersion(rightValue)
  for (const [a, b] of [[left.major, right.major], [left.minor, right.minor], [left.patch, right.patch]] as const) {
    if (a < b) return -1
    if (a > b) return 1
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  const limit = Math.min(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < limit; index += 1) {
    const leftPart = left.prerelease[index]!
    const rightPart = right.prerelease[index]!
    if (leftPart === rightPart) continue
    const leftNumber = Number(leftPart)
    const rightNumber = Number(rightPart)
    const leftIsNumber = /^\d+$/.test(leftPart) && Number.isSafeInteger(leftNumber)
    const rightIsNumber = /^\d+$/.test(rightPart) && Number.isSafeInteger(rightNumber)
    if (leftIsNumber && rightIsNumber) return leftNumber < rightNumber ? -1 : 1
    if (leftIsNumber) return -1
    if (rightIsNumber) return 1
    return leftPart < rightPart ? -1 : 1
  }
  if (left.prerelease.length < right.prerelease.length) return -1
  if (left.prerelease.length > right.prerelease.length) return 1
  return 0
}
