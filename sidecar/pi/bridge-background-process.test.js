import assert from "node:assert/strict";
import { access, mkdtemp, readFile, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { runCommandOnce, spawnCommand } from "./bridge-background-process.js";
import { buildCodingBackgroundLaunch } from "./bridge-policy.js";

async function waitFor(child) {
  return await new Promise((resolvePromise, rejectPromise) => {
    child.once("error", rejectPromise);
    child.once("close", (code, signal) => resolvePromise({ code, signal }));
  });
}

test("background shell:true uses Pi's host bash instead of a Unix-only /bin/bash path", async () => {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "milksu-background-shell-workspace-")),
  );
  const runtime = await realpath(
    await mkdtemp(join(tmpdir(), "milksu-background-shell-runtime-")),
  );
  const previousRuntime = process.env.MILKSU_WORKSPACE_RUNTIME;
  process.env.MILKSU_WORKSPACE_RUNTIME = runtime;
  try {
    const launch = buildCodingBackgroundLaunch(
      {
        command: "printf ready",
        cwd: workspace,
        shell: true,
      },
      join(runtime, "launch.log"),
    );
    if (process.platform === "win32") {
      assert.notEqual(launch.file.replaceAll("\\", "/"), "/bin/bash");
      assert.match(launch.file, /bash\.exe$/i);
    } else {
      assert.ok(launch.file.includes("bash") || launch.file.endsWith("sh"));
    }
    const spawned = spawnCommand(
      {
        command: "printf ready > ready.txt",
        cwd: workspace,
        shell: true,
      },
      join(runtime, "ok.log"),
      true,
    );
    const result = await waitFor(spawned.child);
    assert.equal(result.code, 0);
    assert.equal(await readFile(join(workspace, "ready.txt"), "utf8"), "ready");
  } finally {
    if (previousRuntime === undefined) delete process.env.MILKSU_WORKSPACE_RUNTIME;
    else process.env.MILKSU_WORKSPACE_RUNTIME = previousRuntime;
  }
});

test("background spawn failures stay on the child and cannot crash the sidecar", async () => {
  const workspace = await realpath(
    await mkdtemp(join(tmpdir(), "milksu-background-missing-workspace-")),
  );
  const runtime = await realpath(
    await mkdtemp(join(tmpdir(), "milksu-background-missing-runtime-")),
  );
  const previousRuntime = process.env.MILKSU_WORKSPACE_RUNTIME;
  process.env.MILKSU_WORKSPACE_RUNTIME = runtime;
  try {
    const spawned = spawnCommand(
      {
        argv: [join(workspace, "missing-background-command")],
        cwd: workspace,
        shell: false,
      },
      join(runtime, "missing.log"),
      true,
    );
    assert.ok(spawned.child.listenerCount("error") >= 1);
    await new Promise(resolvePromise => {
      spawned.child.once("close", () => resolvePromise());
      setTimeout(() => resolvePromise(), 1000);
    });
  } finally {
    if (previousRuntime === undefined) delete process.env.MILKSU_WORKSPACE_RUNTIME;
    else process.env.MILKSU_WORKSPACE_RUNTIME = previousRuntime;
  }
});

test("Pi background tasks preserve cwd and strip provider secrets", {
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

test("Project Auto background tasks use Pi-native cwd semantics", {
  skip: process.platform !== "darwin",
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-background-primary-"));
  const authorized = await mkdtemp(join(tmpdir(), "milksu-background-authorized-"));
  const unauthorized = await mkdtemp(join(tmpdir(), "milksu-background-unauthorized-"));
  const runtime = await mkdtemp(join(tmpdir(), "milksu-background-runtime-"));
  const previousRuntime = process.env.MILKSU_WORKSPACE_RUNTIME;
  process.env.MILKSU_WORKSPACE_RUNTIME = runtime;
  try {
    const input = {
      action: "spawn",
      command: "printf background > authorized.txt",
      cwd: authorized,
    };
    const spawned = spawnCommand(
      { ...input, shell: true },
      join(runtime, "authorized.log"),
      true,
    );
    assert.deepEqual(await waitFor(spawned.child), { code: 0, signal: null });
    assert.equal(
      await readFile(join(authorized, "authorized.txt"), "utf8"),
      "background",
    );

    const resumed = {
      command: "printf resumed > resumed.txt",
      cwd: authorized,
      shell: true,
    };
    const result = await runCommandOnce(resumed);
    assert.equal(result.exitCode, 0);
    assert.equal(
      await readFile(join(authorized, "resumed.txt"), "utf8"),
      "resumed",
    );

    const anotherInput = {
      command: "printf native > native.txt",
      cwd: unauthorized,
    };
    const another = spawnCommand(
      { ...anotherInput, shell: true },
      join(runtime, "native.log"),
      true,
    );
    assert.deepEqual(await waitFor(another.child), { code: 0, signal: null });
    assert.equal(await readFile(join(unauthorized, "native.txt"), "utf8"), "native");
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

test("durable command watchers resume from their persisted cwd", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-background-resume-workspace-"));
  const runtime = await mkdtemp(join(tmpdir(), "milksu-background-resume-runtime-"));
  const previousRuntime = process.env.MILKSU_WORKSPACE_RUNTIME;
  process.env.MILKSU_WORKSPACE_RUNTIME = runtime;
  try {
    const persisted = {
      command: "printf resumed > resumed.txt",
      cwd: workspace,
      shell: true,
    };
    const result = await runCommandOnce(persisted);
    assert.equal(result.exitCode, 0);
    assert.equal(await readFile(join(workspace, "resumed.txt"), "utf8"), "resumed");
  } finally {
    if (previousRuntime === undefined) delete process.env.MILKSU_WORKSPACE_RUNTIME;
    else process.env.MILKSU_WORKSPACE_RUNTIME = previousRuntime;
  }
});
