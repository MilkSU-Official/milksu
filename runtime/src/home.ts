import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'

export function resolveHomeRoot(
  env: Record<string, string | undefined> = process.env,
  userHome = homedir(),
): string {
  const explicit = String(env.MILKSU_HOME ?? '').trim()
    || String(env.MILKSU_APPDATA_DIR ?? '').trim()
  if (explicit) {
    if (!isAbsolute(explicit)) {
      throw new Error('MILKSU_HOME must be an absolute path')
    }
    return resolve(explicit)
  }
  const home = String(userHome || env.HOME || env.USERPROFILE || '').trim()
  if (!home) throw new Error('cannot resolve MILKSU_HOME')
  return join(home, '.milksu')
}

export function dataDirectory(home = resolveHomeRoot()): string {
  return join(home, 'data')
}

export function configDirectory(home = resolveHomeRoot()): string {
  return join(home, 'config')
}

export function workspacesDirectory(home = resolveHomeRoot()): string {
  return join(home, 'workspaces')
}

export function conversationsDirectory(home = resolveHomeRoot()): string {
  return join(dataDirectory(home), 'stores', 'conversations')
}

export function labJobsDirectory(home = resolveHomeRoot()): string {
  return join(dataDirectory(home), 'stores', 'lab-jobs')
}

export function researchDirectory(home = resolveHomeRoot()): string {
  return join(dataDirectory(home), 'domain', 'research')
}

export function settingsPath(home = resolveHomeRoot()): string {
  return join(configDirectory(home), 'settings.json')
}

export function codingProjectMemoryPath(home = resolveHomeRoot()): string {
  return join(dataDirectory(home), 'stores', 'coding-project-memory.json')
}

export function codingAttachmentsDirectory(home = resolveHomeRoot()): string {
  return join(dataDirectory(home), 'agent', 'home', 'attachments')
}

export function usageDatabasePath(home = resolveHomeRoot()): string {
  return join(dataDirectory(home), 'stores', 'usage', 'model-usage.sqlite3')
}

export function credentialsDatabasePath(home = resolveHomeRoot()): string {
  return join(configDirectory(home), 'credentials.db')
}

export function backupsDirectory(home = resolveHomeRoot()): string {
  return join(home, 'backups')
}

export function sessionIndexPath(home = resolveHomeRoot()): string {
  return join(dataDirectory(home), 'stores', 'session-index', 'obelisk.sqlite')
}

export function modelUsagePath(home = resolveHomeRoot()): string {
  return join(dataDirectory(home), 'stores', 'usage', 'model-usage.sqlite3')
}

export function modelCatalogCachePath(home = resolveHomeRoot()): string {
  return join(dataDirectory(home), 'services', 'model-catalog', 'tokenflux.json')
}

export function securityToolsRoot(home = resolveHomeRoot()): string {
  return join(dataDirectory(home), 'services', 'security-tools')
}

export function browserWorkspaceDirectory(home = resolveHomeRoot()): string {
  return join(workspacesDirectory(home), 'browser')
}

export function browserExtensionDirectory(home = resolveHomeRoot()): string {
  return join(browserWorkspaceDirectory(home), 'current-tab-extension')
}
