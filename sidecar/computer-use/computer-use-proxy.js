import { execFile } from "node:child_process";
import { createConnection } from "node:net";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { computerUseSocket } from "../hostpath.js";

const execFileAsync = promisify(execFile);
const maxDriverOutputBytes = 32 << 20;
const maxTextBytes = 4 << 10;
const allowedActions = new Set(["observe", "click", "type", "key", "scroll"]);
const allowedDeliveryModes = new Set(["background", "foreground"]);
const allowedModifiers = new Set(["cmd", "shift", "option", "alt", "ctrl", "fn"]);
const allowedDirections = new Set(["up", "down", "left", "right"]);
const allowedInputFields = new Set([
  "action",
  "amount",
  "by",
  "delay_ms",
  "delivery_mode",
  "direction",
  "element_index",
  "element_token",
  "include_screenshot",
  "key",
  "max_depth",
  "max_elements",
  "modifiers",
  "query",
  "text",
  "x",
  "y",
]);

export const computerUseTool = {
  name: "computer_use",
  description:
    "Observe or interact with the one visible App window locked for this task, background-first so the "
    + "user's cursor and foreground app stay untouched. List windows with milksu_workspace "
    + "list_computer_use_windows; if several match, call milksu_ask; then lock_computer_use_window. "
    + "Observe before each action; one action consumes that snapshot. Act on the freshest observe "
    + "snapshot: prefer element_token or element_index — the driver performs the AX action in the "
    + "background with no cursor move and no focus steal. Use x, y window-local pixels only when the "
    + "target has no AX node (canvas, video, custom-drawn surface). After each action, observe again to "
    + "confirm the effect. Keep delivery_mode \"background\" unless the tool result reports the "
    + "background route unavailable or unverifiable for that one action; then retry only that action "
    + "with \"foreground\".",
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: [...allowedActions],
        description: "observe, click, type, key, or scroll.",
      },
      element_index: {
        type: "integer",
        minimum: 0,
        description:
          "Fresh element_index from the latest observe result of this window; the proxy attaches the "
          + "snapshot id the driver requires. Prefer element_token.",
      },
      element_token: {
        type: "string",
        maxLength: 512,
        description:
          "Fresh opaque element token from the latest observe result; addresses one exact snapshot "
          + "element on the background AX path (no cursor move, no focus steal).",
      },
      x: {
        type: "number",
        minimum: 0,
        description:
          "Window-local screenshot X; pixel (CUA) path, use only when the target has no AX node "
          + "(canvas, video, custom-drawn surface). Background delivery still avoids fronting when "
          + "the platform supports it.",
      },
      y: {
        type: "number",
        minimum: 0,
        description:
          "Window-local screenshot Y; pixel (CUA) path, use only when the target has no AX node "
          + "(canvas, video, custom-drawn surface). Background delivery still avoids fronting when "
          + "the platform supports it.",
      },
      text: {
        type: "string",
        maxLength: maxTextBytes,
        description: "Text for the type action.",
      },
      key: {
        type: "string",
        maxLength: 40,
        description: "Single key name for the key action.",
      },
      modifiers: {
        type: "array",
        maxItems: 4,
        uniqueItems: true,
        items: {
          type: "string",
          enum: [...allowedModifiers],
        },
      },
      direction: {
        type: "string",
        enum: [...allowedDirections],
      },
      amount: {
        type: "integer",
        minimum: 1,
        maximum: 10,
      },
      by: {
        type: "string",
        enum: ["line", "page"],
      },
      delivery_mode: {
        type: "string",
        enum: [...allowedDeliveryModes],
        description:
          "background by default: the driver performs the AX action or posts the event without "
          + "fronting the target window — no cursor move, no focus steal. foreground briefly fronts "
          + "the target window for that one action, then restores the previous frontmost app; use it "
          + "only when the tool result reports the background route unavailable or unverifiable.",
      },
      delay_ms: {
        type: "integer",
        minimum: 0,
        maximum: 100,
      },
      include_screenshot: {
        type: "boolean",
      },
      query: {
        type: "string",
        maxLength: 200,
      },
      max_elements: {
        type: "integer",
        minimum: 1,
        maximum: 500,
      },
      max_depth: {
        type: "integer",
        minimum: 1,
        maximum: 25,
      },
    },
    required: ["action"],
  },
};

function argument(argv, name) {
  const index = argv.indexOf(`--${name}`);
  return index >= 0 ? argv[index + 1] : undefined;
}

export function normalizeComputerUseProxyOptions(argv = process.argv.slice(2)) {
  const socketPath = String(argument(argv, "socket") ?? "").trim();
  const sessionId = String(argument(argv, "session") ?? "").trim();
  const targetName = String(argument(argv, "target-name") ?? "").trim();
  const targetBundleId = String(argument(argv, "target-bundle-id") ?? "").trim();
  const targetWindowId = Number(argument(argv, "target-window-id"));
  const targetPid = Number(argument(argv, "target-pid"));
  const driverPath = String(argument(argv, "driver") ?? "").trim();
  const backend = String(argument(argv, "backend") ?? "cua").trim();
  const expectedSocket = sessionId
    ? expectedComputerUseSocket(sessionId)
    : "";
  if (
    socketPath !== expectedSocket
    || socketPath.includes("\0")
  ) {
    throw new Error("MilkSU Computer Use proxy rejected the private driver socket");
  }
  if (!/^computer_[A-Za-z0-9-]{8,128}$/.test(sessionId)) {
    throw new Error("MilkSU Computer Use proxy rejected the session id");
  }
  if (!targetName || targetName.length > 120 || targetName.includes("\0")) {
    throw new Error("MilkSU Computer Use proxy rejected the target name");
  }
  if (!/^[A-Za-z0-9.-]{1,256}$/.test(targetBundleId)) {
    throw new Error("MilkSU Computer Use proxy rejected the target bundle id");
  }
  if (!Number.isSafeInteger(targetPid) || targetPid <= 1) {
    throw new Error("MilkSU Computer Use proxy rejected the target PID");
  }
  if (!Number.isSafeInteger(targetWindowId) || targetWindowId <= 0) {
    throw new Error("MilkSU Computer Use proxy rejected the target window");
  }
  if (backend !== "portal" && (!driverPath || driverPath.includes("\0"))) {
    throw new Error("MilkSU Computer Use proxy requires the reviewed driver binary");
  }
  if (backend !== "cua" && backend !== "portal") {
    throw new Error("MilkSU Computer Use proxy rejected the backend");
  }
  return {
    socketPath,
    sessionId,
    targetName,
    targetBundleId,
    targetWindowId,
    targetPid,
    driverPath,
    backend,
  };
}

export function expectedComputerUseSocket(sessionId) {
  return computerUseSocket(sessionId);
}

function rejectUnexpectedInputFields(input, expectedFields) {
  const allowed = new Set(["action", ...expectedFields]);
  for (const field of Object.keys(input)) {
    if (!allowed.has(field)) {
      throw new Error(
        `computer_use ${input.action} rejected the unrelated field ${field}`,
      );
    }
  }
}

function requireInteger(input, name, minimum, maximum) {
  if (input[name] === undefined) return undefined;
  const value = Number(input[name]);
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`computer_use ${name} must be an integer from ${minimum} to ${maximum}`);
  }
  return value;
}

function optionalCoordinates(input) {
  const hasX = input.x !== undefined;
  const hasY = input.y !== undefined;
  if (hasX !== hasY) {
    throw new Error("computer_use pixel addressing requires both x and y");
  }
  if (!hasX) return {};
  const x = Number(input.x);
  const y = Number(input.y);
  if (!Number.isFinite(x) || !Number.isFinite(y) || x < 0 || y < 0) {
    throw new Error("computer_use x and y must be non-negative window-local coordinates");
  }
  return { x, y };
}

function optionalElementAddress(input) {
  const elementIndex = requireInteger(input, "element_index", 0, 100_000);
  const elementToken = input.element_token === undefined
    ? undefined
    : String(input.element_token);
  if (elementToken !== undefined && (elementToken.length === 0 || elementToken.length > 512)) {
    throw new Error("computer_use element_token must be between 1 and 512 characters");
  }
  const coordinates = optionalCoordinates(input);
  const addressCount = Number(elementIndex !== undefined)
    + Number(elementToken !== undefined)
    + Number(coordinates.x !== undefined);
  if (addressCount > 1) {
    throw new Error("computer_use accepts one AX or pixel address per call");
  }
  return {
    ...(elementIndex === undefined ? {} : { element_index: elementIndex }),
    ...(elementToken === undefined ? {} : { element_token: elementToken }),
    ...coordinates,
  };
}

export function normalizeComputerUseInput(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("computer_use input must be an object");
  }
  for (const field of Object.keys(value)) {
    if (!allowedInputFields.has(field)) {
      throw new Error(`computer_use rejected the unsupported field ${field}`);
    }
  }
  const action = String(value.action ?? "").trim();
  if (!allowedActions.has(action)) {
    throw new Error("computer_use action must be observe, click, type, key, or scroll");
  }
  const deliveryMode = String(value.delivery_mode ?? "background");
  if (!allowedDeliveryModes.has(deliveryMode)) {
    throw new Error("computer_use delivery_mode must be background or foreground");
  }
  const address = optionalElementAddress(value);
  if (action === "observe") {
    rejectUnexpectedInputFields(
      value,
      ["include_screenshot", "max_elements", "max_depth", "query"],
    );
    const query = value.query === undefined ? undefined : String(value.query).trim();
    if (query !== undefined && query.length > 200) {
      throw new Error("computer_use query exceeds 200 characters");
    }
    return {
      action,
      include_screenshot: value.include_screenshot !== false,
      max_elements: requireInteger(value, "max_elements", 1, 500) ?? 300,
      max_depth: requireInteger(value, "max_depth", 1, 25) ?? 18,
      ...(query ? { query } : {}),
    };
  }
  if (action === "click") {
    rejectUnexpectedInputFields(
      value,
      ["delivery_mode", "element_index", "element_token", "x", "y"],
    );
    if (Object.keys(address).length === 0) {
      throw new Error("computer_use click requires a fresh element or pixel address");
    }
    return { action, delivery_mode: deliveryMode, ...address };
  }
  if (action === "type") {
    rejectUnexpectedInputFields(
      value,
      [
        "text",
        "delay_ms",
        "delivery_mode",
        "element_index",
        "element_token",
        "x",
        "y",
      ],
    );
    const text = String(value.text ?? "");
    if (!text || Buffer.byteLength(text) > maxTextBytes) {
      throw new Error(`computer_use type text must be between 1 and ${maxTextBytes} bytes`);
    }
    if (Object.keys(address).length === 0) {
      throw new Error("computer_use type requires a fresh element or pixel address");
    }
    return {
      action,
      text,
      delivery_mode: deliveryMode,
      delay_ms: requireInteger(value, "delay_ms", 0, 100) ?? 30,
      ...address,
    };
  }
  if (action === "key") {
    rejectUnexpectedInputFields(
      value,
      [
        "key",
        "modifiers",
        "delivery_mode",
        "element_index",
        "element_token",
        "x",
        "y",
      ],
    );
    const key = String(value.key ?? "").trim();
    if (!/^[A-Za-z0-9_-]{1,40}$/.test(key)) {
      throw new Error("computer_use key must be a single named key");
    }
    const modifiers = Array.isArray(value.modifiers)
      ? [...new Set(value.modifiers.map(item => String(item).trim()))]
      : [];
    if (
      modifiers.length > 4
      || modifiers.some(modifier => !allowedModifiers.has(modifier))
    ) {
      throw new Error("computer_use key contains unsupported modifiers");
    }
    return {
      action,
      key,
      modifiers,
      delivery_mode: deliveryMode,
      ...address,
    };
  }
  rejectUnexpectedInputFields(
    value,
    [
      "direction",
      "amount",
      "by",
      "delivery_mode",
      "element_index",
      "element_token",
      "x",
      "y",
    ],
  );
  const direction = String(value.direction ?? "");
  if (!allowedDirections.has(direction)) {
    throw new Error("computer_use scroll requires up, down, left, or right");
  }
  return {
    action,
    direction,
    amount: requireInteger(value, "amount", 1, 10) ?? 3,
    by: value.by === "page" ? "page" : "line",
    delivery_mode: deliveryMode,
    ...address,
  };
}

function selectTargetWindow(result, targetPid, targetWindowId) {
  const windows = Array.isArray(result?.windows)
    ? result.windows.filter(window => Number(window?.pid) === targetPid)
    : [];
  const target = windows.find(window => (
    Number(window?.window_id) === targetWindowId &&
    window?.is_on_screen !== false
  ));
  if (!target) {
    throw new Error("MilkSU Computer Use target window is no longer visible");
  }
  if (!Number.isSafeInteger(Number(target.window_id)) || Number(target.window_id) <= 0) {
    throw new Error("MilkSU Computer Use rejected an invalid target window");
  }
  return target;
}

// Normalize the driver's delivery reporting so the model can walk the
// background-first ladder: background AX -> background pixel -> foreground for
// one action. Refusals carry a code (for example snapshot_id_required or
// background_unavailable) instead of an exception.
function summarizeDelivery(input, result) {
  const summary = { requested_mode: input.delivery_mode };
  if (!result || typeof result !== "object") return summary;
  const delivery = typeof result.delivery === "object" ? result.delivery : undefined;
  if (typeof delivery?.mode === "string") summary.mode = delivery.mode;
  if (typeof result.route === "string") summary.route = result.route;
  if (typeof result.effect === "string") summary.effect = result.effect;
  if (result.status === "refused" &&
      result.refusal && typeof result.refusal === "object") {
    if (typeof result.refusal.code === "string") {
      summary.refusal = result.refusal.code;
    }
    if (typeof result.refusal.message === "string") {
      summary.refusal_detail = result.refusal.message.slice(0, 300);
    }
  }
  if (result.escalation && typeof result.escalation === "object") {
    summary.escalation = {
      ...(typeof result.escalation.reason === "string"
        ? { reason: result.escalation.reason }
        : {}),
      ...(typeof result.escalation.target === "string"
        ? { target: result.escalation.target }
        : {}),
    };
  }
  return summary;
}

export function createComputerUseExecutor(options, runTool) {
  let sessionStarted = false;
  let ended = false;
  let observedWindowId;
  let observedSnapshotId;

  async function ensureSession() {
    if (sessionStarted) return;
    await runTool("start_session", {
      session: options.sessionId,
      capture_scope: "window",
    });
    sessionStarted = true;
  }

  async function resolveWindow() {
    const result = await runTool("list_windows", {
      pid: options.targetPid,
      on_screen_only: true,
    });
    return selectTargetWindow(result, options.targetPid, options.targetWindowId);
  }

  // The driver refuses a bare element_index without its snapshot id. The proxy
  // owns the observe -> act pairing, so it attaches the tracked snapshot id
  // instead of exposing snapshot bookkeeping to the model.
  function consumeObservation(action, windowId) {
    if (observedWindowId !== Number(windowId)) {
      throw new Error(
        `computer_use requires a fresh observe of the selected target window before ${action}`,
      );
    }
    const snapshotId = observedSnapshotId;
    observedWindowId = undefined;
    observedSnapshotId = undefined;
    return snapshotId;
  }

  function addressForAction(address, snapshotId) {
    if (address.element_token !== undefined || address.x !== undefined) {
      return address;
    }
    if (address.element_index === undefined) {
      return address;
    }
    if (typeof snapshotId !== "string" || snapshotId.length === 0) {
      throw new Error(
        "computer_use AX addressing is unavailable for this window; "
        + "use x, y from the latest observe screenshot instead",
      );
    }
    return { ...address, snapshot_id: snapshotId };
  }

  return {
    async execute(rawInput) {
      if (ended) throw new Error("MilkSU Computer Use session has ended");
      const input = normalizeComputerUseInput(rawInput);
      await ensureSession();
      const targetWindow = await resolveWindow();
      const target = {
        pid: options.targetPid,
        window_id: Number(targetWindow.window_id),
        session: options.sessionId,
      };
      let tool;
      let args;
      switch (input.action) {
        case "observe":
          tool = "get_window_state";
          args = {
            ...target,
            include_screenshot: input.include_screenshot,
            max_elements: input.max_elements,
            max_depth: input.max_depth,
            ...(input.query ? { query: input.query } : {}),
          };
          break;
        case "click":
        case "type":
        case "key":
        case "scroll": {
          const snapshotId = consumeObservation(input.action, targetWindow.window_id);
          const address = addressForAction(optionalElementAddress(input), snapshotId);
          const common = {
            ...target,
            scope: "window",
            delivery_mode: input.delivery_mode,
            ...address,
          };
          if (input.action === "click") {
            tool = "click";
            args = common;
          } else if (input.action === "type") {
            tool = "type_text";
            args = { ...common, text: input.text, delay_ms: input.delay_ms };
          } else if (input.action === "key") {
            tool = "press_key";
            args = { ...common, key: input.key, modifiers: input.modifiers };
          } else {
            tool = "scroll";
            args = {
              ...common,
              direction: input.direction,
              amount: input.amount,
              by: input.by,
            };
          }
          break;
        }
        default:
          throw new Error("MilkSU Computer Use rejected an unknown action");
      }
      const result = await runTool(tool, args);
      if (input.action === "observe") {
        observedWindowId = Number(targetWindow.window_id);
        observedSnapshotId = result && typeof result.snapshot_id === "string"
          ? result.snapshot_id
          : undefined;
      }
      return {
        result,
        delivery: summarizeDelivery(input, result),
        action: input.action,
        driverTool: tool,
        target: {
          app: options.targetName,
          bundleId: options.targetBundleId,
          pid: options.targetPid,
          windowId: Number(targetWindow.window_id),
          title: String(targetWindow.title ?? ""),
        },
      };
    },

    async end() {
      if (ended) return;
      ended = true;
      if (!sessionStarted) return;
      try {
        await runTool("end_session", { session: options.sessionId });
      } catch {
        // The host daemon owns terminal cleanup; a failed best-effort end must
        // not keep the stdio server alive.
      }
    },
  };
}

export function createPortalSocketRunner(socketPath) {
  return async (tool, args) => {
    const payload = `${JSON.stringify({ tool, args: args ?? {} })}\n`;
    return await new Promise((resolve, reject) => {
      const conn = createConnection({ path: socketPath });
      let buf = "";
      const timer = setTimeout(() => {
        conn.destroy();
        reject(new Error("Linux portal Computer Use timed out"));
      }, 20_000);
      conn.setEncoding("utf8");
      conn.on("connect", () => conn.write(payload));
      conn.on("data", chunk => {
        buf += chunk;
        const index = buf.indexOf("\n");
        if (index < 0) return;
        clearTimeout(timer);
        conn.end();
        try {
          const parsed = JSON.parse(buf.slice(0, index));
          if (parsed.error) {
            reject(new Error(String(parsed.error)));
            return;
          }
          resolve(parsed.result ?? {});
        } catch (error) {
          reject(error);
        }
      });
      conn.on("error", error => {
        clearTimeout(timer);
        reject(error);
      });
    });
  };
}

export function createCuaCliRunner(options, environment = process.env) {
  return async (tool, args) => {
    const { stdout } = await execFileAsync(
      options.driverPath,
      ["call", tool, JSON.stringify(args), "--socket", options.socketPath],
      {
        env: process.platform === "win32" ? {
          SystemRoot: environment.SystemRoot ?? "C:\\Windows",
          WINDIR: environment.WINDIR ?? environment.SystemRoot ?? "C:\\Windows",
          USERPROFILE: environment.USERPROFILE,
          APPDATA: environment.APPDATA,
          LOCALAPPDATA: environment.LOCALAPPDATA,
          TEMP: environment.TEMP,
          TMP: environment.TMP,
          PATH: `${environment.SystemRoot ?? "C:\\Windows"}\\System32`,
          CUA_DRIVER_EMBEDDED: "1",
          CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
          CUA_LOG: "warn",
        } : {
          HOME: environment.HOME ?? tmpdir(),
          TMPDIR: environment.TMPDIR ?? tmpdir(),
          PATH: "/usr/bin:/bin:/usr/sbin:/sbin",
          LANG: environment.LANG ?? "en_US.UTF-8",
          CUA_DRIVER_EMBEDDED: "1",
          CUA_DRIVER_RS_TELEMETRY_ENABLED: "false",
          CUA_LOG: "warn",
        },
        encoding: "utf8",
        timeout: 20_000,
        maxBuffer: maxDriverOutputBytes,
      },
    );
    const text = String(stdout).trim();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { text };
    }
  };
}

function mcpToolResult(execution) {
  const structured = execution.result && typeof execution.result === "object"
    ? structuredClone(execution.result)
    : { text: String(execution.result ?? "") };
  const screenshot = typeof structured.screenshot_png_b64 === "string"
    ? structured.screenshot_png_b64
    : undefined;
  const mimeType = typeof structured.screenshot_mime_type === "string"
    ? structured.screenshot_mime_type
    : "image/png";
  delete structured.screenshot_png_b64;
  delete structured.screenshot_mime_type;
  const envelope = {
    action: execution.action,
    driverTool: execution.driverTool,
    target: execution.target,
    delivery: execution.delivery,
    output: structured,
  };
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(envelope, null, 2),
      },
      ...(screenshot
        ? [{ type: "image", data: screenshot, mimeType }]
        : []),
    ],
    structuredContent: envelope,
  };
}

function errorResponse(id, code, message) {
  return {
    jsonrpc: "2.0",
    id,
    error: {
      code,
      message,
    },
  };
}

export async function runComputerUseMcpServer({
  input = process.stdin,
  output = process.stdout,
  options = normalizeComputerUseProxyOptions(),
  runTool = undefined,
} = {}) {
  const executor = createComputerUseExecutor(
    options,
    runTool ?? (options.backend === "portal"
      ? createPortalSocketRunner(options.socketPath)
      : createCuaCliRunner(options)),
  );
  const lines = createInterface({ input, terminal: false });
  let queue = Promise.resolve();
  const write = value => output.write(`${JSON.stringify(value)}\n`);
  lines.on("line", (line) => {
    if (!line.trim()) return;
    queue = queue.then(async () => {
      let request;
      try {
        request = JSON.parse(line);
      } catch {
        write(errorResponse(null, -32700, "MilkSU Computer Use received invalid JSON"));
        return;
      }
      if (request.method === "notifications/initialized") return;
      if (request.method === "initialize") {
        write({
          jsonrpc: "2.0",
          id: request.id,
          result: {
            protocolVersion: request.params?.protocolVersion ?? "2025-06-18",
            capabilities: { tools: {} },
            serverInfo: {
              name: "milksu-computer-use",
              version: "1.0.0",
            },
          },
        });
        return;
      }
      if (request.method === "tools/list") {
        write({
          jsonrpc: "2.0",
          id: request.id,
          result: { tools: [computerUseTool] },
        });
        return;
      }
      if (request.method === "tools/call") {
        if (request.params?.name !== computerUseTool.name) {
          write(errorResponse(request.id, -32602, "MilkSU exposed only computer_use"));
          return;
        }
        try {
          const execution = await executor.execute(request.params?.arguments ?? {});
          write({
            jsonrpc: "2.0",
            id: request.id,
            result: mcpToolResult(execution),
          });
        } catch (error) {
          write({
            jsonrpc: "2.0",
            id: request.id,
            result: {
              isError: true,
              content: [{
                type: "text",
                text: error instanceof Error ? error.message : String(error),
              }],
            },
          });
        }
        return;
      }
      if (request.id !== undefined) {
        write(errorResponse(request.id, -32601, "MilkSU Computer Use method not found"));
      }
    }).catch(error => {
      write(errorResponse(null, -32603, error instanceof Error ? error.message : String(error)));
    });
  });
  await new Promise(resolve => lines.once("close", resolve));
  await queue;
  await executor.end();
}

export function isComputerUseProxyEntrypoint(
  argv = process.argv,
  moduleUrl = import.meta.url,
) {
  if (argv.slice(2).includes("--socket")) {
    return true;
  }
  const invokedPath = argv[1] ? resolve(argv[1]) : "";
  if (!invokedPath) return false;
  const invokedName = basename(invokedPath.replaceAll("\\", "/")).toLowerCase();
  // chat-bridge.cjs bundles this file; path equality would start the proxy
  // without --socket and fail the Linux package smoke with exit code 1.
  return invokedName === "computer-use-proxy.cjs" || invokedName === "computer-use-proxy.js";
}

if (isComputerUseProxyEntrypoint()) {
  runComputerUseMcpServer().catch(error => {
    process.stderr.write(
      `MilkSU Computer Use proxy failed: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  });
}
