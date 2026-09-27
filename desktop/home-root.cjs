'use strict'

/**
 * MilkSU home root resolution for the desktop shell.
 *
 * All MilkSU state lives under one root (default `~/.milksu`):
 *   <root>/desktop          Electron userData (stable, non-isolated)
 *   <root>/workspaces/...   agent / ctf / browser workspaces
 *   <root>/data, config...  Go runtime (owned by internal/appdata)
 *
 * Keep env semantics aligned with internal/appdata/directory.go:
 * MILKSU_HOME wins, then MILKSU_APPDATA_DIR (root alias), then ~/.milksu.
 */

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')

const DEFAULT_HOME_DIR_NAME = '.milksu'
const DESKTOP_USER_DATA_SEGMENT = 'desktop'

/**
 * @param {NodeJS.ProcessEnv | Record<string, string | undefined>} [env]
 * @param {string} [homedir]
 * @returns {string}
 */
function resolveHomeRoot(env = process.env, homedir = os.homedir()) {
  const explicit = String(env.MILKSU_HOME ?? '').trim()
    || String(env.MILKSU_APPDATA_DIR ?? '').trim()
  if (explicit && path.isAbsolute(explicit)) return path.resolve(explicit)
  return path.join(homedir, DEFAULT_HOME_DIR_NAME)
}

/**
 * Move a stable channel's historical natural Electron userData directory
 * into <homeRoot>/desktop. Only runs for the stable non-isolated instance.
 *
 * Returns true when <homeRoot>/desktop is ready to pin (already present,
 * nothing to migrate, or rename succeeded). Returns false when the rename
 * failed — the caller must then keep the natural userData path.
 *
 * @param {{
 *   homeRoot: string,
 *   naturalUserDataPath: string,
 *   fsLike?: typeof fs,
 * }} input
 * @returns {boolean}
 */
function migrateStableUserDataIntoHome(input) {
  const fsLike = input.fsLike ?? fs
  const destination = path.join(input.homeRoot, DESKTOP_USER_DATA_SEGMENT)
  const from = path.resolve(String(input.naturalUserDataPath ?? ''))
  if (!from || from === path.resolve(destination)) return true
  if (fsLike.existsSync(destination)) return true
  if (!fsLike.existsSync(from)) return true
  try {
    fsLike.mkdirSync(input.homeRoot, { recursive: true })
    fsLike.renameSync(from, destination)
    return true
  } catch {
    return false
  }
}

module.exports = {
  DEFAULT_HOME_DIR_NAME,
  DESKTOP_USER_DATA_SEGMENT,
  resolveHomeRoot,
  migrateStableUserDataIntoHome,
}
