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

export function companionIntentLine(intent, locale = "zh") {
  const bucket = String(intent?.bucket ?? "").trim();
  const label = INTENT_LABELS[bucket];
  if (!label) return "";
  const who = intent?.source === "model"
    ? (locale === "en" ? "the conversation model" : "主模型")
    : "Jev";
  const name = locale === "en" ? label.en : label.zh;
  return locale === "en"
    ? `Intent: ${name}. Decided by ${who}.`
    : `意图识别：${name}。由${who}判定。`;
}

export function companionModelPrompt(visible, intent, locale = "zh") {
  const line = companionIntentLine(intent, locale);
  const text = String(visible ?? "").trim();
  if (!line) return text;
  if (!text) return line;
  return `${line}\n${text}`;
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
