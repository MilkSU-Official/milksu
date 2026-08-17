'use strict'

const assert = require('node:assert/strict')
const path = require('node:path')
const test = require('node:test')

const { openLocalPath } = require('./local-path.cjs')

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
