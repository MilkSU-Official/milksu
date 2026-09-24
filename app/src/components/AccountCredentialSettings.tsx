import { useState } from 'react'
import { invokeCommand } from '@/desktop'
import { useT } from '@/hooks/useUiLocale'
import { accountPasswordMessage, accountPasswordProblem, accountUsernameProblem } from '@/lib/accountPassword'
import type { AccountStatus } from '@/types'
import { Button, Input, Label } from '@/components/ui'
import { SettingsRow } from '@/components/ui/settings'

export function AccountCredentialSettings({
  account,
  onChanged,
}: {
  account: AccountStatus
  onChanged: (status: AccountStatus) => void
}) {
  const t = useT()
  const [username, setUsername] = useState(account.user?.username || '')
  const [password, setPassword] = useState('')
  const [currentPassword, setCurrentPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')
  if (account.state !== 'active') return null

  async function savePassword() {
    setError('')
    setSaved('')
    if (accountUsernameProblem(username)) {
      setError(t('用户名需要 3 到 32 位字母、数字、下划线或连字符。', 'Usernames are 3–32 letters, numbers, underscores, or hyphens.'))
      return
    }
    if (accountPasswordProblem(password)) {
      setError(t('密码至少 10 位。', 'Use at least 10 characters.'))
      return
    }
    setBusy(true)
    try {
      const next = await invokeCommand<AccountStatus>('set_account_password', {
        username: username.trim(),
        password,
      })
      setPassword('')
      setSaved(t('用户名和密码已经设置。', 'Username and password are set.'))
      onChanged(next)
    } catch (reason) {
      setError(accountPasswordMessage(reason, t))
    } finally {
      setBusy(false)
    }
  }

  async function changePassword() {
    setError('')
    setSaved('')
    if (accountPasswordProblem(nextPassword)) {
      setError(t('新密码至少 10 位。', 'Use at least 10 characters for the new password.'))
      return
    }
    setBusy(true)
    try {
      const next = await invokeCommand<AccountStatus>('change_account_password', {
        currentPassword,
        newPassword: nextPassword,
      })
      setCurrentPassword('')
      setNextPassword('')
      setSaved(t('密码已更新。', 'Password updated.'))
      onChanged(next)
    } catch (reason) {
      setError(accountPasswordMessage(reason, t))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <SettingsRow
        label={t('用户名', 'Username')}
        description={account.hasPassword
          ? (account.user?.username || '')
          : t('设置后可以用它登录，不必每次打开浏览器。', 'After this is set, sign-in does not need the browser.')}
        align="start"
        stack="always"
      >
        {account.hasPassword ? null : (
          <div className="grid w-full max-w-sm gap-2">
            <Label htmlFor="settings-account-username" className="sr-only">{t('用户名', 'Username')}</Label>
            <Input id="settings-account-username" className="h-7" autoComplete="username" value={username} onChange={event => setUsername(event.target.value)} />
            <Label htmlFor="settings-account-password" className="sr-only">{t('密码', 'Password')}</Label>
            <Input id="settings-account-password" className="h-7" type="password" autoComplete="new-password" placeholder={t('密码', 'Password')} value={password} onChange={event => setPassword(event.target.value)} />
            <Button type="button" size="sm" className="w-fit" disabled={busy} onClick={() => void savePassword()}>
              {t('设置', 'Set')}
            </Button>
          </div>
        )}
      </SettingsRow>
      {account.hasPassword ? (
        <SettingsRow
          label={t('密码', 'Password')}
          description={t('修改密码需要当前密码。', 'Changing the password requires the current one.')}
          align="start"
          stack="always"
        >
          <div className="grid w-full max-w-sm gap-2">
            <Input className="h-7" type="password" autoComplete="current-password" placeholder={t('当前密码', 'Current password')} value={currentPassword} onChange={event => setCurrentPassword(event.target.value)} />
            <Input className="h-7" type="password" autoComplete="new-password" placeholder={t('新密码', 'New password')} value={nextPassword} onChange={event => setNextPassword(event.target.value)} />
            <Button type="button" size="sm" className="w-fit" disabled={busy} onClick={() => void changePassword()}>
              {t('更新密码', 'Update password')}
            </Button>
          </div>
        </SettingsRow>
      ) : null}
      {error ? <p className="px-4 pb-3 text-[13px] text-destructive">{error}</p> : null}
      {saved ? <p className="px-4 pb-3 text-[13px] text-muted-foreground">{saved}</p> : null}
    </>
  )
}
