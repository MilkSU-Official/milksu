import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { resolveDshLaunch, resolveDshScript } from "./launch.js";

test("packaged sidecar layout resolves dsh next to the bridge", () => {
  const root = mkdtempSync(join(tmpdir(), "milksu-dsh-launch-"));
  const bin = join(root, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  mkdirSync(dirname(bin), { recursive: true });
  writeFileSync(bin, "export {}\n");
  assert.equal(resolveDshScript(root), bin);
  const launch = resolveDshLaunch({
    here: root,
    execPath: "/usr/bin/node",
    env: {},
  });
  assert.equal(launch.command, "/usr/bin/node");
  assert.deepEqual(launch.args, [bin, "--profile", "acp"]);
});

test("explicit MILKSU_DSH_COMMAND wins over packaged layout", () => {
  const launch = resolveDshLaunch({
    here: "/missing",
    execPath: "/usr/bin/node",
    env: {
      MILKSU_DSH_COMMAND: "/bin/echo",
      MILKSU_DSH_ACP_ARGS: "--profile acp",
    },
  });
  assert.equal(launch.command, "/bin/echo");
  assert.deepEqual(launch.args, ["--profile", "acp"]);
});

test("missing packaged CLI fails closed", () => {
  assert.throws(
    () => resolveDshLaunch({ here: join(tmpdir(), "missing-dsh"), env: {} }),
    /not packaged next to the Sidecar/,
  );
});
