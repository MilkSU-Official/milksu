import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, rm, stat, utimes, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRegistry, defineExtension, defineTool } from "@earendil-works/pi-durable";
import { Type } from "@earendil-works/pi-ai";
import { fauxAssistantMessage, fauxProvider, fauxToolCall } from "@earendil-works/pi-ai/providers/faux";
import { createModels } from "@earendil-works/pi-ai/models";
import {
  HARNESS_ENABLE_ENV,
  HARNESS_LOCK_FILE,
  HARNESS_LOCK_HELD_CODE,
  HarnessLockHeldError,
  acquireHarnessLock,
  harnessLockPath,
  harnessStoragePath,
  isPiHarnessEnabled,
  openMilkSUHarness,
  resolveHarnessAgentDir,
} from "./harness-adapter.js";

function makeFauxModels() {
  const faux = fauxProvider();
  const models = createModels();
  models.setProvider(faux.provider);
  return { faux, models };
}

function slowTouchTool({ workspace, replay }) {
  return defineTool({
    name: "slow_touch",
    description: "append exec log, write side effect, sleep",
    parameters: Type.Object({ path: Type.String(), ms: Type.Number() }),
    ...(replay ? { replay } : {}),
    async execute(args, api) {
      api.output(`touching ${args.path}\n`);
      await writeFile(join(workspace, "exec-log.txt"), `${Date.now()}\n`, { flag: "a" });
      await writeFile(join(workspace, args.path), `${Date.now()}\n`);
      await new Promise(resolve => setTimeout(resolve, args.ms));
      api.output("done\n");
      return {};
    },
  });
}

function registryWithSlowTouch({ workspace, replay }) {
  const registry = createRegistry();
  registry.install(defineExtension({
    name: "milksu-harness-adapter-test",
    tools: [slowTouchTool({ workspace, replay })],
  }));
  return registry;
}

async function withTempAgentDir(run) {
  const root = await mkdtemp(join(tmpdir(), "milksu-harness-adapter-"));
  const agentDir = join(root, "agent");
  const workspace = join(root, "workspace");
  await mkdir(join(agentDir, "harness"), { recursive: true });
  await mkdir(workspace, { recursive: true });
  try {
    return await run({ root, agentDir, workspace });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

test("enable gate defaults to off and only accepts the explicit value", () => {
  assert.equal(isPiHarnessEnabled(), false);
  assert.equal(isPiHarnessEnabled({}), false);
  assert.equal(isPiHarnessEnabled({ [HARNESS_ENABLE_ENV]: "" }), false);
  assert.equal(isPiHarnessEnabled({ [HARNESS_ENABLE_ENV]: "0" }), false);
  assert.equal(isPiHarnessEnabled({ [HARNESS_ENABLE_ENV]: "true" }), false);
  assert.equal(isPiHarnessEnabled({ [HARNESS_ENABLE_ENV]: "1" }), true);
});

test("agentDir resolution mirrors the bridge convention", () => {
  assert.equal(
    resolveHarnessAgentDir({ MILKSU_PI_AGENT_DIR: "/tmp/agent-home/pi" }),
    "/tmp/agent-home/pi",
  );
  assert.equal(resolveHarnessAgentDir({}, "/ws"), join("/ws", ".milksu", "pi"));
  assert.equal(harnessStoragePath("/agent"), join("/agent", "harness", "harness.sqlite"));
  assert.equal(harnessLockPath("/agent"), join("/agent", "harness", HARNESS_LOCK_FILE));
});

test("lock acquire/release and second-acquire rejection", async () => {
  await withTempAgentDir(async ({ agentDir }) => {
    const storageDir = join(agentDir, "harness");
    const first = await acquireHarnessLock(storageDir, { heartbeatMs: 50, settleMs: 5 });
    try {
      assert.equal(first.holder.pid, process.pid);
      assert.ok(first.heartbeatState().beats >= 1, "first heartbeat beat completes before return");

      await assert.rejects(
        () => acquireHarnessLock(storageDir, { heartbeatMs: 50, settleMs: 5 }),
        error => {
          assert.ok(error instanceof HarnessLockHeldError);
          assert.equal(error.code, HARNESS_LOCK_HELD_CODE);
          assert.equal(error.detail.holder.pid, process.pid);
          return true;
        },
      );
    } finally {
      await first.release();
    }
    await first.release(); // idempotent
    const second = await acquireHarnessLock(storageDir, { heartbeatMs: 50, settleMs: 5 });
    await second.release();
  });
});

test("lock steal: stale mtime and dead holder are both acquirable", async () => {
  await withTempAgentDir(async ({ agentDir }) => {
    const storageDir = join(agentDir, "harness");
    const lockPath = join(storageDir, HARNESS_LOCK_FILE);

    // 场景 1：持有者 pid 已死（模拟崩溃后残留）→ 立即偷取。
    await writeFile(lockPath, `${JSON.stringify({ pid: 999999999 })}\n`, { flag: "wx" });
    const stolen = await acquireHarnessLock(storageDir, { heartbeatMs: 50, settleMs: 5 });
    await stolen.release();

    // 场景 2：心跳过期（mtime 超过 staleMs）→ 即使 pid 字段仍存活也偷取。
    const staleTime = new Date(Date.now() - 60_000);
    await writeFile(lockPath, `${JSON.stringify({ pid: process.pid })}\n`, { flag: "wx" });
    await utimes(lockPath, staleTime, staleTime);
    const revived = await acquireHarnessLock(storageDir, { heartbeatMs: 50, settleMs: 5 });
    await revived.release();

    // 场景 3：新鲜 mtime + 活 pid → 拒绝（正常防双开）。
    await writeFile(lockPath, `${JSON.stringify({ pid: process.pid })}\n`, { flag: "wx" });
    try {
      await assert.rejects(
        () => acquireHarnessLock(storageDir, { heartbeatMs: 50, settleMs: 5 }),
        error => error instanceof HarnessLockHeldError,
      );
    } finally {
      await rm(lockPath, { force: true });
    }
  });
});

test("heartbeat refreshes the lock mtime while held and detects loss", async () => {
  await withTempAgentDir(async ({ agentDir }) => {
    const storageDir = join(agentDir, "harness");
    const lock = await acquireHarnessLock(storageDir, { heartbeatMs: 40, settleMs: 0 });
    try {
      const before = (await stat(lock.path)).mtimeMs;
      await new Promise(resolve => setTimeout(resolve, 130));
      const after = (await stat(lock.path)).mtimeMs;
      assert.ok(after > before, "heartbeat keeps the lock file mtime fresh");
      assert.equal(lock.heartbeatState().lost, false);

      // 宿主清理/被偷：锁文件消失后心跳上报 lost，而不是默默继续。
      await rm(lock.path, { force: true });
      await new Promise(resolve => setTimeout(resolve, 130));
      assert.equal(lock.heartbeatState().lost, true);
      assert.ok(lock.heartbeatState().lastError);
    } finally {
      await lock.release();
    }
  });
});

test("openMilkSUHarness: alias index is atomic and conversation() round-trips", async () => {
  await withTempAgentDir(async ({ agentDir }) => {
    const { models } = makeFauxModels();
    const registry = createRegistry();
    const handle = await openMilkSUHarness({
      agentDir,
      models,
      registry,
      heartbeatMs: 50,
      settleMs: 5,
      unrefHeartbeat: true,
    });
    try {
      assert.ok(handle.storagePath.endsWith(join("harness", "harness.sqlite")));

      const missing = await handle.conversation("conv-adapter-1");
      assert.equal(missing, undefined);

      const created = await handle.ensureConversation("conv-adapter-1");
      assert.ok(created.conversation.id > 0);
      assert.equal(created.created, true);

      const again = await handle.ensureConversation("conv-adapter-1");
      assert.equal(again.conversation.id, created.conversation.id);
      assert.equal(again.created, false);

      const looked = await handle.conversation("conv-adapter-1");
      assert.equal(looked.id, created.conversation.id);
      await assert.rejects(
        () => handle.ensureConversation("   "),
        /non-empty conversationId/,
      );
    } finally {
      await handle.close();
      await handle.close(); // idempotent
    }

    // close 后锁已释放：可再次打开同一存储（dispose 语义的进程内面）。
    const reopened = await openMilkSUHarness({
      agentDir,
      models,
      registry: createRegistry(),
      heartbeatMs: 50,
      settleMs: 5,
      unrefHeartbeat: true,
    });
    const conversation = await reopened.conversation("conv-adapter-1");
    assert.ok(conversation, "alias survives reopen");
    await reopened.close();
  });
});

test("submitInput passes requestId through and is idempotent per conversation", async () => {
  await withTempAgentDir(async ({ agentDir, workspace }) => {
    const { faux, models } = makeFauxModels();
    faux.setResponses([
      fauxAssistantMessage([fauxToolCall("slow_touch", { path: "side-effect.txt", ms: 60 })], {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("all done"),
    ]);
    const handle = await openMilkSUHarness({
      agentDir,
      models,
      registry: registryWithSlowTouch({ workspace }),
      heartbeatMs: 50,
      settleMs: 5,
      unrefHeartbeat: true,
    });
    try {
      await handle.configureConversation("conv-submit", {
        provider: "faux",
        modelId: "faux-1",
        thinkingLevel: "off",
      });
      handle.resume();
      const first = await handle.submitInput("conv-submit", {
        requestId: "req-1",
        content: "run the tool",
      });
      const second = await handle.submitInput("conv-submit", {
        requestId: "req-1",
        content: "run the tool",
      });
      assert.equal(second.id, first.id, "same requestId returns the same submission");
      const settled = await handle.waitSubmission(first);
      assert.equal(settled.status, "done");
      const page = await handle.conversationEntries("conv-submit", { limit: 100 });
      const kinds = page.items.map(entry => entry.kind);
      assert.equal(kinds.filter(kind => kind === "pi.user").length, 1);
      assert.ok(kinds.includes("pi.assistant"));
      assert.ok(kinds.includes("pi.tool-result"));
    } finally {
      await handle.close();
    }
  });
});

test("configureConversation persists model and thinkingLevel per conversation", async () => {
  await withTempAgentDir(async ({ agentDir }) => {
    const { models } = makeFauxModels();
    const handle = await openMilkSUHarness({
      agentDir,
      models,
      registry: createRegistry(),
      heartbeatMs: 50,
      settleMs: 5,
      unrefHeartbeat: true,
    });
    try {
      await handle.configureConversation("conv-model", {
        provider: "faux",
        modelId: "faux-1",
        thinkingLevel: "off",
      });
      const view = await handle.conversationViewState("conv-model");
      try {
        assert.equal(view.value.docs["pi.agent"]?.model?.provider, "faux");
        assert.equal(view.value.docs["pi.agent"]?.model?.modelId, "faux-1");
      } finally {
        await view.dispose();
      }
    } finally {
      await handle.close();
    }
  });
});

test("openMilkSUHarness refuses to start on storage damage and releases the lock", async () => {
  await withTempAgentDir(async ({ agentDir }) => {
    const { models } = makeFauxModels();
    const storageDir = join(agentDir, "harness");
    // 打开前自检：损坏的存储文件在 openNodeSqliteStorage/Harness.open 处 throw。
    await writeFile(harnessStoragePath(agentDir), "not a sqlite database at all");
    await assert.rejects(
      () => openMilkSUHarness({
        agentDir,
        models,
        registry: createRegistry(),
        heartbeatMs: 50,
        settleMs: 5,
        unrefHeartbeat: true,
      }),
    );
    // 失败路径必须释放锁：立即可以再次 acquire。
    const lock = await acquireHarnessLock(storageDir, { heartbeatMs: 50, settleMs: 5 });
    await lock.release();
    await rm(harnessStoragePath(agentDir), { force: true });
  });
});

test("faux text streaming produces assistant entries without network", async () => {
  await withTempAgentDir(async ({ agentDir }) => {
    const { faux, models } = makeFauxModels();
    faux.setResponses([fauxAssistantMessage("hello from faux")]);
    const handle = await openMilkSUHarness({
      agentDir,
      models,
      registry: createRegistry(),
      heartbeatMs: 50,
      settleMs: 5,
      unrefHeartbeat: true,
    });
    try {
      await handle.configureConversation("conv-faux", {
        provider: "faux",
        modelId: "faux-1",
        thinkingLevel: "off",
      });
      handle.resume();
      const submission = await handle.submitInput("conv-faux", {
        requestId: "req-faux",
        content: "say hi",
      });
      const settled = await handle.waitSubmission(submission);
      assert.equal(settled.status, "done");
      const page = await handle.conversationEntries("conv-faux", { limit: 10 });
      // entries 是 newest-first（types.d.ts），最新条目在首位。
      const last = page.items[0];
      assert.equal(last.kind, "pi.assistant");
      const text = last.model?.[0]?.content?.map(block => block.text ?? "").join("") ?? "";
      assert.equal(text, "hello from faux");
    } finally {
      await handle.close();
    }
  });
});

test("lock holder file content is readable diagnostics", async () => {
  await withTempAgentDir(async ({ agentDir }) => {
    const storageDir = join(agentDir, "harness");
    const lock = await acquireHarnessLock(storageDir, { heartbeatMs: 50, settleMs: 0 });
    try {
      const holder = JSON.parse(await readFile(lock.path, "utf8"));
      assert.equal(holder.pid, process.pid);
      assert.equal(typeof holder.acquiredAt, "number");
      assert.equal(holder.heartbeatMs, 50);
    } finally {
      await lock.release();
    }
  });
});
