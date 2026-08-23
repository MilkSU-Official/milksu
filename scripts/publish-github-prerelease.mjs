#!/usr/bin/env node

/**
 * Create (or refresh) the GitHub prerelease page for the verified source commit.
 *
 * A bare `git tag` is not enough for QQ / installer distribution — this step
 * creates the Releases page and attaches DMG / EXE / DEB (+ SHA256SUMS).
 *
 * Defaults look under build/release/github/{macos,windows,linux}/ after
 * `npm run release:collect`, and still accept a DMG in build/release/.
 *
 * Usage:
 *   npm run release:github -- \
 *     --release-title "MilkSU 26.818.1 内测版" \
 *     --release-notes "…"
 */

import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { access, mkdir, readFile, readdir, writeFile } from 'node:fs/promises'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const repository = 'MilkSU-Official/milksu'
const receiptPath = join(repositoryRoot, 'build', 'test-results', 'release-source-verification.json')
const releaseDir = join(repositoryRoot, 'build', 'release')
const stagingDir = join(releaseDir, 'github')

function option(name, fallback = '') {
  const prefix = `--${name}=`
  const inline = process.argv.find(argument => argument.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 && process.argv[index + 1] ? process.argv[index + 1] : fallback
}

function run(command, args) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { cwd: repositoryRoot, stdio: 'inherit' })
    child.once('error', rejectPromise)
    child.once('exit', code => code === 0
      ? resolvePromise()
      : rejectPromise(new Error(`${command} exited with status ${code}`)))
  })
}

async function digestSha256(file) {
  const hash = createHash('sha256')
  await new Promise((resolvePromise, rejectPromise) => {
    const stream = createReadStream(file)
    stream.on('data', chunk => hash.update(chunk))
    stream.once('end', resolvePromise)
    stream.once('error', rejectPromise)
  })
  return hash.digest('hex')
}

async function findOne(directory, predicate) {
  try {
    const names = await readdir(directory)
    const match = names.find(predicate)
    return match ? join(directory, match) : ''
  } catch {
    return ''
  }
}

async function resolveArtifacts(version) {
  const macExplicit = option('mac')
  const winExplicit = option('windows')
  const linuxExplicit = option('linux')
  const mac = macExplicit || await findOne(
    join(stagingDir, 'macos'),
    name => name === `MilkSU-macOS-arm64-${version}.dmg`,
  ) || await findOne(
    releaseDir,
    name => name === `MilkSU-macOS-arm64-${version}.dmg`,
  )
  const windows = winExplicit || await findOne(
    join(stagingDir, 'windows'),
    name => name === `MilkSU-Windows-x64-${version}-Setup.exe`,
  ) || await findOne(
    stagingDir,
    name => name === `MilkSU-Windows-x64-${version}-Setup.exe`,
  )
  const linux = linuxExplicit || await findOne(
    join(stagingDir, 'linux'),
    name => name === `MilkSU-Linux-x64-${version}.deb`,
  ) || await findOne(
    stagingDir,
    name => name === `MilkSU-Linux-x64-${version}.deb`,
  )
  const missing = [
    ['mac', mac],
    ['windows', windows],
    ['linux', linux],
  ].filter(([, path]) => !path)
  if (missing.length) {
    throw new Error(
      `missing installer(s): ${missing.map(([name]) => name).join(', ')}. `
      + 'Pass --mac/--windows/--linux or place versioned files under build/release/.',
    )
  }
  for (const path of [mac, windows, linux]) await access(path)
  return { mac, windows, linux }
}

async function main() {
  const rootPackage = JSON.parse(await readFile(join(repositoryRoot, 'package.json'), 'utf8'))
  const version = String(rootPackage.version ?? '').trim()
  if (!/^\d+\.\d+\.\d+$/u.test(version)) {
    throw new Error('root package.json version must be a stable semantic version')
  }

  const receipt = JSON.parse(await readFile(receiptPath, 'utf8'))
  if (receipt?.passed !== true || receipt?.version !== version || !/^[0-9a-f]{40}$/u.test(receipt?.commit ?? '')) {
    throw new Error('release verification receipt is missing, failed, or does not match the current version')
  }
  const { stdout: head } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: repositoryRoot })
  const headCommit = head.trim()
  // Default to the verified receipt commit (the packaged source), not necessarily HEAD
  // when docs-only follow-ups landed after packaging.
  const commit = option('source-commit', receipt.commit)
  if (commit !== receipt.commit) {
    throw new Error(`--source-commit ${commit} does not match receipt commit ${receipt.commit}`)
  }
  if (commit !== headCommit) {
    process.stdout.write(
      `note: packaging source ${commit.slice(0, 7)} differs from HEAD ${headCommit.slice(0, 7)}; `
      + 'using the verified receipt commit for the release target\n',
    )
  }

  const artifacts = await resolveArtifacts(version)
  await mkdir(stagingDir, { recursive: true })
  const sumsPath = join(stagingDir, `SHA256SUMS-${version}.txt`)
  const lines = []
  for (const path of [artifacts.mac, artifacts.windows, artifacts.linux]) {
    lines.push(`${await digestSha256(path)}  ${basename(path)}`)
  }
  await writeFile(sumsPath, `${lines.join('\n')}\n`)

  const tag = `v${version}`
  const title = option('release-title', `MilkSU ${version} 内测版`)
  const notes = option(
    'release-notes',
    [
      `MilkSU ${version} 内测版`,
      '',
      `源 commit：\`${commit}\``,
      '',
      '### 安装包',
      `| 平台 | 文件 |`,
      `| --- | --- |`,
      `| macOS ARM64 | \`${basename(artifacts.mac)}\` |`,
      `| Windows x64 | \`${basename(artifacts.windows)}\` |`,
      `| Linux x64 | \`${basename(artifacts.linux)}\` |`,
    ].join('\n'),
  )

  // Prefer editing an existing release page; otherwise create one (never leave a bare tag).
  let releaseExists = false
  try {
    await execFileAsync('gh', ['release', 'view', tag, '--repo', repository], { cwd: repositoryRoot })
    releaseExists = true
  } catch {
    releaseExists = false
  }

  if (releaseExists) {
    await run('gh', [
      'release', 'edit', tag,
      '--repo', repository,
      '--title', title,
      '--notes', notes,
      '--prerelease',
    ])
  } else {
    await run('gh', [
      'release', 'create', tag,
      '--repo', repository,
      '--target', commit,
      '--title', title,
      '--notes', notes,
      '--prerelease',
    ])
  }

  // Replace installers so versioned names win over any legacy unversioned macOS DMG.
  await run('gh', [
    'release', 'upload', tag,
    '--repo', repository,
    '--clobber',
    artifacts.mac,
    artifacts.windows,
    artifacts.linux,
    sumsPath,
  ])

  // Best-effort cleanup of the old unversioned macOS asset name.
  try {
    await execFileAsync('gh', [
      'release', 'delete-asset', tag, 'MilkSU-macOS-arm64.dmg',
      '--repo', repository,
      '--yes',
    ], { cwd: repositoryRoot })
  } catch {
    // Asset may already be absent.
  }

  process.stdout.write(`https://github.com/${repository}/releases/tag/${tag}\n`)
}

await main()
