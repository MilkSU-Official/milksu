import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { collectInstalledPackageClosure, copyDshRuntime } from './package-sidecar.mjs'

test('DSH packaged closure includes required app-boot peers', async () => {
  const dependenciesOnly = await collectInstalledPackageClosure(['@deepseek-ai/dsh'])
  assert.equal(
    dependenciesOnly.some(pkg => pkg.name === '@deepseek-ai/cordis-plugin-group'),
    false,
    'dependency-only closure must not hide the missing peer that shipped in 26.912.3',
  )

  const packages = await collectInstalledPackageClosure(['@deepseek-ai/dsh'], {
    includePeerDependencies: true,
  })
  assert.ok(
    packages.some(pkg => pkg.name === '@deepseek-ai/dsh'),
    'DSH CLI package must stay in the runtime closure',
  )
  assert.ok(
    packages.some(pkg => pkg.name === '@deepseek-ai/cordis-plugin-group'),
    'required peer @deepseek-ai/cordis-plugin-group must be copied into the Sidecar',
  )
})

test('copied DSH runtime can import app-boot without the repository node_modules', async () => {
  const output = await mkdtemp(join(tmpdir(), 'milksu-dsh-closure-'))
  try {
    await copyDshRuntime(output)
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
