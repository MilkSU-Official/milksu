import assert from "node:assert/strict";
import test from "node:test";
import {
  applyReviewedAssistantText,
  companionReplyReviewInstructions,
  reviewCompanionDraft,
  rewriteLastAssistantReply,
} from "./reply-review.js";

test("chat review keeps the short lines apart from the long paragraph", () => {
  assert.match(companionReplyReviewInstructions("zh", "chat"), /空行留着/);
  assert.match(companionReplyReviewInstructions("en", "chat"), /blank lines/);
  assert.doesNotMatch(companionReplyReviewInstructions("zh", "markdown"), /空行留着/);
});

test("review keeps the draft when the pass fails", async () => {
  const text = await reviewCompanionDraft({
    draft: "你好",
    userText: "在吗",
    locale: "zh",
    complete: async () => {
      throw new Error("offline");
    },
  });
  assert.equal(text, "你好");
});

test("review replaces a draft with the model text", async () => {
  let systemPrompt = "";
  let userBody = "";
  const text = await reviewCompanionDraft({
    draft: "上次 abc123dead 还在编译",
    userText: "你好",
    locale: "zh",
    complete: async (context) => {
      systemPrompt = context.systemPrompt;
      userBody = context.messages[0].content[0].text;
      return {
        role: "assistant",
        content: [{ type: "text", text: "你好。" }],
      };
    },
  });
  assert.equal(text, "你好。");
  assert.match(systemPrompt, /审/);
  assert.match(userBody, /你好/);
  assert.match(userBody, /abc123dead/);
});

test("reviewed text replaces the last assistant reply and keeps tool calls", () => {
  const assistant = {
    role: "assistant",
    content: [
      { type: "toolCall", id: "call-1", name: "companion_board", arguments: { action: "list" } },
      { type: "text", text: "会话 abc123 还在跑" },
      { type: "text", text: "另外一段" },
    ],
  };
  assert.equal(applyReviewedAssistantText(assistant, "还在跑。"), true);
  assert.equal(assistant.content.filter(block => block.type === "text").length, 1);
  assert.equal(assistant.content.find(block => block.type === "text").text, "还在跑。");
  assert.equal(assistant.content[0].name, "companion_board");

  const roots = [
    [{ role: "user", content: [{ type: "text", text: "进度" }] }, assistant],
  ];
  assert.equal(rewriteLastAssistantReply(roots, "标题还在跑。"), true);
  assert.equal(assistant.content.find(block => block.type === "text").text, "标题还在跑。");
});
