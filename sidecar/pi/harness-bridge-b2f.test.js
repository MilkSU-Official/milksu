// PR-2 批次 B2f：门开路径 Computer Use 控窗两件端到端（faux provider + 真工作区
// broker + 假 cua-driver 脚本——resolvePackagedComputerUseDriver 的真解析 +
// createCuaCliRunner 的真 execFile spawn 全链路真跑，只有 driver 二进制换成按
// argv 应答的 stub）。与 harness-bridge-b2c.test.js（B2c）同构：keepProductTools=
// true，跑**真**的 milksu-computer-use 挂载。
//
// 覆盖工单验收点：
//   - 两件执行断言（prepare 的 broker 回路 + computer_use 的 observe→act 链）
//   - policy 门负向：非 go 档（plan/read-only）拒 computer_use；prepare 的
//     prepare 档拒但 status 档放行（门关逐字文案）
//   - descriptor 传递：milksu_workspace lock_computer_use_window → 会话策略
//     computerUse → executor 的 sessionId/socketPath/target*（driver argv 实证）
//   - executor 缓存：同 descriptor 复用（start_session 恰一次）、换 descriptor
//     换槽（start_session 第二次）、observe→click 的 snapshot_id 注入
//   - 文本契约：挂载面复用门关工厂（源码级）+ 注册面描述与门关定义一致

import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { fauxAssistantMessage, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createWorkspaceActionBroker } from "./bridge-workspace.js";
import {
  createComputerUseDriverExtension,
  computerUseDriverToolName,
} from "./bridge-computer-use-driver.js";
import {
  computerUseToolName,
  createComputerUseToolExtension,
} from "./bridge-computer-use-tool.js";
import {
  buildTestLayer,
  makeFauxModels,
  waitForEvent,
} from "./harness-bridge-test-support.mjs";
import { MILKSU_COMPUTER_USE_EXTENSION } from "./harness-bridge-computer-use.js";
import { collectExtensionToolDefinitions } from "./harness-bridge-daily-tools.js";

const originalCwd = process.cwd();
const here = dirname(fileURLToPath(import.meta.url));
const computerUseModulePath = join(here, "harness-bridge-computer-use.js");

const goCommand = {
  provider: "faux",
  model: "faux-1",
  locale: "zh",
  executionMode: "go",
  approvalPolicy: "ask",
};

/** 门关工厂的直接收集壳（单测断言用——与挂载面同一收集路径）。 */
function gateClosedDefinitions(conversationId, policy) {
  const requests = [];
  const requestAction = async request => {
    requests.push(request);
    return JSON.stringify({ ready: true, source: "already", version: "0.29.1" });
  };
  const driverTools = collectExtensionToolDefinitions(
    createComputerUseDriverExtension(conversationId, () => policy, requestAction),
  );
  const computerUseTools = collectExtensionToolDefinitions(
    createComputerUseToolExtension(() => policy),
  );
  const byName = new Map(
    [...driverTools, ...computerUseTools].map(definition => [definition.name, definition]),
  );
  return { byName, requests };
}

/**
 * 假 cua-driver：按 argv（call <tool> <json> --socket <path>）应答固定 JSON，把
 * 每次调用记进日志。MILKSU_SIDECAR_DIR 指向它的目录——
 * resolvePackagedComputerUseDriver 的真解析（候选序/非符号链接校验）与
 * createCuaCliRunner 的真 execFile spawn（argv/受限 env/stdout JSON 解析）全部
 * 真跑；只有 driver 二进制换成 stub。
 */
async function installFakeDriver(root) {
  const sidecarDir = join(root, "fake-sidecar");
  const logPath = join(root, "driver-calls.log");
  await mkdir(sidecarDir, { recursive: true });
  await writeFile(logPath, "", { mode: 0o600 });
  const driverPath = join(sidecarDir, "cua-driver");
  await writeFile(driverPath, [
    "#!/bin/sh",
    `printf '%s\\t%s\\n' "$2" "$3" >> ${JSON.stringify(logPath)}`,
    "case \"$2\" in",
    "  start_session) echo '{\"ok\":true}';;",
    "  list_windows) echo '{\"windows\":[{\"window_id\":421,\"pid\":1234,\"is_on_screen\":true,\"title\":\"Notes\"}]}';;",
    "  get_window_state) echo '{\"snapshot_id\":\"snap-1\",\"elements\":[],\"delivery\":{\"mode\":\"background\"}}';;",
    "  click) echo '{\"delivery\":{\"mode\":\"background\"},\"route\":\"ax\",\"effect\":\"clicked\"}';;",
    "  end_session) echo '{\"ok\":true}';;",
    "  *) echo '{\"ok\":true}';;",
    "esac",
    "",
  ].join("\n"));
  await chmod(driverPath, 0o755);
  return { sidecarDir, logPath, driverPath };
}

async function withComputerUseFixture(run, options = {}) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-b2f-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const fakeDriver = options.fakeDriver ? await installFakeDriver(root) : undefined;
  const previousSidecarDir = process.env.MILKSU_SIDECAR_DIR;
  if (fakeDriver) process.env.MILKSU_SIDECAR_DIR = fakeDriver.sidecarDir;
  process.chdir(workspace);
  const { faux, models } = makeFauxModels();
  const { layer, events, emit, maps, approvalBroker } = buildTestLayer({
    agentDir,
    workspace,
    faux,
    models,
    keepProductTools: true,
    ...options,
  });
  async function driverLog() {
    return (await readFile(fakeDriver.logPath, "utf8")).trim()
      .split("\n").filter(Boolean);
  }
  try {
    return await run({
      layer, events, emit, maps, faux, models, workspace, root, approvalBroker,
      driverLog,
    });
  } finally {
    await layer.disposeAll();
    process.chdir(originalCwd);
    if (fakeDriver) {
      if (previousSidecarDir === undefined) delete process.env.MILKSU_SIDECAR_DIR;
      else process.env.MILKSU_SIDECAR_DIR = previousSidecarDir;
    }
    await rm(root, { recursive: true, force: true });
  }
}

const lockDescriptor = {
  sessionId: "computer_testsession01",
  socketPath: "/tmp/milksu-computer-use/mcu-testsession01.sock",
  targetBundleId: "com.apple.TextEdit",
  targetName: "TextEdit",
  targetPid: 1234,
  targetWindowId: 421,
};

const secondLockDescriptor = {
  ...lockDescriptor,
  sessionId: "computer_testsession02",
  socketPath: "/tmp/milksu-computer-use/mcu-testsession02.sock",
};

function lockResponse(descriptor) {
  return JSON.stringify({
    locked: true,
    status: { phase: "ready" },
    descriptor,
  });
}

// ---------- 单元：policy 门逐字 + prepare 的 broker 回路 ----------

test("prepare_computer_use_driver gates only the prepare action verbatim", async () => {
  // plan 档 + prepare：门关逐字文案，零 broker 请求。
  const plan = gateClosedDefinitions("conv-unit", {
    executionMode: "plan",
    approvalPolicy: "workspace-auto",
  });
  await assert.rejects(
    () => plan.byName.get(computerUseDriverToolName).execute("c1", { action: "prepare" }),
    /Plan 或只读策略不能准备 Computer Use Driver。先查看 status。/,
  );
  assert.equal(plan.requests.length, 0);

  // go + read-only + prepare：同文案拒（门关只看 executionMode/approvalPolicy）。
  const readOnly = gateClosedDefinitions("conv-unit", {
    executionMode: "go",
    approvalPolicy: "read-only",
  });
  await assert.rejects(
    () => readOnly.byName.get(computerUseDriverToolName).execute("c1", { action: "prepare" }),
    /Plan 或只读策略不能准备 Computer Use Driver/,
  );
  assert.equal(readOnly.requests.length, 0);

  // plan 档 + status：放行（status 是纯查询，任何档可查——execute 级门只拦 prepare）。
  const status = gateClosedDefinitions("conv-unit", {
    executionMode: "plan",
    approvalPolicy: "read-only",
  });
  const statusResult = await status.byName.get(computerUseDriverToolName)
    .execute("c1", { action: "status" });
  assert.equal(status.requests.length, 1);
  // 门关映射：input 带的是桌面侧动作名（不是工具参数原值）。
  assert.deepEqual(status.requests[0], {
    conversationId: "conv-unit",
    action: "computer_use_driver_status",
    input: { action: "computer_use_driver_status" },
  });
  assert.deepEqual(statusResult.content, [{
    type: "text",
    text: JSON.stringify({ ready: true, source: "already", version: "0.29.1" }),
  }]);
});

test("prepare_computer_use_driver maps prepare to the desktop action with a fallback text", async () => {
  const requests = [];
  const [definition] = collectExtensionToolDefinitions(
    createComputerUseDriverExtension(
      "conv-unit",
      () => ({ executionMode: "go", approvalPolicy: "workspace-auto" }),
      async request => {
        requests.push(request);
        return "";
      },
    ),
  );
  // 空回包：门关 `${action} completed` 兜底文案（action 是桌面侧动作名；input 同）。
  const result = await definition.execute("c1", { action: "prepare" });
  assert.deepEqual(requests[0], {
    conversationId: "conv-unit",
    action: "prepare_computer_use_driver",
    input: { action: "prepare_computer_use_driver" },
  });
  assert.deepEqual(result.content, [{
    type: "text",
    text: "prepare_computer_use_driver completed",
  }]);
});

test("computer_use keeps the gate-closed gate texts for plan mode and missing locks", async () => {
  const plan = gateClosedDefinitions("conv-unit", {
    executionMode: "plan",
    approvalPolicy: "workspace-auto",
  });
  await assert.rejects(
    () => plan.byName.get(computerUseToolName).execute("c1", { action: "observe" }),
    /Plan 或只读策略不能操作桌面窗口。/,
  );

  const unlocked = gateClosedDefinitions("conv-unit", {
    executionMode: "go",
    approvalPolicy: "ask",
  });
  await assert.rejects(
    () => unlocked.byName.get(computerUseToolName).execute("c1", { action: "observe" }),
    /No window is locked\. Call milksu_workspace list_computer_use_windows, use milksu_ask if several match, then lock_computer_use_window\./,
  );
  // 半 descriptor（有 sessionId 无 socketPath）同拒——门关两字段都要求。
  const halfLocked = gateClosedDefinitions("conv-unit", {
    executionMode: "go",
    approvalPolicy: "ask",
    computerUse: { sessionId: "computer_x", socketPath: "" },
  });
  await assert.rejects(
    () => halfLocked.byName.get(computerUseToolName).execute("c1", { action: "observe" }),
    /No window is locked/,
  );
});

// ---------- E2E：锁窗 → observe → click 全链路（真 broker + 真 execFile 假 driver） ----------

test("computer_use locks, observes, and clicks through the real broker and driver chain", async () => {
  const requests = [];
  const broker = createWorkspaceActionBroker((conversationId, type, data) => {
    if (type === "workspace_action") requests.push({ conversationId, ...data });
  });
  await withComputerUseFixture(async ({ layer, events, faux, driverLog }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-cu" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("milksu_workspace", {
          action: "lock_computer_use_window",
          targetPid: lockDescriptor.targetPid,
          targetWindowId: lockDescriptor.targetWindowId,
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("computer_use", { action: "observe", max_elements: 40 })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("computer_use", { action: "click", element_index: 0 })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    const sending = layer.sendMessage({
      ...goCommand, conversationId: "conv-cu", prompt: "lock and click",
    });
    // 锁窗请求 → 桌面回包带 descriptor（门关 Go 侧 StartCodingComputerUse 的形状）。
    await new Promise(resolveWait => {
      const timer = setInterval(() => {
        if (requests.some(request => request.action === "lock_computer_use_window")) {
          clearInterval(timer);
          resolveWait();
        }
      }, 20);
    });
    broker.respond({
      requestId: requests.find(
        request => request.action === "lock_computer_use_window",
      ).requestId,
      ok: true,
      result: lockResponse(lockDescriptor),
    });
    await sending;
    await waitForEvent(events, "turn_settled");

    const toolEnds = events.filter(
      event => event.type === "tool_call_end"
        && (event.toolName === "computer_use" || event.toolName === "milksu_workspace"),
    );
    assert.equal(toolEnds.length, 3);
    assert.equal(toolEnds.every(entry => entry.isError === false), true);

    // driver 日志：真 execFile 链路的 argv 实证（descriptor 逐字段流转 +
    // observe→click 的 snapshot_id 注入；resolveWindow 在每次执行前重验目标窗）。
    assert.deepEqual(await driverLog(), [
      `start_session\t${JSON.stringify({
        session: lockDescriptor.sessionId,
        capture_scope: "window",
      })}`,
      `list_windows\t${JSON.stringify({
        pid: lockDescriptor.targetPid,
        on_screen_only: true,
      })}`,
      `get_window_state\t${JSON.stringify({
        pid: lockDescriptor.targetPid,
        window_id: lockDescriptor.targetWindowId,
        session: lockDescriptor.sessionId,
        include_screenshot: true,
        max_elements: 40,
        max_depth: 18,
      })}`,
      `list_windows\t${JSON.stringify({
        pid: lockDescriptor.targetPid,
        on_screen_only: true,
      })}`,
      `click\t${JSON.stringify({
        pid: lockDescriptor.targetPid,
        window_id: lockDescriptor.targetWindowId,
        session: lockDescriptor.sessionId,
        scope: "window",
        delivery_mode: "background",
        element_index: 0,
        snapshot_id: "snap-1",
      })}`,
    ]);

    // 工具结果：门关 JSON 序列化形状（result/delivery/action/driverTool/target）。
    const observe = JSON.parse(toolEnds[1].content);
    assert.equal(observe.action, "observe");
    assert.equal(observe.driverTool, "get_window_state");
    assert.deepEqual(observe.target, {
      app: lockDescriptor.targetName,
      bundleId: lockDescriptor.targetBundleId,
      pid: lockDescriptor.targetPid,
      windowId: lockDescriptor.targetWindowId,
      title: "Notes",
    });
    assert.equal(observe.delivery.requested_mode, undefined);
    assert.equal(observe.delivery.mode, "background");
    const click = JSON.parse(toolEnds[2].content);
    assert.equal(click.action, "click");
    assert.equal(click.driverTool, "click");
    assert.equal(click.delivery.requested_mode, "background");
    assert.equal(click.delivery.mode, "background");
  }, { workspaceActionBroker: broker, fakeDriver: true });
});

test("the executor cache reuses one driver session and swaps slots on relock", async () => {
  const requests = [];
  const broker = createWorkspaceActionBroker((conversationId, type, data) => {
    if (type === "workspace_action") requests.push({ conversationId, ...data });
  });
  await withComputerUseFixture(async ({ layer, events, faux, driverLog }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-cache" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("milksu_workspace", {
          action: "lock_computer_use_window",
          targetPid: lockDescriptor.targetPid,
          targetWindowId: lockDescriptor.targetWindowId,
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("computer_use", { action: "observe" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("computer_use", { action: "click", element_index: 0 })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("computer_use", { action: "observe" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("milksu_workspace", {
          action: "lock_computer_use_window",
          targetPid: lockDescriptor.targetPid,
          targetWindowId: lockDescriptor.targetWindowId,
        })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("computer_use", { action: "observe" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    const sending = layer.sendMessage({
      ...goCommand, conversationId: "conv-cache", prompt: "lock twice",
    });
    // 两次锁窗请求按到达顺序回包：第一次原 descriptor，第二次换 sessionId。
    let responded = 0;
    await new Promise(resolveWait => {
      const timer = setInterval(() => {
        const lockRequests = requests.filter(
          request => request.action === "lock_computer_use_window",
        );
        while (responded < lockRequests.length && responded < 2) {
          const descriptor = responded === 0 ? lockDescriptor : secondLockDescriptor;
          broker.respond({
            requestId: lockRequests[responded].requestId,
            ok: true,
            result: lockResponse(descriptor),
          });
          responded += 1;
        }
        if (responded === 2) {
          clearInterval(timer);
          resolveWait();
        }
      }, 20);
    });
    await sending;
    await waitForEvent(events, "turn_settled");

    const log = await driverLog();
    const startSessions = log.filter(line => line.startsWith("start_session\t"));
    // 同 descriptor 的 observe/click/observe 复用同一 executor（start_session 恰
    // 一次）；重锁（新 sessionId）换槽（第二次 start_session）。
    assert.equal(startSessions.length, 2);
    assert.equal(
      JSON.parse(startSessions[0].split("\t")[1]).session,
      lockDescriptor.sessionId,
    );
    assert.equal(
      JSON.parse(startSessions[1].split("\t")[1]).session,
      secondLockDescriptor.sessionId,
    );
    // 换槽前 click 的 observe→act 配对仍在（snapshot_id 注入）。
    const clicks = log.filter(line => line.startsWith("click\t"));
    assert.equal(clicks.length, 1);
    assert.equal(JSON.parse(clicks[0].split("\t")[1]).snapshot_id, "snap-1");
    // 所有工具零错。
    const toolEnds = events.filter(event => event.type === "tool_call_end");
    assert.equal(toolEnds.every(entry => entry.isError === false), true);
  }, { workspaceActionBroker: broker, fakeDriver: true });
});

test("computer_use without a lock reports the gate-closed guidance as a tool error", async () => {
  await withComputerUseFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-nolock" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("computer_use", { action: "observe" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    await layer.sendMessage({
      ...goCommand, conversationId: "conv-nolock", prompt: "observe",
    });
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "computer_use"))[0];
    assert.equal(toolEnd.isError, true);
    assert.match(toolEnd.content, /No window is locked/);
  });
});

// ---------- E2E：policy 门负向（plan 档） ----------

test("plan sessions keep the window tools off the mounted surface", async () => {
  await withComputerUseFixture(async ({ layer, events }) => {
    await layer.createSession({
      ...goCommand,
      executionMode: "plan",
      conversationId: "conv-plan",
    });
    const ready = (await waitForEvent(events, "ready"))[0];
    assert.equal(ready.tools.includes("computer_use"), false,
      "plan mode must not configure computer_use");
    assert.equal(ready.tools.includes("prepare_computer_use_driver"), false,
      "plan mode must not configure prepare_computer_use_driver");
  });
});

test("plan mode with the tools force-mounted still hits the execute-level gates", async () => {
  await withComputerUseFixture(async ({ layer, events, faux }) => {
    await layer.createSession({
      ...goCommand,
      executionMode: "plan",
      conversationId: "conv-plan-gate",
    });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("computer_use", { action: "observe" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("prepare_computer_use_driver", { action: "prepare" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        [fauxToolCall("prepare_computer_use_driver", { action: "status" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    await layer.sendMessage({
      ...goCommand, executionMode: "plan", conversationId: "conv-plan-gate",
      prompt: "try anyway",
    });
    await waitForEvent(events, "turn_settled");
    const ends = events.filter(event => event.type === "tool_call_end");
    const computerUseEnd = ends.find(event => event.toolName === "computer_use");
    assert.equal(computerUseEnd.isError, true);
    assert.match(computerUseEnd.content, /Plan 或只读策略不能操作桌面窗口。/);
    // prepare 档被拦（plan，逐字），status 档放行到 broker（空回包 → `${action}
    // completed` 兜底文案——门关 falsy result 分支）。
    const prepareEnds = ends.filter(
      event => event.toolName === "prepare_computer_use_driver",
    );
    assert.equal(prepareEnds.length, 2);
    assert.equal(prepareEnds[0].isError, true);
    assert.match(
      prepareEnds[0].content,
      /Plan 或只读策略不能准备 Computer Use Driver。先查看 status。/,
    );
    assert.equal(prepareEnds[1].isError, false);
    assert.match(prepareEnds[1].content, /computer_use_driver_status completed/);
  }, {
    extraActiveToolNames: ["computer_use", "prepare_computer_use_driver"],
    workspaceActionBroker: {
      request: async () => "",
      cancelConversation: () => undefined,
    },
  });
});

// ---------- E2E：prepare 的 broker 回路（go 档真回包） ----------

test("prepare_computer_use_driver round-trips the desktop status through the real broker", async () => {
  const requests = [];
  const broker = createWorkspaceActionBroker((conversationId, type, data) => {
    if (type === "workspace_action") requests.push({ conversationId, ...data });
  });
  await withComputerUseFixture(async ({ layer, events, faux }) => {
    await layer.createSession({ ...goCommand, conversationId: "conv-prepare" });
    faux.setResponses([
      fauxAssistantMessage(
        [fauxToolCall("prepare_computer_use_driver", { action: "status" })],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("done"),
    ]);
    const sending = layer.sendMessage({
      ...goCommand, conversationId: "conv-prepare", prompt: "check driver",
    });
    await new Promise(resolveWait => {
      const timer = setInterval(() => {
        if (requests.length > 0) {
          clearInterval(timer);
          resolveWait();
        }
      }, 20);
    });
    broker.respond({
      requestId: requests[0].requestId,
      ok: true,
      result: JSON.stringify({
        ready: true,
        source: "already",
        path: "/opt/cua-driver",
        version: "0.29.1",
      }),
    });
    await sending;
    await waitForEvent(events, "turn_settled");
    const toolEnd = (await waitForEvent(events, "tool_call_end",
      event => event.toolName === "prepare_computer_use_driver"))[0];
    assert.equal(toolEnd.isError, false);
    assert.equal(requests[0].action, "computer_use_driver_status");
    assert.equal(requests[0].conversationId, "conv-prepare");
    assert.deepEqual(JSON.parse(toolEnd.content), {
      ready: true,
      source: "already",
      path: "/opt/cua-driver",
      version: "0.29.1",
    });
  }, { workspaceActionBroker: broker });
});

// ---------- 文本契约：挂载面复用门关工厂 + 注册面一致 ----------

test("the mounted surface reuses the gate-closed factories and definition strings verbatim", async () => {
  const moduleSource = await readFile(computerUseModulePath, "utf8");
  // 执行面来自门关工厂（collectExtensionToolDefinitions 收集），不是第二实现。
  for (const marker of [
    "from \"./bridge-computer-use-driver.js\"",
    "from \"./bridge-computer-use-tool.js\"",
  ]) {
    assert.ok(
      moduleSource.includes(marker),
      `the mount must import the gate-closed factory: ${marker}`,
    );
  }
  assert.ok(moduleSource.includes(`"${MILKSU_COMPUTER_USE_EXTENSION}"`));
  // 注册面（描述）：门关定义串锚点（挂载面原型从同一工厂收集，逐字同源）。
  const gateClosed = gateClosedDefinitions("conv-contract", {
    executionMode: "go",
    approvalPolicy: "ask",
  });
  assert.match(
    gateClosed.byName.get(computerUseToolName).description,
    /Observe or click one visible desktop window after it is locked/,
  );
  assert.match(
    gateClosed.byName.get(computerUseDriverToolName).description,
    /Never install Cua from cua\.ai or install\.ps1/,
  );
});
