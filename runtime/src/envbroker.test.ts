import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { chmod, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import test from 'node:test'
import { ConversationStore } from './conversations.ts'
import './domains/envbroker.ts'
import { bindEnvBroker } from './domains/envbroker.ts'
import type { Engine } from './engine.ts'
import {
  EnvBrokerService,
  androidPackageName,
  cacheAndroidAPK,
  catalog,
  composeBytes,
  handleEnvWorkspaceAction,
  installAndroidLab,
  lookPath,
  packageByID,
  packageForCVE,
  publicPackage,
  resolvePackagesRoot,
  type AndroidRunner,
  type Lease,
  type Owner,
  type Package,
} from './envbroker/index.ts'
import { handleOwnedMethod, isOwnedMethod, type HandlerContext } from './handlers.ts'
import { dataDirectory } from './home.ts'
import { LabJobStore } from './lab.ts'

async function tempHome(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'milksu-envbroker-'))
}

async function waitLease(service: EnvBrokerService, owner: Owner, want: string): Promise<Lease> {
  const deadline = Date.now() + 2_000
  let lease = await service.get(owner)
  while (Date.now() < deadline) {
    lease = await service.get(owner)
    if (lease.state === want) return lease
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  assert.fail(`wanted state ${want}, got ${JSON.stringify(lease)}`)
}

async function withFakeDocker<T>(down: boolean, run: (home: string) => Promise<T>): Promise<T> {
  const home = await tempHome()
  const bin = join(home, 'bin')
  await mkdir(bin, { recursive: true, mode: 0o755 })
  const state = join(home, 'docker-state')
  const body = `const fs = require('node:fs')
const args = process.argv.slice(2).join(' ')
const state = process.env.FAKE_DOCKER_STATE
if (args.includes('version')) {
  if (process.env.FAKE_DOCKER_DOWN === '1') {
    process.stdout.write('Cannot connect\\n')
    process.exit(1)
  }
  process.stdout.write('29.0.0\\n')
  process.exit(0)
}
if (args.includes('up --detach')) {
  fs.writeFileSync(state, 'running\\n')
  process.stdout.write('Started\\n')
  process.exit(0)
}
if (args.includes('ps --format')) {
  if (fs.existsSync(state) && fs.readFileSync(state, 'utf8').includes('running')) process.stdout.write('running\\n')
  process.exit(0)
}
if (args.includes('down')) {
  try { fs.unlinkSync(state) } catch {}
  process.stdout.write('Removed\\n')
  process.exit(0)
}
process.exit(0)
`
  const dockerJs = join(bin, 'docker.cjs')
  await writeFile(dockerJs, body, { mode: 0o755 })
  if (process.platform === 'win32') {
    const cmd = `@echo off\r\n"${process.execPath}" "${dockerJs}" %*\r\n`
    await writeFile(join(bin, 'docker.cmd'), cmd)
    await writeFile(join(bin, 'docker-compose.cmd'), cmd)
  } else {
    const script = `#!/usr/bin/env node\n${body}`
    const docker = join(bin, 'docker')
    await writeFile(docker, script, { mode: 0o755 })
    await chmod(docker, 0o755)
    const compose = join(bin, 'docker-compose')
    await writeFile(compose, script, { mode: 0o755 })
    await chmod(compose, 0o755)
  }
  const previousPath = process.env.PATH
  const previousState = process.env.FAKE_DOCKER_STATE
  const previousDown = process.env.FAKE_DOCKER_DOWN
  process.env.PATH = `${bin}${delimiter}${previousPath ?? ''}`
  process.env.FAKE_DOCKER_STATE = state
  process.env.FAKE_DOCKER_DOWN = down ? '1' : ''
  try {
    return await run(home)
  } finally {
    process.env.PATH = previousPath
    if (previousState === undefined) delete process.env.FAKE_DOCKER_STATE
    else process.env.FAKE_DOCKER_STATE = previousState
    if (previousDown === undefined) delete process.env.FAKE_DOCKER_DOWN
    else process.env.FAKE_DOCKER_DOWN = previousDown
  }
}

type FakeAndroid = AndroidRunner & {
  avds: string[]
  booted: boolean
  installed: boolean
  calls: string[]
}

function fakeAndroid(init?: Partial<FakeAndroid>): FakeAndroid {
  const runner: FakeAndroid = {
    avds: init?.avds ?? [],
    booted: init?.booted ?? false,
    installed: init?.installed ?? false,
    calls: [],
    async lookPath(name) {
      return `/sdk/${name}`
    },
    async combinedOutput(name, args) {
      const joined = `${name} ${args.join(' ')}`
      runner.calls.push(joined)
      if (joined.includes('-list-avds')) return { output: Buffer.from(runner.avds.join('\n')), exitCode: 0 }
      if (joined.includes('adb devices') || (name.endsWith('adb') && args[0] === 'devices')) {
        return {
          output: Buffer.from(runner.booted ? 'List of devices\nemulator-5554\tdevice\n' : 'List of devices\n'),
          exitCode: 0,
        }
      }
      if (joined.includes('emu avd name')) {
        const avd = runner.avds.find((name) => name.startsWith('MilkSU-Lab')) ?? 'MilkSU-Lab'
        return { output: Buffer.from(`${avd}\nOK\n`), exitCode: 0 }
      }
      if (args[0] === 'create') {
        const index = args.indexOf('--name')
        if (index >= 0 && args[index + 1]) runner.avds.push(args[index + 1])
        return { output: Buffer.from('created'), exitCode: 0 }
      }
      if (joined.includes('getprop sys.boot_completed')) {
        return { output: Buffer.from(runner.booted ? '1\n' : '0\n'), exitCode: 0 }
      }
      if (joined.includes('emu kill')) {
        runner.booted = false
        return { output: Buffer.from('OK'), exitCode: 0 }
      }
      if (joined.includes('install')) {
        runner.installed = true
        return { output: Buffer.from('Success'), exitCode: 0 }
      }
      if (joined.includes('pm path')) {
        if (runner.installed) return { output: Buffer.from('package:/data/app/b3nac.injuredandroid.apk\n'), exitCode: 0 }
        return { output: Buffer.from(''), error: new Error('missing'), exitCode: 1 }
      }
      if (joined.includes('am start')) return { output: Buffer.from('Starting'), exitCode: 0 }
      return { output: Buffer.alloc(0), exitCode: 0 }
    },
    async startDetached() {
      runner.booted = true
    },
    sdkRoots() {
      return []
    },
  }
  return runner
}

async function stubCtx(home: string, hostCall?: HandlerContext['hostCall']): Promise<HandlerContext> {
  const conversations = new ConversationStore(join(home, 'conversations'))
  await conversations.ensure()
  const labJobs = new LabJobStore(join(home, 'lab-jobs'))
  await labJobs.ensure()
  return {
    conversations,
    labJobs,
    research: { deleteConversation: async () => null } as HandlerContext['research'],
    engine: {} as Engine,
    emit: () => {},
    home,
    hostCall,
  }
}

test('catalog pins expected packages and CVE mapping', () => {
  const want = ['juice-shop', 'webgoat', 'struts2-s2-045', 'whoami', 'android-avd', 'android-lab']
  const got = Object.fromEntries(catalog().map((item) => [item.id, item]))
  for (const id of want) assert.ok(got[id], `missing ${id}`)
  assert.equal(packageByID('whoami')?.surface, 'shell')
  assert.equal(packageByID('whoami')?.kindLabel, '连通性')
  const struts = packageForCVE('CVE-2017-5638')
  assert.equal(struts?.id, 'struts2-s2-045')
  assert.equal(struts?.surface, 'browser')
  assert.equal(packageForCVE('CVE-2023-46604'), undefined)
})

test('catalog groups by category and keeps pack intros', () => {
  const want: Record<string, string> = {
    whoami: 'probe',
    'juice-shop': 'web',
    webgoat: 'web',
    'struts2-s2-045': 'cve',
    'android-avd': 'android',
    'android-lab': 'android',
  }
  for (const item of catalog()) {
    assert.equal(item.category, want[item.id])
    assert.ok(item.source && item.purpose && item.difficulty && item.brief, item.id)
  }
})

test('android-lab pins InjuredAndroid', () => {
  const item = packageByID('android-lab')
  assert.ok(item)
  assert.equal(item.apkSHA256, 'b6b8d2dbd7a428b7754e6e537ba5790c35a73253533454e0768dbf1520a7ed15')
  assert.equal(item.launcher, 'b3nac.injuredandroid/.MainActivity')
  assert.equal(item.challenges?.length, 12)
  assert.equal(item.challenges?.[0]?.id, 'flag-1')
  assert.match(item.brief ?? '', /不是 12 台设备/)
  assert.match(item.detail, /一台模拟器/)
  assert.equal(item.difficulty, '初中级')
})

test('compose files pin loopback, internal network, and digest', async () => {
  assert.match(resolvePackagesRoot(), /envbroker[/\\]packages$/)
  for (const id of ['juice-shop', 'webgoat', 'struts2-s2-045', 'whoami']) {
    const item = packageByID(id)
    assert.ok(item)
    const text = (await composeBytes(item)).toString('utf8')
    assert.match(text, /127\.0\.0\.1:/)
    assert.match(text, /internal: true/)
    assert.match(text, /@sha256:/)
    assert.ok(item.brief)
    assert.ok(item.challenges?.[0]?.id && item.challenges[0].guidance)
  }
})

test('public package omits compose and apk internals', () => {
  const item = packageByID('android-lab')!
  const published = publicPackage(item)
  assert.equal('composePath' in published, false)
  assert.equal('apkURL' in published, false)
  assert.equal('apkSHA256' in published, false)
  assert.equal('launcher' in published, false)
  assert.equal(published.id, 'android-lab')
})

test('lookPath finds docker.cmd via PATHEXT on Windows and docker on Unix', async () => {
  const home = await tempHome()
  const bin = join(home, 'bin')
  await mkdir(bin, { recursive: true, mode: 0o755 })
  const env = {
    PATH: `${bin}${delimiter}${process.env.PATH ?? ''}`,
    PATHEXT: process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD',
  }
  if (process.platform === 'win32') {
    await writeFile(join(bin, 'docker.cmd'), '@echo off\r\n')
    assert.match(String(lookPath('docker', env)).toLowerCase(), /docker\.cmd$/)
  } else {
    const docker = join(bin, 'docker')
    await writeFile(docker, '#!/bin/sh\n', { mode: 0o755 })
    await chmod(docker, 0o755)
    assert.equal(lookPath('docker', env), docker)
  }
})

test('start/stop docker lease uses fake docker executable', async () => {
  await withFakeDocker(false, async (home) => {
    const service = await EnvBrokerService.openForTest(dataDirectory(home))
    const owner: Owner = { kind: 'lab', id: 'job-1' }
    const lease = await service.start(owner, 'juice-shop')
    assert.ok(lease.state === 'pulling' || lease.state === 'ready', JSON.stringify(lease))
    const ready = await waitLease(service, owner, 'ready')
    assert.equal(ready.address, '127.0.0.1:3000')
    assert.equal(ready.surface, 'browser')
    const status = await service.status(owner)
    assert.equal(status.state, 'ready')
    const stopped = await service.stop(owner)
    assert.equal(stopped.state, 'stopped')
  })
})

test('docker down is honest', async () => {
  await withFakeDocker(true, async (home) => {
    const service = await EnvBrokerService.openForTest(dataDirectory(home))
    const lease = await service.start({ kind: 'cve', id: 'CVE-1' }, 'whoami')
    assert.equal(lease.state, 'docker-down')
  })
})

test('occupancy blocks a second docker owner', async () => {
  await withFakeDocker(false, async (home) => {
    const service = await EnvBrokerService.openForTest(dataDirectory(home))
    const owner: Owner = { kind: 'lab', id: 'a' }
    await service.start(owner, 'juice-shop')
    await waitLease(service, owner, 'ready')
    const lease = await service.start({ kind: 'cve', id: 'CVE-1' }, 'juice-shop')
    assert.equal(lease.state, 'busy')
  })
})

test('docker HTTP not ready fails the lease', async () => {
  await withFakeDocker(false, async (home) => {
    const service = await EnvBrokerService.open(dataDirectory(home), {
      waitReady: async () => {
        throw new Error('127.0.0.1:3000 未就绪: timeout')
      },
      addressReady: async () => true,
    })
    const owner: Owner = { kind: 'lab', id: 'slow' }
    await service.start(owner, 'juice-shop')
    const lease = await waitLease(service, owner, 'failed')
    assert.match(lease.error ?? '', /未就绪/)
  })
})

test('android lease uses host emulator', async () => {
  const android = fakeAndroid({ avds: ['MilkSU-Lab'] })
  const home = await tempHome()
  const service = await EnvBrokerService.openForTest(dataDirectory(home), undefined, android)
  const owner: Owner = { kind: 'lab', id: 'phone' }
  const lease = await service.start(owner, 'android-avd')
  assert.ok(lease.state === 'pulling' || lease.state === 'ready', JSON.stringify(lease))
  const ready = await waitLease(service, owner, 'ready')
  assert.equal(ready.surface, 'emulator')
  assert.equal(ready.address, 'emulator-5554')
  assert.equal(ready.device, 'MilkSU-Lab')
})

test('android lab installs APK when emulator is already up', async () => {
  const sourceDir = await tempHome()
  const source = join(sourceDir, 'InjuredAndroid.apk')
  const payload = Buffer.from('fixture-apk')
  await writeFile(source, payload, { mode: 0o600 })
  const sum = createHash('sha256').update(payload).digest('hex')
  const android = fakeAndroid({ avds: ['MilkSU-Lab'], booted: true })
  const home = await tempHome()
  const service = await EnvBrokerService.openForTest(dataDirectory(home), undefined, android)
  service.apks = {
    async fetch(_url, destination) {
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      await writeFile(destination, payload, { mode: 0o600 })
    },
  }
  const item: Package = {
    id: 'android-lab',
    name: 'InjuredAndroid',
    kindLabel: '安卓',
    detail: '一台模拟器',
    provider: 'android-avd',
    surface: 'emulator',
    address: 'emulator-5554',
    apkURL: 'https://example.invalid/InjuredAndroid.apk',
    apkSHA256: sum,
    apkName: 'InjuredAndroid.apk',
    launcher: 'b3nac.injuredandroid/.MainActivity',
  }
  const owner: Owner = { kind: 'lab', id: 'android-lab' }
  await service.store.put({
    schema: 'milksu-env-lease/v1',
    ownerKind: owner.kind,
    ownerId: owner.id,
    packageId: item.id,
    packageName: item.name,
    provider: item.provider,
    surface: item.surface,
    state: 'pulling',
    address: item.address,
    updatedAt: new Date().toISOString(),
  })
  const lease = await service.get(owner)
  await service.runAndroidStart(item, lease, new AbortController().signal)
  const got = await service.get(owner)
  assert.equal(got.state, 'ready')
  assert.equal(got.address, 'emulator-5554')
  const joined = android.calls.join('\n')
  assert.match(joined, /install/)
  assert.match(joined, /am start/)
  assert.match(got.detail ?? '', /InjuredAndroid/)
  const status = await service.status(owner)
  assert.equal(status.state, 'ready')
})

test('android lab and blank AVD share occupancy', async () => {
  const android = fakeAndroid({ avds: ['MilkSU-Lab'] })
  const home = await tempHome()
  const service = await EnvBrokerService.openForTest(dataDirectory(home), undefined, android)
  const owner: Owner = { kind: 'lab', id: 'blank' }
  await service.start(owner, 'android-avd')
  await waitLease(service, owner, 'ready')
  const lease = await service.start({ kind: 'lab', id: 'injured' }, 'android-lab')
  assert.equal(lease.state, 'busy')
})

test('android lab status requires installed APK', async () => {
  const android = fakeAndroid({ avds: ['MilkSU-Lab'], booted: true })
  const home = await tempHome()
  const service = await EnvBrokerService.openForTest(dataDirectory(home), undefined, android)
  const owner: Owner = { kind: 'lab', id: 'missing-apk' }
  await service.store.put({
    schema: 'milksu-env-lease/v1',
    ownerKind: owner.kind,
    ownerId: owner.id,
    packageId: 'android-lab',
    packageName: 'InjuredAndroid',
    provider: 'android-avd',
    surface: 'emulator',
    state: 'ready',
    address: 'emulator-5554',
    updatedAt: new Date().toISOString(),
  })
  const got = await service.status(owner)
  assert.equal(got.state, 'failed')
})

test('android refuses a host phone AVD', async () => {
  const android = fakeAndroid({ avds: ['Pixel_10_Pro'] })
  const home = await tempHome()
  const service = await EnvBrokerService.openForTest(dataDirectory(home), undefined, android)
  const owner: Owner = { kind: 'lab', id: 'phone' }
  let lease = await service.start(owner, 'android-avd')
  if (lease.state !== 'failed') lease = await waitLease(service, owner, 'failed')
  assert.match(lease.error ?? '', /MilkSU/)
})

test('android schedules a second lab device', async () => {
  const android = fakeAndroid({ avds: ['MilkSU-Lab', 'MilkSU-Lab-2'] })
  const home = await tempHome()
  const service = await EnvBrokerService.openForTest(dataDirectory(home), undefined, android)
  const first: Owner = { kind: 'lab', id: 'one' }
  await service.start(first, 'android-avd')
  await waitLease(service, first, 'ready')
  const second: Owner = { kind: 'lab', id: 'two' }
  await service.start(second, 'android-avd')
  const lease = await waitLease(service, second, 'ready')
  assert.equal(lease.device, 'MilkSU-Lab-2')
})

test('APK cache rejects a bad hash and reuses a verified file', async () => {
  const root = await tempHome()
  const source = join(root, 'source.apk')
  const payload = Buffer.from('apk-bytes')
  await writeFile(source, payload, { mode: 0o600 })
  const fetcher = {
    async fetch(_url: string, destination: string) {
      await mkdir(dirname(destination), { recursive: true, mode: 0o700 })
      await writeFile(destination, await readFile(source), { mode: 0o600 })
    },
  }
  await assert.rejects(
    () => cacheAndroidAPK(fetcher, root, {
      id: 'x',
      name: 'x',
      kindLabel: '',
      detail: '',
      provider: 'android-avd',
      surface: 'emulator',
      address: '',
      apkURL: 'https://example.invalid/app.apk',
      apkName: 'app.apk',
      apkSHA256: 'deadbeef',
    }),
    /SHA-256/,
  )
  const sum = createHash('sha256').update(payload).digest('hex')
  const item: Package = {
    id: 'x',
    name: 'x',
    kindLabel: '',
    detail: '',
    provider: 'android-avd',
    surface: 'emulator',
    address: '',
    apkURL: 'https://example.invalid/app.apk',
    apkName: 'app.apk',
    apkSHA256: sum,
  }
  const first = await cacheAndroidAPK(fetcher, root, item)
  const second = await cacheAndroidAPK({
    async fetch() {
      throw new Error('should reuse cache')
    },
  }, root, item)
  assert.equal(first, second)
})

test('install Android lab requires Success', async () => {
  const android = fakeAndroid({ avds: ['Pixel'], booted: true })
  await installAndroidLab(android, 'emulator-5554', 'app.apk', 'b3nac.injuredandroid/.MainActivity')
  assert.equal(androidPackageName('b3nac.injuredandroid/.MainActivity'), 'b3nac.injuredandroid')
})

test('owned handlers list packages, decorate occupancy, and open a directory dialog', async () => {
  await withFakeDocker(false, async (home) => {
    const service = await EnvBrokerService.openForTest(dataDirectory(home))
    bindEnvBroker(home, service)
    const ctx = await stubCtx(home, async (method, payload) => {
      assert.equal(method, 'dialog.openDirectory')
      assert.equal((payload as { title: string }).title, '选择 JDK 目录')
      return '/selected/jdk'
    })
    await ctx.labJobs.save({
      id: 'job-juice',
      title: 'OWASP Juice Shop',
      scope: 'local',
      request: '练习',
      packageId: 'juice-shop',
      createdAt: 1,
      updatedAt: 1,
    })
    assert.equal(isOwnedMethod('ListLabPackages'), true)
    const packages = await handleOwnedMethod(ctx, 'renderer', 'ListLabPackages', []) as Array<{ id: string }>
    assert.ok(packages.some((item) => item.id === 'juice-shop'))
    const cve = await handleOwnedMethod(ctx, 'renderer', 'GetEnvPackageForCVE', ['CVE-2017-5638']) as {
      found: boolean
      package: { id: string }
    }
    assert.equal(cve.found, true)
    assert.equal(cve.package.id, 'struts2-s2-045')
    const owner = { ownerKind: 'lab', ownerId: 'job-juice', packageId: 'juice-shop' }
    await handleOwnedMethod(ctx, 'renderer', 'StartEnvLease', [owner])
    await waitLease(service, { kind: 'lab', id: 'job-juice' }, 'ready')
    const busy = await handleOwnedMethod(ctx, 'renderer', 'StartEnvLease', [{
      ownerKind: 'cve',
      ownerId: 'CVE-2017-5638',
      packageId: 'juice-shop',
    }]) as { state: string; occupyTitle: string }
    assert.equal(busy.state, 'busy')
    assert.equal(busy.occupyTitle, 'OWASP Juice Shop')
    const path = await handleOwnedMethod(ctx, 'renderer', 'ChooseLabPath', ['java'])
    assert.equal(path, '/selected/jdk')
    const status = await handleOwnedMethod(ctx, 'renderer', 'GetLabEnvironmentStatus', [{
      androidSdk: '',
      javaHome: '',
      autoCreateAvd: true,
    }]) as { platform: string; installUrl: string }
    assert.ok(status.platform)
    assert.match(status.installUrl, /developer\.android\.com/)
  })
})

test('OpenAndroidStudioSetup falls back to the install URL', async () => {
  const home = await tempHome()
  const calls: Array<{ method: string; payload?: unknown }> = []
  const ctx = await stubCtx(home, async (method, payload) => {
    calls.push({ method, payload })
    return null
  })
  const { androidStudioLaunchPath } = await import('./envbroker/android.ts')
  if (androidStudioLaunchPath()) {
    return
  }
  await handleOwnedMethod(ctx, 'renderer', 'OpenAndroidStudioSetup', [])
  assert.equal(calls[0]?.method, 'shell.openExternal')
  assert.match(String((calls[0]?.payload as { url: string }).url), /developer\.android\.com\/studio/)
})

test('env workspace actions use the bound lab package', async () => {
  await withFakeDocker(true, async (home) => {
    const conversations = new ConversationStore(join(home, 'conversations'))
    await conversations.ensure()
    const labJobs = new LabJobStore(join(home, 'lab-jobs'))
    await labJobs.ensure()
    const service = await EnvBrokerService.openForTest(dataDirectory(home))
    bindEnvBroker(home, service)
    await labJobs.save({
      id: 'job-juice',
      title: 'OWASP Juice Shop',
      scope: 'local',
      request: '练习',
      packageId: 'juice-shop',
      createdAt: 1,
      updatedAt: 1,
    })
    await conversations.save({
      id: 'lab-job-job-juice',
      title: 'OWASP Juice Shop',
      createdAt: 1,
      messages: [],
      domainTaskContext: { kind: 'lab', jobId: 'job-juice' },
    })
    const host = { service, conversations, labJobs }
    const status = await handleEnvWorkspaceAction(host, 'lab-job-job-juice', 'env_status')
    assert.match(status, /"state":"none"/)
    const started = await handleEnvWorkspaceAction(host, 'lab-job-job-juice', 'env_start')
    assert.match(started, /docker-down/)
  })
})

test('env workspace actions reject a plain coding session', async () => {
  const home = await tempHome()
  const conversations = new ConversationStore(join(home, 'conversations'))
  await conversations.ensure()
  const service = await EnvBrokerService.openForTest(dataDirectory(home))
  await conversations.save({
    id: 'chat-plain',
    title: '普通',
    createdAt: 1,
    messages: [],
  })
  await assert.rejects(
    () => handleEnvWorkspaceAction({ service, conversations }, 'chat-plain', 'env_start'),
    /没有环境作业/,
  )
})
