import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'
import { clearStaleLinuxDevelopmentProtocol, registerLinuxDevelopmentProtocol } from './linux-development-protocol.mjs'

async function fixture(previousHandler = '') {
  const root = await mkdtemp(path.join(os.tmpdir(), 'milksu-dev-protocol-'))
  const applicationsDirectory = path.join(root, 'applications')
  const configDirectory = path.join(root, 'config')
  await mkdir(configDirectory, { recursive: true })
  let handler = previousHandler
  const registrations = []
  const refreshes = []
  const result = await registerLinuxDevelopmentProtocol({
    applicationsDirectory,
    configDirectory,
    appDirectory: path.join(root, 'repo with spaces', 'desktop'),
    electronPath: path.join(root, 'electron'),
    accountApiUrl: 'https://accounts.milksu.org',
    currentHandler: async () => handler,
    setDefaultHandler: async (desktopFile, mimeType) => {
      registrations.push([desktopFile, mimeType])
      handler = desktopFile
    },
    refreshApplications: async directory => refreshes.push(directory),
  })
  return { root, applicationsDirectory, configDirectory, registrations, refreshes, result, current: () => handler }
}

test('temporarily associates the development launcher and restores the previous MilkSU handler', async () => {
  const state = await fixture('milksu.desktop')
  try {
    assert.equal(state.result.registered, true)
    const launcherPath = path.join(state.applicationsDirectory, 'milksu-development-protocol')
    const launcher = await readFile(launcherPath, 'utf8')
    const desktopEntry = await readFile(path.join(state.applicationsDirectory, 'milksu-development.desktop'), 'utf8')
    assert.match(launcher, /MILKSU_ACCOUNT_API_URL='https:\/\/accounts\.milksu\.org'/u)
    assert.match(launcher, /repo with spaces/u)
    assert.match(desktopEntry, /x-scheme-handler\/milksu/u)
    assert.match(desktopEntry, /%u/u)
    assert.deepEqual(state.registrations, [
      ['milksu-development.desktop', 'x-scheme-handler/milksu'],
    ])
    assert.equal((await stat(launcherPath)).mode & 0o777, 0o700)
    assert.equal((await stat(path.join(state.applicationsDirectory, 'milksu-development.desktop'))).mode & 0o777, 0o755)
    assert.equal(state.refreshes.length, 1)
    await state.result.restore()
    assert.equal(state.refreshes.length, 2)
    assert.equal(state.current(), 'milksu.desktop')
    await assert.rejects(readFile(launcherPath))
    assert.deepEqual(state.registrations.at(-1), ['milksu.desktop', 'x-scheme-handler/milksu'])
  } finally {
    await rm(state.root, { recursive: true, force: true })
  }
})

test('removes only its association when no handler existed before opt-in', async () => {
  const state = await fixture()
  try {
    const mimeAppsPath = path.join(state.configDirectory, 'mimeapps.list')
    await writeFile(mimeAppsPath, [
      '[Default Applications]',
      'x-scheme-handler/milksu=milksu-development.desktop;',
      'text/plain=editor.desktop;',
      '',
      '[Added Associations]',
      'x-scheme-handler/milksu=other.desktop;',
      '',
    ].join('\n'))
    await state.result.restore()
    const contents = await readFile(mimeAppsPath, 'utf8')
    assert.doesNotMatch(contents, /x-scheme-handler\/milksu=milksu-development\.desktop/u)
    assert.match(contents, /text\/plain=editor\.desktop/u)
    assert.match(contents, /\[Added Associations\][\s\S]*x-scheme-handler\/milksu=other\.desktop/u)
    await assert.rejects(readFile(path.join(state.applicationsDirectory, 'milksu-development.desktop')))
  } finally {
    await rm(state.root, { recursive: true, force: true })
  }
})

test('treats a leftover development association as temporary rather than restoring it', async () => {
  const state = await fixture('milksu-development.desktop')
  try {
    await writeFile(path.join(state.configDirectory, 'mimeapps.list'), [
      '[Default Applications]',
      'x-scheme-handler/milksu=milksu-development.desktop;',
      '',
    ].join('\n'))
    await state.result.restore()
    assert.deepEqual(state.registrations, [['milksu-development.desktop', 'x-scheme-handler/milksu']])
    assert.equal(state.current(), 'milksu-development.desktop')
    assert.doesNotMatch(await readFile(path.join(state.configDirectory, 'mimeapps.list'), 'utf8'), /x-scheme-handler\/milksu=/u)
  } finally {
    await rm(state.root, { recursive: true, force: true })
  }
})

test('clears a leftover auto-registered development handler on startup', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'milksu-dev-protocol-stale-'))
  const applicationsDirectory = path.join(root, 'applications')
  const configDirectory = path.join(root, 'config')
  await mkdir(applicationsDirectory, { recursive: true })
  await mkdir(configDirectory, { recursive: true })
  const desktopFile = path.join(applicationsDirectory, 'milksu-development.desktop')
  const launcherFile = path.join(applicationsDirectory, 'milksu-development-protocol')
  await writeFile(desktopFile, 'development handler')
  await writeFile(launcherFile, 'development launcher')
  const mimeAppsPath = path.join(configDirectory, 'mimeapps.list')
  await writeFile(mimeAppsPath, [
    '[Default Applications]',
    'x-scheme-handler/milksu=milksu-development.desktop;',
    'text/plain=editor.desktop;',
    '',
  ].join('\n'))
  try {
    assert.equal(await clearStaleLinuxDevelopmentProtocol({
      applicationsDirectory,
      configDirectory,
      currentHandler: async () => 'milksu-development.desktop',
    }), true)
    assert.doesNotMatch(await readFile(mimeAppsPath, 'utf8'), /x-scheme-handler\/milksu=/u)
    assert.match(await readFile(mimeAppsPath, 'utf8'), /text\/plain=editor.desktop/u)
    await assert.rejects(readFile(desktopFile))
    await assert.rejects(readFile(launcherFile))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('does not replace a non-MilkSU protocol handler', async () => {
  const state = await fixture('browser.desktop')
  try {
    assert.deepEqual(state.result, {
      registered: false,
      reason: 'another protocol handler is already configured',
    })
    assert.equal(state.registrations.length, 0)
  } finally {
    await rm(state.root, { recursive: true, force: true })
  }
})
