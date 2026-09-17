import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createConnection } from "node:net";
import { createInterface } from "node:readline";
import { unlinkSync } from "node:fs";
import test from "node:test";
import { dshProductIpc } from "../hostpath.js";
import { createProductIpc, swallowEmitterError } from "./product-ipc.js";

test("product IPC round-trips ask and workspace", async () => {
  const path = dshProductIpc(`ipc-test-${process.pid}`);
  try {
    unlinkSync(path);
  } catch {
    // First listen.
  }
  const ipc = createProductIpc(path, async message => {
    if (message.method === "ask") {
      return { id: "keep", label: "Keep Pi" };
    }
    return "ok";
  });
  await ipc.listen();
  try {
    const result = await new Promise((resolve, reject) => {
      const socket = createConnection(path);
      const input = createInterface({ input: socket });
      input.on("line", line => {
        const message = JSON.parse(line);
        input.close();
        socket.end();
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      });
      socket.on("error", reject);
      socket.write(`${JSON.stringify({ id: 1, method: "ask", params: { question: "q" } })}\n`);
    });
    assert.equal(result.label, "Keep Pi");
  } finally {
    await ipc.close();
    try {
      unlinkSync(path);
    } catch {
      // Already gone.
    }
  }
});

test("swallowEmitterError keeps a later EPIPE from becoming unhandled", () => {
  const emitter = new EventEmitter();
  swallowEmitterError(emitter);
  emitter.emit("error", Object.assign(new Error("write EPIPE"), { code: "EPIPE" }));
});

test("product IPC stays up after a client aborts the named pipe", async () => {
  const path = dshProductIpc(`ipc-abort-${process.pid}`);
  try {
    unlinkSync(path);
  } catch {
    // First listen.
  }
  const ipc = createProductIpc(path, async () => "ok");
  await ipc.listen();
  try {
    await new Promise((resolve, reject) => {
      const socket = createConnection(path);
      socket.on("connect", () => {
        socket.destroy();
        resolve();
      });
      socket.on("error", reject);
    });
    const result = await new Promise((resolve, reject) => {
      const socket = createConnection(path);
      const input = createInterface({ input: socket });
      input.on("line", line => {
        const message = JSON.parse(line);
        input.close();
        socket.end();
        if (message.error) reject(new Error(message.error.message));
        else resolve(message.result);
      });
      socket.on("error", reject);
      socket.write(`${JSON.stringify({ id: 2, method: "workspace", params: {} })}\n`);
    });
    assert.equal(result, "ok");
  } finally {
    await ipc.close();
    try {
      unlinkSync(path);
    } catch {
      // Already gone.
    }
  }
});
