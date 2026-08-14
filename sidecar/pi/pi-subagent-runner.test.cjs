"use strict";

const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const { createHash } = require("node:crypto");
const { createServer } = require("node:http");
const {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const test = require("node:test");
const {
  prepareRunnerPolicy,
  reviewedPromptFiles,
  sandboxProfile,
  validateCLIArguments,
  writeRuntimeModelConfig,
} = require("./pi-subagent-runner.cjs");

const repositoryRoot = resolve(__dirname, "..", "..");

function fixture(agent) {
  const root = mkdtempSync(join(tmpdir(), "milksu-runner-"));
  const workspace = join(root, "workspace");
  const collaborationRoot = join(root, "collaboration");
  const cli = join(root, "pi-cli.cjs");
  const conversationId = "runner-conversation";
  const key = createHash("sha256").update(conversationId).digest("hex").slice(0, 32);
  const taskDirectory = join(collaborationRoot, key);
  const worktree = join(taskDirectory, "writer-1");
  mkdirSync(workspace);
  mkdirSync(worktree, { recursive: true });
  mkdirSync(join(worktree, "node_modules"));
  writeFileSync(join(worktree, "node_modules", "fixture.js"), "module.exports = 1;\n");
  writeFileSync(cli, "// fixture\n");
  writeFileSync(join(taskDirectory, "manifest.json"), JSON.stringify({
    schemaVersion: 2,
    conversationId,
    phase: "active",
    workspace,
    worktrees: [{
      id: "writer-1",
      path: worktree,
      branch: `codex/agent-${key.slice(0, 12)}-writer-1`,
      provisioned: true,
      prepared: true,
    }],
  }));
  return {
    environment: {
      MILKSU_PI_SUBAGENT_AGENT: agent,
      MILKSU_CODING_COLLABORATION_ROOT: collaborationRoot,
      MILKSU_PI_SUBAGENT_CLI: cli,
    },
    workspace,
    worktree,
  };
}

test("effectful roles require an active managed writer worktree", () => {
  const value = fixture("worker");
  assert.throws(
    () => prepareRunnerPolicy(value.environment, value.workspace),
    /must run in a managed writer worktree/,
  );
  const policy = prepareRunnerPolicy(value.environment, value.worktree);
  assert.equal(policy.effectful, true);
  assert.equal(policy.worktree.id, "writer-1");
  assert.equal(policy.mainWorkspace, realpathSync(value.workspace));
  assert.equal(policy.sharedDependencyRoots, undefined);
});

test("read-only roles may use main and receive no workspace write grant", () => {
  const value = fixture("reviewer");
  const policy = prepareRunnerPolicy(value.environment, value.workspace);
  assert.equal(policy.effectful, false);
  const profile = sandboxProfile({
    cwd: policy.cwd,
    mainWorkspace: policy.mainWorkspace,
    runtimeDirectory: policy.runtimeDirectory,
    temporaryDirectory: join(value.workspace, "temporary"),
    writable: false,
  });
  assert.doesNotMatch(
    profile,
    new RegExp(`allow file-write\\* \\(subpath ${JSON.stringify(value.workspace)}`),
  );
});

test("writer profile allows source but denies Git metadata writes", () => {
  const value = fixture("worker");
  const policy = prepareRunnerPolicy(value.environment, value.worktree);
  const profile = sandboxProfile({
    cwd: policy.cwd,
    mainWorkspace: policy.mainWorkspace,
    runtimeDirectory: policy.runtimeDirectory,
    temporaryDirectory: join(value.workspace, "temporary"),
    writable: true,
  });
  assert.match(profile, /allow file-write/);
  assert.match(profile, /deny file-write/);
  assert.equal(profile.includes(JSON.stringify(join(policy.cwd, ".git"))), true);
  const readRule = profile.split("\n").find(line => line.startsWith("(allow file-read*"));
  const writeRule = profile.split("\n").find(line => line.startsWith("(allow file-write*"));
  assert.equal(readRule.includes(JSON.stringify(value.workspace)), false);
  assert.equal(writeRule.includes(JSON.stringify(value.workspace)), false);
});

test("child CLI must keep every no-ambient-discovery flag", () => {
  const safe = [
    "--no-extensions",
    "--no-skills",
    "--no-prompt-templates",
    "--no-themes",
    "--no-context-files",
    "--no-approve",
    "--no-session",
  ];
  assert.doesNotThrow(() => validateCLIArguments(safe));
  assert.throws(
    () => validateCLIArguments(safe.filter(value => value !== "--no-skills")),
    /missing required isolation flag --no-skills/,
  );
  assert.throws(
    () => validateCLIArguments([...safe, "--extension=/tmp/untrusted.ts"]),
    /ambient resource flag/,
  );
});

test("launcher removes the parent Node permission layer before runner startup", () => {
  const result = spawnSync(
    "/bin/sh",
    [
      join(__dirname, "pi-subagent-launcher.sh"),
      process.execPath,
      "-e",
      "if (process.env.NODE_OPTIONS) process.exit(2); process.stdout.write('launcher-ok')",
    ],
    {
      encoding: "utf8",
      env: {
        ...process.env,
        NODE_OPTIONS: "--permission",
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "launcher-ok");
});

test("bundled subagent heartbeats keep an absolute execution limit", () => {
  const source = readFileSync(
    join(repositoryRoot, "node_modules/pi-sub-agent/extensions/index.ts"),
    "utf8",
  );
  assert.match(
    source,
    /MILKSU_SUBAGENT_HEARTBEAT_INTERVAL_MS = 30_000/,
  );
  assert.match(
    source,
    /MILKSU_SUBAGENT_EXECUTION_LIMIT_MS = 10 \* 60_000/,
  );
  assert.match(source, /\(\) => abort\("timeout"\)/);
  assert.match(source, /Subagent exceeded the 10 minute execution limit/);
});

test("runner admits only the exact bundled role prompt from its temporary root", () => {
  const value = fixture("worker");
  const promptDirectory = mkdtempSync(join(tmpdir(), "pi-subagent-"));
  const prompt = join(promptDirectory, "prompt-worker.md");
  writeFileSync(prompt, "reviewed worker prompt\n", { mode: 0o600 });
  const environment = {
    ...value.environment,
    TMPDIR: tmpdir(),
  };
  assert.deepEqual(
    reviewedPromptFiles(
      ["--append-system-prompt", prompt],
      environment,
    ),
    [realpathSync(prompt)],
  );
  const other = join(promptDirectory, "prompt-reviewer.md");
  writeFileSync(other, "wrong role\n", { mode: 0o600 });
  assert.throws(
    () => reviewedPromptFiles(
      ["--append-system-prompt", other],
      environment,
    ),
    /unreviewed system prompt/,
  );
});

test("runner configures Relay by environment reference without persisting its key", () => {
  const agentDirectory = join(mkdtempSync(join(tmpdir(), "milksu-models-")), "agent");
  const sentinel = "sentinel-must-not-be-written";
  const path = writeRuntimeModelConfig(
    agentDirectory,
    ["--model", "milksu-relay/example-model:high"],
    {
      MILKSU_RELAY_KEY: sentinel,
      MILKSU_RELAY_URL: "https://relay.invalid/v1",
    },
  );
  const content = readFileSync(path, "utf8");
  const config = JSON.parse(content);
  assert.equal(content.includes(sentinel), false);
  assert.equal(
    config.providers["milksu-relay"].apiKey,
    "$MILKSU_RELAY_KEY",
  );
  assert.equal(
    config.providers["milksu-relay"].models[0].id,
    "example-model",
  );
});

test("runner configures an active custom relay without persisting its key", () => {
  const agentDirectory = join(mkdtempSync(join(tmpdir(), "milksu-models-")), "agent");
  const sentinel = "custom-secret-must-not-be-written";
  const path = writeRuntimeModelConfig(
    agentDirectory,
    ["--model", "custom-relay-team/vendor/model:preview:high"],
    {
      MILKSU_CUSTOM_PROVIDER_ID: "custom-relay-team",
      MILKSU_CUSTOM_PROVIDER_KEY: sentinel,
      MILKSU_CUSTOM_PROVIDER_URL: "https://relay.invalid/v1",
    },
  );
  const content = readFileSync(path, "utf8");
  const config = JSON.parse(content);
  assert.equal(content.includes(sentinel), false);
  assert.equal(
    config.providers["custom-relay-team"].apiKey,
    "$MILKSU_CUSTOM_PROVIDER_KEY",
  );
  assert.equal(
    config.providers["custom-relay-team"].models[0].id,
    "vendor/model:preview",
  );
});

test("runner configures TokenFlux and rejects the removed KouriChat provider", () => {
  const agentDirectory = join(mkdtempSync(join(tmpdir(), "milksu-models-")), "agent");
  const path = writeRuntimeModelConfig(
    agentDirectory,
    ["--model", "tokenflux/deepseek/deepseek-v4-flash"],
    { TOKENFLUX_BASE_URL: "https://tokenflux.dev/v1" },
  );
  const config = JSON.parse(readFileSync(path, "utf8"));
  assert.equal(config.providers.tokenflux.apiKey, "$TOKENFLUX_API_KEY");
  assert.equal(
    config.providers.tokenflux.models[0].id,
    "deepseek/deepseek-v4-flash",
  );
  assert.equal(
    writeRuntimeModelConfig(
      agentDirectory,
      ["--model", "kourichat/kimi-k3"],
      { KOURICHAT_BASE_URL: "https://api.kourichat.com/v1" },
    ),
    undefined,
  );
});

test("Pi subagent shell drops provider credentials without changing ordinary Pi", async () => {
  const providerName = "OPENAI_API_KEY";
  const markerName = "MILKSU_PI_SUBAGENT_RUNTIME";
  const previousProvider = process.env[providerName];
  const previousMarker = process.env[markerName];
  const sentinel = "sentinel-never-log";
  try {
    process.env[providerName] = sentinel;
    delete process.env[markerName];
    const { getShellEnv } = await import(
      pathToFileURL(join(
        repositoryRoot,
        "node_modules/@earendil-works/pi-coding-agent/dist/utils/shell.js",
      )).href
    );
    assert.equal(getShellEnv()[providerName], sentinel);

    process.env[markerName] = "1";
    const isolated = getShellEnv();
    assert.equal(providerName in isolated, false);
    assert.equal(markerName in isolated, false);
  } finally {
    if (previousProvider === undefined) delete process.env[providerName];
    else process.env[providerName] = previousProvider;
    if (previousMarker === undefined) delete process.env[markerName];
    else process.env[markerName] = previousMarker;
  }
});

test("Pi subagent shell remains networkless while the model runtime can connect", async () => {
  if (process.platform !== "darwin") return;
  const server = createServer((_request, response) => {
    response.writeHead(200);
    response.end("unexpected");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.notEqual(address, null);
  assert.equal(typeof address, "object");
  const previousMarker = process.env.MILKSU_PI_SUBAGENT_RUNTIME;
  try {
    process.env.MILKSU_PI_SUBAGENT_RUNTIME = "1";
    const { createLocalBashOperations } = await import(
      pathToFileURL(join(
        repositoryRoot,
        "node_modules/@earendil-works/pi-coding-agent/dist/core/tools/bash.js",
      )).href
    );
    const result = await createLocalBashOperations().exec(
      `curl --fail --silent --max-time 2 http://127.0.0.1:${address.port}`,
      process.cwd(),
      {
        onData: () => {},
        timeout: 3,
      },
    );
    assert.notEqual(result.exitCode, 0);
  } finally {
    if (previousMarker === undefined) {
      delete process.env.MILKSU_PI_SUBAGENT_RUNTIME;
    } else {
      process.env.MILKSU_PI_SUBAGENT_RUNTIME = previousMarker;
    }
    await new Promise(resolve => server.close(resolve));
  }
});
