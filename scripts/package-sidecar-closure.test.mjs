import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
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

test('Pi inline image processing keeps a shippable Photon runtime', async () => {
  // Pi resizes inline images with Photon. The bundled bridges load it from
  // `path.dirname(process.execPath)`, so packaging copies the module from here.
  // A renamed or dropped dependency would make every image read silently fail.
  const photon = await resolvePhotonRuntime()
  assert.equal(photon.version, '0.3.4')
  assert.equal(photon.licenseName, 'Apache-2.0')
  const wasm = await readFile(photon.wasm)
  assert.ok(wasm.byteLength > 1_000_000, `unexpected Photon module size: ${wasm.byteLength}`)
  assert.ok(
    wasm.subarray(0, 4).equals(Buffer.from([0x00, 0x61, 0x73, 0x6d])),
    'Photon module must start with the WebAssembly magic bytes',
  )
  assert.ok((await readFile(photon.license)).byteLength > 0, 'Photon license must ship with it')
})

test('DSH packaged closure includes required app-boot peers', async () => {
  const dependenciesOnly = await collectInstalledPackageClosure(['@deepseek-ai/dsh'])
  assert.equal(
    dependenciesOnly.some(pkg => pkg.name === '@deepseek-ai/cordis-plugin-group'),
    false,
    'dependency-only closure must not hide the missing peer that shipped in 26.912.3',
  )

  const packages = await collectInstalledPackageClosure(dshRuntimeRootPackages, {
    includePeerDependencies: true,
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
})

test('Pi closure ships only the target platform esbuild binary', async () => {
  // `npm ci` lays down every platform variant the lockfile records, and the
  // packaging closure used to copy all of them (26 esbuild binaries, ~284 MB).
  // Filtering optionalDependencies by os/cpu must keep exactly the target one.
  const unfiltered = await collectInstalledPackageClosure(['@earendil-works/pi-coding-agent'])
  assert.ok(
    unfiltered.filter(pkg => pkg.name.startsWith('@esbuild/')).length > 1,
    'lockfile install must contain foreign esbuild binaries for this test to prove anything',
  )

  const platform = currentPlatform()
  const [goos, goarch] = platform.split('/')
  const target = `@esbuild/${goos === 'windows' ? 'win32' : goos}-${goarch === 'amd64' ? 'x64' : goarch}`
  const packages = await collectInstalledPackageClosure(['@earendil-works/pi-coding-agent'], { platform })
  const esbuildBinaries = packages.filter(pkg => pkg.name.startsWith('@esbuild/'))
  assert.deepEqual(
    esbuildBinaries.map(pkg => pkg.name),
    [target],
    `filtered closure must keep only ${target}`,
  )
  assert.ok(packages.some(pkg => pkg.name === 'esbuild'), 'the esbuild driver package must stay')
  assert.ok(
    packages.some(pkg => pkg.name === '@earendil-works/pi-coding-agent'),
    'the Pi runtime itself must stay',
  )
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
  const output = await mkdtemp(join(tmpdir(), 'milksu-dsh-closure-'))
  try {
    await copyDshRuntime(output, currentPlatform())
    await runIsolatedModuleImport(output, '@deepseek-ai/dsh-app-boot')
    await runIsolatedDshAcp(output)
  } finally {
    await rm(output, { recursive: true, force: true })
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
