import { t } from '@/lib/uiLocale'
import type { UpdateStatus } from '@/types'

export function updateStatusMessage(status: UpdateStatus | null | undefined): string {
  switch (status?.code) {
    case 'not_installed_app':
      return t('请先把 MilkSU 安装到应用程序文件夹，再安装这次更新', 'Install MilkSU to the Applications folder first, then install this update.')
    case 'install_failed':
      return t('更新安装失败，请稍后重试', 'Update install failed. Try again later.')
    case 'install_permission':
      return t(
        '无法安装更新。请确认 MilkSU 已在应用程序文件夹且安装目录可写，再重试。',
        'Could not install the update. Move MilkSU to Applications and make sure the folder is writable, then try again.',
      )
    case 'download_failed':
      return t('更新下载失败，请稍后重试', 'Update download failed. Try again later.')
    case 'login_required':
      return t('请先登录可用的 MilkSU 账户再下载更新', 'Sign in to a MilkSU account before downloading this update.')
    case 'cancelled':
      return t('已取消更新下载', 'Update download cancelled')
    default:
      return status?.message || ''
  }
}

export function updateWorking(status: UpdateStatus | null | undefined): boolean {
  if (status?.state === 'downloading' || status?.state === 'checking') return true
  return status?.state === 'downloaded' && status.phase === 'installing'
}

export function updatePhaseBusy(status: UpdateStatus | null | undefined): boolean {
  const phase = status?.phase || (status?.state === 'downloading' ? 'downloading' : '')
  return phase === 'checking' || phase === 'downloading' || phase === 'verifying' || phase === 'preparing' || phase === 'installing'
}

export function updatePhaseMessage(status: UpdateStatus | null | undefined): string {
  if (status?.state === 'error') return updateStatusMessage(status)
  if (status?.state === 'downloaded' && status.phase !== 'installing') {
    return t(
      '已下载并校验，安装时会关闭 MilkSU，完成后自动重新打开。',
      'Downloaded and verified. Installing will quit MilkSU and reopen it when finished.',
    )
  }
  switch (status?.phase || (status?.state === 'downloading' ? 'downloading' : '')) {
    case 'checking':
      return t('正在检查安装包', 'Checking the installer')
    case 'downloading':
      return t('正在下载安装包', 'Downloading the installer')
    case 'verifying':
      return t('正在校验安装包', 'Verifying the installer')
    case 'preparing':
      return t('正在准备安装', 'Preparing the install')
    case 'installing':
      return t('正在安装，完成后将自动重新打开 MilkSU', 'Installing. MilkSU will reopen when finished.')
    default:
      return status?.message || ''
  }
}

export function updateReadyDetail(): string {
  return t('账号和设置会保留。', 'Account and settings are kept.')
}

export function formatUpdateMegabytes(bytes: number | undefined): string {
  const value = Number(bytes) || 0
  return `${(value / 1024 ** 2).toFixed(1)} MB`
}
