/**
 * Resolve a local Agent command for product-loop ACP cases.
 * Does not copy Provider keys into acp_guest.env.
 */

import { closeSync, openSync, readSync, statSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgList } from '../../sidecar/dsh/launch.js'

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
const DEFAULT_ACP_ARGS = ['--profile', 'acp']

function guestBinJs(root) {
  return resolve(root, 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js')
}

function hasShebang(path) {
  let fd
  try {
    fd = openSync(path, 'r')
    const buf = Buffer.alloc(2)
    const n = readSync(fd, buf, 0, 2, 0)
    return n >= 2 && buf[0] === 0x23 && buf[1] === 0x21
  } catch {
    return false
  } finally {
    if (fd !== undefined) {
      try {
        closeSync(fd)
      } catch {
        // ignore
      }
    }
  }
}

function withCommand(command, args) {
  return args?.length ? { command, args } : { command }
}

export function resolveProductLoopAgentCommand(options = {}) {
  const env = options.env ?? process.env
  const root = options.root ?? defaultRoot
  const execPath = options.execPath ?? process.execPath
  const configured = String(env.MILKSU_DSH_COMMAND ?? '').trim()
  if (configured) {
    return withCommand(configured, parseArgList(env.MILKSU_DSH_ACP_ARGS, DEFAULT_ACP_ARGS))
  }
  const bin = guestBinJs(root)
  let st
  try {
    st = statSync(bin)
  } catch {
    return null
  }
  if (!st.isFile()) return null
  if ((st.mode & 0o111) || hasShebang(bin)) return { command: bin }
  return { command: execPath, args: [bin, '--profile', 'acp'] }
}

function acpGuestCommand(settings) {
  const raw = settings?.acp_guest ?? settings?.AcpGuest
  if (!raw || typeof raw !== 'object') return ''
  return String(raw.command ?? raw.Command ?? '').trim()
}

export async function ensureProductLoopAgent(driver, options = {}) {
  const settings = (await driver.invoke('GetSettings', []).catch(() => ({}))) || {}
  if (acpGuestCommand(settings)) return { ok: true }
  const resolved = resolveProductLoopAgentCommand(options)
  if (!resolved) return { ok: false, detail: 'Agent command is not configured' }
  const acp_guest = withCommand(resolved.command, resolved.args)
  await driver.invoke('SaveSettingsCmd', [{ ...settings, acp_guest }])
  return { ok: true }
}
