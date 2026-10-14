import { catalog, packageByID, packageForCVE } from './catalog.ts'
import {
  allocateAndroidDevice,
  androidStatus,
  androidStatusRequiresPackage,
  createExecAndroidRunner,
  ensureLabAVD,
  errAndroidBusy,
  labAVDs,
  labSystemImage,
  listAvds,
  stopAndroid,
  type AndroidRunner,
} from './android.ts'
import {
  androidPackageName,
  cacheAndroidAPK,
  httpAPKFetcher,
  installAndroidLab,
  type ApkFetcher,
} from './apk.ts'
import {
  composeStatus,
  dockerAvailable,
  execComposeRunner,
  httpReady,
  instanceDirectory,
  materializeCompose,
  projectName,
  startCompose,
  stopCompose,
  waitHTTPReady,
  type ComposeRunner,
} from './docker.ts'
import { LeaseStore } from './store.ts'
import {
  LEASE_SCHEMA,
  emptyLease,
  ownerKey,
  type AndroidTooling,
  type Lease,
  type Owner,
  type Package,
} from './types.ts'

export type EnvBrokerOptions = {
  compose?: ComposeRunner
  android?: AndroidRunner
  apks?: ApkFetcher
  waitReady?: ((address: string, signal?: AbortSignal) => Promise<void>) | null
  addressReady?: (address: string, signal?: AbortSignal) => Promise<boolean>
  autoCreateAVD?: boolean
  androidTooling?: AndroidTooling
}

export class EnvBrokerService {
  readonly dataDirectory: string
  readonly store: LeaseStore
  compose: ComposeRunner
  android: AndroidRunner
  apks: ApkFetcher
  waitReady: ((address: string, signal?: AbortSignal) => Promise<void>) | null
  addressReady: (address: string, signal?: AbortSignal) => Promise<boolean>
  autoCreateAVD: boolean
  androidTooling: AndroidTooling
  private replaceAndroidRunner: boolean
  private readonly inflight = new Map<string, AbortController>()

  constructor(dataDirectory: string, store: LeaseStore, options: EnvBrokerOptions = {}) {
    this.dataDirectory = dataDirectory
    this.store = store
    this.compose = options.compose ?? execComposeRunner
    this.replaceAndroidRunner = !options.android
    this.android = options.android ?? createExecAndroidRunner(
      options.androidTooling?.sdkRoot ?? '',
      options.androidTooling?.javaHome ?? '',
    )
    this.apks = options.apks ?? httpAPKFetcher
    this.waitReady = options.waitReady === undefined ? waitHTTPReady : options.waitReady
    this.addressReady = options.addressReady ?? httpReady
    this.autoCreateAVD = options.autoCreateAVD ?? options.androidTooling?.autoCreateAVD ?? true
    this.androidTooling = options.androidTooling ?? { autoCreateAVD: this.autoCreateAVD }
  }

  static async open(dataDirectory: string, options: EnvBrokerOptions = {}): Promise<EnvBrokerService> {
    const store = await LeaseStore.open(dataDirectory)
    return new EnvBrokerService(dataDirectory, store, options)
  }

  static async openForTest(
    dataDirectory: string,
    compose?: ComposeRunner,
    android?: AndroidRunner,
  ): Promise<EnvBrokerService> {
    return EnvBrokerService.open(dataDirectory, {
      compose,
      android,
      waitReady: null,
      addressReady: async () => true,
    })
  }

  setAndroidTooling(tooling: AndroidTooling): void {
    this.androidTooling = tooling
    this.autoCreateAVD = tooling.autoCreateAVD
    if (this.replaceAndroidRunner) {
      this.android = createExecAndroidRunner(tooling.sdkRoot ?? '', tooling.javaHome ?? '')
    }
  }

  catalog(): Package[] {
    return catalog()
  }

  packageForCVE(cveID: string): Package | undefined {
    return packageForCVE(cveID)
  }

  async get(owner: Owner): Promise<Lease> {
    return this.store.get(owner)
  }

  async list(): Promise<Lease[]> {
    return this.store.all()
  }

  async start(owner: Owner, packageID: string): Promise<Lease> {
    const item = packageByID(packageID)
    if (!item) {
      return this.store.put({
        ...emptyLease(owner),
        state: 'failed',
        error: '未知练习包',
      })
    }
    return this.startItem(owner, item)
  }

  async startItem(owner: Owner, item: Package): Promise<Lease> {
    const occupant = await this.store.occupant(item, owner)
    if (occupant) {
      const occupyTitle = occupyTitleOf(occupant)
      return this.store.put({
        ...emptyLease(owner),
        state: 'busy',
        packageId: item.id,
        packageName: item.name,
        provider: item.provider,
        surface: item.surface,
        address: item.address,
        occupyOwner: `${occupant.ownerKind}:${occupant.ownerId}`,
        occupyTitle,
        error: `被作业 ${occupyTitle} 占用`,
      })
    }
    let lease: Lease = {
      schema: LEASE_SCHEMA,
      ownerKind: owner.kind,
      ownerId: owner.id,
      packageId: item.id,
      packageName: item.name,
      provider: item.provider,
      surface: item.surface,
      state: 'pulling',
      address: item.address,
      detail: item.detail,
      updatedAt: new Date().toISOString(),
    }
    if (item.provider === 'docker') {
      const dockerErr = await dockerAvailable(this.compose)
      if (dockerErr) {
        return this.store.put({
          ...lease,
          state: 'docker-down',
          error: dockerErr.message,
          dockerAvailable: false,
        })
      }
      lease.dockerAvailable = true
      let directory: string
      try {
        directory = await materializeCompose(this.dataDirectory, owner, item)
      } catch (error) {
        return this.store.put({
          ...lease,
          state: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
      const status = await composeStatus(this.compose, directory, projectName(item))
      if (status.state === 'ready') {
        return this.store.put({ ...lease, state: 'ready', error: '' })
      }
      await this.store.put(lease)
      this.spawn(owner, (signal) => this.runDockerStart(item, directory, lease, signal))
      return lease
    }
    if (item.provider === 'android-avd') {
      try {
        await ensureLabAVD(this.android, this.autoCreateAVD)
      } catch (error) {
        return this.store.put({
          ...lease,
          state: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
      const held = await this.store.heldAndroid(owner)
      let names: string[]
      try {
        names = await listAvds(this.android)
      } catch (error) {
        return this.store.put({
          ...lease,
          state: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
      const hasFree = labAVDs(names).some((name) => !held.devices.has(name))
      if (!hasFree && !labSystemImage(this.android)) {
        const occupyTitle = occupyTitleOf(held.holder ?? emptyLease(owner))
        return this.store.put({
          ...lease,
          state: 'busy',
          occupyOwner: held.holder ? `${held.holder.ownerKind}:${held.holder.ownerId}` : '',
          occupyTitle,
          error: `被作业 ${occupyTitle} 占用`,
        })
      }
      await this.store.put(lease)
      this.spawn(owner, (signal) => this.runAndroidStart(item, lease, signal))
      return lease
    }
    return this.store.put({
      ...lease,
      state: 'failed',
      error: '不支持的 Provider',
    })
  }

  async status(owner: Owner, signal?: AbortSignal): Promise<Lease> {
    let lease = await this.get(owner)
    if (!lease.packageId) return lease
    const item = packageByID(lease.packageId)
    if (!item) return lease
    if (lease.state === 'pulling' || lease.state === 'busy') return lease
    if (item.provider === 'docker') {
      const dockerErr = await dockerAvailable(this.compose)
      if (dockerErr) {
        return this.store.put({
          ...lease,
          state: 'docker-down',
          error: dockerErr.message,
          dockerAvailable: false,
        })
      }
      lease = { ...lease, dockerAvailable: true }
      const directory = instanceDirectory(this.dataDirectory, owner, item.id)
      const result = await composeStatus(this.compose, directory, projectName(item), signal)
      if (result.error) lease = { ...lease, detail: result.error.message }
      if (result.state === 'ready') {
        if (item.address && !(await this.addressReady(item.address, signal))) {
          lease = { ...lease, state: 'failed', error: `${item.address} 未响应` }
        } else {
          lease = { ...lease, state: 'ready', error: '' }
        }
      } else if (result.state === 'stopped') {
        lease = { ...lease, state: 'stopped' }
      }
      return this.store.put(lease)
    }
    if (item.provider === 'android-avd') {
      const result = await androidStatus(this.android, lease.address ?? '', signal)
      if (result.error && result.state !== 'ready') {
        lease = { ...lease, error: result.error.message }
      }
      if (result.serial) lease = { ...lease, address: result.serial }
      if (result.state === 'ready' && androidPackageName(item.launcher ?? '')) {
        const installed = await androidStatusRequiresPackage(this.android, result.serial, item.launcher ?? '', signal)
        if (!installed) {
          return this.store.put({
            ...lease,
            state: 'failed',
            error: '模拟器已启动，练习 APK 未安装',
          })
        }
      }
      lease = { ...lease, state: result.state }
      if (result.state === 'ready') lease = { ...lease, error: '' }
      return this.store.put(lease)
    }
    return lease
  }

  async stop(owner: Owner, signal?: AbortSignal): Promise<Lease> {
    this.cancelInflight(owner)
    let lease = await this.get(owner)
    if (!lease.packageId) return lease
    const item = packageByID(lease.packageId)
    if (!item) {
      return this.store.put({ ...lease, state: 'stopped' })
    }
    if (item.provider === 'docker') {
      const directory = instanceDirectory(this.dataDirectory, owner, item.id)
      try {
        await stopCompose(this.compose, directory, projectName(item), signal)
      } catch (error) {
        return this.store.put({
          ...lease,
          state: 'failed',
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    if (item.provider === 'android-avd') {
      try {
        await stopAndroid(this.android, lease.address ?? '', signal)
      } catch {
        // emulator may already be gone
      }
    }
    return this.store.put({ ...lease, state: 'stopped', error: '' })
  }

  async reset(owner: Owner, signal?: AbortSignal): Promise<Lease> {
    await this.stop(owner, signal)
    const lease = await this.get(owner)
    if (!lease.packageId) return lease
    return this.start(owner, lease.packageId)
  }

  async probe(owner: Owner, signal?: AbortSignal): Promise<string> {
    const lease = await this.status(owner, signal)
    if (lease.state !== 'ready' || !lease.address) {
      throw new Error('环境未就绪')
    }
    if (lease.surface !== 'shell') return lease.address
    const target = lease.address.includes('://') ? lease.address : `http://${lease.address}`
    const response = await fetch(target, {
      signal: AbortSignal.any([signal, AbortSignal.timeout(4_000)].filter(Boolean) as AbortSignal[]),
    })
    const body = Buffer.from(await response.arrayBuffer()).subarray(0, 8 << 10).toString('utf8')
    return body.trim()
  }

  async runDockerStart(item: Package, directory: string, lease: Lease, signal: AbortSignal): Promise<void> {
    let current = { ...lease }
    try {
      await startCompose(this.compose, directory, projectName(item), async (line) => {
        const trimmed = line.trim()
        if (!trimmed) return
        current = await this.store.put({ ...current, detail: trimmed })
      }, signal)
      if (this.waitReady && item.address) {
        await this.waitReady(item.address, signal)
      }
      if (signal.aborted) return
      await this.store.put({ ...current, state: 'ready', error: '', detail: item.detail })
    } catch (error) {
      if (signal.aborted) return
      await this.store.put({
        ...current,
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  async runAndroidStart(item: Package, lease: Lease, signal: AbortSignal): Promise<void> {
    let current = { ...lease }
    const owner: Owner = { kind: lease.ownerKind, id: lease.ownerId }
    try {
      const held = await this.store.heldAndroid(owner)
      const device = await allocateAndroidDevice(this.android, held.devices, held.serials, this.autoCreateAVD, signal)
      current = await this.store.put({
        ...current,
        device: device.avd,
        address: device.serial,
        detail: `${device.avd} · ${device.serial}`,
      })
      if (item.apkURL) {
        const apkPath = await cacheAndroidAPK(this.apks, this.dataDirectory, item, signal)
        await installAndroidLab(this.android, device.serial, apkPath, item.launcher ?? '', signal)
        current = await this.store.put({
          ...current,
          detail: `已安装 ${item.name} · ${device.avd} · adb -s ${device.serial}`,
        })
      }
      if (signal.aborted) return
      await this.store.put({ ...current, state: 'ready', error: '' })
    } catch (error) {
      if (signal.aborted) return
      if (error === errAndroidBusy) {
        const held = await this.store.heldAndroid(owner)
        const occupyTitle = occupyTitleOf(held.holder ?? emptyLease(owner))
        await this.store.put({
          ...current,
          state: 'busy',
          occupyOwner: held.holder ? `${held.holder.ownerKind}:${held.holder.ownerId}` : '',
          occupyTitle,
          error: `被作业 ${occupyTitle} 占用`,
        })
        return
      }
      await this.store.put({
        ...current,
        state: 'failed',
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  private spawn(owner: Owner, run: (signal: AbortSignal) => Promise<void>): void {
    this.cancelInflight(owner)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 10 * 60_000)
    this.inflight.set(ownerKey(owner), controller)
    void run(controller.signal).finally(() => {
      clearTimeout(timer)
      if (this.inflight.get(ownerKey(owner)) === controller) {
        this.inflight.delete(ownerKey(owner))
      }
    })
  }

  private cancelInflight(owner: Owner): void {
    const controller = this.inflight.get(ownerKey(owner))
    if (!controller) return
    controller.abort()
    this.inflight.delete(ownerKey(owner))
  }
}

export function occupyTitleOf(lease: Lease): string {
  if (lease.occupyTitle?.trim()) return lease.occupyTitle.trim()
  if (lease.packageName?.trim()) return lease.packageName.trim()
  if (lease.occupyOwner?.trim()) return lease.occupyOwner.trim()
  return `${lease.ownerKind}:${lease.ownerId}`
}
