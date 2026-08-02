import { createHash } from 'node:crypto'
import { execFile, spawn } from 'node:child_process'
import { chmod, copyFile, cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { build } from 'esbuild'

const execFileAsync = promisify(execFile)
const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const nodeVersion = '24.18.0'
const archifyCommit = '7b49d0b715fd4ba48116bcdecd1ba3789a279613'
const piVersion = '0.83.0'
const piLspVersion = '0.29.0'
const piGoalVersion = '0.43.0'
const piBackgroundTasksVersion = '0.1.10'
const piMcpAdapterVersion = '2.17.0'
const playwrightMcpVersion = '0.0.78'
const playwrightVersion = '1.62.0-alpha-1783623505000'
const playwrightSocketRoot = '/private/tmp/milksu-playwright'
const systemOcrVersion = '1.1.0'
const typescriptLanguageServerVersion = '5.3.0'
const vueLanguageServerVersion = '3.3.9'
const typescriptVersion = '6.0.3'
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
}

function argument(name, fallback = undefined) {
  const prefix = `--${name}=`
  const inline = process.argv.find(value => value.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
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
  while (current === repositoryRoot || current.startsWith(`${repositoryRoot}/`)) {
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
  const runtimeRoot = join(cache, `node-v${nodeVersion}`)
  const runtimeBinary = join(runtimeRoot, 'bin', 'node')
  await mkdir(cache, { recursive: true, mode: 0o700 })

  let archiveValid = await exists(archivePath) && await sha256(archivePath) === archive.sha256
  if (!archiveValid) {
    await download(`https://nodejs.org/download/release/v${nodeVersion}/${archive.file}`, archivePath)
    archiveValid = await sha256(archivePath) === archive.sha256
  }
  if (!archiveValid) throw new Error(`official Node archive checksum mismatch: ${archive.file}`)

  if (!await exists(runtimeBinary)) {
    await mkdir(runtimeRoot, { recursive: true, mode: 0o700 })
    const archiveDirectory = archive.file.replace(/\.tar\.xz$/, '')
    await execFileAsync('/usr/bin/tar', [
      '-xJf', archivePath,
      '-C', runtimeRoot,
      '--strip-components=1',
      `${archiveDirectory}/bin/node`,
      `${archiveDirectory}/LICENSE`,
    ])
  }
  return { binary: runtimeBinary, license: join(runtimeRoot, 'LICENSE'), archive }
}

async function officialGoplsRuntime(platform) {
  const [goos, goarch] = platform.split('/')
  if (goos !== 'darwin' || !['arm64', 'amd64'].includes(goarch)) {
    throw new Error(`unsupported gopls platform: ${platform}`)
  }
  const cache = join(repositoryRoot, 'build', 'sidecar-cache', platform.replace('/', '-'))
  const runtimeRoot = join(cache, `gopls-v${goplsVersion}`)
  const runtimeBinary = join(runtimeRoot, 'gopls')
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
  const { stdout: moduleDownloadOutput } = await execFileAsync(
    'go',
    ['mod', 'download', '-json', moduleReference],
    {
      cwd: repositoryRoot,
      maxBuffer: 4 * 1024 * 1024,
      timeout: 120_000,
    },
  )
  const moduleDownload = JSON.parse(moduleDownloadOutput)
  if (
    moduleDownload.Path !== goplsSource.module
    || moduleDownload.Version !== `v${goplsVersion}`
    || moduleDownload.Sum !== goplsSource.moduleSum
    || moduleDownload.GoModSum !== goplsSource.goModSum
    || moduleDownload.Origin?.URL !== goplsSource.originURL
    || moduleDownload.Origin?.Hash !== goplsSource.originHash
    || moduleDownload.Origin?.Ref !== goplsSource.originRef
    || typeof moduleDownload.Dir !== 'string'
  ) {
    throw new Error(`gopls source verification failed: ${moduleDownloadOutput}`)
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
    const child = spawn(executable, argumentsList, { ...options, stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timeout = setTimeout(() => child.kill('SIGKILL'), 15_000)
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

async function buildSidecar(platform) {
  const runtime = await officialNodeRuntime(platform)
  const goplsRuntime = await officialGoplsRuntime(platform)
  const output = join(repositoryRoot, 'build', 'sidecar', platform.replace('/', '-'))
  await mkdir(output, { recursive: true, mode: 0o700 })
  const nodeOutput = join(output, 'node')
  const chatOutput = join(output, 'chat-bridge.cjs')
  const securityOutput = join(output, 'security-bridge.cjs')
  const archifySource = join(repositoryRoot, 'third_party', 'archify', 'archify')
  const archifyOutput = join(output, 'skills', 'archify')
  const licenseOutput = join(output, 'THIRD_PARTY-LICENSES')
  const archifyPackage = JSON.parse(await readFile(join(archifySource, 'package.json'), 'utf8'))
  const systemOcrNativePackage = systemOcrNativePackages[platform]
  if (!systemOcrNativePackage) {
    throw new Error(`system OCR does not support Sidecar platform: ${platform}`)
  }
  const systemOcrSource = join(repositoryRoot, 'node_modules', '@napi-rs', 'system-ocr')
  const systemOcrNativeSource = join(
    repositoryRoot,
    'node_modules',
    ...systemOcrNativePackage.split('/'),
  )
  if (!await exists(systemOcrSource) || !await exists(systemOcrNativeSource)) {
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
  const goplsOutput = join(lspRuntimeOutput, 'gopls')
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
  await rm(systemOcrOutputRoot, { recursive: true, force: true })
  await rm(lspRuntimeOutput, { recursive: true, force: true })
  await Promise.all(
    playwrightPackages.map(packageInfo => rm(
      packageInfo.output,
      { recursive: true, force: true },
    )),
  )
  await mkdir(dirname(archifyOutput), { recursive: true, mode: 0o700 })
  await mkdir(systemOcrOutputRoot, { recursive: true, mode: 0o700 })
  await mkdir(join(lspRuntimeOutput, 'node_modules'), { recursive: true, mode: 0o700 })
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
      join(repositoryRoot, 'node_modules', 'pi-better-background-tasks', 'LICENSE'),
      join(licenseOutput, 'pi-better-background-tasks-MIT.txt'),
    ),
    copyFile(
      join(repositoryRoot, 'node_modules', 'pi-mcp-adapter', 'LICENSE'),
      join(licenseOutput, 'pi-mcp-adapter-MIT.txt'),
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
    cp(
      systemOcrNativeSource,
      join(systemOcrOutputRoot, systemOcrNativePackage.split('/')[1]),
      { recursive: true },
    ),
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
    bundleBridge('bridge.js', chatOutput),
    bundleBridge('security-bridge.js', securityOutput),
  ])
  await Promise.all([
    chmod(nodeOutput, 0o755),
    chmod(goplsOutput, 0o755),
    chmod(chatOutput, 0o644),
    chmod(securityOutput, 0o644),
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
      localOcr: {
        package: '@napi-rs/system-ocr',
        version: systemOcrVersion,
        license: 'MIT',
        licenseFile: 'THIRD_PARTY-LICENSES/napi-rs-system-ocr-MIT.txt',
        scope: 'coding-attachments',
      },
    },
    esbuild: { version: '0.28.1' },
    bridges: {
      chat: { file: 'chat-bridge.cjs', sha256: await sha256(chatOutput) },
      security: { file: 'security-bridge.cjs', sha256: await sha256(securityOutput) },
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
    join(output, 'THIRD_PARTY-LICENSES', 'napi-rs-system-ocr-MIT.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'playwright-mcp-Apache-2.0.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'playwright-Apache-2.0.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'playwright-core-Apache-2.0.txt'),
    join(output, 'THIRD_PARTY-LICENSES', 'gopls-BSD-3-Clause.txt'),
    join(output, 'lsp-runtime', 'gopls'),
    join(output, 'lsp-runtime', 'node_modules', 'typescript-language-server', 'LICENSE'),
    join(output, 'lsp-runtime', 'node_modules', '@vue', 'language-server', 'LICENSE'),
    join(output, 'lsp-runtime', 'node_modules', 'typescript', 'LICENSE.txt'),
    join(output, 'skills', 'archify', 'LICENSE'),
  ]) {
    if (!await exists(licensePath)) {
      throw new Error(`packaged Sidecar is missing license file: ${licensePath}`)
    }
  }
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
    '--allow-fs-read=/bin/bash',
    '--allow-fs-read=/bin/sh',
    '--allow-fs-read=/usr/bin/env',
    '--allow-fs-read=/usr/bin/sandbox-exec',
  ]
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
  const chatRun = await runWithInput(
    node,
    [...chatRuntimeArguments, join(output, 'chat-bridge.cjs')],
    [
      '{"action":"create_session","conversationId":"packaged-smoke","executionMode":"go","approvalPolicy":"workspace-auto"}',
      '{"action":"destroy_session","conversationId":"packaged-smoke"}',
      '',
    ].join('\n'),
    { cwd: workspace, env: { ...process.env, HOME: workspace } },
  )
  const chatResponses = chatRun.stdout.trim().split('\n').map(line => JSON.parse(line))
  const ready = chatResponses.find(value => value.type === 'ready')
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
    'lsp_diagnostics',
    'goal_complete',
    'goal_blocked',
  ]
  const ctfRequestedTools = [...coreExpectedTools, 'ctf_inspect']
  if (
    !ready
    || !expectedTools.every(tool => ready.tools?.includes(tool))
    || ready.tools?.includes('lsp_fix')
    || ready.executionMode !== 'go'
    || ready.approvalPolicy !== 'workspace-auto'
    || !ready.skills?.includes('archify')
    || !ready.extensions?.includes('pi-lsp')
    || !ready.extensions?.includes('pi-goal')
    || !ready.extensions?.includes('pi-background-tasks')
    || !chatResponses.some(value => value.type === 'session_destroyed')
  ) {
    throw new Error(`unexpected packaged Chat Sidecar response: ${chatRun.stdout}`)
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
  if (
    !codingBrowserReady?.tools?.includes('mcp')
    || !codingBrowserReady?.extensions?.includes('pi-mcp-adapter')
    || !codingBrowserReady.capabilities?.some(
      capability => capability.id === 'browser'
        && capability.status === 'approval-required'
        && capability.detail.includes('MilkSU 隔离浏览器'),
    )
    || !codingBrowserResponses.some(value => value.type === 'session_destroyed')
    || codingBrowserResponses.some(value => value.type === 'error')
  ) {
    throw new Error(
      `unexpected packaged Coding Browser response: ${codingBrowserRun.stdout}`,
    )
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
    schemaVersion: 'ctf-workspace.milksu.dev/v1alpha1',
    source: { scope: { targets: [{ kind: 'directory', value: 'workspace' }] } },
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
      '{"action":"create_session","conversationId":"packaged-ctf-coach"}',
      '{"action":"destroy_session","conversationId":"packaged-ctf-coach"}',
      '',
    ].join('\n'),
    { cwd: ctfWorkspace, env: { ...process.env, HOME: ctfWorkspace } },
  )
  const ctfChatResponses = ctfChatRun.stdout.trim().split('\n').map(line => JSON.parse(line))
  const ctfReady = ctfChatResponses.find(value => value.type === 'ready')
  const coachTools = ['read', 'edit', 'write', 'grep', 'find', 'ls', 'ctf_inspect']
  if (
    !ctfReady
    || ctfReady.tools?.includes('bash')
    || ctfReady.tools?.includes('lsp_diagnostics')
    || ctfReady.tools?.includes('lsp_fix')
    || ctfReady.skills?.includes('archify')
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
  })}\n`)
}

async function installSidecar(platform, binaryPath) {
  if (!binaryPath) throw new Error('--bin is required for Sidecar installation')
  const source = await buildSidecar(platform)
  const absoluteBinary = resolve(repositoryRoot, binaryPath)
  if (!absoluteBinary.includes('.app/Contents/MacOS/')) {
    throw new Error(`Wails macOS binary path was not recognised: ${absoluteBinary}`)
  }
  const contents = dirname(dirname(absoluteBinary))
  const destination = join(contents, 'Resources', 'milksu-sidecar')
  const application = dirname(contents)
  const distributableFiles = [
    'node',
    'chat-bridge.cjs',
    'security-bridge.cjs',
    'manifest.json',
    'package.json',
    'NODE-LICENSE',
  ]
  await rm(destination, { recursive: true, force: true })
  await mkdir(destination, { recursive: true, mode: 0o700 })
  await Promise.all(distributableFiles.map(file => copyFile(join(source, file), join(destination, file))))
  await cp(join(source, 'skills'), join(destination, 'skills'), { recursive: true })
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
    join(
      destination,
      'THIRD_PARTY-LICENSES',
      'gopls-BSD-3-Clause.txt',
    ),
  ]) {
    if (!await exists(requiredPath)) {
      throw new Error(`installed Sidecar is missing runtime artifact: ${requiredPath}`)
    }
  }
  await chmod(join(destination, 'node'), 0o755)
  await chmod(join(destination, 'lsp-runtime', 'gopls'), 0o755)
  await execFileAsync('/usr/bin/codesign', [
    '--force',
    '--deep',
    '--sign',
    process.env.MILKSU_CODESIGN_IDENTITY || '-',
    application,
  ])
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
