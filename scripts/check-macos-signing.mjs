#!/usr/bin/env node

import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { resolve } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

function boolEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value ?? '').trim().toLowerCase())
}

function argument(name, fallback = undefined) {
  const prefix = `--${name}=`
  const inline = process.argv.find(value => value.startsWith(prefix))
  if (inline) return inline.slice(prefix.length)
  const index = process.argv.indexOf(`--${name}`)
  return index >= 0 ? process.argv[index + 1] : fallback
}

export function parseCodesignDetails(output) {
  const fields = new Map()
  for (const rawLine of String(output ?? '').split('\n')) {
    const line = rawLine.trim()
    const separator = line.indexOf('=')
    if (separator <= 0) continue
    fields.set(line.slice(0, separator), line.slice(separator + 1))
  }
  return {
    identifier: fields.get('Identifier') || '',
    signature: fields.get('Signature') || '',
    teamIdentifier: fields.get('TeamIdentifier') || '',
    authority: String(output ?? '')
      .split('\n')
      .map(line => line.trim())
      .filter(line => line.startsWith('Authority='))
      .map(line => line.slice('Authority='.length)),
  }
}

export function parseCodeSigningIdentities(output) {
  return String(output ?? '')
    .split('\n')
    .map(line => line.trim())
    .map(line => {
      const match = line.match(/^\s*\d+\)\s+([A-Fa-f0-9]{40})\s+"(.+)"$/)
      if (!match) return null
      return {
        hash: match[1],
        name: match[2],
        developerIdApplication: match[2].startsWith('Developer ID Application: '),
      }
    })
    .filter(Boolean)
}

export function stableCodesignProblem(details) {
  const signature = String(details?.signature ?? '').trim().toLowerCase()
  const teamIdentifier = String(details?.teamIdentifier ?? '').trim().toLowerCase()
  if (signature === 'adhoc') return 'Signature=adhoc'
  if (signature === 'unsigned') return 'Signature=unsigned'
  if (!teamIdentifier || teamIdentifier === 'not set' || teamIdentifier === 'unknown') {
    return `TeamIdentifier=${details?.teamIdentifier || 'not set'}`
  }
  return ''
}

export function identityProblem(identity, identities) {
  const requested = String(identity ?? '').trim()
  if (!requested) return ''
  if (requested === '-') return 'MILKSU_CODESIGN_IDENTITY is ad-hoc (-)'
  if (!identities.some(item => item.name === requested)) {
    return `codesigning identity not found in Keychain: ${requested}`
  }
  if (!requested.startsWith('Developer ID Application: ')) {
    return `identity is not Developer ID Application: ${requested}`
  }
  return ''
}

async function inspectCodesign(appPath) {
  const { stdout, stderr } = await execFileAsync('/usr/bin/codesign', [
    '-dv',
    '--verbose=4',
    appPath,
  ])
  return parseCodesignDetails(`${stdout}\n${stderr}`)
}

async function listCodeSigningIdentities() {
  try {
    const { stdout, stderr } = await execFileAsync('/usr/bin/security', [
      'find-identity',
      '-v',
      '-p',
      'codesigning',
    ])
    return parseCodeSigningIdentities(`${stdout}\n${stderr}`)
  } catch (cause) {
    const output = `${cause?.stdout ?? ''}\n${cause?.stderr ?? ''}`
    return parseCodeSigningIdentities(output)
  }
}

function emit(status) {
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`)
}

async function main() {
  const appPathInput = argument('app', 'build/bin/MilkSU.app')
  const appPath = resolve(appPathInput)
  const requireStable = process.argv.includes('--require-stable')
    || boolEnv(process.env.MILKSU_REQUIRE_STABLE_CODESIGN)
  const identity = argument('identity', process.env.MILKSU_CODESIGN_IDENTITY || '')
  const identities = process.platform === 'darwin'
    ? await listCodeSigningIdentities()
    : []
  const selectedIdentityProblem = identityProblem(identity, identities)
  const status = {
    appPath,
    requireStable,
    identity: identity || '',
    identityAvailable: identity ? !selectedIdentityProblem : false,
    developerIdIdentities: identities
      .filter(item => item.developerIdApplication)
      .map(item => item.name),
    app: null,
    ok: true,
    issues: [],
  }

  if (selectedIdentityProblem) status.issues.push(selectedIdentityProblem)
  if (!existsSync(appPath)) {
    status.issues.push(`app bundle not found: ${appPath}`)
  } else if (process.platform === 'darwin') {
    status.app = await inspectCodesign(appPath)
    const appProblem = stableCodesignProblem(status.app)
    if (appProblem) status.issues.push(`stable app signing missing: ${appProblem}`)
  }
  if (requireStable && !identity) {
    status.issues.push('stable signing requires MILKSU_CODESIGN_IDENTITY or --identity')
  }
  if (requireStable && !status.developerIdIdentities.length) {
    status.issues.push('no Developer ID Application identity is installed in this Keychain')
  }
  if (!requireStable) {
    status.issues = status.issues.filter(issue => !issue.startsWith('stable app signing missing:'))
  }
  status.ok = status.issues.length === 0
  emit(status)
  if (!status.ok) process.exitCode = 1
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main()
}
