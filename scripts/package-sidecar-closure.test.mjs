import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import {
  collectInstalledPackageClosure,
  copyDshRuntime,
  currentPlatform,
  dshRuntimeRootPackages,
  pruneForeignPlatformPackages,
  pruneNodePtyForeignArtifacts,
  resolvePhotonRuntime,
} from './package-sidecar.mjs'

async function createPackageFixture() {
  const root = await mkdtemp(join(tmpdir(), 'milksu-package-fixture-'))
  return { root, packageRoot: join(root, 'node_modules') }
}

async function writeFixturePackage(packageRoot, name, document, files = {}) {
  const directory = join(packageRoot, ...name.split('/'))
  await mkdir(directory, { recursive: true })
  await writeFile(join(directory, 'package.json'), `${JSON.stringify(document)}\n`)
  for (const [relativePath, contents] of Object.entries(files)) {
    const path = join(directory, relativePath)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }
  return directory
}

// Placeholder Photon metadata on purpose, distinct from whatever production
// ships: the assertions below can only pass when resolvePhotonRuntime reads
// the installed package.json, and the oversized module keeps the minimum
// size expectation for a shippable Photon artifact pinned.
const photonFixtureVersion = '0.0.0-fixture.0'
const photonFixtureLicense = 'Fixture-License-1.0'
const photonFixtureWasmBytes = 1_100_000

async function writePhotonFixture(packageRoot) {
  await writeFixturePackage(packageRoot, '@earendil-works/pi-coding-agent', {
    name: '@earendil-works/pi-coding-agent',
    version: '1.0.0',
  })
  const wasm = Buffer.alloc(photonFixtureWasmBytes)
  Buffer.from([0x00, 0x61, 0x73, 0x6d]).copy(wasm)
  await writeFixturePackage(packageRoot, '@silvia-odwyer/photon-node', {
    name: '@silvia-odwyer/photon-node',
    version: photonFixtureVersion,
    license: photonFixtureLicense,
  }, {
    'photon_rs_bg.wasm': wasm,
    'LICENSE.md': 'Apache License',
  })
}

async function writeDshFixture(packageRoot) {
  for (const name of dshRuntimeRootPackages) {
    const document = {
      name,
      version: '0.2.0-rc.2',
      license: 'MIT',
      type: 'module',
    }
    if (name === '@deepseek-ai/dsh') {
      document.dependencies = { '@deepseek-ai/dsh-app-boot': '0.2.0-rc.2' }
    }
    await writeFixturePackage(packageRoot, name, document, {
      ...(name === '@deepseek-ai/dsh' ? {
        // Mirror the real CLI entry just enough to keep the smoke honest:
        // the packaged bin imports app-boot, and app-boot pulls in its
        // required peer chain, so a closure that drops a peer still fails
        // the isolated spawn with ERR_MODULE_NOT_FOUND (the 26.912.3
        // accident) instead of exiting cleanly.
        'lib/bin.js': "import '@deepseek-ai/dsh-app-boot'\nprocess.exit(0)\n",
        LICENSE: 'MIT License',
      } : {}),
    })
  }
  await writeFixturePackage(packageRoot, '@deepseek-ai/dsh-app-boot', {
    name: '@deepseek-ai/dsh-app-boot',
    version: '0.2.0-rc.2',
    license: 'MIT',
    type: 'module',
    exports: './index.mjs',
    // Fabricated peer metadata, decoupled from the real dsh-app-boot
    // manifest: upstream peer changes will not show up in this fixture.
    // copyDshRuntime pins dshVersion against the installed production
    // package, which partially mitigates that drift.
    peerDependencies: {
      '@deepseek-ai/cordis-plugin-group': '^1.0.2',
      '@deepseek-ai/optional-peer-fixture': '^1.0.0',
    },
    peerDependenciesMeta: {
      '@deepseek-ai/optional-peer-fixture': { optional: true },
    },
  }, {
    'index.mjs': "import '@deepseek-ai/cordis-plugin-group'\nexport const fixture = true\n",
  })
  await writeFixturePackage(packageRoot, '@deepseek-ai/cordis-plugin-group', {
    name: '@deepseek-ai/cordis-plugin-group',
    version: '1.0.2',
    license: 'MIT',
    type: 'module',
  }, { 'index.js': 'export const fixture = true\n' })
  await writeFixturePackage(packageRoot, '@deepseek-ai/optional-peer-fixture', {
    name: '@deepseek-ai/optional-peer-fixture',
    version: '1.0.0',
    license: 'MIT',
  })
}

function esbuildPlatformPackage(platform) {
  const [goos, goarch] = platform.split('/')
  const os = goos === 'windows' ? 'win32' : goos
  const cpu = goarch === 'amd64' ? 'x64' : goarch
  return `@esbuild/${os}-${cpu}`
}

test('Pi inline image processing keeps a shippable Photon runtime', async () => {
  const fixture = await createPackageFixture()
  try {
    await writePhotonFixture(fixture.packageRoot)
    const photon = await resolvePhotonRuntime({ packageRoot: fixture.packageRoot })
    // The fixture metadata is a placeholder (see writePhotonFixture), so
    // matching it proves the resolver read the installed package.json
    // instead of returning whatever production happens to ship.
    assert.equal(photon.version, photonFixtureVersion)
    assert.equal(photon.licenseName, photonFixtureLicense)
    const wasm = await readFile(photon.wasm)
    assert.ok(wasm.byteLength > 1_000_000, `unexpected Photon module size: ${wasm.byteLength}`)
    assert.ok(
      wasm.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])),
      'Photon module must start with the WebAssembly magic bytes',
    )
    assert.ok((await readFile(photon.license)).byteLength > 0, 'Photon license must ship with it')
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('DSH packaged closure includes required app-boot peers', async () => {
  const fixture = await createPackageFixture()
  try {
    await writeDshFixture(fixture.packageRoot)
    const dependenciesOnly = await collectInstalledPackageClosure(['@deepseek-ai/dsh'], {
      packageRoot: fixture.packageRoot,
    })
    assert.equal(
      dependenciesOnly.some(pkg => pkg.name === '@deepseek-ai/cordis-plugin-group'),
      false,
      'dependency-only closure must not hide the missing peer that shipped in 26.912.3',
    )

    const packages = await collectInstalledPackageClosure(dshRuntimeRootPackages, {
      includePeerDependencies: true,
      packageRoot: fixture.packageRoot,
    })
    for (const name of dshRuntimeRootPackages) {
      assert.ok(
        packages.some(pkg => pkg.name === name),
        `${name} must stay in the runtime closure`,
      )
    }
    assert.ok(
      packages.some(pkg => pkg.name === '@deepseek-ai/cordis-plugin-group'),
      'required peer @deepseek-ai/cordis-plugin-group must be copied into the Sidecar',
    )
    assert.ok(
      packages.some(pkg => pkg.name === '@deepseek-ai/optional-peer-fixture'),
      'installed optional peers must stay in the runtime closure',
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('Pi closure ships only the target platform esbuild binary', async () => {
  const fixture = await createPackageFixture()
  try {
    const platform = currentPlatform()
    const variants = [
      ['darwin', 'arm64'],
      ['darwin', 'x64'],
      ['linux', 'arm64'],
      ['linux', 'x64'],
      ['win32', 'arm64'],
      ['win32', 'x64'],
    ]
    const optionalDependencies = Object.fromEntries(
      variants.map(([os, cpu]) => [`@esbuild/${os}-${cpu}`, '0.28.2']),
    )
    await writeFixturePackage(fixture.packageRoot, '@earendil-works/pi-coding-agent', {
      name: '@earendil-works/pi-coding-agent',
      version: '1.0.0',
      dependencies: { esbuild: '0.28.2' },
    })
    await writeFixturePackage(fixture.packageRoot, 'esbuild', {
      name: 'esbuild',
      version: '0.28.2',
      optionalDependencies,
    })
    for (const [os, cpu] of variants) {
      await writeFixturePackage(fixture.packageRoot, `@esbuild/${os}-${cpu}`, {
        name: `@esbuild/${os}-${cpu}`,
        version: '0.28.2',
        os: [os],
        cpu: [cpu],
      })
    }

    const unfiltered = await collectInstalledPackageClosure(['@earendil-works/pi-coding-agent'], {
      packageRoot: fixture.packageRoot,
    })
    assert.ok(unfiltered.filter(pkg => pkg.name.startsWith('@esbuild/')).length > 1)

    const packages = await collectInstalledPackageClosure(['@earendil-works/pi-coding-agent'], {
      packageRoot: fixture.packageRoot,
      platform,
    })
    const esbuildBinaries = packages.filter(pkg => pkg.name.startsWith('@esbuild/'))
    assert.deepEqual(esbuildBinaries.map(pkg => pkg.name), [esbuildPlatformPackage(platform)])
    assert.ok(packages.some(pkg => pkg.name === 'esbuild'), 'the esbuild driver package must stay')
    assert.ok(
      packages.some(pkg => pkg.name === '@earendil-works/pi-coding-agent'),
      'the Pi runtime itself must stay',
    )
  } finally {
    await rm(fixture.root, { recursive: true, force: true })
  }
})

test('node-pty prune keeps only the target prebuild and drops Windows conpty', async () => {
  // node-pty ships every platform's prebuilt binary inside its npm tarball,
  // so no package manager can filter them; packaging must prune after copying.
  const root = await mkdtemp(join(tmpdir(), 'milksu-pty-prune-'))
  try {
    const pty = join(root, 'node_modules', 'node-pty')
    for (const name of ['darwin-arm64', 'linux-x64', 'win32-x64']) {
      await mkdir(join(pty, 'prebuilds', name), { recursive: true })
      await writeFile(join(pty, 'prebuilds', name, 'pty.node'), 'stub')
    }
    await mkdir(join(pty, 'third_party', 'conpty'), { recursive: true })
    await writeFile(join(pty, 'third_party', 'conpty', 'conpty.cc'), 'stub')
    await pruneNodePtyForeignArtifacts(root, 'linux/amd64')
    assert.deepEqual(await readdir(join(pty, 'prebuilds')), ['linux-x64'])
    assert.deepEqual(await readdir(join(pty, 'third_party')), [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('recursive package copies get foreign platform packages pruned', async () => {
  // cp(pkg.source) copies a package's whole nested node_modules, so the
  // closure filter alone cannot keep esbuild's 26 platform binaries out of
  // the Sidecar. The post-copy prune removes any package whose os/cpu fields
  // exclude the target platform, at any nesting depth.
  const root = await mkdtemp(join(tmpdir(), 'milksu-platform-prune-'))
  try {
    const pi = join(root, 'node_modules', '@earendil-works', 'pi-coding-agent')
    for (const [name, os, cpu] of [
      ['darwin-arm64', 'darwin', 'arm64'],
      ['linux-x64', 'linux', 'x64'],
    ]) {
      const dir = join(pi, 'node_modules', '@esbuild', name)
      await mkdir(dir, { recursive: true })
      await writeFile(
        join(dir, 'package.json'),
        JSON.stringify({ name: `@esbuild/${name}`, version: '0.28.2', os: [os], cpu: [cpu] }),
      )
    }
    const plain = join(pi, 'node_modules', 'yaml')
    await mkdir(plain, { recursive: true })
    await writeFile(join(plain, 'package.json'), JSON.stringify({ name: 'yaml', version: '2.9.0' }))
    await pruneForeignPlatformPackages(root, 'darwin/arm64')
    assert.deepEqual(
      await readdir(join(pi, 'node_modules', '@esbuild')),
      ['darwin-arm64'],
    )
    assert.ok(await readFile(join(plain, 'package.json')), 'unrestricted packages must stay')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('copied DSH runtime can import app-boot without the repository node_modules', async () => {
  const fixture = await createPackageFixture()
  const output = await mkdtemp(join(tmpdir(), 'milksu-dsh-closure-'))
  try {
    await writeDshFixture(fixture.packageRoot)
    await copyDshRuntime(output, currentPlatform(), { packageRoot: fixture.packageRoot })
    await runIsolatedModuleImport(output, '@deepseek-ai/dsh-app-boot')
    await runIsolatedDshAcp(output)
  } finally {
    await rm(output, { recursive: true, force: true })
    await rm(fixture.root, { recursive: true, force: true })
  }
})

function isolatedDshEnv(output) {
  return {
    HOME: output,
    DSH_HOME: join(output, 'dsh-home'),
    TMPDIR: output,
    PATH: '/usr/bin:/bin',
    NODE_PATH: join(output, 'node_modules'),
  }
}

function runIsolatedModuleImport(output, specifier) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      '--input-type=module',
      '-e',
      `import ${JSON.stringify(specifier)}`,
    ], {
      cwd: output,
      env: isolatedDshEnv(output),
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += chunk })
    child.on('error', reject)
    child.on('exit', code => {
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(`isolated import ${specifier} exited ${code}: ${stderr}`))
    })
  })
}

function runIsolatedDshAcp(output) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [
      join(output, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'),
      '--profile',
      'acp',
    ], {
      cwd: output,
      env: isolatedDshEnv(output),
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let stderr = ''
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', chunk => { stderr += chunk })
    const finish = (error) => {
      child.kill('SIGKILL')
      if (error) reject(error)
      else resolve()
    }
    const timeout = setTimeout(() => finish(), 3_000)
    child.on('error', error => {
      clearTimeout(timeout)
      finish(error)
    })
    child.on('exit', (code) => {
      clearTimeout(timeout)
      if (/ERR_MODULE_NOT_FOUND|Cannot find package|Cannot find module/i.test(stderr)) {
        finish(new Error(`isolated DSH ACP is missing a runtime module: ${stderr}`))
        return
      }
      if (code && code !== 0) {
        finish(new Error(`isolated DSH ACP exited ${code}: ${stderr}`))
        return
      }
      finish()
    })
  })
}
