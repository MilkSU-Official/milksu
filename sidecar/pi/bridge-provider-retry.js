/**
 * 撞到限流时**不要自动重试**。
 *
 * 真事：tokenflux 回 429（限流），而 pi-ai 把 429 当"可重试"（`provider-retry.js`），
 * 默认 `retry.maxRetries = 3` ⇒ 同一轮里连打 3~4 次 ✗ ⇒ 越打越被限流、还在烧额度，
 * 界面上只剩一串"请求过于频繁"，只有用户按停止才停 ✗。
 *
 * pi 从 `<agentDir>/settings.json` 读这个值，所以这里把键**补进那份设置**：
 * 保留原有的一切 ✓、只把两个 maxRetries 归零 ✓、内容没变就不写盘 ✓（避免无谓改动）。
 */
export function withNoProviderRetry(rawText) {
  let parsed;
  try {
    parsed = rawText ? JSON.parse(rawText) : {};
  } catch {
    // 设置文件坏了不要紧：**不碰它** ✓（让 pi 自己去修，别在这里把用户设置写烂 ✗）。
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const retry = parsed.retry && typeof parsed.retry === "object" ? parsed.retry : {};
  const provider = retry.provider && typeof retry.provider === "object" ? retry.provider : {};
  const next = {
    ...parsed,
    retry: { ...retry, maxRetries: 0, provider: { ...provider, maxRetries: 0 } },
  };
  const text = `${JSON.stringify(next, null, 2)}\n`;
  return text === `${JSON.stringify(parsed, null, 2)}\n` ? null : text;
}
