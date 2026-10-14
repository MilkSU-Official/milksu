import { dataDirectory } from '../home.ts'
import { EnvBrokerService } from './service.ts'

const brokers = new Map<string, EnvBrokerService>()

export function bindEnvBroker(home: string, service: EnvBrokerService): void {
  brokers.set(home, service)
}

export async function envBrokerFor(home: string): Promise<EnvBrokerService> {
  const existing = brokers.get(home)
  if (existing) return existing
  const service = await EnvBrokerService.open(dataDirectory(home))
  brokers.set(home, service)
  return service
}

export { catalog, packageByID, packageForCVE, composeBytes } from './catalog.ts'
export { resolvePackagesRoot, composeFilePath } from './packages.ts'
export { LeaseStore, leaseHoldsResource } from './store.ts'
export { EnvBrokerService, occupyTitleOf, type EnvBrokerOptions } from './service.ts'
export {
  ENV_WORKSPACE_ACTIONS,
  handleEnvWorkspaceAction,
  isEnvWorkspaceAction,
} from './workspace.ts'
export {
  probeAndroidTooling,
  androidStudioLaunchPath,
  androidStudioPresent,
  androidSDKCandidates,
  createExecAndroidRunner,
  detectLabSystemImage,
  errAndroidBusy,
  openAndroidStudio,
  type AndroidRunner,
} from './android.ts'
export { cacheAndroidAPK, installAndroidLab, androidPackageName, httpAPKFetcher, type ApkFetcher } from './apk.ts'
export {
  dockerAvailable,
  lookPath,
  startDetached,
  execComposeRunner,
  materializeCompose,
  instanceDirectory,
  projectName,
  openDockerDesktop,
  type ComposeRunner,
} from './docker.ts'
export {
  LEASE_SCHEMA,
  ANDROID_STUDIO_INSTALL_URL,
  LAB_AVD_PREFIX,
  emptyLease,
  publicPackage,
  ownerKey,
  type Owner,
  type Package,
  type PublicPackage,
  type Lease,
  type OwnerRequest,
  type LabEnvironmentProbe,
  type AndroidTooling,
  type AndroidToolingStatus,
  type EnvCVEPackage,
  type Challenge,
} from './types.ts'
