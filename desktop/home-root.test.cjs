'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const {
  DEFAULT_HOME_DIR_NAME,
  DESKTOP_USER_DATA_SEGMENT,
  resolveHomeRoot,
  migrateStableUserDataIntoHome,
} = require('./home-root.cjs')

test('resolveHomeRoot prefers MILKSU_HOME, then MILKSU_APPDATA_DIR, then ~/.milksu', () => {
  const homedir = '/Users/x'
  assert.equal(
    resolveHomeRoot({ MILKSU_HOME: '/custom/home' }, homedir),
    path.resolve('/custom/home'),
  )
  assert.equal(
    resolveHomeRoot({ MILKSU_APPDATA_DIR: '/custom/root' }, homedir),
    path.resolve('/custom/root'),
  )
  assert.equal(
    resolveHomeRoot({ MILKSU_HOME: '/custom/home', MILKSU_APPDATA_DIR: '/custom/root' }, homedir),
    path.resolve('/custom/home'),
  )
  assert.equal(
    resolveHomeRoot({}, homedir),
    path.join(homedir, DEFAULT_HOME_DIR_NAME),
  )
  // Relative overrides are ignored — they are not valid roots.
  assert.equal(
    resolveHomeRoot({ MILKSU_HOME: 'relative/path' }, homedir),
    path.join(homedir, DEFAULT_HOME_DIR_NAME),
  )
})

test('migrateStableUserDataIntoHome renames natural userData into the home root', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'milksu-home-test-'))
  try {
    const homeRoot = path.join(sandbox, '.milksu')
    const natural = path.join(sandbox, 'Application Support', 'MilkSU')
    fs.mkdirSync(natural, { recursive: true })
    fs.writeFileSync(path.join(natural, 'preferences.json'), '{}')

    const ready = migrateStableUserDataIntoHome({ homeRoot, naturalUserDataPath: natural })
    assert.equal(ready, true)
    assert.equal(fs.existsSync(natural), false)
    assert.equal(
      fs.readFileSync(
        path.join(homeRoot, DESKTOP_USER_DATA_SEGMENT, 'preferences.json'),
        'utf8',
      ),
      '{}',
    )
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
})

test('migrateStableUserDataIntoHome keeps an existing home desktop directory', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'milksu-home-test-'))
  try {
    const homeRoot = path.join(sandbox, '.milksu')
    const destination = path.join(homeRoot, DESKTOP_USER_DATA_SEGMENT)
    fs.mkdirSync(destination, { recursive: true })
    fs.writeFileSync(path.join(destination, 'keep.txt'), 'keep')
    const natural = path.join(sandbox, 'Application Support', 'MilkSU')
    fs.mkdirSync(natural, { recursive: true })
    fs.writeFileSync(path.join(natural, 'stale.txt'), 'stale')

    const ready = migrateStableUserDataIntoHome({ homeRoot, naturalUserDataPath: natural })
    assert.equal(ready, true)
    // The already-migrated home directory wins; the natural directory stays.
    assert.equal(fs.readFileSync(path.join(destination, 'keep.txt'), 'utf8'), 'keep')
    assert.equal(fs.existsSync(path.join(natural, 'stale.txt')), true)
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
})

test('migrateStableUserDataIntoHome reports failure when rename is impossible', () => {
  const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'milksu-home-test-'))
  try {
    // homeRoot exists as a plain file: mkdirSync fails and the migration
    // must report false so the caller keeps the natural userData path.
    const homeRoot = path.join(sandbox, '.milksu')
    fs.writeFileSync(homeRoot, 'not a directory')
    const natural = path.join(sandbox, 'Application Support', 'MilkSU')
    fs.mkdirSync(natural, { recursive: true })

    const ready = migrateStableUserDataIntoHome({ homeRoot, naturalUserDataPath: natural })
    assert.equal(ready, false)
    assert.equal(fs.existsSync(natural), true)

    // Natural userData absent: nothing to migrate, pin is safe.
    assert.equal(
      migrateStableUserDataIntoHome({
        homeRoot: path.join(sandbox, 'other-home'),
        naturalUserDataPath: path.join(sandbox, 'missing'),
      }),
      true,
    )
  } finally {
    fs.rmSync(sandbox, { recursive: true, force: true })
  }
})
