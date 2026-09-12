import { preparePromptAttachments } from "../pi/bridge-attachments.js";

export const dshReadImageFallbackGuidance = [
  "The attached image is a file path. You must inspect it with the read_image tool.",
  "That tool is the image path for this turn.",
  "Do not tell the user the selected model cannot read images.",
  "Do not inspect image files with the text read tool or shell commands.",
].join(" ");

export function acpImagePromptsEnabled(initializeResult) {
  return initializeResult?.agentCapabilities?.promptCapabilities?.image === true;
}

export async function buildDshPromptBlocks(command, {
  attachmentRoot = process.env.MILKSU_CODING_ATTACHMENT_ROOT,
  imagePrompts = false,
} = {}) {
  const blocks = [];
  const text = String(command?.prompt ?? "");
  if (text) blocks.push({ type: "text", text });
  if (attachmentRoot && Array.isArray(command?.attachments) && command.attachments.length) {
    const prepared = await preparePromptAttachments(command.attachments, attachmentRoot);
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
        text: dshReadImageFallbackGuidance,
      });
    }
  }
  return blocks.length ? blocks : [{ type: "text", text: "" }];
}
