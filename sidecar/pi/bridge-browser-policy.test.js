import test from "node:test";
import assert from "node:assert/strict";
import {
  browserUseMcpServerName,
  codingBrowserEvidenceFileBlockReason,
  codingBrowserEvidenceRelativePath,
  codingBrowserExcludedTools,
  codingBrowserGuidance,
  codingBrowserMcpServerName,
  codingBrowserToolBlockReason,
  formatCodingBrowserApprovalInput,
} from "./bridge-browser-policy.js";

test("tells the model to use the built-in browser without asking the user to enable it", () => {
  assert.match(codingBrowserGuidance(), /built-in isolated browser/);
  assert.match(codingBrowserGuidance(), /Never ask the user to enable Coding Browser/);
});

test("blocks the unsafe Playwright code tool only on the built-in browser server", () => {
  assert.deepEqual(codingBrowserExcludedTools, ["browser_run_code_unsafe"]);
  assert.match(
    codingBrowserToolBlockReason(
      { tool: "browser_run_code_unsafe" },
      codingBrowserMcpServerName,
    ),
    /arbitrary JavaScript/,
  );
  assert.match(
    codingBrowserToolBlockReason(
      { tool: "browser_run_code_unsafe" },
      browserUseMcpServerName,
    ),
    /reviewed browser tools/,
  );
  assert.match(
    codingBrowserToolBlockReason(
      { tool: "milksu_playwright_browser_run_code_unsafe" },
      codingBrowserMcpServerName,
    ),
    /reviewed browser tools/,
  );
  assert.equal(
    codingBrowserToolBlockReason(
      { tool: "browser_run_code_unsafe" },
      "project-playwright",
    ),
    "",
  );
});

test("labels user-browser approvals separately from the isolated browser", () => {
  assert.equal(
    formatCodingBrowserApprovalInput({
      tool: "browser_click",
      args: { element: "Account menu", target: "ref-12" },
    }, browserUseMcpServerName),
    '用户 Browser Use · 工具 browser_click · 元素 "Account menu" · 目标 "ref-12"',
  );
});

test("formats the salient target of browser approvals from object arguments", () => {
  assert.equal(
    formatCodingBrowserApprovalInput({
      tool: "browser_click",
      args: {
        element: "Verify project button",
        target: "#verify",
      },
    }, codingBrowserMcpServerName),
    '隔离 Coding Browser · 工具 browser_click · 元素 "Verify project button" · 目标 "#verify"',
  );
  assert.equal(
    formatCodingBrowserApprovalInput({
      tool: "browser_navigate",
      args: { url: "http://127.0.0.1:4173/fixture" },
    }, codingBrowserMcpServerName),
    '隔离 Coding Browser · 工具 browser_navigate · 地址 "http://127.0.0.1:4173/fixture"',
  );
});

test("formats typed text and evidence filenames from JSON arguments", () => {
  assert.equal(
    formatCodingBrowserApprovalInput({
      tool: "browser_type",
      args: JSON.stringify({
        element: "Project name",
        target: "#project",
        text: "MilkSU",
        submit: true,
      }),
    }, codingBrowserMcpServerName),
    '隔离 Coding Browser · 工具 browser_type · 元素 "Project name" · '
      + '目标 "#project" · 输入 "MilkSU" · 输入后提交',
  );
  assert.equal(
    formatCodingBrowserApprovalInput({
      tool: "browser_take_screenshot",
      args: { filename: "final-page.png", fullPage: true },
    }, codingBrowserMcpServerName),
    '隔离 Coding Browser · 工具 browser_take_screenshot · '
      + '证据 "final-page.png" · 整页截图',
  );
});

test("formats every visible fill-form field from the real Playwright schema", () => {
  assert.equal(
    formatCodingBrowserApprovalInput({
      tool: "browser_fill_form",
      args: {
        fields: [
          {
            name: "Project",
            type: "textbox",
            target: "#project",
            value: "MilkSU",
          },
          {
            name: "Mode",
            type: "combobox",
            target: "#mode",
            value: "Regression",
          },
        ],
      },
    }, codingBrowserMcpServerName),
    "隔离 Coding Browser · 工具 browser_fill_form · "
      + '字段 "Project" · 类型 textbox · 目标 "#project" · 值 "MilkSU"；'
      + '字段 "Mode" · 类型 combobox · 目标 "#mode" · 值 "Regression"',
  );
});

test("derives only a strict workspace-relative browser evidence path", () => {
  assert.equal(
    codingBrowserEvidenceRelativePath(
      "browser_12345678-abcd-4567-8901-123456789abc",
    ),
    ".milksu/browser-evidence/browser_12345678-abcd-4567-8901-123456789abc",
  );
  for (const value of [
    "",
    "../browser_12345678",
    "browser_short",
    "computer_12345678",
  ]) {
    assert.equal(codingBrowserEvidenceRelativePath(value), "");
  }
});

test("requires explicit Browser evidence files to stay in the current session", () => {
  const sessionId = "browser_12345678-abcd-4567-8901-123456789abc";
  const evidencePath = codingBrowserEvidenceRelativePath(sessionId);
  for (const filename of [
    "final-page.png",
    "../final-page.png",
    "/tmp/final-page.png",
    `${evidencePath}/../other.png`,
    ".milksu/browser-evidence/browser_87654321/other.png",
    `${evidencePath}\\other.png`,
  ]) {
    assert.match(
      codingBrowserEvidenceFileBlockReason(
        {
          tool: "browser_take_screenshot",
          args: { filename },
        },
        codingBrowserMcpServerName,
        sessionId,
      ),
      new RegExp(evidencePath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  }
  assert.equal(
    codingBrowserEvidenceFileBlockReason(
      {
        tool: "browser_take_screenshot",
        args: {
          filename: `${evidencePath}/final-page.png`,
        },
      },
      codingBrowserMcpServerName,
      sessionId,
    ),
    "",
  );
  assert.equal(
    codingBrowserEvidenceFileBlockReason(
      {
        tool: "browser_console_messages",
        args: JSON.stringify({
          filename: `${evidencePath}/console.log`,
        }),
      },
      codingBrowserMcpServerName,
      sessionId,
    ),
    "",
  );
});
