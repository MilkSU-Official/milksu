import { mkdir, readFile, rename, unlink, writeFile, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { emptyLease, ownerKey, type Lease, type Owner, type Package } from './types.ts'

class Mutex {
  private chain: Promise<void> = Promise.resolve()

  run<T>(fn: () => Promise<T>): Promise<T> {
    const previous = this.chain
    let release!: () => void
    this.chain = new Promise((resolve) => {
      release = resolve
    })
    return previous.then(fn).finally(() => release())
  }
}

export function leaseHoldsResource(lease: Lease): boolean {
  return lease.state === 'ready' || lease.state === 'pulling' || lease.state === 'failed'
}

export class LeaseStore {
  readonly path: string
  private leases = new Map<string, Lease>()
  private readonly mutex = new Mutex()

  constructor(dataDirectory: string) {
    this.path = join(dataDirectory, 'services', 'envbroker', 'leases.json')
  }

  static async open(dataDirectory: string): Promise<LeaseStore> {
    const store = new LeaseStore(dataDirectory)
    await mkdir(join(dataDirectory, 'services', 'envbroker'), { recursive: true, mode: 0o700 })
    await store.load()
    return store
  }

  async get(owner: Owner): Promise<Lease> {
    return this.mutex.run(async () => this.leases.get(ownerKey(owner)) ?? emptyLease(owner))
  }

  async put(lease: Lease): Promise<Lease> {
    return this.mutex.run(async () => {
      const next = { ...lease, updatedAt: new Date().toISOString() }
      this.leases.set(ownerKey({ kind: next.ownerKind, id: next.ownerId }), next)
      await this.persistLocked()
      return next
    })
  }

  async all(): Promise<Lease[]> {
    return this.mutex.run(async () => [...this.leases.values()])
  }

  async occupant(item: Package, except: Owner): Promise<Lease | undefined> {
    return this.mutex.run(async () => {
      for (const [key, lease] of this.leases) {
        if (key === ownerKey(except) || !leaseHoldsResource(lease)) continue
        if (item.provider === 'docker') {
          if (item.id && lease.packageId === item.id) return lease
          if (item.address && lease.address === item.address) return lease
          continue
        }
        if (item.provider === 'android-avd' && lease.provider === 'android-avd') continue
      }
      return undefined
    })
  }

  async heldAndroid(except: Owner): Promise<{
    devices: Set<string>
    serials: Set<string>
    holder?: Lease
  }> {
    return this.mutex.run(async () => {
      const devices = new Set<string>()
      const serials = new Set<string>()
      let holder: Lease | undefined
      for (const [key, lease] of this.leases) {
        if (key === ownerKey(except) || lease.provider !== 'android-avd' || !leaseHoldsResource(lease)) continue
        if (lease.device) devices.add(lease.device)
        if (lease.address) serials.add(lease.address)
        if (!holder) holder = lease
      }
      return { devices, serials, holder }
    })
  }

  private async load(): Promise<void> {
    let raw: string
    try {
      raw = await readFile(this.path, 'utf8')
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
      throw error
    }
    const parsed = JSON.parse(raw) as Record<string, Lease>
    this.leases = new Map(Object.entries(parsed ?? {}))
  }

  private async persistLocked(): Promise<void> {
    const payload = `${JSON.stringify(Object.fromEntries(this.leases), null, 2)}\n`
    const tmp = `${this.path}.tmp`
    await writeFile(tmp, payload, { mode: 0o600 })
    try {
      await chmod(tmp, 0o600)
    } catch {
      // Windows file mode is best-effort.
    }
    try {
      await rename(tmp, this.path)
    } catch {
      try {
        await unlink(this.path)
      } catch {
        // replace
      }
      await rename(tmp, this.path)
    }
  }
}
