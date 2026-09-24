import { preparePromptAttachments } from "../pi/bridge-attachments.js";

export const COMPANION_ATTACHMENT_PROMPT_ZH = "请看这些附件。";
export const COMPANION_ATTACHMENT_PROMPT_EN = "Please look at these attachments.";

export function companionVisiblePrompt(prompt, attachments = [], locale = "zh") {
  const text = String(prompt ?? "").trim();
  if (text) return text;
  const names = (Array.isArray(attachments) ? attachments : [])
    .map(item => String(item?.name ?? "").trim())
    .filter(Boolean);
  if (!names.length) return "";
  return locale === "en" ? COMPANION_ATTACHMENT_PROMPT_EN : COMPANION_ATTACHMENT_PROMPT_ZH;
}

const INTENT_LABELS = {
  chat: { zh: "闲聊", en: "chat" },
  deep: { zh: "深入思考", en: "deep thinking" },
  long: { zh: "长任务", en: "long task" },
};

export function companionDecisionLine(intent, locale = "zh") {
  const bucket = String(intent?.bucket ?? "").trim();
  const label = INTENT_LABELS[bucket];
  if (!label) return "";
  const who = intent?.source === "model"
    ? (locale === "en" ? "the conversation model" : "主模型")
    : "Jev";
  const name = locale === "en" ? label.en : label.zh;
  return locale === "en"
    ? `Decision: ${name}. Decided by ${who}.`
    : `决策：${name}。由${who}判定。`;
}

export function companionModelPrompt(visible, intent, locale = "zh") {
  const line = companionDecisionLine(intent, locale);
  const text = String(visible ?? "").trim();
  if (!line) return text;
  if (!text) return line;
  return `${line}\n${text}`;
}

export function companionDecisionBucketFromModel(text) {
  const raw = String(text ?? "");
  if (/长任务|long task/i.test(raw)) return "long";
  if (/深入思考|deep thinking/i.test(raw)) return "deep";
  if (/闲聊|\bchat\b/i.test(raw)) return "chat";
  return "";
}

export async function classifyCompanionDecision(prompt, { locale = "zh", complete, readText } = {}) {
  const asked = String(prompt ?? "").trim();
  if (!asked || typeof complete !== "function") return null;
  const language = locale === "en" ? "en" : "zh";
  const body = language === "en"
    ? `Classify the user message as exactly one label: chat, deep thinking, or long task.\n\n${asked}`
    : `把用户这句话分成且只分成一档：闲聊、深入思考、长任务。只回档名。\n\n${asked}`;
  let message;
  try {
    message = await complete({
      systemPrompt: language === "en"
        ? "Reply with one label only."
        : "只回复一个档名。",
      messages: [{
        role: "user",
        content: [{ type: "text", text: body }],
        timestamp: Date.now(),
      }],
    });
  } catch {
    return null;
  }
  const text = typeof readText === "function" ? readText(message) : "";
  const bucket = companionDecisionBucketFromModel(text);
  if (!bucket) return null;
  return { bucket, source: "model" };
}

export async function prepareCompanionPrompt(command) {
  const locale = command?.locale === "en" ? "en" : "zh";
  const attachments = Array.isArray(command?.attachments) ? command.attachments : [];
  const visible = companionVisiblePrompt(command?.prompt, attachments, locale);
  if (!attachments.length) {
    return { prompt: visible, images: [] };
  }
  const prepared = await preparePromptAttachments(
    attachments,
    process.env.MILKSU_CODING_ATTACHMENT_ROOT,
    { uiLocale: locale },
  );
  return {
    prompt: `${visible}${prepared.context}`,
    images: prepared.images,
  };
}
