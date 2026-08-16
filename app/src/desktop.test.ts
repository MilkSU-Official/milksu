// @vitest-environment jsdom

import { reactive } from 'vue'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { invokeCommand } from './desktop'

afterEach(() => {
  vi.restoreAllMocks()
  Reflect.deleteProperty(window, 'go')
  Reflect.deleteProperty(window, 'milksu')
})

describe('desktop command adapter', () => {
  it('imports and previews renderer clipboard attachments through Desktop RPC', async () => {
    const attachment = {
      id: 'a'.repeat(64),
      name: 'pasted.png',
      mediaType: 'image/png',
      size: 5,
      sha256: 'a'.repeat(64),
    }
    const preview = {
      name: attachment.name,
      mediaType: attachment.mediaType,
      size: attachment.size,
      kind: 'image',
      dataUrl: 'data:image/png;base64,aW1hZ2U=',
    }
    const invoke = vi.fn(async (method: string) => (
      method === 'ImportCodingAttachments' ? [attachment] : preview
    ))
    Object.defineProperty(window, 'milksu', {
      configurable: true,
      value: { invoke },
    })
    const payloads = [{
      name: attachment.name,
      mediaType: attachment.mediaType,
      dataBase64: 'aW1hZ2U=',
    }]

    await expect(invokeCommand('import_coding_attachments', { payloads }))
      .resolves.toEqual([attachment])
    await expect(invokeCommand('preview_coding_attachment', { attachment }))
      .resolves.toEqual(preview)
    expect(invoke).toHaveBeenNthCalledWith(1, 'ImportCodingAttachments', [payloads])
    expect(invoke).toHaveBeenNthCalledWith(2, 'PreviewCodingAttachment', [attachment])
  })

  it('serializes Vue reactive values before crossing Electron IPC', async () => {
    const invoke = vi.fn(async (_method: string, args: unknown[]) => {
      structuredClone(args)
    })
    Object.defineProperty(window, 'milksu', {
      configurable: true,
      value: { invoke },
    })
    const conversation = reactive({
      id: 'coding-1',
      title: '配置 IDA Pro',
      createdAt: 1,
      messages: [{ id: 'message-1', role: 'user', content: '运行健康检查', timestamp: 2 }],
    })

    await expect(invokeCommand('save_conversation', { conversation })).resolves.toBeUndefined()
    expect(invoke).toHaveBeenCalledWith('SaveConversation', [{
      id: 'coding-1',
      title: '配置 IDA Pro',
      createdAt: 1,
      messages: [{ id: 'message-1', role: 'user', content: '运行健康检查', timestamp: 2 }],
    }])
  })

  it('passes an exact queued-message removal through Desktop RPC', async () => {
    const invoke = vi.fn(async () => undefined)
    Object.defineProperty(window, 'milksu', {
      configurable: true,
      value: { invoke },
    })

    await expect(invokeCommand('remove_queued_message', {
      conversationId: 'coding-1',
      queue: 'steering',
      index: 2,
      expected: '先别改 API',
    })).resolves.toBeUndefined()
    expect(invoke).toHaveBeenCalledWith('RemoveQueuedMessage', [
      'coding-1',
      'steering',
      2,
      '先别改 API',
    ])
  })

  it('uses desktop-owned RPCs for adding and revoking project access', async () => {
    const invoke = vi.fn(async (method: string) => (
      method === 'AuthorizeConversationWorkspaceAccess'
        ? ['/Users/milksu/code/second-project']
        : []
    ))
    Object.defineProperty(window, 'milksu', {
      configurable: true,
      value: { invoke },
    })

    await expect(invokeCommand('authorize_conversation_workspace_access', {
      conversationId: 'coding-1',
    })).resolves.toEqual(['/Users/milksu/code/second-project'])
    await expect(invokeCommand('revoke_conversation_workspace_access', {
      conversationId: 'coding-1',
      path: '/Users/milksu/code/second-project',
    })).resolves.toEqual([])

    expect(invoke).toHaveBeenNthCalledWith(
      1,
      'AuthorizeConversationWorkspaceAccess',
      ['coding-1'],
    )
    expect(invoke).toHaveBeenNthCalledWith(
      2,
      'RevokeConversationWorkspaceAccess',
      ['coding-1', '/Users/milksu/code/second-project'],
    )
  })

  it('passes the first Coding message to the silent title generator', async () => {
    const generateConversationTitle = vi.fn(async () => '修复登录回调状态恢复')
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            GenerateConversationTitle: generateConversationTitle,
          },
        },
      },
    })

    await expect(invokeCommand('generate_conversation_title', {
      firstMessage: '登录刷新后丢失回调路径',
      modelMode: 'manual',
      modelProvider: 'tokenflux',
      modelId: 'grok-4.5',
    })).resolves.toBe('修复登录回调状态恢复')
    expect(generateConversationTitle).toHaveBeenCalledWith(
      '登录刷新后丢失回调路径',
      'manual',
      'tokenflux',
      'grok-4.5',
    )
  })

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

  it('passes NVD CVE search to the Wails read-only searcher', async () => {
    const feed = {
      sourceName: 'NVD',
      sourceUrl: 'https://services.nvd.nist.gov/rest/json/cves/2.0?keywordSearch=ActiveMQ',
      retrievedAt: '2026-08-13T03:00:00Z',
      lastModified: '',
      httpStatus: 200,
      contentType: 'application/json',
      body: '{"vulnerabilities":[]}',
    }
    const searchNVDCVEs = vi.fn(async () => feed)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: { main: { App: { SearchNVDCVEs: searchNVDCVEs } } },
    })

    await expect(invokeCommand('search_nvd_cves', { query: 'ActiveMQ' })).resolves.toBe(feed)
    expect(searchNVDCVEs).toHaveBeenCalledWith('ActiveMQ')
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

  it('passes selected OSV CVE sync to the Wails read-only fetcher', async () => {
    const feed = {
      sourceName: 'OSV',
      sourceUrl: 'https://api.osv.dev/v1/vulns/CVE-2023-46604',
      retrievedAt: '2026-08-04T09:00:00Z',
      lastModified: '',
      httpStatus: 200,
      contentType: 'application/json',
      body: '{"schema_version":"1.7.3","id":"CVE-2023-46604"}',
    }
    const fetchOSVCVE = vi.fn(async () => feed)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            FetchOSVCVE: fetchOSVCVE,
          },
        },
      },
    })

    await expect(invokeCommand('fetch_osv_cve', { cveId: 'CVE-2023-46604' })).resolves.toBe(feed)
    expect(fetchOSVCVE).toHaveBeenCalledTimes(1)
    expect(fetchOSVCVE).toHaveBeenCalledWith('CVE-2023-46604')
  })

  it('passes selected GitHub Advisory sync to the Wails read-only fetcher', async () => {
    const feed = {
      sourceName: 'GitHub Advisory Database',
      sourceUrl: 'https://api.github.com/advisories?cve_id=CVE-2023-46604&per_page=10',
      retrievedAt: '2026-08-04T10:00:00Z',
      lastModified: '',
      httpStatus: 200,
      contentType: 'application/json',
      body: '[{"ghsa_id":"GHSA-crg9-44h2-xw35","cve_id":"CVE-2023-46604"}]',
    }
    const fetchGitHubAdvisories = vi.fn(async () => feed)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            FetchGitHubAdvisories: fetchGitHubAdvisories,
          },
        },
      },
    })

    await expect(invokeCommand('fetch_github_advisories', { cveId: 'CVE-2023-46604' })).resolves.toBe(feed)
    expect(fetchGitHubAdvisories).toHaveBeenCalledTimes(1)
    expect(fetchGitHubAdvisories).toHaveBeenCalledWith('CVE-2023-46604')
  })

  it('passes CVE tracking workspace creation to the Wails research facade', async () => {
    const projection = {
      contractVersion: 'vuln.milksu.dev/v1alpha1',
      job: { id: 'job-cve', title: 'CVE-2023-46604 · tracking', role: 'vuln.research', collaborationMode: 'copilot', status: 'queued', createdAt: '2026-08-05T00:00:00Z', updatedAt: '2026-08-05T00:00:00Z' },
      target: { id: 'target-cve', name: 'CVE-2023-46604', version: 'tracking', component: 'ActiveMQ', fixture: 'cve-tracking', collaborationMode: 'copilot', scope: { id: 'scope-cve', source: 'user-confirmed:cve-tracking', purpose: 'authorized CVE learning note tracking', targets: [{ kind: 'lab', value: 'cve-tracking:CVE-2023-46604' }], grantedBy: 'local-user', createdAt: '2026-08-05T00:00:00Z', expiresAt: '2026-09-04T00:00:00Z', revocable: true }, sourceArtifactId: '', readmeArtifactId: '', admittedAt: '2026-08-05T00:00:00Z' },
      hypotheses: [],
      experiments: [],
      artifacts: [],
      evidence: [],
      evaluations: [],
      learning: [],
      assetVerifications: [],
      humanOutcome: { goal: 'record learning', reflectionCount: 0, independentSteps: 0, variantCount: 0, summary: '尚未记录学习复盘。' },
      events: [],
    }
    const ensureVulnTrackingWorkspace = vi.fn(async () => projection)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            EnsureVulnTrackingWorkspace: ensureVulnTrackingWorkspace,
          },
        },
      },
    })
    const request = {
      cveId: 'CVE-2023-46604',
      title: 'Apache ActiveMQ OpenWire RCE',
      summary: 'User-confirmed research note.',
      referenceHref: 'https://nvd.nist.gov/vuln/detail/CVE-2023-46604',
    }

    await expect(invokeCommand('ensure_vuln_tracking_workspace', { request })).resolves.toBe(projection)
    expect(ensureVulnTrackingWorkspace).toHaveBeenCalledTimes(1)
    expect(ensureVulnTrackingWorkspace).toHaveBeenCalledWith(request)
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

  it('rejects product commands when the desktop runtime is absent', async () => {
    await expect(invokeCommand('reveal_vulnerability_feed_snapshot', {
      snapshotPath: '/tmp/feed.json',
    })).rejects.toThrow('MilkSU desktop runtime is unavailable')
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

  it('passes Session Index status, refresh, search, and graph projection to Wails', async () => {
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
    const graphResponse = {
      generatedAt: '2026-08-04T09:32:00Z',
      status,
      nodes: [{
        id: 'session:conversation',
        type: 'session',
        label: 'Computer Use validation',
        sources: [{
          sessionId: 'milksu:conversation',
          conversationId: 'conversation',
          sessionName: 'Computer Use validation',
        }],
      }],
      edges: [],
      projects: ['milksu'],
      truncated: false,
    }
    const getSessionIndexStatus = vi.fn(async () => status)
    const refreshSessionIndex = vi.fn(async () => refresh)
    const searchSessionHistory = vi.fn(async () => searchResponse)
    const getSessionHistoryGraph = vi.fn(async () => graphResponse)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            GetSessionIndexStatus: getSessionIndexStatus,
            RefreshSessionIndex: refreshSessionIndex,
            SearchSessionHistory: searchSessionHistory,
            GetSessionHistoryGraph: getSessionHistoryGraph,
          },
        },
      },
    })

    await expect(invokeCommand('get_session_index_status')).resolves.toBe(status)
    await expect(invokeCommand('refresh_session_index')).resolves.toBe(refresh)
    await expect(invokeCommand('search_session_history', {
      request: { query: 'Computer Use', module: 'coding', limit: 4 },
    })).resolves.toBe(searchResponse)
    await expect(invokeCommand('get_session_history_graph', {
      request: { query: 'Computer Use', module: 'coding', maxNodes: 120, maxEdges: 200 },
    })).resolves.toBe(graphResponse)
    expect(getSessionIndexStatus).toHaveBeenCalledOnce()
    expect(refreshSessionIndex).toHaveBeenCalledOnce()
    expect(searchSessionHistory).toHaveBeenCalledWith({
      query: 'Computer Use',
      module: 'coding',
      limit: 4,
    })
    expect(getSessionHistoryGraph).toHaveBeenCalledWith({
      query: 'Computer Use',
      module: 'coding',
      maxNodes: 120,
      maxEdges: 200,
    })
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

  it('activates the persisted Computer Use scope for the selected Coding task', async () => {
    const status = {
      available: true,
      enabled: true,
      authorized: true,
      conversationId: 'conversation-ui',
      phase: 'ready',
      target: {
        name: 'MilkSU Beta',
        bundleId: 'com.milksu.app.beta',
        pid: 4343,
        windowId: 9010,
      },
      permissions: {
        accessibility: true,
        screenRecording: true,
      },
    }
    const activateCodingComputerUse = vi.fn(async () => status)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            ActivateCodingComputerUse: activateCodingComputerUse,
          },
        },
      },
    })

    await expect(invokeCommand('activate_coding_computer_use', {
      conversationId: 'conversation-ui',
    })).resolves.toBe(status)

    expect(activateCodingComputerUse).toHaveBeenCalledWith('conversation-ui')
  })

  it('passes the daily CTF date and exclusions to the recommendation service', async () => {
    const selection = {
      dateKey: '2026-08-13',
      problemId: 2655,
      reason: '延续最近的 Reverse 练习，难度跨度合适。',
      source: 'pi',
      provider: 'tokenflux',
      model: 'grok-4.5',
    }
    const recommendCTFDailyChallenge = vi.fn(async () => selection)
    Object.defineProperty(window, 'go', {
      configurable: true,
      value: {
        main: {
          App: {
            RecommendCTFDailyChallenge: recommendCTFDailyChallenge,
          },
        },
      },
    })

    await expect(invokeCommand('recommend_ctf_daily_challenge', {
      dateKey: '2026-08-13',
      excludedProblemIds: [3400, 3094],
    })).resolves.toBe(selection)

    expect(recommendCTFDailyChallenge).toHaveBeenCalledWith(
      '2026-08-13',
      [3400, 3094],
    )
  })

})
