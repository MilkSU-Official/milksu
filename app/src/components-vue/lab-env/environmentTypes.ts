export type EnvironmentProvider = 'docker' | 'avd' | 'user-attached' | 'none'

/** Right-hand live target pane. Not hardcoded to a browser. */
export type TargetSurfaceKind = 'browser' | 'shell' | 'emulator' | 'device'

export type EnvironmentLeaseState =
  | 'none'
  | 'docker-down'
  | 'stopped'
  | 'pulling'
  | 'ready'
  | 'busy'
  | 'failed'

export type EnvironmentLease = {
  provider: EnvironmentProvider
  state: EnvironmentLeaseState
  packageName?: string
  address?: string
  detail?: string
  occupyJobTitle?: string
}
