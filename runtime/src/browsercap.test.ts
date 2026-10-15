import assert from 'node:assert/strict'
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ConversationStore } from './conversations.ts'
import { closeBrowserCap } from './domains/browser.ts'
import './domains/browser.ts'
import type { Engine } from './engine.ts'
import { handleOwnedMethod, isOwnedMethod, type HandlerContext } from './handlers.ts'
import { LabJobStore } from './lab.ts'
import {
  chromeFixedCandidates,
  desktopExecPath,
  extensionSourceDir,
  findChromeWith,
  loopbackEndpointPort,
  Manager,
  matchCodingTab,
  originTarget,
  browserUseRuntimeStatus,
} from './browsercap/index.ts'

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'milksu-browsercap-'))
}

type HostCall = NonNullable<HandlerContext['hostCall']>

function recordingHost(options?: {
  cdpEndpoint?: string
  tabs?: { activeTabId: string; tabs: unknown[] }
}): { calls: Array<{ method: string; payload?: unknown }>; hostCall: HostCall } {
  const calls: Array<{ method: string; payload?: unknown }> = []
  const hostCall: HostCall = async (method, payload) => {
    calls.push({ method, payload })
    if (method === 'browser.start') {
      return {
        name: 'Electron Chromium fixture',
        cdpEndpoint: options?.cdpEndpoint ?? 'http://127.0.0.1:43117',
      }
    }
    if (
      method === 'browser.listTabs'
      || method === 'browser.createTab'
      || method === 'browser.createResearchTab'
      || method === 'browser.activateTab'
      || method === 'browser.closeTab'
      || method === 'browser.closeAllTabs'
    ) {
      return options?.tabs ?? { activeTabId: '', tabs: [] }
    }
    return null
  }
  return { calls, hostCall }
}

async function stubCtx(home: string, hostCall?: HostCall): Promise<HandlerContext> {
  const conversations = new ConversationStore(join(home, 'data', 'stores', 'conversations'))
  await conversations.ensure()
  const labJobs = new LabJobStore(join(home, 'data', 'stores', 'lab-jobs'))
  await labJobs.ensure()
  return {
    conversations,
    labJobs,
    research: { deleteConversation: async () => null } as HandlerContext['research'],
    engine: {
      detachSession: async () => {},
      destroySession: async () => {},
    } as Engine,
    emit: () => {},
    home,
    hostCall,
  }
}

test('extensionSourceDir prefers MILKSU_RESOURCES then checkout, not process.cwd', async () => {
  const isolated = await mkdtemp(join(tmpdir(), 'milksu-extension-cwd-'))
  const resources = await mkdtemp(join(tmpdir(), 'milksu-extension-res-'))
  await mkdir(join(resources, 'browserextension'), { recursive: true })
  await writeFile(join(resources, 'browserextension', 'manifest.json'), '{"name":"fixture"}')
  const previousCwd = process.cwd()
  process.chdir(isolated)
  try {
    const fromResources = extensionSourceDir({ MILKSU_RESOURCES: resources })
    assert.equal(fromResources, join(resources, 'browserextension'))
    const fromCheckout = extensionSourceDir({})
    assert.ok(fromCheckout)
    assert.ok(fromCheckout.endsWith(`${join('browserextension')}`))
    assert.notEqual(fromCheckout, join(isolated, 'browserextension'))
  } finally {
    process.chdir(previousCwd)
  }
})

test('owned browser handlers are registered', () => {
  for (const method of [
    'StartCodingBrowser',
    'EnsureCodingBrowser',
    'GetCodingBrowserStatus',
    'GetCodingBrowserOverview',
    'StopCodingBrowser',
    'CloseCodingBrowserTab',
    'GetBrowserUseRuntime',
    'GetBrowserUseStatus',
    'RevealBrowserExtension',
    'ListCodingBrowserTabs',
    'FocusCodingBrowserTab',
    'OpenCodingBrowserURL',
    'NavigateCodingBrowser',
    'ActivateCodingBrowserTab',
    'CreateCodingBrowserTab',
    'RevealCodingBrowserEvidence',
  ]) {
    assert.equal(isOwnedMethod(method), true, method)
  }
})

test('Start/Stop record host create/destroy and List is empty', async () => {
  const home = await tempHome()
  const { calls, hostCall } = recordingHost()
  const ctx = await stubCtx(home, hostCall)
  try {
    const listed = await handleOwnedMethod(ctx, 'renderer', 'ListCodingBrowserTabs', ['conversation-1']) as {
      tabs: unknown[]
    }
    assert.deepEqual(listed.tabs, [])
    assert.equal(calls.some((item) => item.method === 'browser.start'), false)

    const started = await handleOwnedMethod(ctx, 'renderer', 'StartCodingBrowser', [
      'conversation-1',
      'https://example.com/docs',
    ]) as { enabled: boolean; sessionId: string; profileLabel: string; tabs?: unknown[] }
    assert.equal(started.enabled, true)
    assert.match(started.sessionId, /^browser_/)
    assert.equal(started.profileLabel, 'https://example.com')
    assert.deepEqual(started.tabs, [])
    const create = calls.find((item) => item.method === 'browser.start')
    assert.ok(create)
    const createPayload = create.payload as { sessionId: string; initialUrl: string; profilePath: string }
    assert.equal(createPayload.sessionId, started.sessionId)
    assert.equal(createPayload.initialUrl, 'https://example.com/docs')
    assert.ok(String(createPayload.profilePath).includes(started.sessionId))

    const tabs = await handleOwnedMethod(ctx, 'renderer', 'ListCodingBrowserTabs', ['conversation-1']) as {
      tabs: unknown[]
      activeTabId: string
    }
    assert.deepEqual(tabs.tabs, [])
    assert.equal(tabs.activeTabId, '')

    await handleOwnedMethod(ctx, 'renderer', 'StopCodingBrowser', ['conversation-1'])
    const destroy = calls.find((item) => item.method === 'browser.stop')
    assert.ok(destroy)
    assert.equal((destroy.payload as { sessionId: string }).sessionId, started.sessionId)
  } finally {
    await closeBrowserCap(home)
  }
})

test('non-loopback CDP endpoint is rejected and the host view is destroyed', async () => {
  const home = await tempHome()
  const { calls, hostCall } = recordingHost({ cdpEndpoint: 'http://10.0.0.1:9222' })
  const ctx = await stubCtx(home, hostCall)
  try {
    await assert.rejects(
      () => handleOwnedMethod(ctx, 'renderer', 'StartCodingBrowser', ['conversation-1', '']),
      /invalid private CDP/,
    )
    assert.equal(calls.some((item) => item.method === 'browser.start'), true)
    assert.equal(calls.some((item) => item.method === 'browser.stop'), true)
  } finally {
    await closeBrowserCap(home)
  }
})

test('pairing binds 127.0.0.1 and keeps the token off public JSON', async () => {
  const root = await tempHome()
  const manager = await Manager.open(root)
  try {
    const info = await manager.startBridge()
    const endpoint = new URL(info.endpoint)
    assert.equal(endpoint.hostname, '127.0.0.1')
    assert.equal(endpoint.protocol, 'http:')
    const serialized = JSON.stringify(info)
    assert.equal(serialized.includes('"token"'), false)
    const pairing = JSON.parse(Buffer.from(info.pairingCode, 'base64url').toString('utf8')) as {
      endpoint: string
      token: string
    }
    assert.equal(pairing.endpoint, info.endpoint)
    assert.equal(serialized.includes(pairing.token), false)

    const body = JSON.stringify({
      title: 'Challenge',
      url: 'https://example.test/challenge/7',
      text: 'public notes',
    })
    const unpaired = await fetch(`${info.endpoint}/ingest`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
    })
    assert.equal(unpaired.status, 401)
    const paired = await fetch(`${info.endpoint}/ingest`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${pairing.token}`,
      },
      body,
    })
    assert.equal(paired.status, 200)
    const pages = manager.sharedPages()
    assert.equal(pages.length, 1)
    assert.equal(pages[0]?.url, 'https://example.test/challenge/7')
    assert.equal(pages[0]?.scope.targets[0]?.value, 'https://example.test')
  } finally {
    await manager.close()
  }
})

test('pairing survives restart on the same loopback port', async () => {
  const root = await tempHome()
  const first = await Manager.open(root)
  const firstInfo = await first.startBridge()
  const firstPairing = JSON.parse(Buffer.from(firstInfo.pairingCode, 'base64url').toString('utf8')) as {
    endpoint: string
  }
  await first.close()
  const second = await Manager.open(root)
  try {
    const secondInfo = await second.startBridge()
    assert.equal(secondInfo.endpoint, firstInfo.endpoint)
    assert.equal(secondInfo.pairingCode, firstInfo.pairingCode)
    assert.equal(new URL(firstPairing.endpoint).hostname, '127.0.0.1')
  } finally {
    await second.close()
  }
})

test('loopback CDP and origin checks reject credentials and non-HTTP', () => {
  assert.equal(loopbackEndpointPort('http://127.0.0.1:43117'), 43117)
  assert.throws(() => loopbackEndpointPort('http://localhost:43117'))
  assert.throws(() => loopbackEndpointPort('http://10.0.0.1:43117'))
  assert.throws(() => loopbackEndpointPort('ws://127.0.0.1:43117'))
  assert.equal(originTarget('https://example.com/docs'), 'https://example.com')
  for (const value of ['ssh://host:22', 'https://user:pass@example.com', 'file:///tmp/x']) {
    assert.throws(() => originTarget(value))
  }
})

test('matchCodingTab uses id or a unique query', () => {
  const tabs = [
    { id: 'tab_a', title: 'Bilibili', url: 'https://www.bilibili.com/video/1', active: true },
    { id: 'tab_b', title: '文档', url: 'https://example.com/docs', active: false },
  ]
  assert.equal(matchCodingTab(tabs, 'tab_b', '').id, 'tab_b')
  assert.equal(matchCodingTab(tabs, '', 'bilibili').id, 'tab_a')
  assert.throws(() => matchCodingTab(tabs, '', 'https'))
  assert.throws(() => matchCodingTab(tabs, '', 'missing'))
})

test('findChrome prefers nix profile then desktop entries on linux', async () => {
  const root = await tempHome()
  const nixBin = join(root, '.nix-profile', 'bin', 'chromium')
  await mkdir(join(root, '.nix-profile', 'bin'), { recursive: true })
  await writeFile(nixBin, '#!/bin/sh\n')
  const applications = join(root, 'share', 'applications')
  await mkdir(applications, { recursive: true })
  const desktop = join(applications, 'chromium.desktop')
  const desktopExec = join(root, 'opt', 'chromium')
  await mkdir(join(root, 'opt'), { recursive: true })
  await writeFile(desktopExec, '#!/bin/sh\n')
  await writeFile(desktop, `[Desktop Entry]\nExec=${desktopExec} %U\n`)

  const nix = findChromeWith('linux', { HOME: root }, () => undefined, (path) => path === nixBin)
  assert.equal(nix, nixBin)

  const fromDesktop = findChromeWith(
    'linux',
    { HOME: join(root, 'empty-home'), XDG_DATA_DIRS: join(root, 'share') },
    () => undefined,
    (path) => path === desktop || path === desktopExec,
  )
  assert.equal(fromDesktop, desktopExec)
})

test('linux chrome candidates require HOME and PATH comes after profile paths', () => {
  assert.deepEqual(chromeFixedCandidates('linux', {}), [])
  const got = chromeFixedCandidates('linux', { HOME: '/home/milksu' })
  assert.ok(got.includes('/usr/bin/chromium'))
  assert.ok(got.includes('/home/milksu/.nix-profile/bin/chromium'))
  const fromPath = findChromeWith(
    'linux',
    { HOME: '/home/empty-home-missing' },
    (name) => (name === 'chromium' ? '/opt/chromium/bin/chromium' : undefined),
    () => false,
  )
  assert.equal(fromPath, '/opt/chromium/bin/chromium')
  assert.equal(
    desktopExecPath('[Desktop Entry]\nName=Chromium\nExec=/usr/bin/chromium --password-store=basic %U\n'),
    '/usr/bin/chromium',
  )
})

test('Browser Use runtime names Chromium and asks to install when missing', () => {
  const found = browserUseRuntimeStatus('linux', () => '/usr/bin/chromium')
  assert.equal(found.found, true)
  assert.equal(found.name, 'Chromium')
  const missing = browserUseRuntimeStatus('linux', () => {
    throw new Error('missing')
  })
  assert.equal(missing.found, false)
  assert.match(String(missing.nextStep), /Chromium/)
})
