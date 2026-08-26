import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  readdir,
  writeFile,
} from 'node:fs/promises'
import { createServer as createHttpServer } from 'node:http'
import { createConnection, createServer as createNetServer } from 'node:net'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'
import { firstPartyCodingSkillNames } from '../sidecar/pi/bridge-skills.js'
import { prepareReviewedTypeScript } from '../sidecar/pi/prepare-reviewed-ts.mjs'
import { buildWindowsCuaDriver } from './build-windows-cua-driver.mjs'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeVersion = '24.18.0'
const archifyCommit = '7b49d0b715fd4ba48116bcdecd1ba3789a279613'
const piVersion = '0.84.1'
const piLspVersion = '0.29.0'
const piGoalVersion = '0.43.0'
const piBackgroundTasksVersion = '0.1.10'
const piMcpAdapterVersion = '2.17.0'
const piSubAgentVersion = '0.1.5'
const piSubAgentIntegrity = 'sha512-ILgmYfAhP1nzpz7oLLN/lSFrwwigS0hfEKc8NppdkajCX2n2L5RVphG/cQnAWPlfKBXiOovqK8qNwksP1Y4pzw=='
const playwrightMcpVersion = '0.0.78'
const playwrightVersion = '1.62.0-alpha-1783623505000'
const playwrightSocketRoot = '/private/tmp/milksu-playwright'
const cuaDriverVersion = '0.14.2'
const cuaDriverTag = `cua-driver-rs-v${cuaDriverVersion}`
const cuaDriverSourceCommit = 'ed9d5efcf5f261f4854bf2de0ba06a2b0b4419c4'
const cuaDriverArchive = {
  file: `cua-driver-rs-${cuaDriverVersion}-darwin-universal-binary.tar.gz`,
  sha256: '31209b5f460aa7af69208b11718d45c5e8dc2c02fbdb2c95f34b46f5ec73a3a9',
}
const cuaDriverBinarySha256 = 'd691969c11ea5228604ff6e56d876045305bb9c25ea7efb4c2fb358c18c23ed2'
const cuaSessionPolicyPath = join(
  repositoryRoot,
  'internal',
  'computercap',
  'session-policy.yaml',
)
const computerUsePackagedSmokeTarget = {
  name: 'External Preview Fixture',
  bundleId: 'com.example.preview',
  pidOffset: 200,
  windowId: 9001,
}
const stableCodesignRequired = boolEnv(process.env.MILKSU_REQUIRE_STABLE_CODESIGN)
const systemOcrVersion = '1.1.0'
const typescriptLanguageServerVersion = '5.3.0'
const vueLanguageServerVersion = '2.2.12'
const typescriptVersion = '6.0.3'
const diffVersion = '8.0.4'
const goplsVersion = '0.23.0'
const goplsSource = {
  module: 'golang.org/x/tools/gopls',
  moduleSum: 'h1:Dn6mf9WXu9iLnTftDDMb9wV0c6Se7PjzEMqP0LEe08Y=',
  goModSum: 'h1:Ijg67bAdTicg9IINxII7MV+dQpHEXM4646WpNWVYBP0=',
  originURL: 'https://go.googlesource.com/tools',
  originHash: '014f87ff5c01915bc90f4f11a6bb8aea3e0edbd7',
  originRef: `refs/tags/gopls/v${goplsVersion}`,
}
const lspRuntimeRootPackages = [
  {
    name: 'typescript-language-server',
    version: typescriptLanguageServerVersion,
    license: 'Apache-2.0',
    licenseFile: 'LICENSE',
  },
  {
    name: '@vue/language-server',
    version: vueLanguageServerVersion,
    license: 'MIT',
    licenseFile: 'LICENSE',
  },
  {
    name: 'typescript',
    version: typescriptVersion,
    license: 'Apache-2.0',
    licenseFile: 'LICENSE.txt',
  },
]
const systemOcrNativePackages = {
  'darwin/arm64': '@napi-rs/system-ocr-darwin-arm64',
  'darwin/amd64': '@napi-rs/system-ocr-darwin-x64',
  'windows/amd64': '@napi-rs/system-ocr-win32-x64-msvc',
}
const nodeArchives = {
  'darwin/arm64': {
    file: `node-v${nodeVersion}-darwin-arm64.tar.xz`,
    sha256: '4477b9f78efb77744cf5eb57a0e9594dba66466b38b4e93fa9f35cb907a095a6',
  },
  'darwin/amd64': {
    file: `node-v${nodeVersion}-darwin-x64.tar.xz`,
    sha256: '4a3b6bc81542154430825128d9a279e8b364e8d90581544e506ef7579fd1ab6f',
  },
  'windows/amd64': {
    file: `node-v${nodeVersion}-win-x64.zip`,
    sha256: '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821',
  },
  'linux/amd64': {
    file: `node-v${nodeVersion}-linux-x64.tar.xz`,
    sha256: '55aa7153f9d88f28d765fcdad5ae6945b5c0f98a36881703817e4c450fa76742',
  },
  'linux/arm64': {
    file: `node-v${nodeVersion}-linux-arm64.tar.xz`,
    sha256: '58c9520501f6ae2b52d5b210444e24b9d0c029a58c5011b797bc1fe7105886f6',
  },
}

function platformBinaryName(platform, name) {
  return platform.startsWith('windows/') ? `${name}.exe` : name
}

function argument(name, fallback = undefined) {
  const prefix = `--${name}=`
  const inline = process.argv.find(value => value.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

function boolEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

function resolveCodesignIdentity() {
  const identity = (process.env.MILKSU_CODESIGN_IDENTITY || '-').trim() || '-'
  if (stableCodesignRequired && identity === '-') {
    throw new Error(
      'MILKSU_REQUIRE_STABLE_CODESIGN=1 requires MILKSU_CODESIGN_IDENTITY, for example "Developer ID Application: ...".',
    )
  }
  return identity
}

function currentPlatform() {
  const arch = process.arch === 'x64' ? 'amd64' : process.arch
  return `${process.platform}/${arch}`
}

async function exists(path) {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

async function resolveInstalledPackage(packageName, fromDirectory, optional = false) {
  let current = resolve(fromDirectory)
  while (true) {
    const relativeToRepository = relative(repositoryRoot, current)
    if (relativeToRepository.startsWith('..') || isAbsolute(relativeToRepository)) break
    const candidate = join(current, 'node_modules', ...packageName.split('/'))
    if (await exists(join(candidate, 'package.json'))) return candidate
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  if (optional) return ''
  throw new Error(`installed package is missing: ${packageName}`)
}

async function collectInstalledPackageClosure(rootPackages) {
  const rootNodeModules = join(repositoryRoot, 'node_modules')
  const queue = rootPackages.map(name => ({
    name,
    fromDirectory: repositoryRoot,
    optional: false,
  }))
  const visited = new Set()
  const packages = []
  while (queue.length > 0) {
    const request = queue.shift()
    const source = await resolveInstalledPackage(
      request.name,
      request.fromDirectory,
      request.optional,
    )
    if (!source || visited.has(source)) continue
    visited.add(source)
    const document = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    const relativePath = relative(rootNodeModules, source)
    if (relativePath === '' || relativePath.startsWith('..')) {
      throw new Error(`package resolved outside repository node_modules: ${request.name}`)
    }
    packages.push({
      name: document.name,
      version: document.version,
      license: document.license,
      source,
      relativePath,
    })
    for (const name of Object.keys(document.dependencies ?? {})) {
      queue.push({ name, fromDirectory: source, optional: false })
    }
    for (const name of Object.keys(document.optionalDependencies ?? {})) {
      queue.push({ name, fromDirectory: source, optional: true })
    }
  }
  return packages
}

function minimalPackageCopySet(packages) {
  return packages.filter(packageInfo => !packages.some(other => (
    other !== packageInfo
    && packageInfo.source.startsWith(`${other.source}/node_modules/`)
  )))
}

async function sha256(path) {
  const data = await readFile(path)
  return createHash('sha256').update(data).digest('hex')
}

async function inspectCodesign(path) {
  const { stdout, stderr } = await execFileAsync('/usr/bin/codesign', [
    '-dv',
    '--verbose=4',
    path,
  ])
  const fields = new Map()
  for (const rawLine of `${stdout}\n${stderr}`.split('\n')) {
    const line = rawLine.trim()
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    fields.set(line.slice(0, separator), line.slice(separator + 1))
  }
  return {
    identifier: fields.get('Identifier') || '',
    signature: fields.get('Signature') || '',
    teamIdentifier: fields.get('TeamIdentifier') || '',
  }
}

async function signMachOFiles(root, identity) {
  const paths = []
  // The embedded standalone Node process owns the Pi/V8 loop. Hardened
  // Runtime signing without the JIT entitlements makes V8 abort in Heap::SetUp
  // before any Sidecar JavaScript can run. Native helpers and addons do not
  // receive these process entitlements.
  const nodeRuntime = join(root, 'node')
  const nodeEntitlements = join(
    repositoryRoot,
    'desktop',
    'build',
    'entitlements.mac.plist',
  )
  async function walk(directory) {
    const entries = await readdir(directory, { withFileTypes: true })
    for (const entry of entries) {
      const path = join(directory, entry.name)
      if (entry.isDirectory()) {
        await walk(path)
      } else if (entry.isFile()) {
        paths.push(path)
      }
    }
  }
  await walk(root)
  for (const path of paths) {
    const header = await readFile(path).then(bytes => bytes.subarray(0, 4)).catch(() => Buffer.alloc(0))
    if (header.length !== 4) continue
    const magic = header.readUInt32BE(0)
    if (![0xfeedface, 0xfeedfacf, 0xcafebabe, 0xbebafeca, 0xcefaedfe, 0xcffaedfe].includes(magic)) continue
    await execFileAsync('/usr/bin/codesign', [
      '--force',
      '--options', 'runtime',
      '--timestamp',
      ...(path === nodeRuntime ? ['--entitlements', nodeEntitlements] : []),
      '--sign', identity,
      path,
    ])
  }
}

function assertStableCodesign(path, details) {
  const signature = details.signature.trim().toLowerCase()
  const teamIdentifier = details.teamIdentifier.trim().toLowerCase()
  if (signature === 'adhoc' || !teamIdentifier || teamIdentifier === 'not set') {
    throw new Error(
      `stable codesign required for ${path}, got Signature=${details.signature || 'unknown'} TeamIdentifier=${details.teamIdentifier || 'unknown'}`,
    )
  }
}

async function download(url, destination) {
  const response = await fetch(url, { redirect: 'follow' })
  if (!response.ok) throw new Error(`download failed (${response.status}): ${url}`)
  await writeFile(destination, Buffer.from(await response.arrayBuffer()), { mode: 0o600 })
}

async function officialNodeRuntime(platform) {
  const archive = nodeArchives[platform]
  if (!archive) throw new Error(`unsupported Sidecar platform: ${platform}`)
  const cache = join(repositoryRoot, 'build', 'sidecar-cache', platform.replace('/', '-'))
  const archivePath = join(cache, archive.file)
  const archiveDirectory = archive.file.replace(/(?:\.tar\.xz|\.zip)$/u, '')
  const runtimeRoot = join(cache, archiveDirectory)
  const runtimeBinary = platform.startsWith('windows/')
    ? join(runtimeRoot, 'node.exe')
    : join(runtimeRoot, 'bin', 'node')
  await mkdir(cache, { recursive: true, mode: 0o700 })

  let archiveValid = await exists(archivePath) && await sha256(archivePath) === archive.sha256
  if (!archiveValid) {
    await download(`https://nodejs.org/download/release/v${nodeVersion}/${archive.file}`, archivePath)
    archiveValid = await sha256(archivePath) === archive.sha256
  }
  if (!archiveValid) throw new Error(`official Node archive checksum mismatch: ${archive.file}`)

  if (!await exists(runtimeBinary)) {
    await rm(runtimeRoot, { recursive: true, force: true })
    await execFileAsync(process.platform === 'win32' ? 'tar' : '/usr/bin/tar', [
      archive.file.endsWith('.zip') ? '-xf' : '-xJf',
      archivePath,
      '-C',
      cache,
    ])
  }
  return { binary: runtimeBinary, license: join(runtimeRoot, 'LICENSE'), archive }
}

async function officialCuaDriverRuntime(platform) {
  const [goos, goarch] = platform.split('/')
  if (goos !== 'darwin' || !['arm64', 'amd64'].includes(goarch)) {
    throw new Error(`unsupported Cua Driver platform: ${platform}`)
  }
  const cache = join(
    repositoryRoot,
    'build',
    'sidecar-cache',
    `cua-driver-v${cuaDriverVersion}`,
  )
  const archivePath = join(cache, cuaDriverArchive.file)
  const runtimeRoot = join(cache, 'runtime')
  const runtimeBinary = join(runtimeRoot, 'cua-driver')
  await mkdir(cache, { recursive: true, mode: 0o700 })

  let archiveValid = await exists(archivePath)
    && await sha256(archivePath) === cuaDriverArchive.sha256
  if (!archiveValid) {
    await download(
      `https://github.com/trycua/cua/releases/download/${cuaDriverTag}/${cuaDriverArchive.file}`,
      archivePath,
    )
    archiveValid = await sha256(archivePath) === cuaDriverArchive.sha256
  }
  if (!archiveValid) {
    throw new Error(`official Cua Driver archive checksum mismatch: ${cuaDriverArchive.file}`)
  }
  if (
    !await exists(runtimeBinary)
    || await sha256(runtimeBinary) !== cuaDriverBinarySha256
  ) {
    await rm(runtimeRoot, { recursive: true, force: true })
    await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
    await execFileAsync('/usr/bin/tar', [
      '-xzf',
      archivePath,
      '-C',
      runtimeRoot,
      'cua-driver',
    ])
  }
  await chmod(runtimeBinary, 0o755)
  if (await sha256(runtimeBinary) !== cuaDriverBinarySha256) {
    throw new Error(`official Cua Driver binary checksum mismatch: ${runtimeBinary}`)
  }
  const { stdout: architectures } = await execFileAsync('/usr/bin/lipo', [
    '-archs',
    runtimeBinary,
  ])
  if (
    !architectures.split(/\s+/).includes('arm64')
    || !architectures.split(/\s+/).includes('x86_64')
  ) {
    throw new Error(`Cua Driver archive is not universal: ${architectures.trim()}`)
  }
  const { stdout: version } = await execFileAsync(runtimeBinary, ['--version'], {
    env: {
      HOME: runtimeRoot,
      TMPDIR: runtimeRoot,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'en_US.UTF-8',
      CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
    },
    timeout: 10_000,
    maxBuffer: 1 << 20,
  })
  if (version.trim() !== `cua-driver ${cuaDriverVersion}`) {
    throw new Error(`unexpected Cua Driver version: ${version.trim()}`)
  }
  return {
    binary: runtimeBinary,
    archive: cuaDriverArchive,
    tag: cuaDriverTag,
    sourceCommit: cuaDriverSourceCommit,
    binarySha256: cuaDriverBinarySha256,
  }
}

function verifiedGoplsDownload(moduleDownload) {
  return moduleDownload.Path === goplsSource.module
    && moduleDownload.Version === `v${goplsVersion}`
    && moduleDownload.Sum === goplsSource.moduleSum
    && moduleDownload.GoModSum === goplsSource.goModSum
    && moduleDownload.Origin?.URL === goplsSource.originURL
    && moduleDownload.Origin?.Hash === goplsSource.originHash
    && moduleDownload.Origin?.Ref === goplsSource.originRef
    && typeof moduleDownload.Dir === 'string'
}

async function officialGoplsRuntime(platform) {
  const [goos, goarch] = platform.split('/')
  if (!['darwin', 'linux', 'windows'].includes(goos) || !['arm64', 'amd64'].includes(goarch)) {
    throw new Error(`unsupported gopls platform: ${platform}`)
  }
  const cache = join(repositoryRoot, 'build', 'sidecar-cache', platform.replace('/', '-'))
  const runtimeRoot = join(cache, `gopls-v${goplsVersion}`)
  const runtimeBinary = join(runtimeRoot, platformBinaryName(platform, 'gopls'))
  const runtimeLicense = join(runtimeRoot, 'LICENSE')
  const metadataPath = join(runtimeRoot, 'build.json')
  const { stdout: goVersionOutput } = await execFileAsync('go', ['version'])
  const goVersion = goVersionOutput.trim()
  const expectedMetadata = {
    buildRecipe: 'go-build-trimpath-version-override-v1',
    platform,
    version: goplsVersion,
    module: goplsSource.module,
    moduleSum: goplsSource.moduleSum,
    goModSum: goplsSource.goModSum,
    originHash: goplsSource.originHash,
    goVersion,
  }

  if (
    await exists(runtimeBinary)
    && await exists(runtimeLicense)
    && await exists(metadataPath)
  ) {
    try {
      const metadata = JSON.parse(await readFile(metadataPath, 'utf8'))
      const metadataMatches = Object.entries(expectedMetadata).every(
        ([key, value]) => metadata[key] === value,
      )
      if (
        metadataMatches
        && typeof metadata.binarySha256 === 'string'
        && await sha256(runtimeBinary) === metadata.binarySha256
      ) {
        return {
          binary: runtimeBinary,
          license: runtimeLicense,
          ...metadata,
        }
      }
    } catch {
      // Rebuild a corrupt or incomplete cache entry below.
    }
  }

  const moduleReference = `${goplsSource.module}@v${goplsVersion}`
  const downloadModule = envOverrides => execFileAsync(
    'go',
    ['mod', 'download', '-json', moduleReference],
    {
      cwd: repositoryRoot,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
      env: { ...process.env, ...envOverrides },
    },
  ).then(result => JSON.parse(result.stdout))
  const moduleDownload = await downloadModule({})
  if (!verifiedGoplsDownload(moduleDownload)) {
    // Third-party module proxies (for example goproxy.cn) omit the Origin
    // provenance metadata, and the stripped .info then sticks in the shared
    // module cache. Re-fetch through the official proxy into an isolated
    // GOMODCACHE so verification stays hermetic and the user cache untouched.
    const isolatedCache = join(repositoryRoot, 'build', 'sidecar-cache', 'gomodcache')
    await mkdir(isolatedCache, { recursive: true })
    const refetched = await downloadModule({
      GOPROXY: 'https://proxy.golang.org,direct',
      GOMODCACHE: isolatedCache,
    })
    if (!verifiedGoplsDownload(refetched)) {
      throw new Error('gopls source verification failed: module proxy did not provide the pinned Origin metadata')
    }
    Object.assign(moduleDownload, refetched)
  }
  const sourceLicense = join(moduleDownload.Dir, 'LICENSE')
  if (!await exists(sourceLicense)) {
    throw new Error(`gopls source is missing its BSD license: ${sourceLicense}`)
  }

  await rm(runtimeRoot, { recursive: true, force: true })
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
  await execFileAsync(
    'go',
    [
      'build',
      '-trimpath',
      '-buildvcs=false',
      '-mod=readonly',
      `-ldflags=-X=main.version=v${goplsVersion}`,
      '-o',
      runtimeBinary,
      '.',
    ],
    {
      cwd: moduleDownload.Dir,
      env: {
        ...process.env,
        GOOS: goos,
        GOARCH: goarch,
        CGO_ENABLED: '0',
      },
      maxBuffer: 8 * 1024 * 1024,
      timeout: 300_000,
    },
  )
  await copyFile(sourceLicense, runtimeLicense)
  await chmod(runtimeBinary, 0o755)
  const metadata = {
    ...expectedMetadata,
    binarySha256: await sha256(runtimeBinary),
  }
  await writeFile(metadataPath, `${JSON.stringify(metadata, null, 2)}\n`, { mode: 0o600 })
  return {
    binary: runtimeBinary,
    license: runtimeLicense,
    ...metadata,
  }
}

async function bundleBridge(entry, outfile) {
  await build({
    entryPoints: [join(repositoryRoot, entry)],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node24',
    external: ['@napi-rs/system-ocr'],
    banner: { js: "const __import_meta_url = require('node:url').pathToFileURL(__filename).href;" },
    define: { 'import.meta.url': '__import_meta_url' },
    legalComments: 'eof',
    logLevel: 'info',
  })
}

async function runWithInput(executable, argumentsList, input, options) {
  return await new Promise((resolvePromise, rejectPromise) => {
    const { timeoutMs = 15_000, ...spawnOptions } = options
    const child = spawn(executable, argumentsList, {
      ...spawnOptions,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => child.kill('SIGKILL'), timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', chunk => { stdout += chunk })
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', rejectPromise)
    child.on('close', code => {
      clearTimeout(timeout)
      if (code === 0) resolvePromise({ stdout, stderr })
      else rejectPromise(new Error(`Sidecar exited with ${code}: ${stderr}`))
    })
    child.stdin.end(input)
  })
}

async function waitForUnixSocket(socketPath, child, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs
  return await new Promise((resolvePromise, rejectPromise) => {
    let settled = false
    const finish = (error) => {
      if (settled) return
      settled = true
      child.off('exit', onExit)
      if (error) rejectPromise(error)
      else resolvePromise()
    }
    const onExit = (code, signal) => {
      finish(new Error(
        `Cua Driver stopped before opening its socket (code=${code}, signal=${signal})`,
      ))
    }
    const tryConnect = () => {
      if (settled) return
      if (Date.now() >= deadline) {
        finish(new Error(`timed out waiting for Cua Driver socket: ${socketPath}`))
        return
      }
      const connection = createConnection(socketPath)
      connection.once('connect', () => {
        connection.end()
        finish()
      })
      connection.once('error', () => {
        connection.destroy()
        setTimeout(tryConnect, 50)
      })
    }
    child.once('exit', onExit)
    tryConnect()
  })
}

async function verifyPackagedCuaRuntime(output) {
  const driver = join(output, 'cua-driver')
  const runtimeRoot = '/private/tmp/milksu-computer-use'
  await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
  const directory = await mkdtemp(join(runtimeRoot, 'package-smoke-'))
  const socketPath = join(directory, 'driver.sock')
  const policyPath = join(directory, 'session-policy.yaml')
  await copyFile(cuaSessionPolicyPath, policyPath)
  await chmod(policyPath, 0o600)
  let stderr = ''
  const child = spawn(driver, [
    'serve',
    '--embedded',
    '--host-bundle-id',
    'com.milksu.app',
    '--socket',
    socketPath,
    '--permission-mode',
    'bounded',
    '--session-policy',
    policyPath,
    '--approve-session-policy',
    '--no-permissions-gate',
  ], {
    cwd: directory,
    env: {
      HOME: directory,
      TMPDIR: directory,
      PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
      LANG: 'en_US.UTF-8',
      CUA_DRIVER_EMBEDDED: '1',
      CUA_DRIVER_HOST_BUNDLE_ID: 'com.milksu.app',
      CUA_DRIVER_PERMISSION_MODE: 'bounded',
      CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
      CUA_LOG: 'warn',
    },
    stdio: ['ignore', 'ignore', 'pipe'],
  })
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', chunk => {
    if (stderr.length < 8192) stderr += chunk.slice(0, 8192 - stderr.length)
  })
  try {
    await waitForUnixSocket(socketPath, child)
    const { stdout } = await execFileAsync(driver, ['status', '--socket', socketPath], {
      cwd: directory,
      env: {
        HOME: directory,
        TMPDIR: directory,
        PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
        LANG: 'en_US.UTF-8',
        CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
      },
      timeout: 5_000,
      maxBuffer: 1 << 20,
    })
    if (!/running|healthy/i.test(stdout)) {
      throw new Error(`packaged Cua Driver status was unexpected: ${stdout}`)
    }
  } catch (error) {
    throw new Error(
      `packaged bounded Cua Driver failed: `
      + `${error instanceof Error ? error.message : String(error)}${stderr ? `\n${stderr}` : ''}`,
    )
  } finally {
    try {
      await execFileAsync(driver, ['stop', '--socket', socketPath], {
        cwd: directory,
        env: {
          HOME: directory,
          TMPDIR: directory,
          PATH: '/usr/bin:/bin:/usr/sbin:/sbin',
          LANG: 'en_US.UTF-8',
          CUA_DRIVER_RS_TELEMETRY_ENABLED: 'false',
        },
        timeout: 5_000,
        maxBuffer: 1 << 20,
      })
    } catch {
      child.kill('SIGTERM')
    }
    await new Promise(resolvePromise => {
      if (child.exitCode !== null || child.signalCode !== null) {
        resolvePromise()
        return
      }
      const timeout = setTimeout(() => {
        child.kill('SIGKILL')
        resolvePromise()
      }, 2_000)
      child.once('exit', () => {
        clearTimeout(timeout)
        resolvePromise()
      })
    })
    await rm(directory, { recursive: true, force: true })
  }
  return {
    version: cuaDriverVersion,
    policy: 'bounded',
    targetBundleId: 'runtime-selected-visible-app',
  }
}

async function verifyReviewedLspCodeActions({
  output,
  node,
  workspace,
  runtimeArguments,
}) {
  const fixtureRoot = join(workspace, 'lsp-code-actions')
  const vueRoot = join(fixtureRoot, 'vue')
  const goRoot = join(fixtureRoot, 'go')
  const probe = join(output, 'lsp-code-action-probe.cjs')
  await rm(fixtureRoot, { recursive: true, force: true })
  await Promise.all([
    mkdir(vueRoot, { recursive: true, mode: 0o700 }),
    mkdir(goRoot, { recursive: true, mode: 0o700 }),
  ])
  await bundleBridge('scripts/lsp-code-action-probe.mjs', probe)

  const vueBefore = [
    '<script setup lang="ts">',
    'import { unusedValue } from "./unused"',
    'import { usedValue } from "./used"',
    '',
    'const value = usedValue',
    '</script>',
    '',
    '<template><div>{{ value }}</div></template>',
    '',
  ].join('\n')
  const goBefore = [
    'package main',
    '',
    'import (',
    '\t"fmt"',
    '\t"strings"',
    ')',
    '',
    'func main() {',
    '\t_ = strings.TrimSpace(" MilkSU ")',
    '}',
    '',
  ].join('\n')
  await Promise.all([
    writeFile(join(vueRoot, 'Component.vue'), vueBefore, { mode: 0o600 }),
    writeFile(join(vueRoot, 'used.ts'), 'export const usedValue = 42\n', { mode: 0o600 }),
    writeFile(
      join(vueRoot, 'unused.ts'),
      'export const unusedValue = "unused"\n',
      { mode: 0o600 },
    ),
    writeFile(join(vueRoot, 'tsconfig.json'), `${JSON.stringify({
      compilerOptions: {
        module: 'ESNext',
        moduleResolution: 'Bundler',
        target: 'ES2022',
      },
      include: ['**/*'],
    }, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(goRoot, 'go.mod'), 'module example.com/milksu/lspfixture\n\ngo 1.24\n', {
      mode: 0o600,
    }),
    writeFile(join(goRoot, 'main.go'), goBefore, { mode: 0o600 }),
  ])

  const probeArguments = [
    ...runtimeArguments,
    '--allow-child-process',
    '--allow-fs-read=/usr/bin/env',
    probe,
  ]
  const probeEnvironment = {
    ...process.env,
    HOME: workspace,
    TMPDIR: workspace,
  }
  const runProbe = async (input) => {
    const run = await runWithInput(
      node,
      probeArguments,
      `${JSON.stringify(input)}\n`,
      {
        cwd: input.workspace,
        env: probeEnvironment,
        timeoutMs: 30_000,
      },
    )
    const result = JSON.parse(run.stdout)
    if (!result.ok) {
      throw new Error(`packaged ${input.server} Code Action failed: ${result.error}`)
    }
    return result
  }

  const vueResult = await runProbe({
    workspace: vueRoot,
    path: 'Component.vue',
    kind: 'source.organizeImports',
    server: 'milksu-vue',
    write: true,
  })
  const goResult = await runProbe({
    workspace: goRoot,
    path: 'main.go',
    kind: 'source.organizeImports',
    server: 'milksu-go',
    write: true,
  })
  const [vueAfter, goAfter] = await Promise.all([
    readFile(join(vueRoot, 'Component.vue'), 'utf8'),
    readFile(join(goRoot, 'main.go'), 'utf8'),
  ])
  if (
    vueAfter === vueBefore
    || vueAfter.includes('unusedValue')
    || !vueAfter.includes('usedValue')
    || vueResult.result?.details?.write !== true
    || !vueResult.result?.details?.diff?.includes('-import { unusedValue }')
  ) {
    throw new Error(`Vue Code Action was not applied and reviewed: ${JSON.stringify(vueResult)}`)
  }
  if (
    goAfter === goBefore
    || goAfter.includes('"fmt"')
    || !goAfter.includes('"strings"')
    || goResult.result?.details?.write !== true
    || !goResult.result?.details?.diff?.includes('-\t"fmt"')
  ) {
    throw new Error(`Go Code Action was not applied and reviewed: ${JSON.stringify(goResult)}`)
  }

  return {
    vue: {
      server: 'milksu-vue',
      kind: 'source.organizeImports',
      beforeSha256: vueResult.result.details.beforeSha256,
      afterSha256: vueResult.result.details.afterSha256,
    },
    go: {
      server: 'milksu-go',
      kind: 'source.organizeImports',
      beforeSha256: goResult.result.details.beforeSha256,
      afterSha256: goResult.result.details.afterSha256,
    },
  }
}

async function buildSidecar(platform) {
  await prepareReviewedTypeScript()
  const [goos, goarch] = platform.split('/')
  const runtime = await officialNodeRuntime(platform)
  let cuaRuntime = null
  if (goos === 'darwin') {
    cuaRuntime = await officialCuaDriverRuntime(platform)
  } else if (goos === 'windows') {
    if (goarch !== 'amd64') throw new Error(`unsupported Cua Driver platform: ${platform}`)
    cuaRuntime = await buildWindowsCuaDriver({ repositoryRoot })
  }
  const goplsRuntime = await officialGoplsRuntime(platform)
  const output = join(repositoryRoot, 'build', 'sidecar', platform.replace('/', '-'))
  await mkdir(output, { recursive: true, mode: 0o700 })
  const nodeOutput = join(output, platformBinaryName(platform, 'node'))
  const chatOutput = join(output, 'chat-bridge.cjs')
  const securityOutput = join(output, 'security-bridge.cjs')
  const computerUseProxyOutput = join(output, 'computer-use-proxy.cjs')
  const piSubagentLauncherOutput = join(output, 'pi-subagent-launcher.sh')
  const piSubagentRunnerOutput = join(output, 'pi-subagent-runner.cjs')
  const currentProviderRuntimeOutput = join(output, 'current-provider-runtime.cjs')
  const piSubagentCliOutput = join(output, 'pi-subagent-cli.cjs')
  const piSubagentThemeOutput = join(
    output,
    'dist',
    'modes',
    'interactive',
    'theme',
  )
  const piSubagentSource = join(repositoryRoot, 'node_modules', 'pi-sub-agent')
  const piSubagentAgentsOutput = join(output, 'subagents', 'agents')
  const cuaDriverOutput = cuaRuntime
    ? join(output, goos === 'windows' ? 'cua-driver.exe' : 'cua-driver')
    : ''
  const archifySource = join(repositoryRoot, 'third_party', 'archify', 'archify')
  const archifyOutput = join(output, 'skills', 'archify')
  const firstPartySkills = firstPartyCodingSkillNames.map(name => ({
    name,
    source: join(repositoryRoot, 'skills', name),
    output: join(output, 'skills', name),
  }))
  const licenseOutput = join(output, 'THIRD_PARTY-LICENSES')
  const diffSource = join(repositoryRoot, 'node_modules', 'diff')
  const archifyPackage = JSON.parse(await readFile(join(archifySource, 'package.json'), 'utf8'))
  const diffPackage = JSON.parse(await readFile(join(diffSource, 'package.json'), 'utf8'))
  const piSubagentPackage = JSON.parse(
    await readFile(join(piSubagentSource, 'package.json'), 'utf8'),
  )
  const repositoryLock = JSON.parse(
    await readFile(join(repositoryRoot, 'package-lock.json'), 'utf8'),
  )
  if (
    diffPackage.version !== diffVersion
    || diffPackage.license !== 'BSD-3-Clause'
    || !await exists(join(diffSource, 'LICENSE'))
  ) {
    throw new Error(`Diff package mismatch: expected diff@${diffVersion} BSD-3-Clause`)
  }
  if (
    piSubagentPackage.version !== piSubAgentVersion
    || piSubagentPackage.license !== 'MIT'
    || repositoryLock.packages?.['node_modules/pi-sub-agent']?.integrity
      !== piSubAgentIntegrity
    || !await exists(join(piSubagentSource, 'LICENSE'))
  ) {
    throw new Error(
      `Pi subagent package mismatch: expected pi-sub-agent@${piSubAgentVersion} `
      + `MIT with reviewed npm integrity`,
    )
  }
  const systemOcrNativePackage = systemOcrNativePackages[platform]
  const systemOcrSource = join(repositoryRoot, 'node_modules', '@napi-rs', 'system-ocr')
  const systemOcrNativeSource = systemOcrNativePackage
    ? join(repositoryRoot, 'node_modules', ...systemOcrNativePackage.split('/'))
    : ''
  if (
    !await exists(systemOcrSource)
    || (systemOcrNativePackage && !await exists(systemOcrNativeSource))
  ) {
    throw new Error(
      `system OCR packages are incomplete for ${platform}; run npm install on the target architecture`,
    )
  }
  const systemOcrOutputRoot = join(output, 'node_modules', '@napi-rs')
  const playwrightPackages = [
    {
      name: '@playwright/mcp',
      version: playwrightMcpVersion,
      source: join(repositoryRoot, 'node_modules', '@playwright', 'mcp'),
      output: join(output, 'node_modules', '@playwright', 'mcp'),
      licenseFile: 'playwright-mcp-Apache-2.0.txt',
    },
    {
      name: 'playwright',
      version: playwrightVersion,
      source: join(repositoryRoot, 'node_modules', 'playwright'),
      output: join(output, 'node_modules', 'playwright'),
      licenseFile: 'playwright-Apache-2.0.txt',
    },
    {
      name: 'playwright-core',
      version: playwrightVersion,
      source: join(repositoryRoot, 'node_modules', 'playwright-core'),
      output: join(output, 'node_modules', 'playwright-core'),
      licenseFile: 'playwright-core-Apache-2.0.txt',
    },
  ]
  const lspRuntimeOutput = join(output, 'lsp-runtime')
  const goplsOutput = join(lspRuntimeOutput, platformBinaryName(platform, 'gopls'))
  const lspRuntimePackages = await collectInstalledPackageClosure(
    lspRuntimeRootPackages.map(packageInfo => packageInfo.name),
  )
  for (const expected of lspRuntimeRootPackages) {
    const source = await resolveInstalledPackage(expected.name, repositoryRoot)
    const document = JSON.parse(await readFile(join(source, 'package.json'), 'utf8'))
    if (document.version !== expected.version || document.license !== expected.license) {
      throw new Error(
        `LSP runtime package mismatch: expected `
        + `${expected.name}@${expected.version} ${expected.license}`,
      )
    }
    if (!await exists(join(source, expected.licenseFile))) {
      throw new Error(`LSP runtime package is missing its license: ${expected.name}`)
    }
  }
  for (const packageInfo of playwrightPackages) {
    if (!await exists(packageInfo.source)) {
      throw new Error(`Playwright package is missing: ${packageInfo.name}@${packageInfo.version}`)
    }
    const packageDocument = JSON.parse(
      await readFile(join(packageInfo.source, 'package.json'), 'utf8'),
    )
    if (
      packageDocument.version !== packageInfo.version
      || packageDocument.license !== 'Apache-2.0'
    ) {
      throw new Error(
        `Playwright package mismatch: expected ${packageInfo.name}@${packageInfo.version} Apache-2.0`,
      )
    }
  }
  const { stdout: checkedOutArchifyCommit } = await execFileAsync(
    'git',
    ['-C', join(repositoryRoot, 'third_party', 'archify'), 'rev-parse', 'HEAD'],
  )
  if (checkedOutArchifyCommit.trim() !== archifyCommit) {
    throw new Error(
      `Archify checkout mismatch: expected ${archifyCommit}, got ${checkedOutArchifyCommit.trim()}`,
    )
  }

  await rm(archifyOutput, { recursive: true, force: true })
  await Promise.all(firstPartySkills.map(skill => (
    rm(skill.output, { recursive: true, force: true })
  )))
  await rm(systemOcrOutputRoot, { recursive: true, force: true })
  await rm(lspRuntimeOutput, { recursive: true, force: true })
  await rm(join(output, 'subagents'), { recursive: true, force: true })
  await Promise.all(
    playwrightPackages.map(packageInfo => rm(
      packageInfo.output,
      { recursive: true, force: true },
    )),
  )
  await mkdir(dirname(archifyOutput), { recursive: true, mode: 0o700 })
  await mkdir(systemOcrOutputRoot, { recursive: true, mode: 0o700 })
  await mkdir(join(lspRuntimeOutput, 'node_modules'), { recursive: true, mode: 0o700 })
  await mkdir(dirname(piSubagentAgentsOutput), { recursive: true, mode: 0o700 })
  await mkdir(piSubagentThemeOutput, { recursive: true, mode: 0o700 })
  await Promise.all(
    playwrightPackages.map(packageInfo => mkdir(
      dirname(packageInfo.output),
      { recursive: true, mode: 0o700 },
    )),
  )
  await mkdir(licenseOutput, { recursive: true, mode: 0o700 })
  await rm(
    join(licenseOutput, 'gopls-BSD-3-Clause.txt'),
    { force: true },
  )
  await cp(archifySource, archifyOutput, { recursive: true })
  await Promise.all(firstPartySkills.map(skill => (
    cp(skill.source, skill.output, { recursive: true })
  )))
  for (const packageInfo of minimalPackageCopySet(lspRuntimePackages)) {
    const destination = join(
      lspRuntimeOutput,
      'node_modules',
      packageInfo.relativePath,
    )
    await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
    await cp(
      packageInfo.source,
      destination,
      { recursive: true },
    )
  }
  await Promise.all([
    copyFile(runtime.binary, nodeOutput),
    copyFile(runtime.license, join(output, 'NODE-LICENSE')),
    ...(cuaRuntime ? [copyFile(cuaRuntime.binary, cuaDriverOutput)] : []),
    copyFile(goplsRuntime.binary, goplsOutput),
    copyFile(
      goplsRuntime.license,
      join(licenseOutput, 'gopls-BSD-3-Clause.txt'),
    ),
    copyFile(
      join(repositoryRoot, 'third_party', 'licenses', 'pi-MIT.txt'),
      join(licenseOutput, 'pi-MIT.txt'),
    ),
    copyFile(
      join(repositoryRoot, 'third_party', 'licenses', 'narumitw-pi-extensions-MIT.txt'),
      join(licenseOutput, 'narumitw-pi-extensions-MIT.txt'),
    ),
    copyFile(
      join(repositoryRoot, 'third_party', 'licenses', 'cua-MIT.txt'),
      join(licenseOutput, 'cua-MIT.txt'),
    ),
    copyFile(
      join(diffSource, 'LICENSE'),
      join(licenseOutput, 'diff-BSD-3-Clause.txt'),
    ),
    copyFile(
      join(repositoryRoot, 'node_modules', 'pi-better-background-tasks', 'LICENSE'),
      join(licenseOutput, 'pi-better-background-tasks-MIT.txt'),
    ),
    copyFile(
      join(repositoryRoot, 'node_modules', 'pi-mcp-adapter', 'LICENSE'),
      join(licenseOutput, 'pi-mcp-adapter-MIT.txt'),
    ),
    copyFile(
      join(piSubagentSource, 'LICENSE'),
      join(licenseOutput, 'pi-sub-agent-MIT.txt'),
    ),
    copyFile(
      join(repositoryRoot, 'sidecar', 'pi', 'pi-subagent-launcher.sh'),
      piSubagentLauncherOutput,
    ),
    copyFile(
      join(repositoryRoot, 'sidecar', 'pi', 'pi-subagent-runner.cjs'),
      piSubagentRunnerOutput,
    ),
    copyFile(
      join(repositoryRoot, 'sidecar', 'pi', 'current-provider-runtime.cjs'),
      currentProviderRuntimeOutput,
    ),
    copyFile(
      join(repositoryRoot, 'sidecar', 'pi', 'known-context-window.cjs'),
      join(output, 'known-context-window.cjs'),
    ),
    copyFile(
      join(
        repositoryRoot,
        'node_modules',
        '@earendil-works',
        'pi-coding-agent',
        'dist',
        'modes',
        'interactive',
        'theme',
        'dark.json',
      ),
      join(piSubagentThemeOutput, 'dark.json'),
    ),
    copyFile(
      join(
        repositoryRoot,
        'node_modules',
        '@earendil-works',
        'pi-coding-agent',
        'dist',
        'modes',
        'interactive',
        'theme',
        'light.json',
      ),
      join(piSubagentThemeOutput, 'light.json'),
    ),
    cp(
      join(piSubagentSource, 'extensions', 'agents'),
      piSubagentAgentsOutput,
      { recursive: true },
    ),
    copyFile(
      join(systemOcrSource, 'LICENSE'),
      join(licenseOutput, 'napi-rs-system-ocr-MIT.txt'),
    ),
    ...playwrightPackages.map(packageInfo => copyFile(
      join(packageInfo.source, 'LICENSE'),
      join(licenseOutput, packageInfo.licenseFile),
    )),
    cp(systemOcrSource, join(systemOcrOutputRoot, 'system-ocr'), { recursive: true }),
    ...(systemOcrNativePackage ? [cp(
      systemOcrNativeSource,
      join(systemOcrOutputRoot, systemOcrNativePackage.split('/')[1]),
      { recursive: true },
    )] : []),
    ...playwrightPackages.map(packageInfo => cp(
      packageInfo.source,
      packageInfo.output,
      { recursive: true },
    )),
    writeFile(join(output, 'package.json'), `${JSON.stringify({
      name: '@earendil-works/pi-coding-agent',
      version: piVersion,
      type: 'commonjs',
      private: true,
    }, null, 2)}\n`, { mode: 0o600 }),
    writeFile(join(lspRuntimeOutput, 'package.json'), `${JSON.stringify({
      name: '@milksu/lsp-runtime',
      private: true,
      dependencies: Object.fromEntries(
        lspRuntimeRootPackages.map(packageInfo => [
          packageInfo.name,
          packageInfo.version,
        ]),
      ),
    }, null, 2)}\n`, { mode: 0o600 }),
    bundleBridge('sidecar/pi/bridge.js', chatOutput),
    bundleBridge('sidecar/security/security-bridge.js', securityOutput),
    bundleBridge('sidecar/computer-use/computer-use-proxy.js', computerUseProxyOutput),
    bundleBridge(
      'node_modules/@earendil-works/pi-coding-agent/dist/cli.js',
      piSubagentCliOutput,
    ),
  ])
  await Promise.all([
    chmod(nodeOutput, 0o755),
    ...(cuaDriverOutput ? [chmod(cuaDriverOutput, 0o755)] : []),
    chmod(goplsOutput, 0o755),
    chmod(chatOutput, 0o644),
    chmod(securityOutput, 0o644),
    chmod(computerUseProxyOutput, 0o644),
    chmod(piSubagentLauncherOutput, 0o755),
    chmod(piSubagentRunnerOutput, 0o644),
    chmod(join(output, 'known-context-window.cjs'), 0o644),
    chmod(piSubagentCliOutput, 0o644),
  ])

  const manifest = {
    schema: 'milksu-sidecar/v1alpha1',
    platform,
    node: {
      version: nodeVersion,
      archive: runtime.archive.file,
      archiveSha256: runtime.archive.sha256,
      binarySha256: await sha256(nodeOutput),
    },
    pi: {
      package: '@earendil-works/pi-coding-agent',
      version: piVersion,
      license: 'MIT',
      licenseFile: 'THIRD_PARTY-LICENSES/pi-MIT.txt',
    },
    skills: {
      firstParty: {
        package: '@milksu/coding-skills',
        version: '1',
        origin: 'first-party',
        paths: firstPartyCodingSkillNames.map(name => `skills/${name}`),
        scope: 'coding-only',
      },
      archify: {
        package: 'tt-a1i/archify',
        version: archifyPackage.version,
        commit: archifyCommit,
        license: archifyPackage.license,
        licenseFile: 'skills/archify/LICENSE',
        path: 'skills/archify',
      },
    },
    extensions: {
      piLsp: {
        package: '@narumitw/pi-lsp',
        version: piLspVersion,
        license: 'MIT',
        licenseFile: 'THIRD_PARTY-LICENSES/narumitw-pi-extensions-MIT.txt',
        scope: 'coding-only',
        runtime: {
          path: 'lsp-runtime',
          servers: {
            go: {
              package: goplsSource.module,
              version: goplsVersion,
              license: 'BSD-3-Clause',
              licenseFile: 'THIRD_PARTY-LICENSES/gopls-BSD-3-Clause.txt',
              path: 'lsp-runtime/gopls',
              binarySha256: await sha256(goplsOutput),
              sourceModuleSum: goplsSource.moduleSum,
              sourceGoModSum: goplsSource.goModSum,
              sourceCommit: goplsSource.originHash,
              builtWith: goplsRuntime.goVersion,
            },
            typescript: {
              package: 'typescript-language-server',
              version: typescriptLanguageServerVersion,
              license: 'Apache-2.0',
              licenseFile: 'lsp-runtime/node_modules/typescript-language-server/LICENSE',
            },
            vue: {
              package: '@vue/language-server',
              version: vueLanguageServerVersion,
              license: 'MIT',
              licenseFile: 'lsp-runtime/node_modules/@vue/language-server/LICENSE',
            },
          },
          sdk: {
            package: 'typescript',
            version: typescriptVersion,
            license: 'Apache-2.0',
            licenseFile: 'lsp-runtime/node_modules/typescript/LICENSE.txt',
          },
        },
      },
      piGoal: {
        package: '@narumitw/pi-goal',
        version: piGoalVersion,
        license: 'MIT',
        licenseFile: 'THIRD_PARTY-LICENSES/narumitw-pi-extensions-MIT.txt',
        scope: 'coding-only',
      },
      piBackgroundTasks: {
        package: 'pi-better-background-tasks',
        version: piBackgroundTasksVersion,
        license: 'MIT',
        licenseFile: 'THIRD_PARTY-LICENSES/pi-better-background-tasks-MIT.txt',
        scope: 'coding-only',
      },
      piMcpAdapter: {
        package: 'pi-mcp-adapter',
        version: piMcpAdapterVersion,
        license: 'MIT',
        licenseFile: 'THIRD_PARTY-LICENSES/pi-mcp-adapter-MIT.txt',
        scope: 'coding-opt-in',
      },
      piSubAgent: {
        package: 'pi-sub-agent',
        version: piSubAgentVersion,
        npmIntegrity: piSubAgentIntegrity,
        license: 'MIT',
        licenseFile: 'THIRD_PARTY-LICENSES/pi-sub-agent-MIT.txt',
        scope: 'coding-worktree-opt-in',
        launcher: {
          file: 'pi-subagent-launcher.sh',
          sha256: await sha256(piSubagentLauncherOutput),
        },
        runner: {
          file: 'pi-subagent-runner.cjs',
          sha256: await sha256(piSubagentRunnerOutput),
        },
        providerRuntime: {
          file: 'current-provider-runtime.cjs',
          sha256: await sha256(currentProviderRuntimeOutput),
        },
        cli: {
          package: '@earendil-works/pi-coding-agent',
          version: piVersion,
          file: 'pi-subagent-cli.cjs',
          sha256: await sha256(piSubagentCliOutput),
          ambientDiscovery: false,
          assets: {
            darkTheme: {
              file: 'dist/modes/interactive/theme/dark.json',
              sha256: await sha256(join(piSubagentThemeOutput, 'dark.json')),
            },
            lightTheme: {
              file: 'dist/modes/interactive/theme/light.json',
              sha256: await sha256(join(piSubagentThemeOutput, 'light.json')),
            },
          },
        },
        agentsPath: 'subagents/agents',
      },
      playwrightMcp: {
        package: '@playwright/mcp',
        version: playwrightMcpVersion,
        license: 'Apache-2.0',
        licenseFile: 'THIRD_PARTY-LICENSES/playwright-mcp-Apache-2.0.txt',
        scope: 'coding-browser-opt-in',
        dependencies: {
          playwright: playwrightVersion,
          'playwright-core': playwrightVersion,
        },
      },
      ...(cuaRuntime ? {
        cuaDriver: {
          package: 'trycua/cua',
          version: cuaDriverVersion,
          prerelease: true,
          tag: cuaRuntime.tag,
          sourceCommit: cuaRuntime.sourceCommit,
          ...(cuaRuntime.archive ? {
            archive: cuaRuntime.archive.file,
            archiveSha256: cuaRuntime.archive.sha256,
          } : {}),
          ...(cuaRuntime.patch ? { patch: cuaRuntime.patch } : {}),
          ...(cuaRuntime.build ? { build: cuaRuntime.build } : {}),
          binarySha256: await sha256(cuaDriverOutput),
          license: 'MIT',
          licenseFile: 'THIRD_PARTY-LICENSES/cua-MIT.txt',
          scope: 'coding-computer-use-opt-in',
          targetScope: 'runtime-selected-visible-app-window',
          proxy: 'computer-use-proxy.cjs',
        },
      } : {}),
      localOcr: {
        package: '@napi-rs/system-ocr',
        version: systemOcrVersion,
        license: 'MIT',
        licenseFile: 'THIRD_PARTY-LICENSES/napi-rs-system-ocr-MIT.txt',
        scope: 'coding-attachments',
        available: Boolean(systemOcrNativePackage),
        ...(systemOcrNativePackage ? {} : {
          unavailableReason: 'no reviewed native system OCR package for this platform',
        }),
      },
    },
    libraries: {
      diff: {
        package: 'diff',
        version: diffVersion,
        license: 'BSD-3-Clause',
        licenseFile: 'THIRD_PARTY-LICENSES/diff-BSD-3-Clause.txt',
        scope: 'reviewed-lsp-fix',
      },
    },
    esbuild: { version: '0.28.1' },
    bridges: {
      chat: { file: 'chat-bridge.cjs', sha256: await sha256(chatOutput) },
      security: { file: 'security-bridge.cjs', sha256: await sha256(securityOutput) },
      computerUse: {
        file: 'computer-use-proxy.cjs',
        sha256: await sha256(computerUseProxyOutput),
      },
    },
  }
  await writeFile(join(output, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 })
  return output
}

async function smokeSidecar(platform) {
  const output = await buildSidecar(platform)
  for (const licensePath of [
    join(output, 'NODE-LICENSE'),
    join(output, 'THIRD_PARTY-LICENSES', 'pi-MIT.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'narumitw-pi-extensions-MIT.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'pi-better-background-tasks-MIT.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'pi-mcp-adapter-MIT.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'pi-sub-agent-MIT.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'napi-rs-system-ocr-MIT.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'playwright-mcp-Apache-2.0.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'playwright-Apache-2.0.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'playwright-core-Apache-2.0.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'gopls-BSD-3-Clause.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'diff-BSD-3-Clause.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'cua-MIT.txt'),
    join(output, 'computer-use-proxy.cjs'),
    join(output, 'pi-subagent-launcher.sh'),
    join(output, 'pi-subagent-runner.cjs'),
    join(output, 'current-provider-runtime.cjs'),
    join(output, 'known-context-window.cjs'),
    join(output, 'pi-subagent-cli.cjs'),
    join(output, 'dist', 'modes', 'interactive', 'theme', 'dark.json'),
    join(output, 'dist', 'modes', 'interactive', 'theme', 'light.json'),
    join(output, 'subagents', 'agents', 'worker.md'),
    join(output, 'cua-driver'),
    join(output, 'lsp-runtime', 'gopls'),
    join(output, 'lsp-runtime', 'node_modules', 'typescript-language-server', 'LICENSE'),
    join(output, 'lsp-runtime', 'node_modules', '@vue', 'language-server', 'LICENSE'),
    join(output, 'lsp-runtime', 'node_modules', 'typescript', 'LICENSE.txt'),
    join(output, 'skills', 'archify', 'LICENSE'),
    ...firstPartyCodingSkillNames.flatMap(name => [
      join(output, 'skills', name, 'SKILL.md'),
      join(output, 'skills', name, 'agents', 'openai.yaml'),
    ]),
  ]) {
    if (!await exists(licensePath)) {
      throw new Error(`packaged Sidecar is missing license file: ${licensePath}`)
    }
  }
  const cuaRuntime = await verifyPackagedCuaRuntime(output)
  const node = join(output, 'node')
  const workspace = join(repositoryRoot, 'build', 'sidecar-smoke', platform.replace('/', '-'))
  await mkdir(workspace, { recursive: true, mode: 0o700 })
  await mkdir(join(workspace, '.git'), { recursive: true, mode: 0o700 })
  const ocrFixture = join(workspace, 'ocr-fixture.png')
  await copyFile(
    join(repositoryRoot, 'docs', 'design', 'milksu-coding-composer-layout-reference.png'),
    ocrFixture,
  )
  const runtimeArguments = [
    '--permission',
    `--allow-fs-read=${output}`,
    `--allow-fs-read=${workspace}`,
    `--allow-fs-write=${workspace}`,
  ]
  const chatRuntimeArguments = [
    ...runtimeArguments,
    '--allow-addons',
    '--allow-child-process',
    `--allow-fs-write=${playwrightSocketRoot}`,
    '--allow-fs-read=/private/tmp/milksu-computer-use',
    '--allow-fs-write=/private/tmp/milksu-computer-use',
    '--allow-fs-read=/bin/bash',
    '--allow-fs-read=/bin/sh',
    '--allow-fs-read=/usr/bin/env',
    '--allow-fs-read=/usr/bin/sandbox-exec',
  ]
  const computerUseProxyRun = await runWithInput(
    node,
    [
      ...chatRuntimeArguments,
      join(output, 'computer-use-proxy.cjs'),
      '--socket',
      '/private/tmp/milksu-computer-use/computer_packaged-smoke/driver.sock',
      '--session',
      'computer_packaged-smoke',
      '--target-name',
      computerUsePackagedSmokeTarget.name,
      '--target-bundle-id',
      computerUsePackagedSmokeTarget.bundleId,
      '--target-pid',
      String(process.pid + computerUsePackagedSmokeTarget.pidOffset),
      '--target-window-id',
      String(computerUsePackagedSmokeTarget.windowId),
      '--driver',
      join(output, 'cua-driver'),
    ],
    [
      '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}',
      '{"jsonrpc":"2.0","id":2,"method":"tools/list"}',
      '',
    ].join('\n'),
    { cwd: workspace, env: { ...process.env, HOME: workspace, TMPDIR: workspace } },
  )
  const computerUseProxyResponses = computerUseProxyRun.stdout
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
  const computerUseTools = computerUseProxyResponses.find(value => value.id === 2)
    ?.result
    ?.tools
  if (
    computerUseTools?.length !== 1
    || computerUseTools[0]?.name !== 'computer_use'
    || !computerUseTools[0]?.description?.includes('visible App window selected by the user')
    || computerUseTools[0]?.description?.includes('MilkSU application window')
  ) {
    throw new Error(
      `packaged Computer Use proxy exposed an unexpected surface: `
      + computerUseProxyRun.stdout,
    )
  }
  const playwrightCli = join(
    output,
    'node_modules',
    '@playwright',
    'mcp',
    'cli.js',
  )
  const playwrightVersionRun = await runWithInput(
    node,
    [...runtimeArguments, playwrightCli, '--version'],
    '',
    { cwd: workspace, env: { ...process.env, HOME: workspace } },
  )
  if (!playwrightVersionRun.stdout.includes(playwrightMcpVersion)) {
    throw new Error(
      `packaged Playwright MCP did not load: `
      + `${playwrightVersionRun.stdout}${playwrightVersionRun.stderr}`,
    )
  }
  const lspRuntimeCliChecks = [
    {
      name: 'TypeScript language server',
      version: typescriptLanguageServerVersion,
      path: join(
        output,
        'lsp-runtime',
        'node_modules',
        'typescript-language-server',
        'lib',
        'cli.mjs',
      ),
    },
    {
      name: 'Vue language server',
      version: vueLanguageServerVersion,
      path: join(
        output,
        'lsp-runtime',
        'node_modules',
        '@vue',
        'language-server',
        'bin',
        'vue-language-server.js',
      ),
    },
  ]
  for (const check of lspRuntimeCliChecks) {
    const versionRun = await runWithInput(
      node,
      [...runtimeArguments, check.path, '--version'],
      '',
      {
        cwd: workspace,
        env: { ...process.env, HOME: workspace, TMPDIR: workspace },
      },
    )
    if (versionRun.stdout.trim() !== check.version) {
      throw new Error(
        `packaged ${check.name} did not load: `
        + `${versionRun.stdout}${versionRun.stderr}`,
      )
    }
  }
  const goplsVersionRun = await runWithInput(
    join(output, 'lsp-runtime', 'gopls'),
    ['version'],
    '',
    {
      cwd: workspace,
      env: {
        HOME: workspace,
        PATH: process.env.PATH ?? '/usr/bin:/bin',
        TMPDIR: workspace,
        LANG: process.env.LANG ?? 'en_US.UTF-8',
      },
    },
  )
  if (!goplsVersionRun.stdout.includes(`v${goplsVersion}`)) {
    throw new Error(
      `packaged gopls did not load: `
      + `${goplsVersionRun.stdout}${goplsVersionRun.stderr}`,
    )
  }
  const lspCodeActions = await verifyReviewedLspCodeActions({
    output,
    node,
    workspace,
    runtimeArguments,
  })
  const ocrLoad = await runWithInput(
    node,
    [
      ...runtimeArguments,
      '--allow-addons',
      '-e',
      "const {recognize}=require('@napi-rs/system-ocr');"
        + "recognize(process.argv[1],1,['zh-Hans','en-US']).then(result=>{"
        + "if(!result.text)throw new Error('empty OCR result');"
        + "process.stdout.write(`system-ocr-ready:${result.text.length}`)});",
      ocrFixture,
    ],
    '',
    { cwd: output, env: { ...process.env, HOME: output } },
  )
  if (!ocrLoad.stdout.startsWith('system-ocr-ready:')) {
    throw new Error(`packaged system OCR did not load: ${ocrLoad.stdout}${ocrLoad.stderr}`)
  }
  const securityRun = await runWithInput(
    node,
    [...runtimeArguments, join(output, 'security-bridge.cjs')],
    '{"action":"protocol_info","requestId":"packaged-smoke"}\n',
    { cwd: workspace, env: { ...process.env, HOME: workspace } },
  )
  const response = JSON.parse(securityRun.stdout.trim())
  if (response.protocol !== 'milksu-security-engine/v1alpha1' || response.inheritedTools?.length !== 0) {
    throw new Error(`unexpected packaged Security Sidecar response: ${securityRun.stdout}`)
  }
  const imageGenSmokeCredential = 'package-smoke-imagegen-credential-never-log'
  const chatRun = await runWithInput(
    node,
    [...chatRuntimeArguments, join(output, 'chat-bridge.cjs')],
    [
      '{"action":"create_session","conversationId":"packaged-smoke","executionMode":"go","approvalPolicy":"workspace-auto"}',
      '{"action":"destroy_session","conversationId":"packaged-smoke"}',
      '{"action":"create_session","conversationId":"packaged-skills-disabled","executionMode":"go","approvalPolicy":"workspace-auto","disabledSkills":["product-design","archify","../../untrusted"]}',
      '{"action":"destroy_session","conversationId":"packaged-skills-disabled"}',
      '',
    ].join('\n'),
    {
      cwd: workspace,
      env: {
        ...process.env,
        HOME: workspace,
        OPENAI_API_KEY: imageGenSmokeCredential,
      },
    },
  )
  const chatResponses = chatRun.stdout.trim().split('\n').map(line => JSON.parse(line))
  const ready = chatResponses.find(value => (
    value.type === 'ready' && value.id === 'packaged-smoke'
  ))
  const disabledSkillsReady = chatResponses.find(value => (
    value.type === 'ready' && value.id === 'packaged-skills-disabled'
  ))
  const coreExpectedTools = [
    'read',
    'bash',
    'edit',
    'write',
    'grep',
    'find',
    'ls',
  ]
  const expectedTools = [
    ...coreExpectedTools,
    'bg_task',
    'bg_status',
    'milksu_imagegen',
    'lsp_diagnostics',
    'lsp_fix',
    'goal_complete',
    'goal_blocked',
  ]
  const ctfRequestedTools = [...coreExpectedTools, 'ctf_inspect']
  if (
    !ready
    || !expectedTools.every(tool => ready.tools?.includes(tool))
    || ready.executionMode !== 'go'
    || ready.approvalPolicy !== 'workspace-auto'
    || !['archify', ...firstPartyCodingSkillNames]
      .every(name => ready.skills?.includes(name))
    || !disabledSkillsReady
    || disabledSkillsReady.skills?.includes('product-design')
    || disabledSkillsReady.skills?.includes('archify')
    || !firstPartyCodingSkillNames
      .filter(name => name !== 'product-design')
      .every(name => disabledSkillsReady.skills?.includes(name))
    || !ready.extensions?.includes('pi-lsp')
    || !ready.extensions?.includes('pi-goal')
    || !ready.extensions?.includes('pi-background-tasks')
    || ready.tools?.includes('mcp')
    || ready.tools?.includes('subagent')
    || !ready.capabilities?.some(
      capability => capability.id === 'computer-use'
        && capability.status === 'unavailable',
    )
    || !ready.capabilities?.some(
      capability => capability.id === 'imagegen'
        && capability.status === 'approval-required',
    )
    || chatRun.stdout.includes(imageGenSmokeCredential)
    || chatRun.stderr.includes(imageGenSmokeCredential)
    || !chatResponses.some(value => value.type === 'session_destroyed')
  ) {
    throw new Error(`unexpected packaged Chat Sidecar response: ${chatRun.stdout}`)
  }
  const collaborationConversation = 'packaged-collaboration'
  const collaborationKey = createHash('sha256')
    .update(collaborationConversation)
    .digest('hex')
    .slice(0, 32)
  const collaborationRoot = join(workspace, 'collaboration-runtime')
  const collaborationWorktree = join(
    collaborationRoot,
    collaborationKey,
    'writer-1',
  )
  await mkdir(collaborationWorktree, { recursive: true, mode: 0o700 })
  const collaborationBranch = `codex/agent-${collaborationKey.slice(0, 12)}-writer-1`
  await writeFile(
    join(collaborationRoot, collaborationKey, 'manifest.json'),
    `${JSON.stringify({
      schemaVersion: 2,
      conversationId: collaborationConversation,
      workspace,
      baseBranch: 'main',
      baseHead: 'a'.repeat(40),
      phase: 'active',
      worktrees: [{
        id: 'writer-1',
        path: collaborationWorktree,
        branch: collaborationBranch,
        baseHead: 'a'.repeat(40),
        provisioned: true,
        prepared: true,
      }],
    }, null, 2)}\n`,
    { mode: 0o600 },
  )
  const collaborationRun = await runWithInput(
    node,
    [...chatRuntimeArguments, join(output, 'chat-bridge.cjs')],
    [
      JSON.stringify({
        action: 'create_session',
        conversationId: collaborationConversation,
        executionMode: 'go',
        approvalPolicy: 'workspace-auto',
        codingCollaboration: {
          schemaVersion: 2,
          conversationId: collaborationConversation,
          workspace,
          baseHead: 'a'.repeat(40),
          worktrees: [{
            id: 'writer-1',
            path: collaborationWorktree,
            branch: collaborationBranch,
          }],
        },
      }),
      JSON.stringify({
        action: 'destroy_session',
        conversationId: collaborationConversation,
      }),
      '',
    ].join('\n'),
    {
      cwd: workspace,
      env: {
        ...process.env,
        HOME: workspace,
        MILKSU_CODING_COLLABORATION_ROOT: collaborationRoot,
      },
    },
  )
  const collaborationResponses = collaborationRun.stdout
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
  const collaborationReady = collaborationResponses.find(
    value => value.type === 'ready',
  )
  if (
    !collaborationReady?.tools?.includes('subagent')
    || !collaborationReady?.extensions?.includes('pi-sub-agent')
    || !collaborationReady.capabilities?.some(
      capability => capability.id === 'collaboration'
        && capability.status === 'allowed',
    )
    || collaborationResponses.some(value => value.type === 'error')
  ) {
    throw new Error(
      `unexpected packaged Coding collaboration response: `
      + collaborationRun.stdout,
    )
  }
  const subagentSmokePromptDirectory = join(
    workspace,
    'pi-subagent-package-smoke',
  )
  const subagentSmokePrompt = join(
    subagentSmokePromptDirectory,
    'prompt-worker.md',
  )
  await mkdir(subagentSmokePromptDirectory, {
    recursive: true,
    mode: 0o700,
  })
  await writeFile(
    subagentSmokePrompt,
    'You are the packaged MilkSU subagent smoke fixture.\n',
    { mode: 0o600 },
  )
  const relaySentinel = 'package-smoke-sentinel-never-log'
  const relaySmokeModel = 'milksu-package-smoke-model'
  const relaySmokeReply = 'MILKSU-PACKAGED-SUBAGENT-OK'
  const relaySmokeServer = createHttpServer((_request, response) => {
    response.writeHead(200, {
      'content-type': 'text/event-stream',
      connection: 'keep-alive',
    })
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-milksu-smoke',
      object: 'chat.completion.chunk',
      created: 1,
      model: relaySmokeModel,
      choices: [{
        index: 0,
        delta: { role: 'assistant', content: relaySmokeReply },
        finish_reason: null,
      }],
    })}\n\n`)
    response.write(`data: ${JSON.stringify({
      id: 'chatcmpl-milksu-smoke',
      object: 'chat.completion.chunk',
      created: 1,
      model: relaySmokeModel,
      choices: [{
        index: 0,
        delta: {},
        finish_reason: 'stop',
      }],
    })}\n\n`)
    response.end('data: [DONE]\n\n')
  })
  await new Promise((resolvePromise, rejectPromise) => {
    relaySmokeServer.once('error', rejectPromise)
    relaySmokeServer.listen(0, '127.0.0.1', resolvePromise)
  })
  let subagentRunnerRun
  try {
    const relayAddress = relaySmokeServer.address()
    if (!relayAddress || typeof relayAddress === 'string') {
      throw new Error('packaged subagent smoke relay did not bind a TCP port')
    }
    subagentRunnerRun = await runWithInput(
      '/bin/sh',
      [
        join(output, 'pi-subagent-launcher.sh'),
        node,
        join(output, 'pi-subagent-runner.cjs'),
        '--mode',
        'json',
        '-p',
        '--no-extensions',
        '--no-skills',
        '--no-prompt-templates',
        '--no-themes',
        '--no-context-files',
        '--no-approve',
        '--no-session',
        '--append-system-prompt',
        subagentSmokePrompt,
        '--model',
        `milksu-relay/${relaySmokeModel}`,
      ],
      'Return only the packaged subagent smoke receipt.',
      {
        cwd: collaborationWorktree,
        env: {
          ...process.env,
          HOME: workspace,
          TMPDIR: workspace,
          NODE_OPTIONS: '--permission',
          MILKSU_PI_SUBAGENT_AGENT: 'worker',
          MILKSU_CODING_COLLABORATION_ROOT: collaborationRoot,
          MILKSU_PI_SUBAGENT_CLI: join(output, 'pi-subagent-cli.cjs'),
          MILKSU_RELAY_KEY: relaySentinel,
          MILKSU_RELAY_URL: `http://127.0.0.1:${relayAddress.port}/v1`,
        },
      },
    )
  } finally {
    await new Promise(resolvePromise => relaySmokeServer.close(resolvePromise))
  }
  if (
    !subagentRunnerRun.stdout.includes(relaySmokeReply)
    || subagentRunnerRun.stdout.includes(relaySentinel)
    || subagentRunnerRun.stderr.includes(relaySentinel)
  ) {
    throw new Error(
      `packaged subagent runner did not load its isolated Relay model: `
      + `${subagentRunnerRun.stdout}${subagentRunnerRun.stderr}`,
    )
  }
  const backgroundTasksDirectory = join(workspace, 'background-control')
  const backgroundTaskId = 'bg_packaged_control'
  const backgroundTaskDirectory = join(
    backgroundTasksDirectory,
    'tasks',
    backgroundTaskId,
  )
  const backgroundTaskNow = Date.now()
  await mkdir(backgroundTaskDirectory, { recursive: true, mode: 0o700 })
  await writeFile(join(backgroundTaskDirectory, 'meta.json'), `${JSON.stringify({
    id: backgroundTaskId,
    name: 'Packaged control receipt',
    kind: 'process',
    status: 'succeeded',
    startedAt: backgroundTaskNow - 1000,
    endedAt: backgroundTaskNow,
    logPath: join(backgroundTaskDirectory, 'output.log'),
    cwd: workspace,
    spawnPid: process.pid,
    callbackOrigin: {
      cwd: workspace,
      sessionId: 'packaged-background-control',
    },
  }, null, 2)}\n`, { mode: 0o600 })
  const backgroundControlRun = await runWithInput(
    node,
    [...chatRuntimeArguments, join(output, 'chat-bridge.cjs')],
    [
      '{"action":"create_session","conversationId":"packaged-background-control","executionMode":"go","approvalPolicy":"workspace-auto"}',
      JSON.stringify({
        action: 'background_task_control',
        conversationId: 'packaged-background-control',
        requestId: 'packaged-background-control-1',
        control: 'stop',
        taskId: backgroundTaskId,
      }),
      '{"action":"destroy_session","conversationId":"packaged-background-control"}',
      '',
    ].join('\n'),
    {
      cwd: workspace,
      env: {
        ...process.env,
        HOME: workspace,
        MILKSU_BACKGROUND_TASKS_DIR: backgroundTasksDirectory,
      },
    },
  )
  const backgroundControlResponses = backgroundControlRun.stdout
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
  const backgroundControlReceipt = backgroundControlResponses.find(
    value => value.type === 'background_task_controlled',
  )
  if (
    backgroundControlReceipt?.requestId !== 'packaged-background-control-1'
    || backgroundControlReceipt?.error
    || !backgroundControlReceipt?.tasks?.some(
      task => task.id === backgroundTaskId && task.status === 'succeeded',
    )
  ) {
    throw new Error(
      `unexpected packaged background control response: ${backgroundControlRun.stdout}`,
    )
  }
  const mcpConfig = `${JSON.stringify({
    mcpServers: {
      fixture: {
        command: '/bin/sh',
        args: ['-c', 'printf fixture-ready'],
        includeTools: ['fixture_read'],
        milksu: {
          source: 'fixture:local-shell',
          version: '1.0.0',
          taskScope: 'packaged MCP smoke',
        },
      },
    },
  }, null, 2)}\n`
  await writeFile(join(workspace, '.mcp.json'), mcpConfig, { mode: 0o600 })
  const mcpRun = await runWithInput(
    node,
    [...chatRuntimeArguments, join(output, 'chat-bridge.cjs')],
    [
      JSON.stringify({
        action: 'create_session',
        conversationId: 'packaged-mcp',
        executionMode: 'go',
        approvalPolicy: 'workspace-auto',
        mcpServers: ['fixture'],
        mcpConfigDigest: createHash('sha256').update(mcpConfig).digest('hex'),
      }),
      '{"action":"destroy_session","conversationId":"packaged-mcp"}',
      '',
    ].join('\n'),
    { cwd: workspace, env: { ...process.env, HOME: workspace } },
  )
  const mcpResponses = mcpRun.stdout.trim().split('\n').map(line => JSON.parse(line))
  const mcpReady = mcpResponses.find(value => value.type === 'ready')
  if (
    !mcpReady?.tools?.includes('mcp')
    || !mcpReady?.extensions?.includes('pi-mcp-adapter')
    || !mcpResponses.some(value => value.type === 'session_destroyed')
    || mcpResponses.some(value => value.type === 'error')
  ) {
    throw new Error(`unexpected packaged MCP response: ${mcpRun.stdout}`)
  }
  const codingBrowserRun = await runWithInput(
    node,
    [...chatRuntimeArguments, join(output, 'chat-bridge.cjs')],
    [
      JSON.stringify({
        action: 'create_session',
        conversationId: 'packaged-coding-browser',
        executionMode: 'go',
        approvalPolicy: 'workspace-auto',
        codingBrowser: {
          sessionId: 'browser_12345678-abcd-4567-8901-123456789abc',
          cdpEndpoint: 'http://127.0.0.1:43127',
        },
      }),
      '{"action":"destroy_session","conversationId":"packaged-coding-browser"}',
      '',
    ].join('\n'),
    { cwd: workspace, env: { ...process.env, HOME: workspace } },
  )
  const codingBrowserResponses = codingBrowserRun.stdout
    .trim()
    .split('\n')
    .map(line => JSON.parse(line))
  await rm(
    join(playwrightSocketRoot, '123456789abc'),
    { recursive: true, force: true },
  )
  const codingBrowserReady = codingBrowserResponses.find(value => value.type === 'ready')
  const codingBrowserEvidenceDirectory = join(
    workspace,
    '.milksu',
    'browser-evidence',
    'browser_12345678-abcd-4567-8901-123456789abc',
  )
  if (
    !codingBrowserReady?.tools?.includes('mcp')
    || !codingBrowserReady?.extensions?.includes('pi-mcp-adapter')
    || !codingBrowserReady.capabilities?.some(
      capability => capability.id === 'browser'
        && capability.status === 'allowed'
        && capability.detail.includes('MilkSU 隔离浏览器'),
    )
    || !codingBrowserResponses.some(value => value.type === 'session_destroyed')
    || codingBrowserResponses.some(value => value.type === 'error')
    || !(await exists(codingBrowserEvidenceDirectory))
  ) {
    throw new Error(
      `unexpected packaged Coding Browser response: ${codingBrowserRun.stdout}`,
    )
  }
  const computerUseSessionId = 'computer_packaged-runtime'
  const computerUseDirectory = join(
    '/private/tmp/milksu-computer-use',
    computerUseSessionId,
  )
  const computerUseSocketPath = join(computerUseDirectory, 'driver.sock')
  await rm(computerUseDirectory, { recursive: true, force: true })
  await mkdir(computerUseDirectory, { recursive: true, mode: 0o700 })
  const computerUseSocket = createNetServer()
  await new Promise((resolvePromise, rejectPromise) => {
    computerUseSocket.once('error', rejectPromise)
    computerUseSocket.listen(computerUseSocketPath, resolvePromise)
  })
  try {
    const computerUseRun = await runWithInput(
      node,
      [...chatRuntimeArguments, join(output, 'chat-bridge.cjs')],
      [
        JSON.stringify({
          action: 'create_session',
          conversationId: 'packaged-computer-use',
          executionMode: 'go',
          approvalPolicy: 'workspace-auto',
          computerUse: {
            sessionId: computerUseSessionId,
            socketPath: computerUseSocketPath,
            targetBundleId: computerUsePackagedSmokeTarget.bundleId,
            targetName: computerUsePackagedSmokeTarget.name,
            targetPid: process.pid + computerUsePackagedSmokeTarget.pidOffset,
            targetWindowId: computerUsePackagedSmokeTarget.windowId,
          },
        }),
        '{"action":"destroy_session","conversationId":"packaged-computer-use"}',
        '',
      ].join('\n'),
      { cwd: workspace, env: { ...process.env, HOME: workspace } },
    )
    const computerUseResponses = computerUseRun.stdout
      .trim()
      .split('\n')
      .map(line => JSON.parse(line))
    const computerUseReady = computerUseResponses.find(value => value.type === 'ready')
    if (
      !computerUseReady?.tools?.includes('mcp')
      || !computerUseReady?.extensions?.includes('pi-mcp-adapter')
      || !computerUseReady.capabilities?.some(
        capability => capability.id === 'computer-use'
          && capability.status === 'allowed'
          && capability.detail.includes('模型不能改 PID、窗口或桌面范围'),
      )
      || !computerUseReady.capabilities?.some(
        capability => capability.id === 'computer-use'
          && capability.detail.includes(computerUsePackagedSmokeTarget.name)
          && capability.detail.includes(computerUsePackagedSmokeTarget.bundleId),
      )
      || !computerUseResponses.some(value => value.type === 'session_destroyed')
      || computerUseResponses.some(value => value.type === 'error')
    ) {
      throw new Error(
        `unexpected packaged Computer Use response: ${computerUseRun.stdout}`,
      )
    }
  } finally {
    await new Promise(resolvePromise => computerUseSocket.close(resolvePromise))
    await rm(computerUseDirectory, { recursive: true, force: true })
  }
  const planRun = await runWithInput(
    node,
    [...chatRuntimeArguments, join(output, 'chat-bridge.cjs')],
    [
      '{"action":"create_session","conversationId":"packaged-plan","executionMode":"plan","approvalPolicy":"workspace-auto"}',
      '{"action":"destroy_session","conversationId":"packaged-plan"}',
      '',
    ].join('\n'),
    { cwd: workspace, env: { ...process.env, HOME: workspace } },
  )
  const planResponses = planRun.stdout.trim().split('\n').map(line => JSON.parse(line))
  const planReady = planResponses.find(value => value.type === 'ready')
  if (
    !planReady
    || ['bash', 'edit', 'write', 'bg_task', 'lsp_fix', 'mcp'].some(
      tool => planReady.tools?.includes(tool),
    )
    || planReady.extensions?.includes('pi-mcp-adapter')
    || ![
      'read',
      'grep',
      'find',
      'ls',
      'bg_status',
      'lsp_diagnostics',
      'goal_complete',
      'goal_blocked',
    ].every(tool => planReady.tools?.includes(tool))
    || planReady.executionMode !== 'plan'
  ) {
    throw new Error(`unexpected packaged Plan response: ${planRun.stdout}`)
  }
  const nonGitWorkspace = join(
    repositoryRoot,
    'build',
    'sidecar-smoke-non-git',
    platform.replace('/', '-'),
  )
  await mkdir(nonGitWorkspace, { recursive: true, mode: 0o700 })
  const nonGitArguments = [
    '--permission',
    `--allow-fs-read=${output}`,
    `--allow-fs-read=${nonGitWorkspace}`,
    `--allow-fs-write=${nonGitWorkspace}`,
    '--allow-child-process',
    '--allow-fs-read=/bin/bash',
    '--allow-fs-read=/bin/sh',
    '--allow-fs-read=/usr/bin/env',
    '--allow-fs-read=/usr/bin/sandbox-exec',
  ]
  const nonGitRun = await runWithInput(
    node,
    [...nonGitArguments, join(output, 'chat-bridge.cjs')],
    [
      '{"action":"create_session","conversationId":"packaged-non-git","executionMode":"plan","approvalPolicy":"workspace-auto"}',
      '{"action":"destroy_session","conversationId":"packaged-non-git"}',
      '',
    ].join('\n'),
    { cwd: nonGitWorkspace, env: { ...process.env, HOME: nonGitWorkspace } },
  )
  const nonGitResponses = nonGitRun.stdout.trim().split('\n').map(line => JSON.parse(line))
  if (
    !nonGitResponses.some(value => value.type === 'ready')
    || !nonGitResponses.some(value => value.type === 'session_destroyed')
    || nonGitResponses.some(value => value.type === 'error')
  ) {
    throw new Error(`unexpected packaged non-Git workspace response: ${nonGitRun.stdout}`)
  }
  const ctfWorkspace = join(workspace, 'ctf-coach')
  await mkdir(join(ctfWorkspace, '.git'), { recursive: true, mode: 0o700 })
  await writeFile(join(ctfWorkspace, 'challenge.json'), `${JSON.stringify({
    schemaVersion: 'ctf-workspace.milksu.dev/v1alpha2',
    source: {
      scope: {
        id: 'scope_packaged_ctf_coach',
        source: 'sidecar-smoke:offline',
        purpose: 'packaged CTF Coach smoke',
        targets: [{ kind: 'directory', value: 'workspace' }],
        grantedBy: 'local-user',
        createdAt: new Date(Date.now() - 60_000).toISOString(),
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        revocable: true,
      },
    },
    networkScopes: [],
    policy: {
      mode: 'coach',
      allowedTools: ctfRequestedTools,
      execution: {
        workspaceOnly: true,
        defaultCommandTimeoutSeconds: 120,
        maxCommandTimeoutSeconds: 300,
        maxToolEventOutputBytes: 60000,
      },
    },
  }, null, 2)}\n`, { mode: 0o600 })
  const ctfRuntimeArguments = [
    '--permission',
    `--allow-fs-read=${output}`,
    `--allow-fs-read=${ctfWorkspace}`,
    `--allow-fs-write=${ctfWorkspace}`,
    '--allow-child-process',
    '--allow-fs-read=/bin/bash',
    '--allow-fs-read=/bin/sh',
    '--allow-fs-read=/usr/bin/env',
    '--allow-fs-read=/usr/bin/sandbox-exec',
  ]
  const ctfChatRun = await runWithInput(
    node,
    [...ctfRuntimeArguments, join(output, 'chat-bridge.cjs')],
    [
      JSON.stringify({
        action: 'create_session',
        conversationId: 'packaged-ctf-coach',
        sessionRole: 'solver',
        computerUse: {
          sessionId: 'computer_must-not-enter-ctf',
          socketPath:
            '/private/tmp/milksu-computer-use/computer_must-not-enter-ctf/driver.sock',
          targetBundleId: computerUsePackagedSmokeTarget.bundleId,
          targetName: computerUsePackagedSmokeTarget.name,
          targetPid: process.pid + computerUsePackagedSmokeTarget.pidOffset,
          targetWindowId: computerUsePackagedSmokeTarget.windowId,
        },
      }),
      '{"action":"destroy_session","conversationId":"packaged-ctf-coach"}',
      '',
    ].join('\n'),
    { cwd: ctfWorkspace, env: { ...process.env, HOME: ctfWorkspace } },
  )
  const ctfChatResponses = ctfChatRun.stdout.trim().split('\n').map(line => JSON.parse(line))
  const ctfReady = ctfChatResponses.find(value => value.type === 'ready')
  const coachTools = [
    'read', 'edit', 'write', 'grep', 'find', 'ls',
    'ctf_inspect', 'ctf_request_endpoint',
  ]
  if (
    !ctfReady
    || ctfReady.tools?.includes('bash')
    || ctfReady.tools?.includes('lsp_diagnostics')
    || ctfReady.tools?.includes('lsp_fix')
    || ['archify', ...firstPartyCodingSkillNames]
      .some(name => ctfReady.skills?.includes(name))
    || ctfReady.extensions?.includes('pi-lsp')
    || ctfReady.extensions?.includes('pi-goal')
    || ctfReady.extensions?.includes('pi-mcp-adapter')
    || ctfReady.tools?.includes('mcp')
    || ctfReady.tools?.includes('goal_complete')
    || ctfReady.tools?.includes('goal_blocked')
    || !coachTools.every(tool => ctfReady.tools?.includes(tool))
    || !ctfChatResponses.some(value => value.type === 'session_destroyed')
  ) {
    throw new Error(`unexpected packaged CTF Coach response: ${ctfChatRun.stdout}`)
  }
  const bashProbe = await runWithInput(
    node,
    [
      ...chatRuntimeArguments,
      '-e',
      [
        'const { existsSync } = require("node:fs");',
        'const { spawn } = require("node:child_process");',
        'if (!existsSync("/bin/bash")) throw new Error("bash is unavailable");',
        'const child = spawn("/bin/bash", ["-c", "printf packaged-bash-ok"]);',
        'child.stdout.pipe(process.stdout);',
        'child.stderr.pipe(process.stderr);',
        'child.on("close", code => { if (code) process.exitCode = code; });',
      ].join(' '),
    ],
    '',
    { cwd: workspace, env: { ...process.env, HOME: workspace } },
  )
  if (bashProbe.stdout !== 'packaged-bash-ok') {
    throw new Error(`unexpected packaged Bash probe: ${bashProbe.stdout}\n${bashProbe.stderr}`)
  }
  const { stdout: codingDeliveryOutput } = await execFileAsync(
    process.execPath,
    [join(repositoryRoot, 'scripts', 'test-coding-agent-delivery.mjs')],
    {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        MILKSU_CODING_SIDECAR_NODE: node,
      },
      maxBuffer: 4 * 1024 * 1024,
      timeout: 60_000,
    },
  )
  const codingDelivery = JSON.parse(codingDeliveryOutput)
  if (!codingDelivery.passed || codingDelivery.score !== 100) {
    throw new Error(`packaged Coding delivery failed: ${codingDeliveryOutput}`)
  }
  process.stdout.write(`${JSON.stringify({
    ...response,
    codingDeliveryScore: codingDelivery.score,
    lspCodeActions,
    computerUse: cuaRuntime,
  })}\n`)
}

async function installSidecar(platform, binaryPath) {
  if (!binaryPath) throw new Error('--bin is required for Sidecar installation')
  const codesignIdentity = resolveCodesignIdentity()
  const source = await buildSidecar(platform)
  const absoluteBinary = resolve(repositoryRoot, binaryPath)
  if (!absoluteBinary.includes('.app/Contents/MacOS/')) {
    throw new Error(`macOS App binary path was not recognised: ${absoluteBinary}`)
  }
  const contents = dirname(dirname(absoluteBinary))
  const destination = join(contents, 'Resources', 'milksu-sidecar')
  const application = dirname(contents)
  const distributableFiles = [
    'node',
    'chat-bridge.cjs',
    'security-bridge.cjs',
    'computer-use-proxy.cjs',
    'pi-subagent-launcher.sh',
    'pi-subagent-runner.cjs',
    'current-provider-runtime.cjs',
    'known-context-window.cjs',
    'pi-subagent-cli.cjs',
    'cua-driver',
    'manifest.json',
    'package.json',
    'NODE-LICENSE',
  ]
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true, mode: 0o700 })
  await Promise.all(distributableFiles.map(file => copyFile(join(source, file), join(destination, file))))
  await cp(join(source, 'skills'), join(destination, 'skills'), { recursive: true })
  await cp(join(source, 'subagents'), join(destination, 'subagents'), { recursive: true })
  await cp(join(source, 'dist'), join(destination, 'dist'), { recursive: true })
  await cp(
    join(source, 'THIRD_PARTY-LICENSES'),
    join(destination, 'THIRD_PARTY-LICENSES'),
    { recursive: true },
  )
  await cp(join(source, 'lsp-runtime'), join(destination, 'lsp-runtime'), { recursive: true })
  await cp(join(source, 'node_modules'), join(destination, 'node_modules'), { recursive: true })
  const installedOcrPackage = join(
    destination,
    'node_modules',
    ...systemOcrNativePackages[platform].split('/'),
  )
  for (const requiredPath of [
    join(destination, 'THIRD_PARTY-LICENSES', 'napi-rs-system-ocr-MIT.txt'),
    installedOcrPackage,
    join(
      destination,
      'lsp-runtime',
      'node_modules',
      '@vue',
      'language-server',
      'bin',
      'vue-language-server.js',
    ),
    join(
      destination,
      'lsp-runtime',
      'node_modules',
      'typescript-language-server',
      'lib',
      'cli.mjs',
    ),
    join(destination, 'lsp-runtime', 'gopls'),
    join(destination, 'node_modules', '@playwright', 'mcp', 'cli.js'),
    join(destination, 'node_modules', 'playwright', 'cli.js'),
    join(destination, 'node_modules', 'playwright-core', 'package.json'),
    join(
      destination,
      'THIRD_PARTY-LICENSES',
      'gopls-BSD-3-Clause.txt',
    ),
    join(
      destination,
      'THIRD_PARTY-LICENSES',
      'diff-BSD-3-Clause.txt',
    ),
    join(
      destination,
      'THIRD_PARTY-LICENSES',
      'cua-MIT.txt',
    ),
    join(destination, 'computer-use-proxy.cjs'),
    join(destination, 'cua-driver'),
  ]) {
    if (!await exists(requiredPath)) {
      throw new Error(`installed Sidecar is missing runtime artifact: ${requiredPath}`)
    }
  }
  await chmod(join(destination, 'node'), 0o755)
  await chmod(join(destination, 'cua-driver'), 0o755)
  await chmod(join(destination, 'lsp-runtime', 'gopls'), 0o755)
  if (codesignIdentity !== '-') {
    await signMachOFiles(destination, codesignIdentity)
  } else {
    await execFileAsync('/usr/bin/codesign', [
      '--force',
      '--sign',
      codesignIdentity,
      join(destination, 'cua-driver'),
    ])
  }
  await execFileAsync('/usr/bin/codesign', [
    '--force',
    ...(codesignIdentity === '-'
      ? ['--deep']
      : [
          '--options', 'runtime',
          '--timestamp',
          '--entitlements', join(repositoryRoot, 'desktop', 'build', 'entitlements.mac.plist'),
        ]),
    '--sign',
    codesignIdentity,
    application,
  ])
  const packagedNode = join(destination, 'node')
  const { stdout: packagedNodeVersion } = await execFileAsync(
    packagedNode,
    ['--version'],
    { timeout: 15_000 },
  )
  if (packagedNodeVersion.trim() !== `v${nodeVersion}`) {
    throw new Error(
      `signed packaged Node failed version check: ${packagedNodeVersion.trim() || '(empty)'}`,
    )
  }
  const signing = await inspectCodesign(application)
  if (stableCodesignRequired) {
    assertStableCodesign(application, signing)
  }
  process.stdout.write(
    `MilkSU app signing: Identifier=${signing.identifier || 'unknown'} Signature=${signing.signature || 'unknown'} TeamIdentifier=${signing.teamIdentifier || 'unknown'}\n`,
  )
  process.stdout.write(`Installed MilkSU Sidecar into ${destination}\n`)
}

const command = process.argv[2] ?? 'build'
const platform = argument('platform', currentPlatform())
if (command === 'build') {
  process.stdout.write(`${await buildSidecar(platform)}\n`)
} else if (command === 'smoke') {
  await smokeSidecar(platform)
} else if (command === 'install') {
  await installSidecar(platform, argument('bin'))
} else {
  throw new Error(`unknown Sidecar packaging command: ${command}`)
}
