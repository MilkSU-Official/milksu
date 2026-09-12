import { t } from './uiLocale'

type ParsedTokenFluxFailure = {
  status: number | null
  code: string
  reason: string
  message: string
  haystack: string
}

const HTTP_STATUS = /\b(400|401|403|404|413|429|500|502|503)\b/
const BARE_STATUS = /\b(?:PI model verification failed:\s*)?(\d{3})\s+status code(?:\s*\(no body\))?/i

function compactErrorText(value: unknown): string {
  return String(value ?? '')
    .replace(/Error invoking remote method[^:]*:\s*/gi, ' ')
    .replace(/(?:Error:\s*)+/g, ' ')
    .replace(/\r\n/g, '\n')
    .replace(/\s+/g, ' ')
    .trim()
}

function readNestedMessage(value: unknown): string {
  if (!value) return ''
  if (typeof value === 'string') return value.trim()
  if (typeof value !== 'object') return ''
  const record = value as { message?: unknown; type?: unknown; code?: unknown }
  return String(record.message ?? record.type ?? record.code ?? '').trim()
}

function parseJsonError(raw: string): { code: string; message: string } {
  const match = raw.match(/\{[\s\S]*\}/)
  if (!match) return { code: '', message: '' }
  try {
    const body = JSON.parse(match[0]) as Record<string, unknown>
    const nested = body.error
    const nestedRecord = nested && typeof nested === 'object'
      ? nested as { message?: unknown; type?: unknown; code?: unknown }
      : null
    const code = String(
      (typeof body.code === 'string' ? body.code : '')
      || (nestedRecord && typeof nestedRecord.code === 'string' ? nestedRecord.code : '')
      || '',
    ).trim()
    const message = String(
      body.message
      ?? readNestedMessage(nested)
      ?? body.type
      ?? '',
    ).trim()
    return { code, message }
  } catch {
    return { code: '', message: '' }
  }
}

function parseTokenFluxFailure(value: unknown): ParsedTokenFluxFailure {
  const raw = compactErrorText(value)
  const json = parseJsonError(raw)
  const reason = String(raw.match(/reason\s*=\s*"([^"]+)"/i)?.[1] ?? '').trim()
  const bare = raw.match(BARE_STATUS)
  const statusMatch = raw.match(HTTP_STATUS)
  const status = statusMatch ? Number(statusMatch[1]) : (bare ? Number(bare[1]) : null)
  const message = json.message
    || String(raw.match(/\bmessage\s*=\s*"([^"]+)"/i)?.[1] ?? '').trim()
  const haystack = [raw, json.code, reason, message].filter(Boolean).join(' ')
  return {
    status,
    code: json.code,
    reason,
    message,
    haystack,
  }
}

function has(parsed: ParsedTokenFluxFailure, pattern: RegExp): boolean {
  return pattern.test(parsed.haystack) || pattern.test(parsed.code) || pattern.test(parsed.reason)
}

const TOKENFLUX_FINGERPRINT = /tokenflux|API_KEY_|INSUFFICIENT_BALANCE|GROUP_|TEAM_|SUBSCRIPTION_|QUOTA_EXHAUSTED|DAILY_LIMIT_EXCEEDED|WEEKLY_LIMIT_EXCEEDED|MONTHLY_LIMIT_EXCEEDED|COMPOSITE_KEY_MODEL_PREFIX|Claude Code|composite api key model|not supported by any configured account|No available accounts|All available accounts exhausted|Billing service temporarily unavailable|内容审计命中风险规则|restricted to Claude Code|only allows Claude Code|\/v1\/messages only|does not allow (?:Anthropic|OpenAI|Gemini)|not assigned to any group|rate limited|Concurrency limit|Too many pending requests|Upstream rate limit|model group rate/i

function looksLikeTokenFluxFingerprint(parsed: ParsedTokenFluxFailure): boolean {
  return TOKENFLUX_FINGERPRINT.test(parsed.haystack)
    || TOKENFLUX_FINGERPRINT.test(parsed.code)
    || TOKENFLUX_FINGERPRINT.test(parsed.reason)
}

/** Maps TokenFlux HTTP status + message / reason= per https://docs.tokenflux.dev/en/docs/errors.html */
export function explainTokenFluxError(value: unknown): string | null {
  const parsed = parseTokenFluxFailure(value)
  if (!looksLikeTokenFluxFingerprint(parsed)) {
    return null
  }

  if (has(parsed, /COMPOSITE_KEY_MODEL_PREFIX_REQUIRED|composite api key model must use prefix\/model_id/i)) {
    return t('当前 Key 需要带厂商前缀的模型 ID（例如 x-ai/grok-4.5）。', 'This key requires a vendor-prefixed model ID (for example x-ai/grok-4.5).')
  }
  if (has(parsed, /model is required/i) && parsed.status === 400) {
    return t('请求没有带上模型 ID，请重新选择模型。', 'The request did not include a model ID. Choose a model again.')
  }
  if (has(parsed, /Claude Code version|Unable to determine Claude Code version/i)) {
    return t('该分组要求 Claude Code 客户端，MilkSU 不能用这个模型。', 'This group requires the Claude Code client. MilkSU cannot use this model.')
  }

  if (has(parsed, /API_KEY_REQUIRED|API key is required/i)) {
    return t('请求没有带上 TokenFlux Key，请重新保存后再验证。', 'The request did not include a TokenFlux key. Save again, then verify.')
  }
  if (has(parsed, /API_KEY_DISABLED|API key is disabled/i)) {
    return t('这个 TokenFlux Key 已停用，请到 TokenFlux 换一个可用 Key。', 'This TokenFlux key is disabled. Create a usable key on TokenFlux.')
  }
  if (has(parsed, /INVALID_API_KEY|Invalid API key/i)) {
    return t('TokenFlux Key 无效，请检查后重新保存。', 'The TokenFlux key is invalid. Check it, then save again.')
  }
  if (has(parsed, /USER_NOT_FOUND|User associated with API key not found/i)) {
    return t('这个 TokenFlux Key 对应的账户不存在。', 'The TokenFlux account for this key was not found.')
  }
  if (has(parsed, /USER_INACTIVE|User account is not active/i)) {
    return t('这个 TokenFlux 账户已停用。', 'This TokenFlux account is inactive.')
  }
  if (parsed.status === 401 || has(parsed, /\b401\b|unauthori[sz]ed|authentication failed/i)) {
    return t('模型凭据无效或无权访问。', 'Model credentials are invalid or unauthorized.')
  }

  if (has(parsed, /INSUFFICIENT_BALANCE|Insufficient account balance|insufficient quota/i)) {
    return t('TokenFlux 账户余额不足，请到 TokenFlux 充值后再试。', 'TokenFlux account balance is insufficient. Top up on TokenFlux, then try again.')
  }
  if (has(parsed, /API_KEY_EXPIRED|API key 已过期/i)) {
    return t('这个 TokenFlux Key 已过期，请到 TokenFlux 重新创建。', 'This TokenFlux key has expired. Create a new one on TokenFlux.')
  }
  if (has(parsed, /ACCESS_DENIED|Your IP is/i)) {
    return t('当前 IP 不在这个 TokenFlux Key 的允许范围。', 'This IP is outside the range allowed for this TokenFlux key.')
  }
  if (has(parsed, /GROUP_DELETED|所属分组已删除/i)) {
    return t('这个 TokenFlux Key 所属分组已删除，请到 TokenFlux 换一个分组重新创建 Key。', 'The group for this TokenFlux key was deleted. Create a key on another group on TokenFlux.')
  }
  if (has(parsed, /GROUP_DISABLED_FOR_USER|所属公开分组已被禁用/i)) {
    return t('这个 TokenFlux 公开分组已对该账户停用，请换一个分组。', 'This public TokenFlux group is disabled for the account. Switch to another group.')
  }
  if (has(parsed, /GROUP_DISABLED|所属分组已停用/i)) {
    return t('这个 TokenFlux Key 所属分组已停用，请到 TokenFlux 换一个分组。', 'The group for this TokenFlux key is disabled. Switch groups on TokenFlux.')
  }
  if (has(parsed, /GROUP_NOT_ALLOWED|不再允许当前用户使用/i)) {
    return t('这个 TokenFlux 专属分组已不再允许当前账户使用。', 'This private TokenFlux group no longer allows the current account.')
  }
  if (has(parsed, /does not support the requested model|not supported by any configured account/i)) {
    return t('当前 TokenFlux 分组不支持这个模型，请换模型或换分组。', 'The current TokenFlux group does not support this model. Choose another model or group.')
  }
  if (has(parsed, /restricted to Claude Code clients|only allows Claude Code|\/v1\/messages only/i)) {
    return t('该模型仅支持 Claude Code 客户端，请改选 OpenAI 兼容模型。', 'This model only supports Claude Code clients. Choose an OpenAI-compatible model.')
  }
  if (has(parsed, /does not allow (?:Anthropic Messages|OpenAI Chat Completions|OpenAI Responses|Gemini GenerateContent) requests/i)) {
    return t('当前 TokenFlux 分组不接受这种请求协议，请换一个分组或模型。', 'The current TokenFlux group does not accept this request protocol. Switch group or model.')
  }
  if (has(parsed, /not assigned to any group/i)) {
    return t('这个 TokenFlux Key 还没有分配分组，请到 TokenFlux 指定分组。', 'This TokenFlux key is not assigned to a group. Assign a group on TokenFlux.')
  }
  if (has(parsed, /TEAM_SUSPENDED|团队已暂停/i)) {
    return t('TokenFlux 团队已暂停，请让团队所有者处理。', 'The TokenFlux team is suspended. Ask the team owner to resolve it.')
  }
  if (has(parsed, /TEAM_MEMBERSHIP_REQUIRED|团队成员关系已失效/i)) {
    return t('TokenFlux 团队成员关系已失效，请让团队所有者处理。', 'TokenFlux team membership is no longer valid. Ask the team owner to resolve it.')
  }
  if (has(parsed, /TEAM_BILLING_OWNER_INACTIVE|团队付款所有者已停用/i)) {
    return t('TokenFlux 团队付款所有者已停用，请让团队所有者处理。', 'The TokenFlux team billing owner is inactive. Ask the team owner to resolve it.')
  }
  if (has(parsed, /TEAM_ACTOR_INACTIVE|团队密钥所属成员已停用/i)) {
    return t('这个 TokenFlux 团队 Key 所属成员已停用。', 'The member for this TokenFlux team key is inactive.')
  }
  if (has(parsed, /TEAM_FEATURE_DISABLED|团队功能未启用/i)) {
    return t('TokenFlux 团队功能未启用。', 'TokenFlux team features are not enabled.')
  }
  if (has(parsed, /内容审计命中风险规则/i)) {
    return t('请求被 TokenFlux 内容审计拦截，请调整输入后重试。', 'TokenFlux content moderation blocked this request. Adjust the input, then try again.')
  }
  if (has(parsed, /SUBSCRIPTION_EXPIRED|subscription has expired/i)) {
    return t('TokenFlux 订阅已过期，请到 TokenFlux 续订后再试。', 'The TokenFlux subscription has expired. Renew it on TokenFlux, then try again.')
  }
  if (has(parsed, /SUBSCRIPTION_SUSPENDED/i)) {
    return t('TokenFlux 订阅已暂停，请到 TokenFlux 查看订阅状态。', 'The TokenFlux subscription is suspended. Check it on TokenFlux.')
  }
  if (has(parsed, /SUBSCRIPTION_NOT_FOUND|SUBSCRIPTION_INVALID|PREFERRED_SUBSCRIPTION_/i)) {
    return t('TokenFlux 订阅不可用，请到 TokenFlux 查看订阅与分组。', 'The TokenFlux subscription is unavailable. Check the subscription and group on TokenFlux.')
  }
  if (has(parsed, /API_KEY_QUOTA_EXHAUSTED|额度已用完|限额已用完|quota exhausted|DAILY_LIMIT_EXCEEDED|WEEKLY_LIMIT_EXCEEDED|MONTHLY_LIMIT_EXCEEDED|TEAM_MEMBER_(?:DAILY|WEEKLY|MONTHLY)_LIMIT/i)) {
    return t('TokenFlux 额度已用完，请到 TokenFlux 查看该 Key 或订阅的额度。', 'TokenFlux quota is exhausted. Check this key or subscription quota on TokenFlux.')
  }
  if (has(parsed, /requests-per-minute|Concurrency limit|Too many pending requests|Upstream rate limit|rate limited|Too many invalid authentication attempts/i)) {
    return t('TokenFlux 请求过于频繁，请稍后再试。', 'TokenFlux is rate-limiting this key. Try again in a moment.')
  }

  if (has(parsed, /No available accounts|All available accounts exhausted/i)) {
    return t('当前 TokenFlux 分组没有可用账号，请换模型或换分组。', 'The current TokenFlux group has no available account. Switch model or group.')
  }
  if (has(parsed, /Billing service temporarily unavailable/i)) {
    return t('TokenFlux 计费服务暂时不可用，请稍后重试。', 'TokenFlux billing is temporarily unavailable. Try again later.')
  }
  if (parsed.status === 502 || parsed.status === 503 || parsed.status === 500 || has(parsed, /Upstream service|temporarily unavailable|overloaded/i)) {
    return t('TokenFlux 上游暂时不可用，请稍后重试或换一个模型。', 'TokenFlux upstream is temporarily unavailable. Retry later or switch models.')
  }
  if (parsed.status === 404 || has(parsed, /Model not found/i)) {
    return t('当前 TokenFlux 分组找不到这个模型，请换模型或换分组。', 'This model is not available in the current TokenFlux group. Switch model or group.')
  }
  if (parsed.status === 429) {
    return t('TokenFlux 请求过于频繁，请稍后再试。', 'TokenFlux is rate-limiting this key. Try again in a moment.')
  }
  if (parsed.status === 403 || has(parsed, /status code \(no body\)/i)) {
    return t('TokenFlux 拒绝了这次请求。常见原因是余额不足、订阅过期或分组不可用，请到 TokenFlux 查看额度与 Key 状态。', 'TokenFlux rejected this request. Typical causes are insufficient balance, an expired subscription, or an unavailable group. Check quota and key status on TokenFlux.')
  }
  if (parsed.status === 400) {
    return t('TokenFlux 认为这次请求无效，请检查模型 ID 后重试。', 'TokenFlux rejected this request as invalid. Check the model ID, then try again.')
  }
  return null
}

function explainTokenFluxStatusFallback(parsed: ParsedTokenFluxFailure): string | null {
  if (parsed.status === 401 || has(parsed, /\b401\b|unauthori[sz]ed|authentication failed/i)) {
    return t('模型凭据无效或无权访问。', 'Model credentials are invalid or unauthorized.')
  }
  if (parsed.status === 502 || parsed.status === 503 || parsed.status === 500) {
    return t('TokenFlux 上游暂时不可用，请稍后重试或换一个模型。', 'TokenFlux upstream is temporarily unavailable. Retry later or switch models.')
  }
  if (parsed.status === 404) {
    return t('当前 TokenFlux 分组找不到这个模型，请换模型或换分组。', 'This model is not available in the current TokenFlux group. Switch model or group.')
  }
  if (parsed.status === 429) {
    return t('TokenFlux 请求过于频繁，请稍后再试。', 'TokenFlux is rate-limiting this key. Try again in a moment.')
  }
  if (parsed.status === 403 || has(parsed, /status code \(no body\)/i)) {
    return t('TokenFlux 拒绝了这次请求。常见原因是余额不足、订阅过期或分组不可用，请到 TokenFlux 查看额度与 Key 状态。', 'TokenFlux rejected this request. Typical causes are insufficient balance, an expired subscription, or an unavailable group. Check quota and key status on TokenFlux.')
  }
  if (parsed.status === 400) {
    return t('TokenFlux 认为这次请求无效，请检查模型 ID 后重试。', 'TokenFlux rejected this request as invalid. Check the model ID, then try again.')
  }
  return null
}

function explainNeutralModelHttp(parsed: ParsedTokenFluxFailure): string | null {
  if (parsed.status === 401 || has(parsed, /\b401\b|unauthori[sz]ed|authentication failed/i)) {
    return t('模型凭据无效或无权访问。', 'Model credentials are invalid or unauthorized.')
  }
  if (parsed.status === 404 || has(parsed, /Model not found/i)) {
    return t('当前服务找不到这个模型。', 'This model is not available on the current service.')
  }
  if (parsed.status === 429) {
    return t('请求过于频繁，请稍后再试。', 'The model service is rate-limiting this key. Try again in a moment.')
  }
  if (parsed.status === 502 || parsed.status === 503 || parsed.status === 500 || has(parsed, /Upstream service|temporarily unavailable|overloaded/i)) {
    return t('模型服务暂时不可用，请稍后重试或换一个模型。', 'The model service is temporarily unavailable. Retry later or switch models.')
  }
  if (parsed.status === 403 || has(parsed, /status code \(no body\)/i)) {
    return t('模型服务拒绝了这次请求。请检查 Key、额度与模型 ID。', 'The model service rejected this request. Check the key, quota, and model ID.')
  }
  if (parsed.status === 400) {
    return t('这次请求无效，请检查模型 ID 后重试。', 'The model service rejected this request as invalid. Check the model ID, then try again.')
  }
  return null
}

export type ModelServiceErrorContext = {
  provider?: string | null
}

export function explainModelServiceError(
  value: unknown,
  context?: ModelServiceErrorContext,
): string | null {
  const parsed = parseTokenFluxFailure(value)
  const provider = String(context?.provider ?? '').trim()
  if (provider === 'tokenflux') {
    return explainTokenFluxError(value) ?? explainTokenFluxStatusFallback(parsed)
  }
  if (looksLikeTokenFluxFingerprint(parsed)) {
    return explainTokenFluxError(value)
  }
  return explainNeutralModelHttp(parsed)
}

export function explainModelVerificationFailure(
  value: unknown,
  provider?: string | null,
): string {
  const raw = compactErrorText(value)
  if (
    /both model sources are unavailable|enable the personal API key|add a personal API key|connect the beta account quota/i
      .test(raw)
  ) {
    return t(
      '当前没有可用的账户或个人模型来源。请启用 MilkSU 账户、TokenFlux 个人 Key 或已配置的中转站后重试。',
      'No account or personal model source is available. Enable the MilkSU account, a personal TokenFlux key, or a configured relay, then try again.',
    )
  }
  const mapped = explainModelServiceError(value, { provider })
  if (mapped) return mapped
  if (
    /ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|network is unreachable|connection refused|\bconnection error\b|fetch failed|dial tcp/i
      .test(raw)
  ) {
    return t('无法连上模型服务，请检查网络后重试。', 'Could not reach the model service. Check the network, then try again.')
  }
  if (String(provider ?? '').trim() === 'tokenflux') {
    return t('模型验证失败。请到 TokenFlux 查看该 Key 的状态与额度。', 'Model verification failed. Check this key\'s status and quota on TokenFlux.')
  }
  return t('模型验证失败。请检查该服务的 Key 状态与额度。', 'Model verification failed. Check this service\'s key status and quota.')
}
