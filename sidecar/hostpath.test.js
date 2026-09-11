import assert from "node:assert/strict";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  computerUseSocket,
  dshProductIpc,
  ephemeralRoot,
  unixComputerUseSocket,
  unixDshProductIpc,
} from "./hostpath.js";

test("ephemeral root uses XDG_RUNTIME_DIR on Linux and os.tmpdir otherwise", () => {
  assert.equal(
    ephemeralRoot({ XDG_RUNTIME_DIR: "/run/user/1000" }, "linux"),
    "/run/user/1000",
  );
  assert.equal(ephemeralRoot({}, "linux"), tmpdir());
  assert.equal(ephemeralRoot({ XDG_RUNTIME_DIR: "/run/user/1000" }, "darwin"), tmpdir());
});

test("DSH product IPC stays under the ephemeral root and short enough for sockaddr_un", () => {
  if (process.platform === "win32") {
    assert.match(dshProductIpc("conversation-1"), /^\\\\\.\\pipe\\milksu-dsh-/);
    return;
  }
  const path = dshProductIpc("conversation-1");
  assert.ok(Buffer.byteLength(path) <= 103);
  const root = ephemeralRoot();
  if (Buffer.byteLength(join(root, "dsh-conversation-1.sock")) <= 103) {
    assert.ok(path.startsWith(root));
  }
});

test("DSH product IPC relocates when the root is a product workspace tmp", () => {
  if (process.platform === "win32") return;
  const root = join("/", "d".repeat(107));
  const path = unixDshProductIpc(root, "bridge-123456");
  assert.ok(Buffer.byteLength(path) <= 103);
  assert.equal(path.startsWith(root), false);
});

test("Computer Use unix sockets stay short and under the ephemeral root", () => {
  const sessionId = "computer_0123456789abcdef0123456789abcdef";
  if (process.platform === "win32") {
    assert.equal(
      computerUseSocket(sessionId),
      `\\\\.\\pipe\\milksu-computer-use-${sessionId}`,
    );
    return;
  }
  const path = computerUseSocket(sessionId);
  assert.ok(path.startsWith(ephemeralRoot()));
  assert.ok(Buffer.byteLength(path) <= 103);
  assert.equal(path.includes(`${join("milksu-computer-use", sessionId)}`), false);
});

test("Computer Use unix sockets hash the session id when the root is long", () => {
  const root = join("/", "d".repeat(69));
  const sessionId = "computer_0123456789abcdef0123456789abcdef";
  const path = unixComputerUseSocket(root, sessionId);
  assert.ok(Buffer.byteLength(path) <= 103);
  assert.notEqual(path, join(root, "mcu-0123456789abcdef0123456789abcdef.sock"));
});
