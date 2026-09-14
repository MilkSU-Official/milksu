import assert from "node:assert/strict";
import test from "node:test";
import {
  DATALESS_DIAGNOSTIC_THRESHOLD,
  DATALESS_EARLY_EXIT_LIMIT,
  DEFAULT_BASH_TIMEOUT_SECONDS,
  MAX_BASH_TIMEOUT_SECONDS,
  applyBashTimeout,
  commandDirectories,
  countDatalessFiles,
  createHangGuardExtension,
  hangGuardConfig,
  isICloudSyncedPath,
  resolveUserHome,
  timeoutDiagnostic,
} from "./bridge-hang-guard.js";

const baseConfig = {
  defaultTimeoutSeconds: DEFAULT_BASH_TIMEOUT_SECONDS,
  maxTimeoutSeconds: MAX_BASH_TIMEOUT_SECONDS,
};

const FAKE_HOME = "/Users/tester";
const ICLOUD_DIR = "/Users/tester/Documents/repo";
const PLAIN_DIR = "/tmp/repo";

function fakePi() {
  const handlers = new Map();
  const pi = {
    on(name, handler) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
  };
  return { pi, handlers, handler: name => handlers.get(name)?.[0] };
}

function fakeSpawn(stdout, { status = 0, error = undefined, capture } = {}) {
  return (command, args, options) => {
    if (capture) capture.push({ command, args, options });
    return { status, stdout, stderr: "", error };
  };
}

function hangGuard({ environment = {}, spawn, capture, home } = {}) {
  const { pi, handler, handlers } = fakePi();
  createHangGuardExtension({
    environment,
    platform: "darwin",
    home: home ?? FAKE_HOME,
    spawn: spawn ?? fakeSpawn("", { capture }),
  })(pi);
  return { handler, handlers };
}

const manyDataless = Array.from({ length: DATALESS_EARLY_EXIT_LIMIT + 4 }, (_, index) => `.git/${index}`)
  .join("\n") + "\n";

// ───────────────────────── 超时注入 ─────────────────────────

test("missing timeout receives the default", () => {
  const input = { command: "sleep 6000" };
  assert.equal(applyBashTimeout(input, baseConfig), DEFAULT_BASH_TIMEOUT_SECONDS);
  assert.equal(input.timeout, DEFAULT_BASH_TIMEOUT_SECONDS);
});

test("the default leaves room for ordinary long builds", () => {
  // 120s would terminate `npm ci`, `cargo build` and `go test ./...` on a cold cache,
  // and the model routinely omits `timeout` entirely.
  assert.ok(DEFAULT_BASH_TIMEOUT_SECONDS >= 600);
  assert.ok(DEFAULT_BASH_TIMEOUT_SECONDS < MAX_BASH_TIMEOUT_SECONDS);
});

test("explicit reasonable timeout is preserved", () => {
  const input = { command: "ls", timeout: 30 };
  assert.equal(applyBashTimeout(input, baseConfig), undefined);
  assert.equal(input.timeout, 30);
});

test("excessive timeout is clamped to the maximum", () => {
  const input = { command: "ls", timeout: 24 * 24 * 3600 };
  assert.equal(applyBashTimeout(input, baseConfig), MAX_BASH_TIMEOUT_SECONDS);
  assert.equal(input.timeout, MAX_BASH_TIMEOUT_SECONDS);
});

test("invalid timeout values are left untouched", () => {
  for (const value of [0, -5, "abc"]) {
    const input = { command: "ls", timeout: value };
    assert.equal(applyBashTimeout(input, baseConfig), undefined);
    assert.equal(input.timeout, value);
  }
  assert.equal(applyBashTimeout(undefined, baseConfig), undefined);
});

test("null timeout is treated as missing", () => {
  const input = { command: "ls", timeout: null };
  assert.equal(applyBashTimeout(input, baseConfig), DEFAULT_BASH_TIMEOUT_SECONDS);
  assert.equal(input.timeout, DEFAULT_BASH_TIMEOUT_SECONDS);
});

// ───────────────────────── tool_call 只注入超时，不做判断 ─────────────────────────

test("tool_call never blocks a command, whatever it is or where it runs", async () => {
  const { handler } = hangGuard({ spawn: fakeSpawn(manyDataless) });
  const commands = [
    "git fsck --no-progress",
    "cd ~/Documents/sync-repo && git fsck --no-progress",
    "grep -rn foo .",
    "find . -name '*.swift'",
    "npm ci",
    "git status",
  ];
  for (const command of commands) {
    const input = { command };
    for (const cwd of [ICLOUD_DIR, PLAIN_DIR]) {
      const result = await handler("tool_call")({ toolName: "bash", input: { ...input } }, { cwd });
      assert.equal(result, undefined, `${command} in ${cwd} must not be blocked`);
    }
  }
});

test("tool_call never touches the filesystem", async () => {
  // Deciding "is this command dangerous here" needs shell parsing and a filesystem scan
  // before execution. Both were dropped: an unbounded wait is already bounded by the
  // injected timeout, so a wrong guess would only cost the user a legitimate command.
  const calls = [];
  const { handler } = hangGuard({ spawn: fakeSpawn(manyDataless, { capture: calls }) });

  const input = { command: "cd ~/Documents/sync-repo && git fsck --no-progress" };
  const result = await handler("tool_call")({ toolName: "bash", input }, { cwd: ICLOUD_DIR });

  assert.equal(result, undefined);
  assert.equal(calls.length, 0, "no preflight scan may run before a command");
  assert.equal(input.timeout, DEFAULT_BASH_TIMEOUT_SECONDS);
});

test("tool_call ignores non-bash tools", async () => {
  const { handler } = hangGuard({ spawn: fakeSpawn("") });

  const input = { path: "/tmp/x" };
  assert.equal(await handler("tool_call")({ toolName: "read", input }, { cwd: ICLOUD_DIR }), undefined);
  assert.equal(input.timeout, undefined);
});

test("tool_call survives an input it cannot write to", async () => {
  const { handler } = hangGuard({ spawn: fakeSpawn("") });
  const input = Object.freeze({ command: "ls" });
  assert.equal(await handler("tool_call")({ toolName: "bash", input }, { cwd: PLAIN_DIR }), undefined);
});

test("the whole guard can be disabled", () => {
  const { handlers } = hangGuard({ environment: { MILKSU_PI_HANG_GUARD: "0" } });
  assert.equal(handlers.size, 0);
});

// ───────────────────────── iCloud 路径识别（仅用于超时后的解释） ─────────────────────────

test("iCloud synced roots are recognised and everything else skipped", () => {
  const options = { platform: "darwin", home: FAKE_HOME };
  assert.equal(isICloudSyncedPath(ICLOUD_DIR, options), true);
  assert.equal(isICloudSyncedPath(`${FAKE_HOME}/Documents`, options), true);
  assert.equal(isICloudSyncedPath(`${FAKE_HOME}/Desktop/x`, options), true);
  assert.equal(isICloudSyncedPath(`${FAKE_HOME}/Library/Mobile Documents/com~apple~CloudDocs`, options), true);
  assert.equal(isICloudSyncedPath(PLAIN_DIR, options), false);
  assert.equal(isICloudSyncedPath(`${FAKE_HOME}/DocumentsBackup`, options), false);
  assert.equal(isICloudSyncedPath(`${FAKE_HOME}/New project`, options), false);
  assert.equal(isICloudSyncedPath("", options), false);
  assert.equal(isICloudSyncedPath(ICLOUD_DIR, { platform: "linux", home: FAKE_HOME }), false);
});

// ───────────────────────── dataless 扫描 ─────────────────────────

test("dataless scan uses an early exit limit and never downloads", () => {
  const calls = [];
  const count = countDatalessFiles(ICLOUD_DIR, {
    platform: "darwin",
    spawn: fakeSpawn("a\nb\nc\n", { capture: calls }),
    limit: 21,
  });
  assert.equal(count, 3);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].command, "/bin/sh");
  const shell = calls[0].args[1];
  assert.match(shell, /-flags \+dataless/);
  assert.match(shell, /head -n 21/);
  assert.match(shell, /'\/Users\/tester\/Documents\/repo'/);
});

test("dataless scan reports unknown on other platforms or failures", () => {
  assert.equal(countDatalessFiles(ICLOUD_DIR, { platform: "linux", spawn: fakeSpawn("x\n") }), -1);
  assert.equal(
    countDatalessFiles(ICLOUD_DIR, { platform: "darwin", spawn: fakeSpawn("", { status: 1 }) }),
    -1,
  );
  assert.equal(
    countDatalessFiles(ICLOUD_DIR, {
      platform: "darwin",
      spawn: fakeSpawn("", { error: new Error("ETIMEDOUT") }),
    }),
    -1,
  );
  assert.equal(countDatalessFiles("", { platform: "darwin", spawn: fakeSpawn("x\n") }), -1);
});

test("directories with quotes are shell-quoted safely", () => {
  const calls = [];
  countDatalessFiles("/tmp/it's here", {
    platform: "darwin",
    spawn: fakeSpawn("", { capture: calls }),
  });
  assert.match(calls[0].args[1], /'\/tmp\/it'\\''s here'/);
});

// ───────────────────────── 用户目录解析 ─────────────────────────

test("the sandboxed sidecar HOME is not used for ~ expansion", () => {
  // MilkSU runs the sidecar with HOME=…/com.milksu.app/agent-home while commands use the
  // real user home, published as MILKSU_USER_HOME.
  const sandboxed = { HOME: "/sandbox/agent-home", MILKSU_USER_HOME: FAKE_HOME };
  assert.equal(resolveUserHome(sandboxed), FAKE_HOME);
  assert.equal(resolveUserHome({ MILKSU_USER_HOME: "  " }) !== "", true);
  assert.equal(
    commandDirectories("cd ~/Documents/sync-repo && git fsck", "/tmp", { home: resolveUserHome(sandboxed) })[1],
    `${FAKE_HOME}/Documents/sync-repo`,
  );
});

// ───────────────────────── 命令涉及的目录 ─────────────────────────

test("command directories include the session cwd and cd targets", () => {
  const options = { home: FAKE_HOME };
  assert.deepEqual(
    commandDirectories("git fsck", "/tmp/work", options),
    ["/tmp/work"],
  );
  assert.deepEqual(
    commandDirectories("cd ~/Documents/sync-repo && git fsck", "/tmp/work", options),
    ["/tmp/work", `${FAKE_HOME}/Documents/sync-repo`],
  );
  assert.deepEqual(
    commandDirectories('cd "~/Documents/My Repo" && git gc', "/tmp", options),
    ["/tmp", `${FAKE_HOME}/Documents/My Repo`],
  );
  assert.deepEqual(
    commandDirectories("pushd ../other && grep -rn x .", "/tmp/work", options),
    ["/tmp/work", "/tmp/other"],
  );
  assert.deepEqual(
    commandDirectories("cd - && git fsck", "/tmp/work", options),
    ["/tmp/work"],
  );
  assert.deepEqual(commandDirectories("cd 64x64 && ls", "/tmp/x", options), ["/tmp/x", "/tmp/x/64x64"]);
});

// ───────────────────────── 超时诊断文案 ─────────────────────────

test("diagnostic names the limit and points at background tasks", () => {
  const detail = timeoutDiagnostic({ timeoutSeconds: 600 });
  assert.match(detail, /600s foreground limit/);
  assert.match(detail, /background task tools/);
  assert.doesNotMatch(detail, /iCloud/);
});

test("diagnostic explains iCloud only when the count is above the threshold", () => {
  const explained = timeoutDiagnostic({
    timeoutSeconds: 600,
    directory: ICLOUD_DIR,
    count: DATALESS_EARLY_EXIT_LIMIT,
  });
  assert.match(explained, /21\+/);
  assert.match(explained, /only in iCloud/);
  assert.match(explained, /brctl download/);

  const quiet = timeoutDiagnostic({
    timeoutSeconds: 600,
    directory: ICLOUD_DIR,
    count: DATALESS_DIAGNOSTIC_THRESHOLD - 1,
  });
  assert.doesNotMatch(quiet, /iCloud/);

  const unknown = timeoutDiagnostic({ timeoutSeconds: 600, directory: ICLOUD_DIR, count: -1 });
  assert.doesNotMatch(unknown, /iCloud/);
});

// ───────────────────────── tool_result 钩子 ─────────────────────────

test("tool_result appends diagnostics to timeouts only", async () => {
  const { handler } = hangGuard({ spawn: fakeSpawn(manyDataless) });

  const timeoutResult = await handler("tool_result")(
    {
      isError: true,
      input: { command: "git fsck", timeout: 600 },
      content: [{ type: "text", text: "timeout:600" }],
    },
    { cwd: ICLOUD_DIR },
  );
  assert.match(timeoutResult.content.at(-1).text, /600s foreground limit/);
  assert.match(timeoutResult.content.at(-1).text, /only in iCloud/);

  const otherError = await handler("tool_result")(
    { isError: true, input: { command: "git fsck" }, content: [{ type: "text", text: "ENOENT" }] },
    { cwd: ICLOUD_DIR },
  );
  assert.equal(otherError, undefined);
});

test("tool_result skips the scan outside iCloud roots", async () => {
  const calls = [];
  const { handler } = hangGuard({ spawn: fakeSpawn(manyDataless, { capture: calls }) });

  const result = await handler("tool_result")(
    {
      isError: true,
      input: { command: "git fsck", timeout: 600 },
      content: [{ type: "text", text: "timeout:600" }],
    },
    { cwd: PLAIN_DIR },
  );
  assert.match(result.content.at(-1).text, /600s foreground limit/);
  assert.doesNotMatch(result.content.at(-1).text, /iCloud/);
  assert.equal(calls.length, 0);
});

test("tool_result reports the explicit timeout the call actually used", async () => {
  const { handler } = hangGuard({ spawn: fakeSpawn("") });

  const result = await handler("tool_result")(
    {
      isError: true,
      input: { command: "sleep 4000", timeout: 3600 },
      content: [{ type: "text", text: "Command timed out" }],
    },
    { cwd: PLAIN_DIR },
  );
  assert.match(result.content.at(-1).text, /3600s foreground limit/);
});

// ───────────────────────── 配置 ─────────────────────────

test("config reads environment overrides and defaults", () => {
  const defaults = hangGuardConfig({});
  assert.equal(defaults.defaultTimeoutSeconds, DEFAULT_BASH_TIMEOUT_SECONDS);
  assert.equal(defaults.maxTimeoutSeconds, MAX_BASH_TIMEOUT_SECONDS);
  assert.equal(defaults.enabled, true);

  const overridden = hangGuardConfig({
    MILKSU_PI_BASH_DEFAULT_TIMEOUT_SECONDS: "45",
    MILKSU_PI_BASH_MAX_TIMEOUT_SECONDS: "600",
    MILKSU_PI_HANG_GUARD: "0",
  });
  assert.equal(overridden.defaultTimeoutSeconds, 45);
  assert.equal(overridden.maxTimeoutSeconds, 600);
  assert.equal(overridden.enabled, false);

  const invalid = hangGuardConfig({ MILKSU_PI_BASH_DEFAULT_TIMEOUT_SECONDS: "-1" });
  assert.equal(invalid.defaultTimeoutSeconds, DEFAULT_BASH_TIMEOUT_SECONDS);
});
