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
