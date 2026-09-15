import { Globe2, Mail, ShieldCheck } from 'lucide-react'
import { GitHubIcon } from '@/components/GitHubIcon'
import { Alert, AlertDescription, Button } from '@/components/ui'
import brandLockup from '@/assets/milksu-brand-lockup.png'
import { useT } from '@/hooks/useUiLocale'
import type { AccountStatus } from '@/types'

export default function AccountLoginPage({
  status,
  busy,
  error,
  onLogin,
  onContinueLocal,
}: {
  status: AccountStatus
  busy: boolean
  error?: string
  onLogin?: () => void
  onContinueLocal?: () => void
}) {
  const t = useT()
  const stateMessage = status.state === 'authorizing'
    ? t('浏览器授权完成后会自动回到 MilkSU。', 'After you finish in the browser, you will return to MilkSU automatically.')
    : status.state === 'invitation_required'
      ? t('这个 GitHub 账号尚未获得内测邀请。', 'This GitHub account does not have a beta invitation yet.')
      : status.state === 'suspended'
        ? t('这个内测账号当前已暂停访问。', 'This beta account is currently suspended.')
        : status.state === 'unavailable'
          ? t('账户服务暂时不可用，你仍可使用自己的 API Key。', 'Account service is temporarily unavailable. You can still use your own API key.')
          : t('使用受邀的 GitHub 账号继续', 'Continue with an invited GitHub account')
  const loginLabel = status.state === 'authorizing'
    ? t('等待 GitHub 授权', 'Waiting for GitHub authorization')
    : t('使用 GitHub 登录', 'Sign in with GitHub')

  return (
    <main className="flex min-h-screen min-w-0 bg-background text-foreground" aria-label={t('登录 MilkSU', 'Sign in to MilkSU')}>
      <section className="flex min-w-0 flex-1 flex-col px-10 py-9 md:px-20 md:py-16">
        <header className="flex items-center gap-3">
          <img src={brandLockup} alt="MilkSU" className="h-[2.6rem] w-auto object-contain" />
        </header>

        <div className="my-auto w-full max-w-[540px] py-14">
          <p className="text-sm text-muted-foreground">{t('内测访问', 'Private beta')}</p>
          <h1 className="mt-3 text-4xl font-semibold tracking-tight">
            {t('登录', 'Sign in')} MilkSU
          </h1>
          <p className="mt-5 text-lg leading-7 text-muted-foreground">{stateMessage}</p>
          {error ? (
            <Alert variant="destructive" className="mt-4">
              <AlertDescription>
                <p className="font-medium text-destructive">{t('登录没有完成', 'Sign-in did not complete')}</p>
                <p className="mt-1">{error}</p>
              </AlertDescription>
            </Alert>
          ) : null}

          <Button
            size="lg"
            className="mt-10 h-12 w-full text-base"
            disabled={busy || status.state === 'authorizing'}
            onClick={onLogin}
          >
            <GitHubIcon className="size-5" />
            {loginLabel}
          </Button>

          <div className="mt-9 space-y-4 text-sm text-muted-foreground">
            <p className="flex items-center gap-3"><Globe2 className="size-4" />{t('将在系统浏览器中完成登录', 'Sign-in continues in your system browser')}</p>
            <p className="flex items-center gap-3"><ShieldCheck className="size-4" />{t('MilkSU 不保存你的 GitHub 密码', 'MilkSU does not store your GitHub password')}</p>
          </div>

          <div className="mt-10 border-t border-border pt-8">
            <Button variant="ghost" className="px-0 text-muted-foreground hover:bg-transparent hover:text-foreground" onClick={onContinueLocal}>
              {t('暂不登录，使用自己的 API Key', 'Skip sign-in and use your own API key')}
            </Button>
            <a href="mailto:milksu@proton.me" className="mt-5 flex w-fit items-center gap-2 text-sm text-muted-foreground hover:text-foreground">
              <Mail className="size-4" />{t('尚未收到邀请？联系 milksu@proton.me', 'No invitation yet? Contact milksu@proton.me')}
            </a>
          </div>
        </div>
      </section>

      <aside className="relative hidden w-[42%] shrink-0 overflow-hidden border-l border-border bg-card xl:block" aria-hidden="true" />
    </main>
  )
}
