import { registerOwnedHandlers } from '../domains.ts'
import type { HandlerContext } from '../handlers.ts'
import {
  ANDROID_STUDIO_INSTALL_URL,
  EnvBrokerService,
  bindEnvBroker as bindCachedEnvBroker,
  catalog,
  envBrokerFor,
  openAndroidStudio,
  openDockerDesktop,
  packageForCVE,
  probeAndroidTooling,
  publicPackage,
  type LabEnvironmentProbe,
  type Lease,
  type Owner,
  type OwnerRequest,
} from '../envbroker/index.ts'

export function bindEnvBroker(home: string, service: EnvBrokerService): void {
  bindCachedEnvBroker(home, service)
}

function arg<T>(args: unknown[] | undefined, index: number, fallback: T): T {
  if (!args || index >= args.length || args[index] === undefined || args[index] === null) {
    return fallback
  }
  return args[index] as T
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function ownerRequest(value: unknown): OwnerRequest {
  const input = asObject(value)
  return {
    ownerKind: String(input.ownerKind ?? '').trim(),
    ownerId: String(input.ownerId ?? '').trim(),
    packageId: String(input.packageId ?? '').trim() || undefined,
  }
}

function ownerOf(request: OwnerRequest): Owner {
  return { kind: request.ownerKind, id: request.ownerId }
}

async function hostCall(ctx: HandlerContext, method: string, payload: unknown): Promise<unknown> {
  if (!ctx.hostCall) throw new Error('desktop runtime is not ready')
  return ctx.hostCall(method, payload)
}

function applyAndroidTooling(ctx: HandlerContext, service: EnvBrokerService): void {
  const lab = ctx.settings?.get().lab
  service.setAndroidTooling({
    sdkRoot: String(lab?.android_sdk ?? '').trim(),
    javaHome: String(lab?.java_home ?? '').trim(),
    autoCreateAVD: lab?.auto_create_avd !== false,
  })
}

async function envBroker(ctx: HandlerContext): Promise<EnvBrokerService> {
  const service = await envBrokerFor(ctx.home)
  applyAndroidTooling(ctx, service)
  return service
}

async function decorateLease(ctx: HandlerContext, lease: Lease): Promise<Lease> {
  const occupy = String(lease.occupyOwner ?? '').trim()
  if (!occupy) return lease
  const cut = occupy.indexOf(':')
  if (cut <= 0) return lease
  const kind = occupy.slice(0, cut)
  const id = occupy.slice(cut + 1)
  let occupyTitle = String(lease.occupyTitle ?? '').trim()
  if (kind === 'lab') {
    try {
      const job = await ctx.labJobs.get(id)
      if (job.title.trim()) occupyTitle = job.title.trim()
    } catch {
      // keep existing title
    }
  } else if (kind === 'cve') {
    occupyTitle = id
  }
  if (!occupyTitle) occupyTitle = occupy
  return { ...lease, occupyTitle }
}

function labProbe(value: unknown): LabEnvironmentProbe {
  const input = asObject(value)
  const auto = input.autoCreateAvd
  return {
    androidSdk: String(input.androidSdk ?? '').trim(),
    javaHome: String(input.javaHome ?? '').trim(),
    autoCreateAvd: auto === undefined || auto === null ? undefined : Boolean(auto),
  }
}

registerOwnedHandlers({
  ListLabPackages: async () => catalog().map((item) => publicPackage(item)),
  async ListEnvLeases(ctx) {
    const leases = await (await envBroker(ctx)).list()
    return Promise.all(leases.map((lease) => decorateLease(ctx, lease)))
  },
  async GetEnvLease(ctx, args) {
    const request = ownerRequest(arg(args, 0, {}))
    const service = await envBroker(ctx)
    return decorateLease(ctx, await service.status(ownerOf(request)))
  },
  GetEnvPackageForCVE(_ctx, args) {
    const item = packageForCVE(arg(args, 0, ''))
    if (item) return { found: true, package: publicPackage(item) }
    return {
      found: false,
      package: publicPackage({
        id: '',
        name: '',
        kindLabel: '',
        detail: '',
        provider: '',
        surface: '',
        address: '',
      }),
    }
  },
  async StartEnvLease(ctx, args) {
    const request = ownerRequest(arg(args, 0, {}))
    const service = await envBroker(ctx)
    return decorateLease(ctx, await service.start(ownerOf(request), request.packageId ?? ''))
  },
  async StopEnvLease(ctx, args) {
    const request = ownerRequest(arg(args, 0, {}))
    const service = await envBroker(ctx)
    return decorateLease(ctx, await service.stop(ownerOf(request)))
  },
  async ResetEnvLease(ctx, args) {
    const request = ownerRequest(arg(args, 0, {}))
    const service = await envBroker(ctx)
    return decorateLease(ctx, await service.reset(ownerOf(request)))
  },
  async ProbeEnvLease(ctx, args) {
    const request = ownerRequest(arg(args, 0, {}))
    return (await envBroker(ctx)).probe(ownerOf(request))
  },
  GetLabEnvironmentStatus(ctx, args) {
    const probe = labProbe(arg(args, 0, {}))
    let sdkRoot = probe.androidSdk ?? ''
    let javaHome = probe.javaHome ?? ''
    let autoCreate = probe.autoCreateAvd ?? true
    if (!sdkRoot && !javaHome) {
      const lab = ctx.settings?.get().lab
      if (lab) {
        if (!sdkRoot) sdkRoot = String(lab.android_sdk ?? '').trim()
        if (!javaHome) javaHome = String(lab.java_home ?? '').trim()
        if (lab.auto_create_avd != null) autoCreate = lab.auto_create_avd !== false
      }
    }
    return probeAndroidTooling({ sdkRoot, javaHome, autoCreateAVD: autoCreate })
  },
  async ChooseLabPath(ctx, args) {
    const kind = String(arg(args, 0, '')).trim()
    const title = kind === 'java' ? '选择 JDK 目录' : '选择 Android SDK 目录'
    const path = await hostCall(ctx, 'dialog.openDirectory', { title })
    return typeof path === 'string' ? path : ''
  },
  async OpenDockerDesktop() {
    await openDockerDesktop()
    return null
  },
  async OpenAndroidStudioSetup(ctx) {
    const result = await openAndroidStudio()
    if (result === 'spawned') return null
    await hostCall(ctx, 'shell.openExternal', { url: ANDROID_STUDIO_INSTALL_URL })
    return null
  },
})
