import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const temporary = mkdtempSync(join(tmpdir(), 'milksu-plugin-author-'))

function run(...args) {
  return execFileSync('go', ['run', './cmd/milksu-pluginctl', ...args], {
    cwd: root,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'inherit'],
  })
}

function digest(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

try {
  const keyPath = join(temporary, 'publisher-key.json')
  const key = JSON.parse(run('keygen', '--publisher', 'MilkSU Plugin Gate', '--out', keyPath))
  const luaSource = join(temporary, 'gate.skin')
  const typeScriptSource = join(temporary, 'gate.tools')
  run('create', '--runtime', 'lua', '--id', 'gate.skin', '--name', 'Gate Skin', '--publisher', key.publisher, '--key-id', key.key_id, '--out', luaSource)
  run('create', '--runtime', 'typescript', '--id', 'gate.tools', '--name', 'Gate Tools', '--publisher', key.publisher, '--key-id', key.key_id, '--out', typeScriptSource)
  const commonRuntime = ['--node', process.execPath, '--worker', join(root, 'sidecar', 'plugin-runtime', 'worker.mjs')]
  run('test', '--source', luaSource, ...commonRuntime)
  run('test', '--source', typeScriptSource, ...commonRuntime)
  const firstPackage = join(temporary, 'gate-tools-a.milksu-plugin')
  const secondPackage = join(temporary, 'gate-tools-b.milksu-plugin')
  run('pack', '--source', typeScriptSource, '--key', keyPath, '--out', firstPackage)
  run('pack', '--source', typeScriptSource, '--key', keyPath, '--out', secondPackage)
  if (digest(firstPackage) !== digest(secondPackage)) throw new Error('deterministic plugin packages differ')
  const inspection = JSON.parse(run('verify', '--package', firstPackage, '--host-version', '26.823.1'))
  if (!inspection.compatible || inspection.signers?.length !== 1 || inspection.manifest?.id !== 'gate.tools') {
    throw new Error(`offline plugin verification failed: ${JSON.stringify(inspection)}`)
  }
  process.stdout.write(`plugin author flow ok: ${inspection.manifest.id} ${inspection.digest}\n`)
} finally {
  rmSync(temporary, { recursive: true, force: true })
}
