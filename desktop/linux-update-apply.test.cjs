'use strict'

const assert = require('node:assert/strict')
const os = require('node:os')
const path = require('node:path')
const test = require('node:test')
const {
  classifyLinuxInstall,
  linuxArtifactKind,
  buildLinuxInstallPlan,
  renderLinuxApplyScript,
} = require('./linux-update-apply.cjs')

test('classifies nix, deb and tarball installs without hardcoded temp paths', () => {
  assert.equal(classifyLinuxInstall({
    execPath: '/nix/store/abc/bin/milksu',
    which: () => '',
  }).kind, 'nix')
  assert.equal(classifyLinuxInstall({
    execPath: '/opt/MilkSU/milksu',
    env: { PATH: '/usr/bin' },
    which: (name) => (name === 'dpkg-query' ? '/usr/bin/dpkg-query' : ''),
  }).kind, 'tarball')
  assert.equal(linuxArtifactKind('deb'), 'deb')
  assert.equal(linuxArtifactKind('tarball'), 'tar.gz')
  assert.equal(linuxArtifactKind('nix'), '')
})

test('builds a pkexec dpkg plan from PATH lookups', () => {
  const which = (name) => ({
    sh: '/bin/sh',
    pkexec: '/usr/bin/pkexec',
    dpkg: '/usr/bin/dpkg',
  }[name] || '')
  const plan = buildLinuxInstallPlan({
    installKind: 'deb',
    artifactPath: '/var/folders/xx/MilkSU-26.826.1.deb',
    execPath: '/opt/MilkSU/milksu',
    prefix: '/opt/MilkSU',
    which,
  })
  assert.equal(plan.ok, true)
  assert.deepEqual(plan.commands[0], [
    '/usr/bin/pkexec',
    '/usr/bin/dpkg',
    '--install',
    path.resolve('/var/folders/xx/MilkSU-26.826.1.deb'),
  ])
  const script = renderLinuxApplyScript(plan, { pid: 4242 })
  assert.match(script, /while kill -0 "\$pid"/)
  assert.match(script, /pkexec/)
  assert.doesNotMatch(script, /\/tmp\//)
  assert.doesNotMatch(script, /\/private\/tmp\//)
})

test('names the missing installer tool instead of failing silently', () => {
  const plan = buildLinuxInstallPlan({
    installKind: 'deb',
    artifactPath: path.join(os.homedir(), 'MilkSU-26.826.1.deb'),
    execPath: '/opt/MilkSU/milksu',
    which: (name) => (name === 'sh' ? '/bin/sh' : ''),
  })
  assert.equal(plan.ok, false)
  assert.equal(plan.code, 'pkexec_missing')
  assert.equal(plan.missing, 'pkexec')
})
