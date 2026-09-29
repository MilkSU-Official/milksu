import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PROTOCOL_DESKTOP_FILE = 'milksu-development.desktop'
const PROTOCOL_LAUNCHER_FILE = 'milksu-development-protocol'
const PROTOCOL_STATE_FILE = 'milksu-development-protocol.state.json'
const MIME_TYPE = 'x-scheme-handler/milksu'

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`
}

function desktopExecQuote(value) {
  return `"${String(value)
    .replaceAll('\\', '\\\\')
    .replaceAll('"', '\\"')
    .replaceAll('%', '%%')}"`
}

export function linuxDevelopmentProtocolFiles({ applicationsDirectory, appDirectory, electronPath, accountApiUrl }) {
  const launcherPath = join(applicationsDirectory, PROTOCOL_LAUNCHER_FILE)
  const desktopPath = join(applicationsDirectory, PROTOCOL_DESKTOP_FILE)
  const launcher = [
    '#!/bin/sh',
    `MILKSU_CHANNEL=stable MILKSU_DESKTOP_APP_ID=com.milksu.app MILKSU_ACCOUNT_API_URL=${shellQuote(accountApiUrl)} MILKSU_PLUGIN_DEV=1 exec ${shellQuote(electronPath)} ${shellQuote(appDirectory)} "$@"`,
    '',
  ].join('\n')
  const desktopEntry = [
    '[Desktop Entry]',
    'Type=Application',
    'Name=MilkSU Development',
    'NoDisplay=true',
    'Terminal=false',
    `Exec=${desktopExecQuote(launcherPath)} %u`,
    `MimeType=${MIME_TYPE};`,
    '',
  ].join('\n')
  return { launcherPath, desktopPath, launcher, desktopEntry, desktopFileName: PROTOCOL_DESKTOP_FILE }
}

// Threat model: this heuristic only picks which existing handler a dev opt-in may
// temporarily replace and later restore; a spoofed milksu-look-alike name can never
// receive the callback, because the dev launcher is installed only after the opt-in.
function isMilkSUHandler(handler) {
  return /(?:^|[.-])milksu(?:[-.].*)?\.desktop$/iu.test(handler)
}

function protocolStatePath(applicationsDirectory) {
  return join(applicationsDirectory, PROTOCOL_STATE_FILE)
}

async function writePreviousHandlerState(applicationsDirectory, previousHandler) {
  await writeFile(protocolStatePath(applicationsDirectory), `${JSON.stringify({ previousHandler })}\n`, { mode: 0o600 })
}

async function readPreviousHandlerState(applicationsDirectory, log) {
  try {
    const parsed = JSON.parse(await readFile(protocolStatePath(applicationsDirectory), 'utf8'))
    return typeof parsed?.previousHandler === 'string' ? parsed.previousHandler : ''
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      log(`linux-development-protocol: failed to read previous handler state, falling back to removing the association: ${error?.message ?? error}`)
    }
    return ''
  }
}

async function removeDefaultAssociation(configDirectory) {
  const mimeAppsPath = join(configDirectory, 'mimeapps.list')
  let contents
  try {
    contents = await readFile(mimeAppsPath, 'utf8')
  } catch (error) {
    if (error?.code === 'ENOENT') return
    throw error
  }

  const lines = contents.split(/(?<=\n)/u)
  let section = ''
  const updated = lines.filter(line => {
    const trimmed = line.trim()
    const sectionMatch = trimmed.match(/^\[([^\]]+)\]$/u)
    if (sectionMatch) section = sectionMatch[1]
    if (section !== 'Default Applications') return true
    const equalsAt = trimmed.indexOf('=')
    if (equalsAt < 0 || trimmed.slice(0, equalsAt).trim() !== MIME_TYPE) return true
    return false
  }).join('')

  if (updated !== contents) await writeFile(mimeAppsPath, updated, 'utf8')
}

export async function clearStaleLinuxDevelopmentProtocol({ applicationsDirectory, configDirectory, currentHandler, setDefaultHandler, refreshApplications = async () => {}, log = () => {} }) {
  const current = String(await currentHandler()).trim()
  if (current === PROTOCOL_DESKTOP_FILE) {
    const previousHandler = await readPreviousHandlerState(applicationsDirectory, log)
    let restored = false
    if (previousHandler && typeof setDefaultHandler === 'function') {
      try {
        await removeDefaultAssociation(configDirectory)
        await setDefaultHandler(previousHandler, MIME_TYPE)
        restored = true
      } catch (error) {
        log(`linux-development-protocol: failed to restore previous handler ${previousHandler}, removing the development association instead: ${error?.message ?? error}`)
      }
    }
    if (!restored) await removeDefaultAssociation(configDirectory)
    await unlink(join(applicationsDirectory, PROTOCOL_LAUNCHER_FILE)).catch(error => {
      if (error?.code !== 'ENOENT') throw error
    })
    await unlink(join(applicationsDirectory, PROTOCOL_DESKTOP_FILE)).catch(error => {
      if (error?.code !== 'ENOENT') throw error
    })
    await unlink(protocolStatePath(applicationsDirectory)).catch(error => {
      if (error?.code !== 'ENOENT') throw error
    })
  }
  // The app list cache can outlive the MIME default when a previous process exits abruptly.
  await refreshApplications(applicationsDirectory)
  return current === PROTOCOL_DESKTOP_FILE
}

export async function registerLinuxDevelopmentProtocol({
  applicationsDirectory,
  configDirectory,
  appDirectory,
  electronPath,
  accountApiUrl,
  currentHandler,
  setDefaultHandler,
  refreshApplications = async () => {},
  log = () => {},
}) {
  const configuredHandler = String(await currentHandler()).trim()
  const previousHandler = configuredHandler === PROTOCOL_DESKTOP_FILE ? '' : configuredHandler
  if (previousHandler && !isMilkSUHandler(previousHandler)) {
    return { registered: false, reason: 'another protocol handler is already configured' }
  }

  const files = linuxDevelopmentProtocolFiles({ applicationsDirectory, appDirectory, electronPath, accountApiUrl })
  await mkdir(applicationsDirectory, { recursive: true })
  await mkdir(configDirectory, { recursive: true })
  await writeFile(files.launcherPath, files.launcher, { mode: 0o700 })
  await chmod(files.launcherPath, 0o700)
  await writeFile(files.desktopPath, files.desktopEntry, { mode: 0o755 })
  await chmod(files.desktopPath, 0o755)
  try {
    await refreshApplications(applicationsDirectory)
    // Persist the previous handler before switching the default, so a killed
    // process can still be rolled back by the startup stale cleanup.
    await writePreviousHandlerState(applicationsDirectory, previousHandler)
    await setDefaultHandler(files.desktopFileName, MIME_TYPE)
  } catch (error) {
    await unlink(files.launcherPath).catch(() => undefined)
    await unlink(files.desktopPath).catch(() => undefined)
    await unlink(protocolStatePath(applicationsDirectory)).catch(() => undefined)
    await refreshApplications(applicationsDirectory).catch(() => undefined)
    throw error
  }

  // Re-check right after setting the default: a concurrent handler change
  // (TOCTOU) must not go unnoticed, or restore() would roll back to the
  // recorded previousHandler while the user already picked something else.
  try {
    const effective = String(await currentHandler()).trim()
    if (effective !== files.desktopFileName) {
      log(`linux-development-protocol: default handler after set is ${effective || '(empty)'}, expected ${files.desktopFileName}`)
    }
  } catch (error) {
    log(`linux-development-protocol: failed to verify the default handler after set: ${error?.message ?? error}`)
  }

  let restored = false
  return {
    registered: true,
    files,
    previousHandler,
    async restore() {
      if (restored) return
      const current = String(await currentHandler()).trim()
      if (current === files.desktopFileName) {
        if (previousHandler) await setDefaultHandler(previousHandler, MIME_TYPE)
        else await removeDefaultAssociation(configDirectory)
      }
      await unlink(files.launcherPath).catch(error => {
        if (error?.code !== 'ENOENT') throw error
      })
      await unlink(files.desktopPath).catch(error => {
        if (error?.code !== 'ENOENT') throw error
      })
      await unlink(protocolStatePath(applicationsDirectory)).catch(error => {
        if (error?.code !== 'ENOENT') throw error
      })
      await refreshApplications(applicationsDirectory)
      restored = true
    },
  }
}
