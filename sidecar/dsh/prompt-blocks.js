import { preparePromptAttachments } from "../pi/bridge-attachments.js";
import { chineseUiLocale } from "../pi/bridge-runtime-environment.js";

export function dshReadImageFallbackGuidance(uiLocale) {
  if (chineseUiLocale(uiLocale)) {
    return [
      "附件图片是文件路径。必须用 read_image 工具查看。",
      "这个工具就是本回合的图片路径。",
      "不要告诉用户所选模型不能看图。",
      "不要用文本 read 工具或 shell 命令去检查图片文件。",
    ].join(" ");
  }
  return [
    "The attached image is a file path. You must inspect it with the read_image tool.",
    "That tool is the image path for this turn.",
    "Do not tell the user the selected model cannot read images.",
    "Do not inspect image files with the text read tool or shell commands.",
  ].join(" ");
}

export function acpImagePromptsEnabled(initializeResult) {
  return initializeResult?.agentCapabilities?.promptCapabilities?.image === true;
}

export async function buildDshPromptBlocks(command, {
  attachmentRoot = process.env.MILKSU_CODING_ATTACHMENT_ROOT,
  imagePrompts = false,
} = {}) {
  const blocks = [];
  const text = String(command?.prompt ?? "");
  const uiLocale = command?.locale === "en" ? "en" : "zh";
  if (text) blocks.push({ type: "text", text });
  if (attachmentRoot && Array.isArray(command?.attachments) && command.attachments.length) {
    const prepared = await preparePromptAttachments(command.attachments, attachmentRoot, {
      uiLocale,
    });
    if (prepared.context) blocks.push({ type: "text", text: prepared.context });
    if (imagePrompts) {
      for (const image of prepared.images) {
        blocks.push({
          type: "image",
          mimeType: image.mimeType,
          data: image.data,
        });
      }
    } else if (prepared.images.length > 0) {
      blocks.push({
        type: "text",
        text: dshReadImageFallbackGuidance(uiLocale),
      });
    }
  }
  return blocks.length ? blocks : [{ type: "text", text: "" }];
}
