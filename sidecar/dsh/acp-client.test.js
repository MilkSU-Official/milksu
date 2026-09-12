import assert from "node:assert/strict";
import { readFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { createAcpClient, formatAcpError } from "./acp-client.js";

const here = dirname(fileURLToPath(import.meta.url));

test("ACP Internal error keeps the protocol detail", () => {
  assert.equal(
    formatAcpError({
      message: "Internal error",
      data: { details: "Failed to load the ES module: host-plugin.js" },
    }),
    "Internal error: Failed to load the ES module: host-plugin.js",
  );
});

test("ACP notify writes a JSON-RPC notification without an id", async () => {
  const dump = join(tmpdir(), `milksu-dsh-notify-${process.pid}.json`);
  try {
    unlinkSync(dump);
  } catch {
    // First write.
  }
  const client = createAcpClient({
    command: process.execPath,
    args: [join(here, "fake-acp.mjs")],
    env: { ...process.env, MILKSU_DSH_FAKE_ACP_DUMP: dump },
  });
  try {
    await client.request("initialize", {
      protocolVersion: 1,
      clientInfo: { name: "test", title: "test", version: "0" },
    });
    // Notifications must not occupy a pending request slot or wait for a reply.
    assert.equal(client.notify("session/cancel", { sessionId: "unused" }), undefined);
    const created = await client.request("session/new", { cwd: here, mcpServers: [] });
    assert.match(String(created.sessionId ?? ""), /^acp_/);
    const dumped = JSON.parse(readFileSync(dump, "utf8"));
    const cancel = dumped.received.find(item => item.method === "session/cancel");
    assert.ok(cancel);
    assert.equal(cancel.hasId, false);
  } finally {
    await client.close();
    try {
      unlinkSync(dump);
    } catch {
      // Already gone.
    }
  }
});

test("spawn failure is reported through onFailure instead of an unhandled error", async () => {
  const failures = [];
  const client = createAcpClient({
    command: join("/definitely-missing-milksu-dsh", "no-such-binary"),
    args: ["--profile", "acp"],
    onFailure(message) {
      failures.push(message);
    },
  });
  const started = Date.now();
  while (Date.now() - started < 2000 && failures.length === 0) {
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.equal(failures.length, 1);
  assert.match(failures[0], /ENOENT|not found|spawn/i);
  await assert.rejects(client.request("initialize", {}), /ENOENT|not found|spawn/i);
});
