/**
 * How much of a model's context window is actually usable for input.
 *
 * A request has to leave room for the model's own answer, so the usable input
 * budget is `window - maxOutput`. The usage panel needs that number: dividing by
 * the whole window made a conversation that could no longer fit look like "65%".
 *
 * Pure on purpose: the caller owns where the numbers come from, so the rule can
 * be tested without a session. Unknown values are omitted from the payload
 * instead of being guessed, which keeps the reader's UI on its previous shape.
 */
export function contextUsageWindowPayload(windowTokens, maxOutput) {
  const size = Number(windowTokens);
  const output = Number(maxOutput);
  if (!Number.isFinite(size) || size <= 0) return {};
  if (!Number.isFinite(output) || output <= 0 || output >= size) return {};
  return { maxOutput: output, usableWindow: size - output };
}

/**
 * 取该模型的「最大输出」，顺序固定：
 *   ① 先按 id 查表（lookupMaxTokens，通常 knownMaxTokens —— 未知 id 返回 0 ✓）
 *   ② 表查不到 ⇒ 用会话给的 maxTokens
 *   ③ 都没有 ⇒ undefined（**不带字段**，前端保持旧口径）
 * ⚠️ 绝不用 registeredMaxTokens 的默认值（unknown ⇒ 16384 ✗）兜底 —— 那会给未知模型一个错的数。
 * lookup 以参数注入 ⇒ 纯函数可测，不自己 require（否则又是不可测的假守卫 ✗）。
 */
export function resolveMaxOutput({ modelIds = [], sessionMaxTokens, lookupMaxTokens } = {}) {
  if (typeof lookupMaxTokens === "function") {
    for (const candidate of modelIds) {
      const id = String(candidate ?? "").trim();
      if (!id) continue;
      const known = Number(lookupMaxTokens(id));
      if (Number.isFinite(known) && known > 0) return known;
    }
  }
  const session = Number(sessionMaxTokens);
  if (Number.isFinite(session) && session > 0) return session;
  return undefined;
}
