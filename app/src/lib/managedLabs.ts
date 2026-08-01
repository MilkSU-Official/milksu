import type {
  ManagedLabDefinition,
  ManagedLabInstance,
  ManagedLabPackage,
  ManagedLabPresentation,
} from '@/ctfLabTypes'

function lifecycleFor(instance?: ManagedLabInstance): ManagedLabDefinition['lifecycle'] {
  switch (instance?.phase) {
    case 'acquiring':
    case 'starting':
    case 'resetting':
      return 'starting'
    case 'ready':
      return 'running'
    case 'stopping':
    case 'cleaning':
      return 'stopping'
    case 'failed':
    case 'orphaned':
      return 'error'
    case 'cleaned':
    case undefined:
      return 'ready'
    case 'stopped':
      return 'error'
    default:
      return 'error'
  }
}

function newestInstance(
  packageId: string,
  instances: readonly ManagedLabInstance[],
) {
  return instances
    .filter(instance => instance.packageId === packageId)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0]
}

export function buildManagedLabDefinitions(
  packages: readonly ManagedLabPackage[],
  instances: readonly ManagedLabInstance[],
): ManagedLabDefinition[] {
  return packages.map(packageValue => {
    const instance = newestInstance(packageValue.id, instances)
    return {
      id: packageValue.id,
      packageVersion: packageValue.version,
      instanceId: instance?.instanceId,
      endpoint: instance?.endpoint,
      message: instance?.message,
      challenge: packageValue.challenge,
      judgeType: packageValue.judgeType,
      launchPath: packageValue.launchPath,
      accessType: packageValue.accessType,
      name: packageValue.title,
      vendor: packageValue.title.startsWith('OWASP ') ? 'OWASP' : 'Community',
      summary: packageValue.description,
      difficulty: '入门',
      categories: packageValue.categories,
      runtime: 'Docker',
      lifecycle: lifecycleFor(instance),
      startupEstimate: '首次约 1–3 分钟',
      resettable: true,
      agentAccess: instance?.phase === 'ready' ? 'supported' : 'planned',
    }
  })
}

export function managedLabPresentation(
  lifecycle: ManagedLabDefinition['lifecycle'],
): ManagedLabPresentation {
  switch (lifecycle) {
    case 'setup-required':
      return {
        statusLabel: '尚未安装',
        statusTone: 'muted',
        actionKind: 'setup',
        actionLabel: '检查准备项',
        actionDisabled: false,
      }
    case 'ready':
      return {
        statusLabel: '可以启动',
        statusTone: 'brand',
        actionKind: 'start',
        actionLabel: '启动靶场',
        actionDisabled: false,
      }
    case 'starting':
      return {
        statusLabel: '正在启动',
        statusTone: 'warning',
        actionKind: 'wait',
        actionLabel: '正在启动',
        actionDisabled: true,
      }
    case 'running':
      return {
        statusLabel: '运行中',
        statusTone: 'brand',
        actionKind: 'train',
        actionLabel: '用 Agent 学习',
        actionDisabled: false,
      }
    case 'stopping':
      return {
        statusLabel: '正在停止',
        statusTone: 'warning',
        actionKind: 'wait',
        actionLabel: '正在停止',
        actionDisabled: true,
      }
    case 'error':
      return {
        statusLabel: '需要处理',
        statusTone: 'danger',
        actionKind: 'destroy',
        actionLabel: '清理环境',
        actionDisabled: false,
      }
    case 'planned':
      return {
        statusLabel: '随后接入',
        statusTone: 'muted',
        actionKind: 'unavailable',
        actionLabel: '暂不可用',
        actionDisabled: true,
      }
  }
}
