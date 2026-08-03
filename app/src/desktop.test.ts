// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { invokeCommand } from './desktop'

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'go')
})

describe('desktop command adapter', () => {
  it('passes Coding background task refresh policy to Wails unchanged', async () => {
    const status = {
      defaultEngine: 'pi',
      running: true,
      sessionCount: 1,
      protocol: 'pi',
      backgroundTasks: [],
    }
    const refreshCodingBackgroundTasks = vi.fn(async () => status)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            RefreshCodingBackgroundTasks: refreshCodingBackgroundTasks,
          },
        },
      },
    })

    await expect(invokeCommand('refresh_coding_background_tasks', {
      conversationId: 'conversation-bg',
      workspacePath: '/workspace/milksu',
      executionMode: 'go',
      approvalPolicy: 'workspace-auto',
    })).resolves.toBe(status)

    expect(refreshCodingBackgroundTasks).toHaveBeenCalledWith(
      'conversation-bg',
      '/workspace/milksu',
      'go',
      'workspace-auto',
    )
  })

  it('passes Coding background task start and stop details to Wails unchanged', async () => {
    const status = {
      defaultEngine: 'pi',
      running: true,
      sessionCount: 1,
      protocol: 'pi',
      backgroundTasks: [{
        id: 'bg-dev',
        kind: 'process',
        status: 'running',
        command: 'npm run dev',
      }],
    }
    const startCodingBackgroundTask = vi.fn(async () => status)
    const stopCodingBackgroundTask = vi.fn(async () => status)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            StartCodingBackgroundTask: startCodingBackgroundTask,
            StopCodingBackgroundTask: stopCodingBackgroundTask,
          },
        },
      },
    })

    await expect(invokeCommand('start_coding_background_task', {
      conversationId: 'conversation-bg',
      workspacePath: '/workspace/milksu',
      command: 'npm run dev',
      name: 'dev server',
      executionMode: 'go',
      approvalPolicy: 'full-auto',
    })).resolves.toBe(status)

    expect(startCodingBackgroundTask).toHaveBeenCalledWith(
      'conversation-bg',
      '/workspace/milksu',
      'npm run dev',
      'dev server',
      'go',
      'full-auto',
    )

    await expect(invokeCommand('stop_coding_background_task', {
      conversationId: 'conversation-bg',
      taskId: 'bg-dev',
    })).resolves.toBe(status)

    expect(stopCodingBackgroundTask).toHaveBeenCalledWith(
      'conversation-bg',
      'bg-dev',
    )
  })

  it('uses deliverable defaults for omitted Coding background task mode and policy', async () => {
    const status = {
      defaultEngine: 'pi',
      running: true,
      sessionCount: 1,
      protocol: 'pi',
      backgroundTasks: [],
    }
    const refreshCodingBackgroundTasks = vi.fn(async () => status)
    const startCodingBackgroundTask = vi.fn(async () => status)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            RefreshCodingBackgroundTasks: refreshCodingBackgroundTasks,
            StartCodingBackgroundTask: startCodingBackgroundTask,
          },
        },
      },
    })

    await invokeCommand('refresh_coding_background_tasks', {
      conversationId: 'conversation-bg',
      workspacePath: '/workspace/milksu',
    })
    await invokeCommand('start_coding_background_task', {
      conversationId: 'conversation-bg',
      workspacePath: '/workspace/milksu',
      command: 'npm run dev',
    })

    expect(refreshCodingBackgroundTasks).toHaveBeenCalledWith(
      'conversation-bg',
      '/workspace/milksu',
      'go',
      'workspace-auto',
    )
    expect(startCodingBackgroundTask).toHaveBeenCalledWith(
      'conversation-bg',
      '/workspace/milksu',
      'npm run dev',
      '',
      'go',
      'workspace-auto',
    )
  })

  it('passes Coding artifact preview scope to Wails unchanged', async () => {
    const preview = {
      relativePath: 'docs/demo.html',
      kind: 'html',
      mediaType: 'text/html; charset=utf-8',
      sizeBytes: 128,
      content: '<h1>Preview</h1>',
    }
    const getCodingArtifactPreview = vi.fn(async () => preview)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            GetCodingArtifactPreview: getCodingArtifactPreview,
          },
        },
      },
    })

    await expect(invokeCommand('get_coding_artifact_preview', {
      workspacePath: '/workspace/milksu',
      relativePath: 'docs/demo.html',
    })).resolves.toBe(preview)

    expect(getCodingArtifactPreview).toHaveBeenCalledWith(
      '/workspace/milksu',
      'docs/demo.html',
    )
  })

  it('passes Coding collaboration preparation details to Wails unchanged', async () => {
    const status = {
      schemaVersion: 1,
      conversationId: 'conversation-collab',
      workspace: '/workspace/milksu',
      phase: 'active',
      active: true,
      canFinish: true,
      worktrees: [],
    }
    const prepareCodingCollaboration = vi.fn(async () => status)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            PrepareCodingCollaboration: prepareCodingCollaboration,
          },
        },
      },
    })

    await expect(invokeCommand('prepare_coding_collaboration', {
      conversationId: 'conversation-collab',
      workspacePath: '/workspace/milksu',
      writers: '2',
    })).resolves.toBe(status)

    expect(prepareCodingCollaboration).toHaveBeenCalledWith(
      'conversation-collab',
      '/workspace/milksu',
      2,
    )
  })

  it('defaults omitted Coding collaboration writer count to one', async () => {
    const prepareCodingCollaboration = vi.fn(async () => ({
      schemaVersion: 1,
      conversationId: 'conversation-collab',
      workspace: '/workspace/milksu',
      phase: 'active',
      active: true,
      canFinish: true,
      worktrees: [],
    }))
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            PrepareCodingCollaboration: prepareCodingCollaboration,
          },
        },
      },
    })

    await invokeCommand('prepare_coding_collaboration', {
      conversationId: 'conversation-collab',
      workspacePath: '/workspace/milksu',
    })

    expect(prepareCodingCollaboration).toHaveBeenCalledWith(
      'conversation-collab',
      '/workspace/milksu',
      1,
    )
  })

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
