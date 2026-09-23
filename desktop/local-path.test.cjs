'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { copyImageFile, openLocalPath, revealLocalPath } = require('./local-path.cjs')

test('openLocalPath opens an existing absolute directory without rewriting it', async () => {
  const target = path.resolve('产物 directory')
  const opened = []

  await openLocalPath(target, {
    stat: async value => {
      assert.equal(value, target)
      return { isDirectory: () => true, isFile: () => false }
    },
    openPath: async value => {
      opened.push(value)
      return ''
    },
  })

  assert.deepEqual(opened, [target])
})

test('openLocalPath rejects relative and unavailable paths before opening', async () => {
  let opened = false
  const openPath = async () => {
    opened = true
    return ''
  }

  await assert.rejects(
    openLocalPath('relative/path', {
      stat: async () => ({ isDirectory: () => true, isFile: () => false }),
      openPath,
    }),
    /must be absolute/u,
  )
  await assert.rejects(
    openLocalPath(path.resolve('missing'), {
      stat: async () => { throw new Error('missing') },
      openPath,
    }),
    /local path is unavailable: missing/u,
  )
  assert.equal(opened, false)
})

// Revealing a CVE snapshot or an evidence file has to select it in the file
// manager. Opening it would launch the file in whatever application claims the
// extension, which is a different and unwanted action.
test('revealLocalPath selects the entry instead of opening it', async () => {
  const target = path.resolve('snapshot.json')
  const revealed = []

  await revealLocalPath(target, {
    stat: async () => ({ isDirectory: () => false, isFile: () => true }),
    showItemInFolder: async value => {
      revealed.push(value)
    },
  })

  assert.deepEqual(revealed, [target])
})

test('revealLocalPath applies the same path validation as opening', async () => {
  let revealed = false
  const showItemInFolder = async () => {
    revealed = true
  }

  await assert.rejects(
    revealLocalPath('relative/path', {
      stat: async () => ({ isDirectory: () => false, isFile: () => true }),
      showItemInFolder,
    }),
    /must be absolute/u,
  )
  await assert.rejects(
    revealLocalPath(path.resolve('missing'), {
      stat: async () => { throw new Error('missing') },
      showItemInFolder,
    }),
    /local path is unavailable: missing/u,
  )
  assert.equal(revealed, false)
})

test('openLocalPath rejects special files and surfaces shell failures', async () => {
  const target = path.resolve('target')

  await assert.rejects(
    openLocalPath(target, {
      stat: async () => ({ isDirectory: () => false, isFile: () => false }),
      openPath: async () => '',
    }),
    /not a file or directory/u,
  )
  await assert.rejects(
    openLocalPath(target, {
      stat: async () => ({ isDirectory: () => false, isFile: () => true }),
      openPath: async () => 'no application is associated',
    }),
    /open local path: no application is associated/u,
  )
})

test('copyImageFile writes a real file image and rejects everything else', async () => {
  const target = path.resolve('milk-cat.png')
  const written = []
  const image = { isEmpty: () => false }
  await copyImageFile(target, {
    stat: async () => ({ isDirectory: () => false, isFile: () => true }),
    readImage: async value => {
      assert.equal(value, target)
      return image
    },
    writeImage: async value => {
      written.push(value)
    },
  })
  assert.deepEqual(written, [image])

  await assert.rejects(
    copyImageFile('relative.png', {
      stat: async () => ({ isDirectory: () => false, isFile: () => true }),
      readImage: async () => image,
      writeImage: async () => {},
    }),
    /must be absolute/u,
  )
  await assert.rejects(
    copyImageFile(target, {
      stat: async () => ({ isDirectory: () => true, isFile: () => false }),
      readImage: async () => image,
      writeImage: async () => {},
    }),
    /not a file/u,
  )
  await assert.rejects(
    copyImageFile(target, {
      stat: async () => ({ isDirectory: () => false, isFile: () => true }),
      readImage: async () => ({ isEmpty: () => true }),
      writeImage: async () => {},
    }),
    /image is empty/u,
  )
})
