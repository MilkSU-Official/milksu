'use strict'

const assert = require('node:assert/strict')
const test = require('node:test')

const {
  attachBrowserView,
  detachBrowserView,
} = require('./browser-view-attachment.cjs')

function fixture(attached = false) {
  const calls = []
  const view = {
    setVisible(value) {
      calls.push(['visible', value])
    },
  }
  const contentView = {
    addChildView(value) {
      calls.push(['add', value])
    },
    removeChildView(value) {
      calls.push(['remove', value])
    },
  }
  return { calls, contentView, current: { attached, view } }
}

test('detaching a hidden browser removes it from the native view tree', () => {
  const state = fixture(true)

  detachBrowserView(state.contentView, state.current)

  assert.equal(state.current.attached, false)
  assert.deepEqual(state.calls, [
    ['visible', false],
    ['remove', state.current.view],
  ])
})

test('a newly restored browser can start detached until its panel is visible', () => {
  const state = fixture(true)

  detachBrowserView(state.contentView, state.current)
  attachBrowserView(state.contentView, state.current)

  assert.equal(state.current.attached, true)
  assert.deepEqual(state.calls, [
    ['visible', false],
    ['remove', state.current.view],
    ['add', state.current.view],
  ])
})

test('browser view attachment is idempotent', () => {
  const state = fixture(false)

  attachBrowserView(state.contentView, state.current)
  attachBrowserView(state.contentView, state.current)
  detachBrowserView(state.contentView, state.current)
  detachBrowserView(state.contentView, state.current)

  assert.equal(state.current.attached, false)
  assert.deepEqual(state.calls, [
    ['add', state.current.view],
    ['visible', false],
    ['remove', state.current.view],
    ['visible', false],
  ])
})
