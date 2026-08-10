import assert from "node:assert/strict";
import { access, mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  authorizeBackgroundToolInput,
  authorizeResumedBackgroundSpecification,
  withBackgroundResumeAuthorization,
} from "./bridge-background-authorization.js";
import { runCommandOnce, spawnCommand } from "./bridge-background-process.js";
import { prepareCodingBackgroundAuthorization } from "./bridge-policy.js";

async function waitFor(child) {
  return await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
}

test("background adapter rejects calls that did not pass MilkSU tool preflight", () => {
  assert.throws(
    () => spawnCommand(
      { command: "printf unsafe", cwd: process.cwd(), shell: true },
      join(tmpdir(), `milksu-background-unauthorised-${Date.now()}.log`),
      true,
    ),
    /unauthorised background process/,
  );
});

test("Project Auto background tasks stay in the workspace and strip provider secrets", {
  skip: process.platform !== "darwin",
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-background-workspace-"));
  const runtime = await mkdtemp(join(tmpdir(), "milksu-background-runtime-"));
  const outside = join(
    await mkdtemp(join(tmpdir(), "milksu-background-outside-")),
    "escaped.txt",
  );
  const previousRuntime = process.env.MILKSU_WORKSPACE_RUNTIME;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.MILKSU_WORKSPACE_RUNTIME = runtime;
  process.env.DEEPSEEK_API_KEY = "provider-secret";
  try {
    const allowed = {
      action: "spawn",
      command: 'test -z "$DEEPSEEK_API_KEY" && test -z "$MILKSU_BACKGROUND_AUTHORIZATION" && test "$PORT" = 4321 && printf safe > background.txt',
      cwd: workspace,
      env: {
        PORT: "4321",
        DEEPSEEK_API_KEY: "model-supplied-secret",
        BASH_ENV: "/tmp/untrusted-bash-env",
        HOME: "/tmp/untrusted-home",
      },
    };
    const authorization = await prepareCodingBackgroundAuthorization(
      workspace,
      "workspace-auto",
      allowed,
    );
    authorizeBackgroundToolInput(allowed, authorization);
    const spawned = spawnCommand(
      { ...allowed, shell: true },
      join(runtime, "allowed.log"),
      true,
    );
    assert.deepEqual(await waitFor(spawned.child), { code: 0, signal: null });
    assert.equal(await readFile(join(workspace, "background.txt"), "utf8"), "safe");

    const persistedWatchCommand = {
      command: allowed.command,
      cwd: allowed.cwd,
      env: allowed.env,
      shell: true,
    };
    const watchResult = await runCommandOnce(persistedWatchCommand);
    assert.equal(watchResult.exitCode, 0);
    assert.equal(await readFile(join(workspace, "background.txt"), "utf8"), "safe");

    assert.throws(
      () => runCommandOnce({
        ...persistedWatchCommand,
        command: "printf changed > background.txt",
      }),
      /command changed after authorization/,
    );

    const denied = {
      action: "spawn",
      command: `printf escaped > ${JSON.stringify(outside)}`,
      cwd: workspace,
    };
    const deniedAuthorization = await prepareCodingBackgroundAuthorization(
      workspace,
      "workspace-auto",
      denied,
    );
    authorizeBackgroundToolInput(denied, deniedAuthorization);
    const deniedSpawn = spawnCommand(
      { ...denied, shell: true },
      join(runtime, "denied.log"),
      true,
    );
    const deniedResult = await waitFor(deniedSpawn.child);
    assert.notEqual(deniedResult.code, 0);
    await assert.rejects(access(outside), /ENOENT/);
  } finally {
    if (previousRuntime === undefined) delete process.env.MILKSU_WORKSPACE_RUNTIME;
    else process.env.MILKSU_WORKSPACE_RUNTIME = previousRuntime;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

test("Project Auto Node background tasks can inspect their private log descriptor", {
  skip: process.platform !== "darwin",
}, async () => {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "milksu-background-node-workspace-")),
  );
  const runtime = await realpath(
    await mkdtemp(join(tmpdir(), "milksu-background-node-runtime-")),
  );
  const previousRuntime = process.env.MILKSU_WORKSPACE_RUNTIME;
  process.env.MILKSU_WORKSPACE_RUNTIME = runtime;
  try {
    const input = {
      action: "spawn",
      command: "node --version > node-version.txt",
      cwd: workspace,
    };
    const authorization = await prepareCodingBackgroundAuthorization(
      workspace,
      "workspace-auto",
      input,
    );
    authorizeBackgroundToolInput(input, authorization);
    const logPath = join(runtime, "background-tasks", "node", "output.log");
    const spawned = spawnCommand(
      { ...input, shell: true },
      logPath,
      true,
    );
    assert.deepEqual(await waitFor(spawned.child), { code: 0, signal: null });
    assert.match(
      await readFile(join(workspace, "node-version.txt"), "utf8"),
      /^v\d+\.\d+\.\d+\s*$/u,
    );
    assert.match(await readFile(logPath, "utf8"), /exit .* code=0/u);
  } finally {
    if (previousRuntime === undefined) delete process.env.MILKSU_WORKSPACE_RUNTIME;
    else process.env.MILKSU_WORKSPACE_RUNTIME = previousRuntime;
  }
});

test("background task logs cannot escape the reviewed private runtime", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-background-log-workspace-"));
  const runtime = await mkdtemp(join(tmpdir(), "milksu-background-log-runtime-"));
  const outside = join(
    await mkdtemp(join(tmpdir(), "milksu-background-log-outside-")),
    "output.log",
  );
  const previousRuntime = process.env.MILKSU_WORKSPACE_RUNTIME;
  process.env.MILKSU_WORKSPACE_RUNTIME = runtime;
  try {
    const input = {
      action: "spawn",
      command: "printf denied",
      cwd: workspace,
    };
    const authorization = await prepareCodingBackgroundAuthorization(
      workspace,
      "workspace-auto",
      input,
    );
    authorizeBackgroundToolInput(input, authorization);
    assert.throws(
      () => spawnCommand({ ...input, shell: true }, outside, true),
      /log outside its private runtime/u,
    );
    await assert.rejects(access(outside), /ENOENT/u);
  } finally {
    if (previousRuntime === undefined) delete process.env.MILKSU_WORKSPACE_RUNTIME;
    else process.env.MILKSU_WORKSPACE_RUNTIME = previousRuntime;
  }
});

test("Full Access background tasks may leave the workspace without inheriting model keys", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-background-full-workspace-"));
  const runtime = await mkdtemp(join(tmpdir(), "milksu-background-full-runtime-"));
  const outside = join(
    await mkdtemp(join(tmpdir(), "milksu-background-full-outside-")),
    "result.txt",
  );
  const previousRuntime = process.env.MILKSU_WORKSPACE_RUNTIME;
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.MILKSU_WORKSPACE_RUNTIME = runtime;
  process.env.DEEPSEEK_API_KEY = "provider-secret";
  try {
    const input = {
      action: "spawn",
      command: `test -z "$DEEPSEEK_API_KEY" && test -z "$OPENAI_API_KEY" && printf full > ${JSON.stringify(outside)}`,
      cwd: workspace,
      env: {
        OPENAI_API_KEY: "model-supplied-secret",
      },
    };
    const authorization = await prepareCodingBackgroundAuthorization(
      workspace,
      "full-auto",
      input,
    );
    authorizeBackgroundToolInput(input, authorization);
    const spawned = spawnCommand(
      { ...input, shell: true },
      join(runtime, "full.log"),
      true,
    );
    assert.deepEqual(await waitFor(spawned.child), { code: 0, signal: null });
    assert.equal(await readFile(outside, "utf8"), "full");
  } finally {
    if (previousRuntime === undefined) delete process.env.MILKSU_WORKSPACE_RUNTIME;
    else process.env.MILKSU_WORKSPACE_RUNTIME = previousRuntime;
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

test("durable command watchers are rebound only during reviewed session recovery", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-background-resume-workspace-"));
  const runtime = await mkdtemp(join(tmpdir(), "milksu-background-resume-runtime-"));
  const previousRuntime = process.env.MILKSU_WORKSPACE_RUNTIME;
  process.env.MILKSU_WORKSPACE_RUNTIME = runtime;
  try {
    const scopeInput = { cwd: workspace };
    const scope = await prepareCodingBackgroundAuthorization(
      workspace,
      "workspace-auto",
      scopeInput,
    );
    const persisted = {
      command: "printf resumed > resumed.txt",
      cwd: workspace,
      env: { MILKSU_BACKGROUND_AUTHORIZATION: "expired-sidecar-token" },
      shell: true,
    };

    assert.throws(
      () => authorizeResumedBackgroundSpecification({ ...persisted }),
      /outside a reviewed session start/,
    );
    await withBackgroundResumeAuthorization(scope, async () => {
      authorizeResumedBackgroundSpecification(persisted);
      const result = await runCommandOnce(persisted);
      assert.equal(result.exitCode, 0);
    });
    assert.equal(await readFile(join(workspace, "resumed.txt"), "utf8"), "resumed");

    const outside = {
      command: "printf denied",
      cwd: await mkdtemp(join(tmpdir(), "milksu-background-resume-outside-")),
      shell: true,
    };
    await assert.rejects(
      withBackgroundResumeAuthorization(scope, async () => {
        authorizeResumedBackgroundSpecification(outside);
      }),
      /outside the selected project/,
    );
  } finally {
    if (previousRuntime === undefined) delete process.env.MILKSU_WORKSPACE_RUNTIME;
    else process.env.MILKSU_WORKSPACE_RUNTIME = previousRuntime;
  }
});
