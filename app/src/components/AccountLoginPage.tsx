import { useState, type FormEvent } from 'react'
import { Mail } from 'lucide-react'
import { GitHubIcon } from '@/components/GitHubIcon'
import { Alert, AlertDescription, Button, Input, Label } from '@/components/ui'
import { useT } from '@/hooks/useUiLocale'
import { accountPasswordProblem, accountUsernameProblem } from '@/lib/accountPassword'
import type { AccountStatus } from '@/types'

function BrandMark() {
  return (
    <div className="flex items-center gap-2 text-foreground">
      <svg viewBox="0 0 24 24" className="size-7" fill="currentColor" aria-hidden="true">
        <path d="M3.1 20V4h3.7l5.2 9.35L17.2 4h3.7v16h-3.15V8.85L13.7 16.6h-3.4L6.25 8.85V20H3.1Z" />
      </svg>
      <span className="text-base font-semibold tracking-tight">MilkSU</span>
    </div>
  )
}

export default function AccountLoginPage({
  status,
  busy,
  error,
  onLogin,
  onPasswordLogin,
  onChangePassword,
  onContinueLocal,
}: {
  status: AccountStatus
  busy: boolean
  error?: string
  onLogin?: () => void
  onPasswordLogin?: (username: string, password: string) => void
  onChangePassword?: (currentPassword: string, newPassword: string) => void
  onContinueLocal?: () => void
}) {
  const t = useT()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [nextPassword, setNextPassword] = useState('')
  const [localError, setLocalError] = useState('')
  const changing = status.mustChangePassword === true && status.state === 'active'
  const shownError = error || localError

  function submitPassword(event: FormEvent) {
    event.preventDefault()
    setLocalError('')
    if (accountUsernameProblem(username)) {
      setLocalError(t('用户名需要 3 到 32 位字母、数字、下划线或连字符。', 'Usernames are 3–32 letters, numbers, underscores, or hyphens.'))
      return
    }
    if (accountPasswordProblem(password)) {
      setLocalError(t('密码至少 10 位。', 'Use at least 10 characters.'))
      return
    }
    onPasswordLogin?.(username.trim(), password)
  }

  function submitChange(event: FormEvent) {
    event.preventDefault()
    setLocalError('')
    if (accountPasswordProblem(nextPassword)) {
      setLocalError(t('新密码至少 10 位。', 'Use at least 10 characters for the new password.'))
      return
    }
    if (nextPassword === password) {
      setLocalError(t('新密码需要和当前密码不同。', 'Choose a password that is different from the current one.'))
      return
    }
    onChangePassword?.(password, nextPassword)
  }

  return (
    <main className="flex min-h-screen min-w-0 justify-center bg-background text-foreground" aria-label={t('登录 MilkSU', 'Sign in to MilkSU')}>
      <section className="flex min-w-0 w-full max-w-[440px] flex-col px-8 py-10 md:px-0 md:py-16">
        <header className="flex items-center">
          <BrandMark />
        </header>

        <div className="my-auto w-full py-12">
          <p className="text-sm text-muted-foreground">{t('内测访问', 'Private beta')}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            {changing ? t('设置新密码', 'Set a new password') : t('登录', 'Sign in')}
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            {changing
              ? t('这是临时密码。改完之后才会进入 MilkSU。', 'This password is temporary. MilkSU opens after you replace it.')
              : t('使用用户名和密码，或受邀的 GitHub 账号。', 'Use a username and password, or an invited GitHub account.')}
          </p>
          {shownError ? (
            <Alert variant="destructive" className="mt-5">
              <AlertDescription>{shownError}</AlertDescription>
            </Alert>
          ) : null}

          {changing ? (
            <form className="mt-8 space-y-4" onSubmit={submitChange}>
              <div className="space-y-2">
                <Label htmlFor="account-current-password">{t('当前密码', 'Current password')}</Label>
                <Input id="account-current-password" className="h-11" type="password" autoComplete="current-password" value={password} onChange={event => setPassword(event.target.value)} />
              </div>
              <div className="space-y-2">
                <Label htmlFor="account-new-password">{t('新密码', 'New password')}</Label>
                <Input id="account-new-password" className="h-11" type="password" autoComplete="new-password" value={nextPassword} onChange={event => setNextPassword(event.target.value)} />
              </div>
              <Button type="submit" size="lg" className="h-11 w-full" disabled={busy}>
                {t('继续', 'Continue')}
              </Button>
            </form>
          ) : (
            <>
              <form className="mt-8 space-y-4" onSubmit={submitPassword}>
                <div className="space-y-2">
                  <Label htmlFor="account-username">{t('用户名', 'Username')}</Label>
                  <Input
                    id="account-username"
                    className="h-11"
                    autoComplete="username"
                    autoCapitalize="none"
                    spellCheck={false}
                    value={username}
                    onChange={event => setUsername(event.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="account-password">{t('密码', 'Password')}</Label>
                  <Input
                    id="account-password"
                    className="h-11"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={event => setPassword(event.target.value)}
                  />
                </div>
                <Button type="submit" size="lg" className="h-11 w-full" disabled={busy || status.state === 'authorizing'}>
                  {busy ? t('正在登录', 'Signing in') : t('登录', 'Sign in')}
                </Button>
              </form>

              <div className="my-6 flex items-center gap-3 text-xs text-muted-foreground">
                <span className="h-px flex-1 bg-border" />
                {t('或', 'or')}
                <span className="h-px flex-1 bg-border" />
              </div>

              <Button
                type="button"
                variant="outline"
                size="lg"
                className="h-11 w-full"
                disabled={busy || status.state === 'authorizing'}
                onClick={onLogin}
              >
                <GitHubIcon className="size-4" />
                {status.state === 'authorizing'
                  ? t('等待 GitHub 授权', 'Waiting for GitHub authorization')
                  : t('使用 GitHub 登录', 'Sign in with GitHub')}
              </Button>
            </>
          )}

          {changing ? null : (
            <div className="mt-10 border-t border-border pt-6">
              <Button variant="ghost" className="h-9 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground" onClick={onContinueLocal}>
                {t('暂不登录，使用自己的 API Key', 'Skip sign-in and use your own API key')}
              </Button>
              <a href="mailto:milksu@proton.me" className="mt-4 flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
                <Mail className="size-4" />{t('尚未收到邀请？联系 milksu@proton.me', 'No invitation yet? Contact milksu@proton.me')}
              </a>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
