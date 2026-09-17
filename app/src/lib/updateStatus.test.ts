import { describe, expect, it } from 'vitest'
import {
  formatUpdateMegabytes,
  updatePhaseBusy,
  updatePhaseMessage,
  updateStatusMessage,
  updateWorking,
} from './updateStatus'

describe('update status copy', () => {
  it('names a cancelled download without treating it as an install failure', () => {
    expect(updateStatusMessage({
      state: 'error',
      currentVersion: '26.917.1',
      enabled: true,
      code: 'cancelled',
    })).toBe('已取消更新下载')
  })

  it('keeps the dialog working through verify, prepare and install', () => {
    expect(updateWorking({ state: 'downloading', currentVersion: '1', enabled: true, phase: 'verifying' })).toBe(true)
    expect(updatePhaseBusy({ state: 'downloading', currentVersion: '1', enabled: true, phase: 'preparing' })).toBe(true)
    expect(updateWorking({ state: 'downloaded', currentVersion: '1', enabled: true, phase: 'installing' })).toBe(true)
    expect(updateWorking({ state: 'downloaded', currentVersion: '1', enabled: true })).toBe(false)
    expect(updatePhaseMessage({
      state: 'downloaded',
      currentVersion: '1',
      enabled: true,
      version: '26.917.1',
    })).toContain('已下载并校验')
    expect(formatUpdateMegabytes(10 * 1024 * 1024)).toBe('10.0 MB')
  })
})
