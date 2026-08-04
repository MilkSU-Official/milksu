// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from 'vitest'
import { invokeCommand } from './desktop'

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'go')
})

describe('desktop command adapter', () => {
  it('passes CISA KEV feed sync to the Wails read-only fetcher', async () => {
    const feed = {
      sourceName: 'CISA KEV',
      sourceUrl: 'https://www.cisa.gov/sites/default/files/feeds/known_exploited_vulnerabilities.json',
      retrievedAt: '2026-08-04T01:02:03Z',
      lastModified: '2026-08-04T01:02:03Z',
      httpStatus: 200,
      contentType: 'application/json',
      body: '{"vulnerabilities":[]}',
    }
    const fetchCISAKEVFeed = vi.fn(async () => feed)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            FetchCISAKEVFeed: fetchCISAKEVFeed,
          },
        },
      },
    })

    await expect(invokeCommand('fetch_cisa_kev_feed')).resolves.toBe(feed)
    expect(fetchCISAKEVFeed).toHaveBeenCalledTimes(1)
  })

  it('passes selected NVD CVE sync to the Wails read-only fetcher', async () => {
    const feed = {
      sourceName: 'NVD',
      sourceUrl: 'https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=CVE-2024-3400',
      retrievedAt: '2026-08-04T07:00:00Z',
      lastModified: '2026-08-04T07:00:00Z',
      httpStatus: 200,
      contentType: 'application/json',
      body: '{"vulnerabilities":[{"cve":{"id":"CVE-2024-3400"}}]}',
    }
    const fetchNVDCVE = vi.fn(async () => feed)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            FetchNVDCVE: fetchNVDCVE,
          },
        },
      },
    })

    await expect(invokeCommand('fetch_nvd_cve', { cveId: 'CVE-2024-3400' })).resolves.toBe(feed)
    expect(fetchNVDCVE).toHaveBeenCalledTimes(1)
    expect(fetchNVDCVE).toHaveBeenCalledWith('CVE-2024-3400')
  })

  it('passes selected FIRST EPSS sync to the Wails read-only fetcher', async () => {
    const feed = {
      sourceName: 'FIRST EPSS',
      sourceUrl: 'https://api.first.org/data/v1/epss?cve=CVE-2024-3400',
      retrievedAt: '2026-08-04T08:00:00Z',
      lastModified: '',
      httpStatus: 200,
      contentType: 'application/json',
      body: '{"data":[{"cve":"CVE-2024-3400","epss":"0.932410000","percentile":"0.997200000","date":"2026-08-04"}]}',
    }
    const fetchFIRSTEPSS = vi.fn(async () => feed)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            FetchFIRSTEPSS: fetchFIRSTEPSS,
          },
        },
      },
    })

    await expect(invokeCommand('fetch_first_epss', { cveId: 'CVE-2024-3400' })).resolves.toBe(feed)
    expect(fetchFIRSTEPSS).toHaveBeenCalledTimes(1)
    expect(fetchFIRSTEPSS).toHaveBeenCalledWith('CVE-2024-3400')
  })

  it('passes Vulhub practice catalog sync to the Wails read-only fetcher', async () => {
    const catalog = {
      sourceName: 'Vulhub Practice Catalog',
      sourceUrl: 'https://github.com/vulhub/vulhub',
      retrievedAt: '2026-08-04T06:00:00Z',
      lastModified: '2026-08-04T06:00:00Z',
      httpStatus: 200,
      contentType: 'application/json',
      body: '{"items":[]}',
    }
    const fetchVulhubPracticeCatalog = vi.fn(async () => catalog)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            FetchVulhubPracticeCatalog: fetchVulhubPracticeCatalog,
          },
        },
      },
    })

    await expect(invokeCommand('fetch_vulhub_practice_catalog')).resolves.toBe(catalog)
    expect(fetchVulhubPracticeCatalog).toHaveBeenCalledTimes(1)
  })

  it('passes CVE feed snapshot reveal to Wails with the exact backend-validated path', async () => {
    const revealVulnerabilityFeedSnapshot = vi.fn(async () => undefined)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            RevealVulnerabilityFeedSnapshot: revealVulnerabilityFeedSnapshot,
          },
        },
      },
    })

    await expect(invokeCommand('reveal_vulnerability_feed_snapshot', {
      snapshotPath: '/Users/example/Library/Application Support/MilkSU/vuln/feed-snapshots/nvd/20260804T070000Z-abcd.json',
    })).resolves.toBeUndefined()
    expect(revealVulnerabilityFeedSnapshot).toHaveBeenCalledOnce()
    expect(revealVulnerabilityFeedSnapshot).toHaveBeenCalledWith(
      '/Users/example/Library/Application Support/MilkSU/vuln/feed-snapshots/nvd/20260804T070000Z-abcd.json',
    )
  })

  it('does not pretend browser preview can reveal CVE feed snapshots in Finder', async () => {
    await expect(invokeCommand('reveal_vulnerability_feed_snapshot', {
      snapshotPath: '/tmp/feed.json',
    })).rejects.toThrow('MilkSU 桌面运行时')
  })

  it('passes CVE practice directory selection and lifecycle to Wails', async () => {
    const request = {
      cveId: 'CVE-2023-46604',
      environmentId: 'vulhub-cve-2023-46604',
      directory: '/Users/example/vulhub/activemq/CVE-2023-46604',
      sourceRevision: 'vulhub master abc123',
      cleanupVolumes: true,
    }
    const run = {
      schema: 'milksu-vuln-practice-run/v1',
      action: 'start',
      state: 'running',
      cveId: request.cveId,
      environmentId: request.environmentId,
      directory: request.directory,
      composeFile: `${request.directory}/docker-compose.yml`,
      projectName: 'milksu-cve-2023-46604-abcd',
      observedAt: '2026-08-05T08:00:00Z',
      evidencePath: '/Users/example/Library/Application Support/MilkSU/vuln/practice-runs/cve-2023-46604/start.json',
      containerCount: 1,
      gates: {
        dockerAvailable: true,
        composeFileValidated: true,
        started: true,
        statusObserved: true,
        stopped: false,
        noCredentialLeak: true,
      },
    }
    const chooseVulnerabilityPracticeDirectory = vi.fn(async () => request.directory)
    const startVulnerabilityPractice = vi.fn(async () => run)
    const getVulnerabilityPracticeStatus = vi.fn(async () => ({ ...run, action: 'status' }))
    const stopVulnerabilityPractice = vi.fn(async () => ({ ...run, action: 'stop', state: 'stopped' }))
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            ChooseVulnerabilityPracticeDirectory: chooseVulnerabilityPracticeDirectory,
            StartVulnerabilityPractice: startVulnerabilityPractice,
            GetVulnerabilityPracticeStatus: getVulnerabilityPracticeStatus,
            StopVulnerabilityPractice: stopVulnerabilityPractice,
          },
        },
      },
    })

    await expect(invokeCommand('choose_vulnerability_practice_directory')).resolves.toBe(request.directory)
    await expect(invokeCommand('start_vulnerability_practice', { request })).resolves.toBe(run)
    await expect(invokeCommand('get_vulnerability_practice_status', { request })).resolves.toMatchObject({ action: 'status' })
    await expect(invokeCommand('stop_vulnerability_practice', { request })).resolves.toMatchObject({ state: 'stopped' })
    expect(startVulnerabilityPractice).toHaveBeenCalledWith(request)
    expect(getVulnerabilityPracticeStatus).toHaveBeenCalledWith(request)
    expect(stopVulnerabilityPractice).toHaveBeenCalledWith(request)
  })

  it('does not pretend browser preview can start CVE practice containers', async () => {
    await expect(invokeCommand('start_vulnerability_practice', {
      request: {
        cveId: 'CVE-2023-46604',
        environmentId: 'vulhub-cve-2023-46604',
        directory: '/tmp/vulhub/activemq/CVE-2023-46604',
      },
    })).rejects.toThrow('MilkSU 桌面运行时')
  })

  it('passes Session Index status, refresh, and history search to Wails', async () => {
    const status = {
      available: true,
      mode: 'milksu-obelisk-core',
      indexPath: '/Users/example/Library/Application Support/com.milksu.app/session-index/obelisk.sqlite',
      checkedAt: '2026-08-04T09:30:00Z',
      readOnly: true,
      sessionCount: 2,
      messageCount: 5,
      toolCallCount: 1,
      memoryCount: 0,
      sources: [{ source: 'milksu-coding', count: 2 }],
    }
    const refresh = {
      indexedAt: '2026-08-04T09:31:00Z',
      indexPath: status.indexPath,
      source: 'milksu',
      sessionCount: 2,
      messageCount: 5,
      toolCallCount: 1,
    }
    const searchResponse = {
      query: 'Computer Use',
      searchedAt: '2026-08-04T09:32:00Z',
      status,
      results: [{
        messageUuid: 'milksu:conversation:message',
        sessionId: 'milksu:conversation',
        sessionName: 'Computer Use validation',
        source: 'milksu-coding',
        timestamp: '2026-08-04T09:20:00Z',
        snippet: 'Computer Use 外部 App 点击已验证',
      }],
    }
    const getSessionIndexStatus = vi.fn(async () => status)
    const refreshSessionIndex = vi.fn(async () => refresh)
    const searchSessionHistory = vi.fn(async () => searchResponse)
    const importExternalSessionHistory = vi.fn(async () => ({
      importedAt: '2026-08-04T09:33:00Z',
      indexPath: status.indexPath,
      source: 'codex',
      path: '/tmp/codex-history.jsonl',
      sessionCount: 1,
      messageCount: 2,
      toolCallCount: 1,
      skippedLineCount: 0,
    }))
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            GetSessionIndexStatus: getSessionIndexStatus,
            RefreshSessionIndex: refreshSessionIndex,
            SearchSessionHistory: searchSessionHistory,
            ImportExternalSessionHistory: importExternalSessionHistory,
          },
        },
      },
    })

    await expect(invokeCommand('get_session_index_status')).resolves.toBe(status)
    await expect(invokeCommand('refresh_session_index')).resolves.toBe(refresh)
    await expect(invokeCommand('search_session_history', {
      request: { query: 'Computer Use', module: 'coding', limit: 4 },
    })).resolves.toBe(searchResponse)
    await expect(invokeCommand('import_external_session_history', {
      request: {
        source: 'codex',
        path: '/tmp/codex-history.jsonl',
        project: 'milksu',
        projectPath: '/Users/milksu/code/milksu',
      },
    })).resolves.toMatchObject({
      source: 'codex',
      sessionCount: 1,
      messageCount: 2,
    })
    expect(getSessionIndexStatus).toHaveBeenCalledOnce()
    expect(refreshSessionIndex).toHaveBeenCalledOnce()
    expect(searchSessionHistory).toHaveBeenCalledWith({
      query: 'Computer Use',
      module: 'coding',
      limit: 4,
    })
    expect(importExternalSessionHistory).toHaveBeenCalledWith({
      source: 'codex',
      path: '/tmp/codex-history.jsonl',
      project: 'milksu',
      projectPath: '/Users/milksu/code/milksu',
    })
  })

  it('does not ask browser preview users to install Obelisk for Session Index commands', async () => {
    await expect(invokeCommand('get_session_index_status')).resolves.toMatchObject({
      available: false,
      mode: 'browser-preview',
      reason: '打包 App 中会自动维护本机历史。',
    })
    await expect(invokeCommand('search_session_history', {
      request: { query: 'CVE-2024-3400', module: 'cve' },
    })).resolves.toMatchObject({
      query: 'CVE-2024-3400',
      results: [],
    })
    await expect(invokeCommand('import_external_session_history', {
      request: { source: 'codex', path: '/tmp/codex-history.jsonl' },
    })).rejects.toThrow('请在 MilkSU 桌面应用中导入外部历史。')
  })

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

  it('routes Coding artifact preview WebView smoke only through Wails', async () => {
    const request = {
      enabled: true,
      workspace: '/workspace/milksu',
      relativePath: 'reports/dangerous.html',
    }
    const getRequest = vi.fn(async () => request)
    const complete = vi.fn(async () => undefined)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            GetCodingArtifactPreviewWebViewSmokeRequest: getRequest,
            CompleteCodingArtifactPreviewWebViewSmoke: complete,
          },
        },
      },
    })

    await expect(invokeCommand('get_coding_artifact_preview_webview_smoke_request'))
      .resolves.toBe(request)
    await expect(invokeCommand('complete_coding_artifact_preview_webview_smoke', {
      report: {
        workspace: '/workspace/milksu',
        relativePath: 'reports/dangerous.html',
        gates: { iframeSandboxPresent: true },
      },
    })).resolves.toBeUndefined()

    expect(getRequest).toHaveBeenCalledOnce()
    expect(complete).toHaveBeenCalledWith({
      workspace: '/workspace/milksu',
      relativePath: 'reports/dangerous.html',
      gates: { iframeSandboxPresent: true },
    })
  })

  it('does not pretend browser preview can run the WebView artifact smoke', async () => {
    await expect(invokeCommand('get_coding_artifact_preview_webview_smoke_request'))
      .resolves.toEqual({ enabled: false })
    await expect(invokeCommand('complete_coding_artifact_preview_webview_smoke', {
      report: {},
    })).rejects.toThrow('MilkSU 桌面运行时')
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

  it('shows a friendly browser-preview fallback for Computer Use commands', async () => {
    await expect(invokeCommand('get_coding_computer_use_status')).resolves.toMatchObject({
      available: false,
      enabled: false,
      phase: 'unavailable',
      permissions: {
        accessibility: false,
        screenRecording: false,
      },
      problem: expect.stringContaining('MilkSU 桌面运行时'),
    })

    await expect(invokeCommand('request_coding_computer_use_permissions')).resolves.toMatchObject({
      available: false,
      enabled: false,
      problem: expect.stringContaining('浏览器预览只能验证 UI 文案和入口'),
    })
    await expect(invokeCommand('list_coding_computer_use_targets')).resolves.toEqual([])
    await expect(invokeCommand('start_coding_computer_use', {
      conversationId: 'conversation-ui',
      targetPid: 4242,
      targetWindowId: 9001,
    })).rejects.toThrow('Computer Use 可见 App 会话需要 MilkSU 桌面运行时')
    await expect(invokeCommand('stop_coding_computer_use', {
      conversationId: 'conversation-ui',
    })).rejects.toThrow('Computer Use 可见 App 会话需要 MilkSU 桌面运行时')
  })
})
