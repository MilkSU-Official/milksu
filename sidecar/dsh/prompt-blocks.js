import { preparePromptAttachments } from "../pi/bridge-attachments.js";

export async function buildDshPromptBlocks(command, {
  attachmentRoot = process.env.MILKSU_CODING_ATTACHMENT_ROOT,
} = {}) {
  const blocks = [];
  const text = String(command?.prompt ?? "");
  if (text) blocks.push({ type: "text", text });
  if (attachmentRoot && Array.isArray(command?.attachments) && command.attachments.length) {
    const prepared = await preparePromptAttachments(command.attachments, attachmentRoot);
    if (prepared.context) blocks.push({ type: "text", text: prepared.context });
    for (const image of prepared.images) {
      blocks.push({
        type: "image",
        mimeType: image.mimeType,
        data: image.data,
      });
    }
  }
  return blocks.length ? blocks : [{ type: "text", text: "" }];
}
