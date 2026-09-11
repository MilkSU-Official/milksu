import assert from "node:assert/strict";
import { join } from "node:path";
import test from "node:test";
import { createAcpClient, formatAcpError } from "./acp-client.js";

test("ACP Internal error keeps the protocol detail", () => {
  assert.equal(
    formatAcpError({
      message: "Internal error",
      data: { details: "Failed to load the ES module: host-plugin.js" },
    }),
    "Internal error: Failed to load the ES module: host-plugin.js",
  );
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
