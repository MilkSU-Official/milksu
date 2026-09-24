import { desktopErrorMessage } from '@/desktop'

export function accountUsernameProblem(value: string) {
  const name = value.trim()
  if (!/^[A-Za-z0-9_-]{3,32}$/.test(name)) return 'invalid_username'
  return ''
}

export function accountPasswordProblem(value: string) {
  if (value.length < 10 || value.length > 200) return 'invalid_password'
  return ''
}

export function accountPasswordMessage(
  reason: unknown,
  t: (zh: string, en: string) => string,
) {
  const code = desktopErrorMessage(reason).split('account_password:').at(-1) || ''
  switch (code) {
    case 'rate_limited':
      return t('登录尝试过多，请稍后再试。', 'Too many sign-in attempts. Try again later.')
    case 'access_suspended':
      return t('这个内测账号当前已暂停访问。', 'This beta account is currently suspended.')
    case 'invalid_username':
      return t('用户名需要 3 到 32 位字母、数字、下划线或连字符。', 'Usernames are 3–32 letters, numbers, underscores, or hyphens.')
    case 'invalid_password':
      return t('密码至少 10 位。', 'Use at least 10 characters.')
    case 'username_taken':
      return t('这个用户名已经有人使用。', 'That username is already taken.')
    case 'password_mismatch':
      return t('当前密码不正确。', 'The current password is wrong.')
    case 'password_exists':
      return t('这个账号已经设置过密码。', 'This account already has a password.')
    default:
      return t('用户名或密码不正确。', 'The username or password is incorrect.')
  }
}
