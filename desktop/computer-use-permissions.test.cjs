'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const {
  probeComputerUsePermissions,
  computerUsePermissionsSettingsURL,
  shouldRelaunchAfterScreenRecordingGrant,
} = require('./computer-use-permissions.cjs')

test('probeComputerUsePermissions reads Electron host TCC without inventing grants', () => {
  const calls = []
  const result = probeComputerUsePermissions({
    isTrustedAccessibilityClient(prompt) {
      calls.push(['ax', prompt])
      return true
    },
    getMediaAccessStatus(mediaType) {
      calls.push(['screen', mediaType])
      return 'granted'
    },
  }, { prompt: false })
  assert.deepEqual(result, {
    accessibility: true,
    screenRecording: true,
    screenStatus: 'granted',
  })
  assert.deepEqual(calls, [['ax', false], ['screen', 'screen']])
})

test('probeComputerUsePermissions treats non-granted screen status as false', () => {
  for (const screenStatus of ['not-determined', 'denied', 'restricted', 'unknown', '']) {
    const result = probeComputerUsePermissions({
      isTrustedAccessibilityClient: () => false,
      getMediaAccessStatus: () => screenStatus,
    })
    assert.equal(result.accessibility, false)
    assert.equal(result.screenRecording, false)
    assert.equal(result.screenStatus, screenStatus || 'unknown')
  }
})

test('probeComputerUsePermissions fails closed when Electron APIs throw', () => {
  const result = probeComputerUsePermissions({
    isTrustedAccessibilityClient() { throw new Error('no ax') },
    getMediaAccessStatus() { throw new Error('no screen') },
  })
  assert.deepEqual(result, {
    accessibility: false,
    screenRecording: false,
    screenStatus: 'unknown',
  })
})

test('computerUsePermissionsSettingsURL opens the separately requested privacy pane', () => {
  assert.equal(
    computerUsePermissionsSettingsURL('screen-recording'),
    'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
  )
  assert.equal(
    computerUsePermissionsSettingsURL('accessibility'),
    'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
  )
  assert.throws(() => computerUsePermissionsSettingsURL('camera'), /unsupported Computer Use permission/)
})

test('screen grant relaunch is armed only for a fresh transition to granted', () => {
  const openedAt = Date.now()
  assert.equal(shouldRelaunchAfterScreenRecordingGrant({
    openedAt,
    previousStatus: 'denied',
  }, 'granted', openedAt + 1000), true)
  assert.equal(shouldRelaunchAfterScreenRecordingGrant({
    openedAt,
    previousStatus: 'granted',
  }, 'granted', openedAt + 1000), false)
  assert.equal(shouldRelaunchAfterScreenRecordingGrant({
    openedAt,
    previousStatus: 'denied',
  }, 'denied', openedAt + 1000), false)
  assert.equal(shouldRelaunchAfterScreenRecordingGrant({
    openedAt,
    previousStatus: 'denied',
  }, 'granted', openedAt + 11 * 60 * 1000), false)
})
