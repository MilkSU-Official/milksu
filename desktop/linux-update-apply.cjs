'use strict'

const { spawn } = require('node:child_process')
const fs = require('node:fs')
const path = require('node:path')

const DEBIAN_PACKAGE_NAMES = ['milksu', 'milksu-desktop']

function pathHasNixStore(value) {
  return String(value ?? '').includes(`${path.sep}nix${path.sep}store${path.sep}`)
    || String(value ?? '').includes('/nix/store/')
}

function whichOnPath(command, env = process.env) {
  const name = String(command ?? '').trim()
  if (!name || name.includes(path.sep) || name.includes('/')) return ''
  const directories = String(env.PATH ?? '').split(path.delimiter).filter(Boolean)
  for (const directory of directories) {
    const candidate = path.join(directory, name)
    try {
      fs.accessSync(candidate, fs.constants.X_OK)
      return candidate
    } catch {
      // keep searching PATH
    }
  }
  return ''
}

function commandOutput(file, args) {
  try {
    const { execFileSync } = require('node:child_process')
    return execFileSync(file, args, { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    return ''
  }
}

function classifyLinuxInstall({
  execPath = '',
  env = process.env,
  which = whichOnPath,
} = {}) {
  const resolvedExec = path.resolve(String(execPath || process.execPath))
  if (pathHasNixStore(resolvedExec)) {
    return { kind: 'nix', execPath: resolvedExec, prefix: path.dirname(resolvedExec) }
  }
  const dpkgQuery = which('dpkg-query', env)
  if (dpkgQuery) {
    const ownedBy = commandOutput(dpkgQuery, ['-S', resolvedExec])
    const knownPackage = DEBIAN_PACKAGE_NAMES.some(name => ownedBy.startsWith(`${name}:`))
      || DEBIAN_PACKAGE_NAMES.some(name => commandOutput(dpkgQuery, ['-W', '-f=${Package}', name]) === name)
    if (knownPackage || /: /.test(ownedBy)) {
      return { kind: 'deb', execPath: resolvedExec, prefix: path.dirname(resolvedExec) }
    }
  }
  const prefix = path.dirname(resolvedExec)
  if (prefix && prefix !== '/' && prefix !== path.parse(prefix).root) {
    return { kind: 'tarball', execPath: resolvedExec, prefix }
  }
  return { kind: 'unknown', execPath: resolvedExec, prefix: '' }
}

function linuxArtifactKind(installKind) {
  if (installKind === 'deb') return 'deb'
  if (installKind === 'tarball') return 'tar.gz'
  return ''
}

function prefixIsWritable(prefix) {
  try {
    fs.accessSync(prefix, fs.constants.W_OK)
    return true
  } catch {
    return false
  }
}

function buildLinuxInstallPlan({
  installKind,
  artifactPath,
  execPath,
  prefix,
  env = process.env,
  which = whichOnPath,
} = {}) {
  const artifact = path.resolve(String(artifactPath ?? ''))
  const relaunch = path.resolve(String(execPath ?? ''))
  if (!artifact || !relaunch) {
    return { ok: false, code: 'install_unavailable', missing: '' }
  }
  if (installKind === 'nix' || installKind === 'unknown') {
    return { ok: false, code: 'linux_install_unsupported', missing: '' }
  }
  const sh = which('sh', env)
  if (!sh) return { ok: false, code: 'sh_missing', missing: 'sh' }

  if (installKind === 'deb') {
    const pkexec = which('pkexec', env)
    const dpkg = which('dpkg', env)
    if (!pkexec) return { ok: false, code: 'pkexec_missing', missing: 'pkexec' }
    if (!dpkg) return { ok: false, code: 'dpkg_missing', missing: 'dpkg' }
    return {
      ok: true,
      shell: sh,
      relaunch,
      installKind,
      artifact,
      commands: [[pkexec, dpkg, '--install', artifact]],
    }
  }

  const tar = which('tar', env)
  if (!tar) return { ok: false, code: 'tar_missing', missing: 'tar' }
  const extractArgs = [tar, '-xzf', artifact, '-C', path.resolve(String(prefix ?? '')), '--strip-components=1']
  if (prefixIsWritable(prefix)) {
    return { ok: true, shell: sh, relaunch, installKind, artifact, commands: [extractArgs] }
  }
  const pkexec = which('pkexec', env)
  if (!pkexec) return { ok: false, code: 'pkexec_missing', missing: 'pkexec' }
  return {
    ok: true,
    shell: sh,
    relaunch,
    installKind,
    artifact,
    commands: [[pkexec, ...extractArgs]],
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`
}

function renderLinuxApplyScript(plan, { pid }) {
  const lines = [
    '#!/bin/sh',
    'set -eu',
    `pid=${Number(pid)}`,
    'while kill -0 "$pid" 2>/dev/null; do sleep 0.2; done',
    'status=0',
  ]
  for (const command of plan.commands) {
    lines.push(`${command.map(shellQuote).join(' ')} || status=$?`)
  }
  lines.push('if [ "$status" -ne 0 ]; then')
  lines.push(`  ${shellQuote(plan.relaunch)} >/dev/null 2>&1 &`)
  lines.push('  exit "$status"')
  lines.push('fi')
  lines.push(`exec ${shellQuote(plan.relaunch)}`)
  lines.push('')
  return lines.join('\n')
}

function spawnLinuxApply({ plan, pid, scriptPath, spawnImpl = spawn }) {
  fs.writeFileSync(scriptPath, renderLinuxApplyScript(plan, { pid }), { mode: 0o700 })
  const child = spawnImpl(plan.shell, [scriptPath], {
    detached: true,
    stdio: 'ignore',
  })
  child.unref?.()
  return child
}

module.exports = {
  classifyLinuxInstall,
  linuxArtifactKind,
  buildLinuxInstallPlan,
  renderLinuxApplyScript,
  spawnLinuxApply,
  whichOnPath,
}
