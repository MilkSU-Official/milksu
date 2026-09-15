import { useEffect, useRef, useState } from 'react'
import {
  Bug,
  Code2,
  Flag,
  FlaskConical,
  LogOut,
  Moon,
  Settings,
  Sun,
  SunMoon,
  UserRound,
} from 'lucide-react'
import profileAvatar from '@/assets/ctf-learner-avatar.png'
import { invokeCommand } from '@/desktop'
import type { ThemeMode } from '@/lib/themeMode'
import type { AccountStatus, BuildTracking } from '@/types'
import { WORKSPACE_RAIL_ITEMS, type AppSection, type WorkspaceSection } from '@/lib/workspaceNavigation'
import { useT } from '@/hooks/useUiLocale'

const icons = {
  ctf: Flag,
  vuln: Bug,
  lab: FlaskConical,
  chat: Code2,
} as const

export default function WorkspaceRail({
  activeSection,
  accountStatus,
  themeMode,
  collapsed,
  onNavigate,
  onProfile,
  onAccountLogin,
  onAccountLogout,
  onSettings,
  onToggleTheme,
}: {
  activeSection: AppSection
  accountStatus: AccountStatus
  themeMode: ThemeMode
  collapsed?: boolean
  onNavigate?: (value: WorkspaceSection) => void
  onProfile?: () => void
  onAccountLogin?: () => void
  onAccountLogout?: () => void
  onSettings?: () => void
  onToggleTheme?: () => void
}) {
  const t = useT()
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRoot = useRef<HTMLDivElement | null>(null)
  const [buildTracking, setBuildTracking] = useState<BuildTracking | null>(null)
  const avatarSource = accountStatus.user?.avatarUrl || profileAvatar

  const isBetaChannel = Boolean(
    !buildTracking?.development
    && !buildTracking?.missing
    && String(buildTracking?.channel ?? '').toLowerCase() === 'beta'
    && String(buildTracking?.appId ?? '') === 'com.milksu.app.beta',
  )
  const themeToggleLabel = themeMode === 'system'
    ? t('当前跟随系统，切换到日间模式', 'Following system. Switch to light mode')
    : themeMode === 'light'
      ? t('当前日间模式，切换到夜间模式', 'Light mode. Switch to dark mode')
      : t('当前夜间模式，切换到跟随系统', 'Dark mode. Switch to follow system')
  const ThemeToggleIcon = themeMode === 'system' ? SunMoon : themeMode === 'light' ? Sun : Moon
  const themeModeLabel = themeMode === 'system'
    ? t('跟随系统', 'System')
    : themeMode === 'light'
      ? t('日间', 'Light')
      : t('夜间', 'Dark')

  useEffect(() => {
    function closeOnOutsidePointer(event: PointerEvent) {
      if (!menuRoot.current?.contains(event.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('pointerdown', closeOnOutsidePointer)
    void invokeCommand<BuildTracking>('get_build_tracking')
      .then(value => { setBuildTracking(value) })
      .catch(() => { setBuildTracking(null) })
    return () => document.removeEventListener('pointerdown', closeOnOutsidePointer)
  }, [])

  function navigate(value: WorkspaceSection) {
    setMenuOpen(false)
    onNavigate?.(value)
  }

  function openProfile() {
    setMenuOpen(false)
    onProfile?.()
  }

  function openSettings() {
    setMenuOpen(false)
    onSettings?.()
  }

  return (
    <div
      className={`app-drag workspace-rail relative flex w-[4.75rem] shrink-0 flex-col${collapsed !== false ? ' workspace-rail--collapsed' : ''}`}
      data-shell-traffic-safe
    >
      <div
        ref={menuRoot}
        className="workspace-rail-traffic-safe relative flex items-end justify-center px-1"
        onKeyDown={event => { if (event.key === 'Escape') setMenuOpen(false) }}
      >
        <button
          type="button"
          className="app-no-drag workspace-rail-profile"
          aria-label={t('打开用户菜单', 'Open user menu')}
          aria-expanded={menuOpen}
          onClick={event => {
            event.stopPropagation()
            setMenuOpen(open => !open)
          }}
        >
          <span className="ak-media--album workspace-rail-profile__album">
            <img src={avatarSource} alt={t('用户头像', 'User avatar')} className="workspace-rail-profile__mark" />
            {isBetaChannel ? (
              <span
                className="pointer-events-none absolute -right-2 -top-2 bg-indigo-600 px-1 py-0.5 text-[9px] font-semibold leading-none tracking-wide text-white"
                aria-label={t('Beta 渠道', 'Beta channel')}
                data-testid="beta-channel-badge"
              >
                BETA
              </span>
            ) : null}
          </span>
        </button>

        {menuOpen ? (
          <section
            className="app-no-drag absolute left-[4.6rem] top-10 z-50 w-52 overflow-hidden border border-border bg-popover p-1.5 text-popover-foreground shadow-xl"
            aria-label={t('用户菜单', 'User menu')}
          >
            <button className="user-menu-item" onClick={openProfile}><UserRound className="size-4" />{t('个人资料', 'Profile')}</button>
            <button className="user-menu-item" onClick={openSettings}><Settings className="size-4" />{t('设置', 'Settings')}</button>
            {accountStatus.state === 'active' ? (
              <button className="user-menu-item" onClick={() => { setMenuOpen(false); onAccountLogout?.() }}><LogOut className="size-4" />{t('退出登录', 'Sign out')}</button>
            ) : accountStatus.configured ? (
              <button className="user-menu-item" onClick={() => { setMenuOpen(false); onAccountLogin?.() }}><LogOut className="size-4 rotate-180" />{t('使用 GitHub 登录', 'Sign in with GitHub')}</button>
            ) : (
              <button className="user-menu-item text-muted-foreground" disabled><LogOut className="size-4" />{t('账户未配置', 'Account not configured')}</button>
            )}
          </section>
        ) : null}
      </div>

      <nav className="app-no-drag workspace-rail-nav" aria-label={t('全局工作区', 'Workspace')}>
        {WORKSPACE_RAIL_ITEMS.map(item => {
          const Icon = icons[item.id]
          return (
            <button
              key={item.id}
              type="button"
              className={`workspace-rail-item${activeSection === item.id ? ' is-current' : ''}`}
              aria-label={item.label}
              aria-current={activeSection === item.id ? 'page' : undefined}
              title={item.label}
              data-ui-selected={activeSection === item.id ? '' : undefined}
              onClick={() => navigate(item.id)}
            >
              <Icon className="size-4" />
              <span>{item.label}</span>
            </button>
          )
        })}
      </nav>

      <div className="flex-1" />

      <div className="app-no-drag workspace-rail-foot">
        <button
          type="button"
          className="workspace-rail-item"
          aria-label={themeToggleLabel}
          title={themeToggleLabel}
          onClick={onToggleTheme}
        >
          <ThemeToggleIcon className="size-4" />
          <span>{themeModeLabel}</span>
        </button>

        <button
          type="button"
          className={`workspace-rail-item${activeSection === 'settings' ? ' is-current' : ''}`}
          aria-label={t('设置', 'Settings')}
          title={t('设置', 'Settings')}
          data-ui-selected={activeSection === 'settings' ? '' : undefined}
          onClick={openSettings}
        >
          <Settings className="size-4" />
          <span>{t('设置', 'Settings')}</span>
        </button>
      </div>
      <style>{workspaceRailCss}</style>
    </div>
  )
}

const workspaceRailCss = `
.workspace-rail-traffic-safe {
  box-sizing: border-box;
  min-height: calc(var(--shell-title-safe-top) + 3.65rem);
  padding-top: var(--shell-title-safe-top);
  padding-bottom: .45rem;
}
.workspace-rail {
  color: var(--foreground);
  background: var(--sidebar);
}
.workspace-rail-profile {
  display: grid;
  width: 2.9rem;
  height: 2.9rem;
  border: 0;
  place-items: center;
  background: transparent;
  cursor: pointer;
}
.workspace-rail-profile__album {
  margin: 0;
  border-width: 3px;
  border-color: #f8f7f2;
  box-shadow: 0 5px 12px rgb(0 0 0 / .4);
}
.workspace-rail-profile__album::before {
  top: 2px;
  left: -5px;
  border-width: 3px;
  border-color: #f8f7f2;
}
.workspace-rail-profile__mark {
  display: block;
  width: 32px;
  height: 32px;
  border: 0;
  background: #222;
  object-fit: cover;
}
@media (prefers-reduced-motion: reduce) {
  .workspace-rail-profile__album {
    transform: none;
  }
  .workspace-rail-profile__album::before {
    display: none;
  }
}
.workspace-rail-nav,
.workspace-rail-foot { display: grid; gap: .15rem; padding: 0 .35rem .35rem; }
.workspace-rail-item {
  display: grid;
  width: 100%;
  min-height: 3.15rem;
  padding: .4rem .15rem;
  border: 0;
  place-items: center;
  gap: .2rem;
  color: var(--muted-foreground);
  background: transparent;
  cursor: pointer;
  font-size: var(--text-body);
  line-height: var(--text-body--line-height);
  letter-spacing: var(--text-body--letter-spacing);
}
.workspace-rail-item span {
  font-size: 10px;
  line-height: 1.15;
}
.workspace-rail-item.is-current {
  color: #111315;
  background: #05a7dc;
  box-shadow: 0 0 1.4rem color-mix(in srgb, #05a7dc 55%, transparent);
}
.workspace-rail-item:not(.is-current):hover,
.workspace-rail-item:not(.is-current):focus-visible { color: var(--foreground); background: var(--overlay-hover); }
.workspace-rail-item, .workspace-rail-control { --border-hairline: transparent; --selected-border: transparent; }
.user-menu-item { display: flex; width: 100%; align-items: center; gap: .65rem; border: 0; border-radius: 0; background: transparent; padding: .65rem .7rem; color: var(--foreground); font-size: var(--text-body); cursor: pointer; }
.user-menu-item:hover:not(:disabled), .user-menu-item:focus-visible { background: var(--muted); outline: 0; }
.user-menu-item:disabled { cursor: default; opacity: .55; }
`
