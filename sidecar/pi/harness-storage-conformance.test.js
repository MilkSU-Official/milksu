// pi-durable /testing 的 registerStorageConformance 对 MilkSU 打开姿势的一致性套件
// （PR-2 批次 A，照 REHEARSAL §4.4 的跑法）。
//
// 我们的存储打开姿势 = harness-adapter 的 openMilkSUHarness 内部调用：
// openNodeSqliteStorage(<dir>/harness/harness.sqlite)（Q4：SQLite WAL 唯一产品后端）。
// 本套件用同一入口为每个用例开一个新存储，确认没踩 pi-durable 的存储契约。
//
// 注记：JSONL 后端（fsync:true）不进产品，仅在 REHEARSAL 验证过；这里只跑 SQLite。
// Node 版本：本机开发 Node；打包 Node 24.18.0 的 node:sqlite 行为未覆盖（REHEARSAL R11）。

import test from "node:test";
import assert from "node:assert/strict";
import { isDeepStrictEqual } from "node:util";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerStorageConformance } from "@earendil-works/pi-durable/testing";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";

// 极简 Vitest 兼容 expect（照 REHEARSAL testing-conformance.mjs 的实现面）。
function partialMatch(actual, expected) {
  if (expected === null || typeof expected !== "object") return Object.is(actual, expected);
  if (actual === null || typeof actual !== "object") return false;
  if (Array.isArray(expected)) {
    if (!Array.isArray(actual) || actual.length !== expected.length) return false;
    return expected.every((value, index) => partialMatch(actual[index], value));
  }
  return Object.entries(expected).every(([key, value]) => partialMatch(actual[key], value));
}

function makeExpect() {
  const fail = message => {
    throw new Error(message);
  };
  return (actual, message) => ({
    toBe: expected => (Object.is(actual, expected)
      ? undefined
      : fail(`${message ?? ""} expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`)),
    toEqual: expected => (isDeepStrictEqual(actual, expected)
      ? undefined
      : fail(`${message ?? ""} deepEqual mismatch`)),
    toMatchObject: expected => (partialMatch(actual, expected)
      ? undefined
      : fail(`${message ?? ""} toMatchObject mismatch`)),
    toBeTruthy: () => (actual ? undefined : fail(`${message ?? ""} expected truthy`)),
    toBeGreaterThan: expected => (actual > expected
      ? undefined
      : fail(`${message ?? ""} expected > ${expected}, got ${actual}`)),
    toBeDefined: () => (actual !== undefined ? undefined : fail(`${message ?? ""} expected defined`)),
    toBeUndefined: () => (actual === undefined ? undefined : fail(`${message ?? ""} expected undefined`)),
    toHaveLength: expected => (actual?.length === expected
      ? undefined
      : fail(`${message ?? ""} expected length ${expected}, got ${actual?.length}`)),
    resolves: {
      toBe: async expected => {
        const value = await actual;
        if (!Object.is(value, expected)) {
          fail(`resolves.toBe mismatch: ${JSON.stringify(value)} vs ${JSON.stringify(expected)}`);
        }
      },
    },
    rejects: {
      toThrow: async messageIncludes => {
        try {
          await actual;
        } catch (error) {
          if (messageIncludes === undefined || String(error?.message ?? error).includes(messageIncludes)) return;
          fail(`rejects.toThrow: message ${String(error?.message ?? error)} does not include ${messageIncludes}`);
        }
        fail("rejects.toThrow: promise resolved instead of rejecting");
      },
    },
  });
}

test("pi-durable storage conformance passes for the MilkSU SQLite open path", async () => {
  const base = await mkdtemp(join(tmpdir(), "milksu-harness-conformance-"));
  try {
    let counter = 0;
    const withStorage = async use => {
      counter += 1;
      const caseDir = join(base, String(counter).padStart(3, "0"));
      await mkdir(join(caseDir, "harness"), { recursive: true });
      // 与 harness-adapter.js openMilkSUHarness 完全相同的打开姿势。
      const storage = await openNodeSqliteStorage(join(caseDir, "harness", "harness.sqlite"));
      try {
        await use(storage);
      } finally {
        await storage.close(BACKGROUND_CONTEXT).catch(() => undefined);
      }
    };

    const cases = [];
    const runner = {
      describe: (name, suite) => suite(),
      it: (name, run) => {
        cases.push({ name, run: () => run() });
      },
      expect: makeExpect(),
    };
    registerStorageConformance(runner, "milksu-harness-sqlite", withStorage);

    assert.ok(cases.length >= 20, `expected the documented 23-case suite, got ${cases.length}`);
    const failures = [];
    for (const { name, run } of cases) {
      try {
        await run();
      } catch (error) {
        failures.push(`${name}: ${String(error?.message ?? error)}`);
      }
    }
    assert.deepEqual(failures, [], `storage conformance failures:\n${failures.join("\n")}`);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
});
