import assert from "node:assert/strict";
import test from "node:test";
import { parseArgList, resolveDshLaunch } from "./launch.js";

test("empty ACP args stay empty", () => {
  assert.deepEqual(parseArgList("", []), []);
  assert.deepEqual(parseArgList(undefined, []), []);
  assert.deepEqual(parseArgList("[]", []), []);
});

test("configured Agent command does not default to DSH --profile acp", () => {
  const launch = resolveDshLaunch({
    env: { MILKSU_DSH_COMMAND: "/usr/local/bin/codex-acp" },
  });
  assert.equal(launch.command, "/usr/local/bin/codex-acp");
  assert.deepEqual(launch.args, []);
});

test("explicit ACP args are preserved", () => {
  const launch = resolveDshLaunch({
    env: {
      MILKSU_DSH_COMMAND: "/usr/bin/dsh",
      MILKSU_DSH_ACP_ARGS: JSON.stringify(["--profile", "acp"]),
    },
  });
  assert.deepEqual(launch.args, ["--profile", "acp"]);
});
