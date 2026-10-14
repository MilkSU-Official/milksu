import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { resolveDshLaunch, resolveDshScript } from "./launch.js";

test("packaged sidecar layout still finds a nearby dsh script for diagnostics", () => {
  const root = mkdtempSync(join(tmpdir(), "milksu-dsh-launch-"));
  const bin = join(root, "node_modules", "@deepseek-ai", "dsh", "lib", "bin.js");
  mkdirSync(dirname(bin), { recursive: true });
  writeFileSync(bin, "export {}\n");
  assert.equal(resolveDshScript(root), bin);
  assert.throws(
    () => resolveDshLaunch({
      here: root,
      execPath: "/usr/bin/node",
      env: {},
    }),
    /Agent command is not configured/,
  );
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

test("missing guest command fails closed", () => {
  assert.throws(
    () => resolveDshLaunch({ here: join(tmpdir(), "missing-dsh"), env: {} }),
    /Agent command is not configured/,
  );
});

test("JSON ACP args are accepted", () => {
  const launch = resolveDshLaunch({
    here: "/missing",
    execPath: "/usr/bin/node",
    env: {
      MILKSU_DSH_COMMAND: "/bin/echo",
      MILKSU_DSH_ACP_ARGS: '["--profile","acp"]',
    },
  });
  assert.deepEqual(launch.args, ["--profile", "acp"]);
});
