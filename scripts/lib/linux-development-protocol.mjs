import { chmod, mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

const PROTOCOL_DESKTOP_FILE = 'milksu-development.desktop'
const PROTOCOL_LAUNCHER_FILE = 'milksu-development-protocol'
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

function isMilkSUHandler(handler) {
  return /(?:^|[.-])milksu(?:[-.].*)?\.desktop$/iu.test(handler)
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

export async function clearStaleLinuxDevelopmentProtocol({ applicationsDirectory, configDirectory, currentHandler, refreshApplications = async () => {} }) {
  const current = String(await currentHandler()).trim()
  if (current === PROTOCOL_DESKTOP_FILE) {
    await removeDefaultAssociation(configDirectory)
    await unlink(join(applicationsDirectory, PROTOCOL_LAUNCHER_FILE)).catch(error => {
      if (error?.code !== 'ENOENT') throw error
    })
    await unlink(join(applicationsDirectory, PROTOCOL_DESKTOP_FILE)).catch(error => {
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
    await setDefaultHandler(files.desktopFileName, MIME_TYPE)
  } catch (error) {
    await unlink(files.launcherPath).catch(() => undefined)
    await unlink(files.desktopPath).catch(() => undefined)
    await refreshApplications(applicationsDirectory).catch(() => undefined)
    throw error
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
      await refreshApplications(applicationsDirectory)
      restored = true
    },
  }
}
