import { t } from '@/lib/uiLocale'
import type { UpdateStatus } from '@/types'

export function updateStatusMessage(status: UpdateStatus | null | undefined): string {
  switch (status?.code) {
    case 'not_installed_app':
      return t('请先把 MilkSU 安装到应用程序文件夹，再安装这次更新', 'Install MilkSU to the Applications folder first, then install this update.')
    case 'install_failed':
      return t('更新安装失败，请稍后重试', 'Update install failed. Try again later.')
    case 'download_failed':
      return t('更新下载失败，请稍后重试', 'Update download failed. Try again later.')
    default:
      return status?.message || ''
  }
}
