import { useState } from 'react'
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  SettingsRow,
  SettingsSection,
} from '@/components/ui'
import { useT } from '@/hooks/useUiLocale'
import { desktopCloudAgentClient } from '@/lib/cloud/cloudAgentClient'
import { toast, toastError } from '@/lib/appToast'

/**
 * Cloud BYOK: keys go through Desktop CloudAgentInvoke → Cloud API encrypt-at-rest.
 * Plaintext never stays in renderer after submit (input cleared on success).
 */
export default function CloudCredentialSettings() {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [label, setLabel] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)

  async function save() {
    const key = apiKey.trim()
    if (!key) {
      toastError(t('请填写 API Key', 'API key is required'))
      return
    }
    setBusy(true)
    try {
      const client = desktopCloudAgentClient()
      await client.upsertCredential({
        label: label.trim() || t('云端自带', 'Cloud own key'),
        baseUrl: baseUrl.trim(),
        apiKey: key,
      })
      setApiKey('')
      setOpen(false)
      toast(t('已保存到云端（仅服务端持有）', 'Saved to cloud (server-held only)'))
    } catch (error) {
      toastError(
        error instanceof Error ? error.message : t('保存云端凭据失败', 'Failed to save cloud credential'),
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsSection title={t('云端自带 Key', 'Cloud own keys')}>
        <SettingsRow
          label={t('中转 / 上游 Key', 'Relay / upstream key')}
          description={t(
            '加密存服务端，明文不下发；也可继续用账户代持',
            'Encrypted on the server; plaintext never returned. Account-held keys still work.',
          )}
          divider={false}
          trailing={(
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7"
              onClick={() => setOpen(true)}
            >
              {t('添加', 'Add')}
            </Button>
          )}
        />
      </SettingsSection>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('添加云端 Key', 'Add cloud key')}</DialogTitle>
            <DialogDescription>
              {t(
                '只会发到云 API 加密保存，本地不落明文文件。',
                'Sent to the cloud API for encrypted storage; no plaintext file on disk.',
              )}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 py-2">
            <label className="grid gap-1 text-label">
              <span>{t('名称', 'Label')}</span>
              <Input
                value={label}
                onChange={event => setLabel(event.target.value)}
                className="h-7"
              />
            </label>
            <label className="grid gap-1 text-label">
              <span>{t('Base URL', 'Base URL')}</span>
              <Input
                value={baseUrl}
                onChange={event => setBaseUrl(event.target.value)}
                placeholder="https://…"
                className="h-7"
              />
            </label>
            <label className="grid gap-1 text-label">
              <span>API Key</span>
              <Input
                type="password"
                value={apiKey}
                onChange={event => setApiKey(event.target.value)}
                autoComplete="off"
                className="h-7"
              />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              {t('取消', 'Cancel')}
            </Button>
            <Button type="button" size="sm" disabled={busy} onClick={() => void save()}>
              {t('保存', 'Save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
