// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { invokeCommand } from './desktop'

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'go')
})

describe('desktop command adapter', () => {
  it('passes Pull Request publish confirmation details to Wails unchanged', async () => {
    const result = {
      repository: 'MilkSU-Official/milksu',
      sourceBranch: 'codex/self-hosting',
      headCommit: '0123456789abcdef0123456789abcdef01234567',
      targetBranch: 'main',
      number: 42,
      url: 'https://github.com/MilkSU-Official/milksu/pull/42',
      state: 'OPEN',
      draft: true,
      created: true,
      verified: true,
    }
    const publishCodingPullRequest = vi.fn(async () => result)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            PublishCodingPullRequest: publishCodingPullRequest,
          },
        },
      },
    })

    await expect(invokeCommand('publish_coding_pull_request', {
      workspacePath: '/workspace/milksu',
      confirmationToken: 'preview-token',
      title: 'feat: self host',
      body: 'Validated in MilkSU.',
    })).resolves.toBe(result)

    expect(publishCodingPullRequest).toHaveBeenCalledWith(
      '/workspace/milksu',
      'preview-token',
      'feat: self host',
      'Validated in MilkSU.',
    )
  })

  it('uses empty strings for omitted Pull Request publish text fields', async () => {
    const publishCodingPullRequest = vi.fn(async () => ({
      repository: 'MilkSU-Official/milksu',
      sourceBranch: 'codex/self-hosting',
      headCommit: '0123456789abcdef0123456789abcdef01234567',
      targetBranch: 'main',
      number: 42,
      url: 'https://github.com/MilkSU-Official/milksu/pull/42',
      state: 'OPEN',
      draft: true,
      created: true,
      verified: true,
    }))
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            PublishCodingPullRequest: publishCodingPullRequest,
          },
        },
      },
    })

    await invokeCommand('publish_coding_pull_request', {
      workspacePath: '/workspace/milksu',
      confirmationToken: 'preview-token',
    })

    expect(publishCodingPullRequest).toHaveBeenCalledWith(
      '/workspace/milksu',
      'preview-token',
      '',
      '',
    )
  })

  it('passes the selected Computer Use PID and window id to Wails unchanged', async () => {
    const status = {
      available: true,
      enabled: true,
      conversationId: 'conversation-ui',
      phase: 'ready',
      target: {
        name: 'Codex',
        bundleId: 'com.openai.codex',
        pid: 4242,
        windowId: 9001,
      },
      permissions: {
        accessibility: true,
        screenRecording: true,
      },
    }
    const startCodingComputerUse = vi.fn(async () => status)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            StartCodingComputerUse: startCodingComputerUse,
          },
        },
      },
    })

    await expect(invokeCommand('start_coding_computer_use', {
      conversationId: 'conversation-ui',
      targetPid: 4242,
      targetWindowId: 9001,
    })).resolves.toBe(status)

    expect(startCodingComputerUse).toHaveBeenCalledWith(
      'conversation-ui',
      4242,
      9001,
    )
  })
})
