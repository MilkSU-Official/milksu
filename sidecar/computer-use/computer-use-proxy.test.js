import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";
import {
  computerUseKeyAliases,
  computerUseTool,
  createComputerUseExecutor,
  expectedComputerUseSocket,
  isComputerUseProxyEntrypoint,
  normalizeComputerUseInput,
  normalizeComputerUseProxyOptions,
  runComputerUseMcpServer,
} from "./computer-use-proxy.js";

const options = {
  socketPath: expectedComputerUseSocket("computer_12345678"),
  sessionId: "computer_12345678",
  targetName: "Codex",
  targetBundleId: "com.openai.codex",
  targetPid: 4242,
  targetWindowId: 42,
  driverPath: "/reviewed/cua-driver",
  backend: "cua",
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
      expectedComputerUseSocket("computer_other"),
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

test("starts the MCP server from --socket even when argv path casing differs", () => {
  assert.equal(
    isComputerUseProxyEntrypoint(
      ["node", "C:\\Program Files\\MilkSU\\computer-use-proxy.cjs", "--socket", "\\\\.\\pipe\\milksu"],
      "file:///c:/other/computer-use-proxy.js",
    ),
    true,
  );
  assert.equal(
    isComputerUseProxyEntrypoint(
      ["node", "C:\\Program Files\\MilkSU\\computer-use-proxy.cjs"],
      "file:///c:/other/computer-use-proxy.js",
    ),
    true,
  );
  assert.equal(
    isComputerUseProxyEntrypoint(
      ["node", "/opt/MilkSU/chat-bridge.cjs"],
      "file:///opt/MilkSU/chat-bridge.cjs",
    ),
    false,
  );
  assert.equal(
    isComputerUseProxyEntrypoint(
      ["node", "/opt/MilkSU/computer-use-proxy.cjs"],
      "file:///opt/MilkSU/computer-use-proxy.cjs",
    ),
    true,
  );
});

test("describes a locked external app scope instead of MilkSU self-only scope", () => {
  assert.match(computerUseTool.description, /visible App window locked for this task/);
  assert.doesNotMatch(computerUseTool.description, /MilkSU application window/);
  assert.match(computerUseTool.description, /list_computer_use_windows/);
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
    if (name === "get_window_state") {
      return { snapshot_id: "s00000001", elements: [] };
    }
    return { verified: true };
  });

  // Without a prior observe the proxy silently refreshes the snapshot once
  // and runs the act (CU v2 §3.7-3) instead of bouncing a fresh-observe error
  // back to the model (audit D7: four wasted round trips).
  const autoFresh = await executor.execute({
    action: "click",
    element_index: 7,
  });
  assert.equal(autoFresh.action, "click");
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
      name: "click",
      args: {
        pid: options.targetPid,
        window_id: options.targetWindowId,
        session: options.sessionId,
        scope: "window",
        delivery_mode: "background",
        element_index: 7,
        snapshot_id: "s00000001",
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
        snapshot_id: "s00000001",
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
  assert.deepEqual(result.delivery, { requested_mode: "background" });
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

test("normalizes key aliases onto the driver's lowercase key names", () => {
  // The pinned driver 0.38.0 accepts lowercase `return` (not `Enter`); audit
  // D4 burned minutes on `Return` rejected and Enter/ENTER retried. Every
  // spelling the model sends must reach press_key as the same canonical name.
  assert.equal(computerUseKeyAliases.enter, "return");
  assert.equal(computerUseKeyAliases["\u21b5"], "return");
  for (const spelling of ["return", "Return", "enter", "Enter", "ENTER", "\u21b5"]) {
    assert.deepEqual(
      normalizeComputerUseInput({ action: "key", key: spelling }),
      {
        action: "key",
        key: "return",
        modifiers: [],
        delivery_mode: "background",
      },
    );
  }
  // Unknown names still pass through for the driver to judge (f1-f12,
  // letters, digits, arrows), lowercased.
  assert.deepEqual(
    normalizeComputerUseInput({ action: "key", key: "F5" }),
    { action: "key", key: "f5", modifiers: [], delivery_mode: "background" },
  );
  assert.deepEqual(
    normalizeComputerUseInput({ action: "key", key: "Escape" }),
    { action: "key", key: "escape", modifiers: [], delivery_mode: "background" },
  );
  // Modifier aliases collapse onto the driver's modifier table.
  assert.deepEqual(
    normalizeComputerUseInput({
      action: "key",
      key: "Return",
      modifiers: ["Cmd", "command", "Meta"],
    }),
    { action: "key", key: "return", modifiers: ["cmd"], delivery_mode: "background" },
  );
  assert.deepEqual(
    normalizeComputerUseInput({ action: "key", key: "a", modifiers: ["Control"] }),
    { action: "key", key: "a", modifiers: ["ctrl"], delivery_mode: "background" },
  );
  // Unsupported modifiers stay rejected after normalization.
  assert.throws(
    () => normalizeComputerUseInput({
      action: "key",
      key: "return",
      modifiers: ["hyper"],
    }),
    /unsupported modifiers/,
  );
});

test("consecutive acts without a manual observe never report a stale snapshot", async () => {
  const calls = [];
  let snapshots = 0;
  const executor = createComputerUseExecutor(options, async (name, args) => {
    calls.push({ name, args });
    if (name === "list_windows") {
      return {
        windows: [{
          pid: options.targetPid,
          window_id: options.targetWindowId,
          title: "Codex",
          is_on_screen: true,
        }],
      };
    }
    if (name === "get_window_state") {
      snapshots += 1;
      return { snapshot_id: `s-auto-${snapshots}`, elements: [] };
    }
    return { ok: true };
  });

  // The P1 bar: five acts in a row, no manual observe between them, no
  // "requires a fresh observe" error. Each act refreshes its own snapshot.
  for (let index = 1; index <= 5; index += 1) {
    const acted = await executor.execute({ action: "click", element_index: index });
    assert.equal(acted.action, "click");
  }
  const refreshes = calls.filter(call => call.name === "get_window_state");
  assert.equal(refreshes.length, 5);
  assert.ok(refreshes.every(call => call.args.include_screenshot === false));
  const clicks = calls.filter(call => call.name === "click");
  assert.deepEqual(
    clicks.map(call => call.args.snapshot_id),
    ["s-auto-1", "s-auto-2", "s-auto-3", "s-auto-4", "s-auto-5"],
  );
  await executor.end();
});

test("a snapshot refresh that cannot produce a token surfaces the act error", async () => {
  const refreshes = [];
  const executor = createComputerUseExecutor(options, async (name) => {
    if (name === "list_windows") {
      return {
        windows: [{
          pid: options.targetPid,
          window_id: options.targetWindowId,
          title: "Codex",
          is_on_screen: true,
        }],
      };
    }
    if (name === "get_window_state") {
      refreshes.push(name);
      // Degraded observe: no snapshot id at all.
      return { degraded_reason: "ax_window_unresolved", elements: [] };
    }
    return {};
  });
  // The one refresh happens, the retry still cannot address the element, and
  // the original addressing error (not a loop, not a fresh-observe bounce)
  // reaches the model.
  await assert.rejects(
    executor.execute({ action: "click", element_index: 4 }),
    /AX addressing is unavailable/,
  );
  assert.equal(refreshes.length, 1);
  await executor.end();
});

test("element_token addresses the driver without a proxy snapshot id", async () => {
  const calls = [];
  const executor = createComputerUseExecutor(options, async (name, args) => {
    calls.push({ name, args });
    if (name === "list_windows") {
      return {
        windows: [{
          pid: options.targetPid,
          window_id: options.targetWindowId,
          title: "Codex",
          is_on_screen: true,
        }],
      };
    }
    if (name === "get_window_state") {
      return { snapshot_id: "s00000002", elements: [] };
    }
    return { delivery: { mode: "background" }, route: "ax_action", effect: "confirmed" };
  });
  await executor.execute({ action: "observe", include_screenshot: false });
  const result = await executor.execute({
    action: "click",
    element_token: "s00000002:3",
  });
  const click = calls.find(call => call.name === "click");
  assert.deepEqual(click.args, {
    pid: options.targetPid,
    window_id: options.targetWindowId,
    session: options.sessionId,
    scope: "window",
    delivery_mode: "background",
    element_token: "s00000002:3",
  });
  assert.deepEqual(result.delivery, {
    requested_mode: "background",
    mode: "background",
    route: "ax_action",
    effect: "confirmed",
  });
  await executor.end();
});

test("element_index without an AX snapshot points the model at pixel addressing", async () => {
  const executor = createComputerUseExecutor(options, async (name) => {
    if (name === "list_windows") {
      return {
        windows: [{
          pid: options.targetPid,
          window_id: options.targetWindowId,
          title: "Codex",
          is_on_screen: true,
        }],
      };
    }
    if (name === "get_window_state") {
      return { degraded_reason: "ax_window_unresolved", elements: [] };
    }
    return {};
  });
  await executor.execute({ action: "observe", include_screenshot: false });
  await assert.rejects(
    executor.execute({ action: "click", element_index: 4 }),
    /AX addressing is unavailable.*x, y/s,
  );
  await executor.end();
});

test("driver refusals and escalation hints surface in the delivery summary", async () => {
  const executor = createComputerUseExecutor(options, async (name) => {
    if (name === "list_windows") {
      return {
        windows: [{
          pid: options.targetPid,
          window_id: options.targetWindowId,
          title: "Codex",
          is_on_screen: true,
        }],
      };
    }
    if (name === "get_window_state") {
      return { snapshot_id: "s00000003", elements: [] };
    }
    if (name === "type_text") {
      return {
        delivery: { mode: "background" },
        route: "synthetic_events",
        effect: "unverifiable",
        escalation: { reason: "delivery_failed", target: "foreground" },
      };
    }
    return {
      status: "refused",
      refusal: { code: "background_unavailable", message: "post dropped" },
    };
  });
  await executor.execute({ action: "observe", include_screenshot: false });
  const typed = await executor.execute({
    action: "type",
    element_index: 1,
    text: "hi",
  });
  assert.deepEqual(typed.delivery, {
    requested_mode: "background",
    mode: "background",
    route: "synthetic_events",
    effect: "unverifiable",
    escalation: { reason: "delivery_failed", target: "foreground" },
  });
  await executor.execute({ action: "observe", include_screenshot: false });
  const refused = await executor.execute({ action: "click", element_index: 1 });
  assert.deepEqual(refused.delivery, {
    requested_mode: "background",
    refusal: "background_unavailable",
    refusal_detail: "post dropped",
  });
  await executor.end();
});

test("tool description teaches the background-first ladder", () => {
  assert.match(computerUseTool.description, /background-first/);
  assert.match(computerUseTool.description, /element_token or element_index/);
  assert.match(computerUseTool.description, /no cursor move and no focus steal/);
  assert.match(computerUseTool.description, /x, y window-local pixels only when the target has no AX node/);
  assert.doesNotMatch(computerUseTool.description, /one action consumes that snapshot\.$/);
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
