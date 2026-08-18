import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  computerUseTool,
  createComputerUseExecutor,
  normalizeComputerUseInput,
  normalizeComputerUseProxyOptions,
  runComputerUseMcpServer,
} from "./computer-use-proxy.js";

const options = {
  socketPath: process.platform === "win32"
    ? "\\\\.\\pipe\\milksu-computer-use-computer_12345678"
    : "/private/tmp/milksu-computer-use/computer_12345678/driver.sock",
  sessionId: "computer_12345678",
  targetName: "Codex",
  targetBundleId: "com.openai.codex",
  targetPid: 4242,
  targetWindowId: 42,
  driverPath: "/reviewed/cua-driver",
};

test("normalizes only the immutable scoped proxy descriptor", () => {
  assert.deepEqual(
    normalizeComputerUseProxyOptions([
      "--socket",
      options.socketPath,
      "--session",
      options.sessionId,
      "--target-name",
      options.targetName,
      "--target-bundle-id",
      options.targetBundleId,
      "--target-window-id",
      String(options.targetWindowId),
      "--target-pid",
      String(options.targetPid),
      "--driver",
      options.driverPath,
    ]),
    options,
  );
  for (const argv of [
    [
      "--socket",
      process.platform === "win32"
        ? "\\\\.\\pipe\\milksu-computer-use-computer_other"
        : "/private/tmp/milksu-computer-use/computer_other/driver.sock",
      "--session",
      options.sessionId,
      "--target-name",
      options.targetName,
      "--target-bundle-id",
      options.targetBundleId,
      "--target-window-id",
      String(options.targetWindowId),
      "--target-pid",
      String(options.targetPid),
      "--driver",
      options.driverPath,
    ],
    [
      "--socket",
      options.socketPath,
      "--session",
      options.sessionId,
      "--target-name",
      options.targetName,
      "--target-bundle-id",
      "com.apple.finder/invalid",
      "--target-window-id",
      String(options.targetWindowId),
      "--target-pid",
      String(options.targetPid),
      "--driver",
      options.driverPath,
    ],
  ]) {
    assert.throws(() => normalizeComputerUseProxyOptions(argv), /Computer Use/);
  }
});

test("describes a user-selected external app scope instead of MilkSU self-only scope", () => {
  assert.match(computerUseTool.description, /visible App window selected by the user/);
  assert.doesNotMatch(computerUseTool.description, /MilkSU application window/);
  assert.match(computerUseTool.description, /PID, window, bundle id/);
});

test("rejects hidden scope fields and unrelated action parameters", () => {
  for (const value of [
    { action: "observe", pid: 999 },
    { action: "observe", delivery_mode: "foreground" },
    { action: "click", element_index: 2, text: "ignored" },
    { action: "click", x: 1 },
    { action: "type", element_index: 2, text: "" },
    { action: "key", key: "return", modifiers: ["cmd", "unknown"] },
    { action: "scroll", direction: "diagonal" },
  ]) {
    assert.throws(() => normalizeComputerUseInput(value), /computer_use/);
  }
  assert.deepEqual(
    normalizeComputerUseInput({
      action: "type",
      element_index: 2,
      text: "MilkSU",
      delivery_mode: "background",
    }),
    {
      action: "type",
      element_index: 2,
      text: "MilkSU",
      delay_ms: 30,
      delivery_mode: "background",
    },
  );
});

test("injects the selected app PID, exact visible window, session, and window scope", async () => {
  const calls = [];
  const executor = createComputerUseExecutor(options, async (name, args) => {
    calls.push({ name, args });
    if (name === "list_windows") {
      return {
        windows: [
          {
            pid: options.targetPid,
            window_id: 41,
            title: "Behind",
            is_on_screen: true,
            z_index: 3,
          },
          {
            pid: options.targetPid,
            window_id: 42,
            title: "Codex",
            is_on_screen: true,
            z_index: 1,
          },
          {
            pid: 999,
            window_id: 77,
            title: "Other app",
            is_on_screen: true,
            z_index: 99,
          },
        ],
      };
    }
    return { verified: true };
  });

  await assert.rejects(
    executor.execute({
      action: "click",
      element_index: 7,
    }),
    /fresh observe/,
  );
  await executor.execute({
    action: "observe",
    include_screenshot: false,
  });
  const result = await executor.execute({
    action: "click",
    element_index: 7,
  });
  assert.deepEqual(calls, [
    {
      name: "start_session",
      args: {
        session: options.sessionId,
        capture_scope: "window",
      },
    },
    {
      name: "list_windows",
      args: {
        pid: options.targetPid,
        on_screen_only: true,
      },
    },
    {
      name: "list_windows",
      args: {
        pid: options.targetPid,
        on_screen_only: true,
      },
    },
    {
      name: "get_window_state",
      args: {
        pid: options.targetPid,
        window_id: options.targetWindowId,
        session: options.sessionId,
        include_screenshot: false,
        max_elements: 300,
        max_depth: 18,
      },
    },
    {
      name: "list_windows",
      args: {
        pid: options.targetPid,
        on_screen_only: true,
      },
    },
    {
      name: "click",
      args: {
        pid: options.targetPid,
        window_id: options.targetWindowId,
        session: options.sessionId,
        scope: "window",
        delivery_mode: "background",
        element_index: 7,
      },
    },
  ]);
  assert.deepEqual(result.target, {
    app: "Codex",
    bundleId: "com.openai.codex",
    pid: options.targetPid,
    windowId: options.targetWindowId,
    title: "Codex",
  });
  await executor.end();
  assert.deepEqual(calls.at(-1), {
    name: "end_session",
    args: { session: options.sessionId },
  });
  await assert.rejects(
    executor.execute({ action: "observe" }),
    /session has ended/,
  );
});

test("exposes one MCP tool and preserves screenshots without writing files", async () => {
  const input = new PassThrough();
  const output = new PassThrough();
  output.setEncoding("utf8");
  let responseText = "";
  output.on("data", chunk => {
    responseText += chunk;
  });
  const run = runComputerUseMcpServer({
    input,
    output,
    options,
    runTool: async (name) => {
      if (name === "list_windows") {
        return {
          windows: [{
            pid: options.targetPid,
            window_id: 42,
            title: "MilkSU",
            is_on_screen: true,
          }],
        };
      }
      if (name === "get_window_state") {
        return {
          elements: [{ element_index: 1, role: "button", label: "设置" }],
          screenshot_png_b64: Buffer.from("fixture").toString("base64"),
          screenshot_mime_type: "image/png",
        };
      }
      return { active: true };
    },
  });
  input.end([
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: { protocolVersion: "2025-06-18" },
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/list",
    }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "computer_use",
        arguments: { action: "observe" },
      },
    }),
    "",
  ].join("\n"));
  await run;

  const responses = responseText.trim().split("\n").map(line => JSON.parse(line));
  assert.deepEqual(responses[1].result.tools, [computerUseTool]);
  assert.equal(responses[2].result.content[0].type, "text");
  assert.equal(responses[2].result.content[1].type, "image");
  assert.equal(
    responses[2].result.structuredContent.output.screenshot_png_b64,
    undefined,
  );
  assert.equal(
    responses[2].result.structuredContent.target.bundleId,
    options.targetBundleId,
  );
});
