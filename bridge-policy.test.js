import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer as createHTTPServer } from "node:http";
import { createServer as createTCPServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import {
  loadSessionPolicy,
  normalizeCodingPolicy,
  parseCodingProductAction,
  scopeAllowsNetwork,
} from "./bridge-policy.js";

function manifest(
  mode,
  allowedTools,
  execution = {},
  targets = [{ kind: "directory", value: "workspace" }],
) {
  return {
    schemaVersion: "ctf-workspace.milksu.dev/v1alpha1",
    source: {
      scope: {
        targets,
      },
    },
    policy: {
      mode,
      allowedTools,
      execution: {
        workspaceOnly: true,
        defaultCommandTimeoutSeconds: 120,
        maxCommandTimeoutSeconds: 300,
        maxToolEventOutputBytes: 60000,
        ...execution,
      },
    },
  };
}

async function listen(server) {
  await new Promise((resolvePromise, rejectPromise) => {
    server.once("error", rejectPromise);
    server.listen(0, "127.0.0.1", resolvePromise);
  });
  return server.address().port;
}

async function close(server) {
  await new Promise(resolvePromise => server.close(resolvePromise));
}

async function workspaceWithManifest(value) {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-ctf-policy-"));
  await mkdir(join(workspace, "work"), { recursive: true });
  await writeFile(
    join(workspace, "challenge.json"),
    `${JSON.stringify(value, null, 2)}\n`,
    "utf8",
  );
  return workspace;
}

test("legacy Coding sessions preserve deliverable Go defaults without unrestricted tools", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-policy-"));
  const policy = await loadSessionPolicy(workspace);
  assert.equal(policy.ctf, false);
  assert.equal(policy.executionMode, "go");
  assert.equal(policy.approvalPolicy, "workspace-auto");
  assert.deepEqual(
    policy.activeTools,
    [
      "read",
      "bash",
      "edit",
      "write",
      "grep",
      "find",
      "ls",
      "bg_task",
      "bg_status",
      "milksu_progress",
      "lsp_diagnostics",
      "lsp_fix",
      "goal_complete",
      "goal_blocked",
    ],
  );
  assert.equal(policy.customTools.some(tool => tool.name === "bash"), true);
  assert.equal(policy.activeTools.includes("lsp_fix"), true);
});

test("Plan and Read-only enforce a read-only tool allowlist", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-policy-"));
  for (const [executionMode, approvalPolicy] of [
    ["plan", "workspace-auto"],
    ["go", "read-only"],
  ]) {
    const policy = await loadSessionPolicy(workspace, "", {
      executionMode,
      approvalPolicy,
    });
    assert.deepEqual(
      policy.activeTools,
      [
        "read",
        "grep",
        "find",
        "ls",
        "bg_status",
        "milksu_progress",
        "lsp_diagnostics",
        "goal_complete",
        "goal_blocked",
      ],
    );
    for (const denied of ["bash", "edit", "write", "bg_task", "lsp_fix"]) {
      assert.equal(policy.activeTools.includes(denied), false);
    }
  }
});

test("Ask exposes effectful tools behind the desktop approval channel", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-policy-"));
  const policy = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "ask",
  });
  const ask = normalizeCodingPolicy("go", "ask");
  assert.equal(ask.approvalChannelAvailable, true);
  for (const gated of ["bash", "edit", "write", "lsp_fix"]) {
    assert.equal(policy.activeTools.includes(gated), true);
  }
  assert.equal(policy.activeTools.includes("bg_task"), true);
  assert.equal(
    ask.capabilities.find(value => value.id === "workspace-write").status,
    "approval-required",
  );
  assert.equal(
    ask.capabilities.find(value => value.id === "command").status,
    "approval-required",
  );
});

test("MCP is exposed only for an explicitly selected Coding task", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-policy-"));
  const disabled = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
  });
  assert.equal(disabled.activeTools.includes("mcp"), false);
  assert.equal(
    disabled.capabilities.find(value => value.id === "browser").status,
    "unavailable",
  );

  const enabled = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
    mcpServers: ["browser"],
  });
  assert.equal(enabled.activeTools.includes("mcp"), true);
  assert.deepEqual(enabled.mcpServers, ["browser"]);
  assert.equal(
    enabled.capabilities.find(value => value.id === "browser").status,
    "approval-required",
  );

  const codingBrowser = {
    sessionId: "browser_12345678-abcd-4567-8901-123456789abc",
    cdpEndpoint: "http://127.0.0.1:43127",
  };
  const browserEnabled = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
    mcpServers: ["milksu-playwright"],
    projectMcpServers: [],
    codingBrowser,
  });
  assert.equal(browserEnabled.activeTools.includes("mcp"), true);
  assert.deepEqual(browserEnabled.projectMcpServers, []);
  assert.deepEqual(browserEnabled.codingBrowser, codingBrowser);
  assert.match(
    browserEnabled.capabilities.find(value => value.id === "browser").detail,
    /MilkSU 隔离浏览器/,
  );

  for (const policyInput of [
    { executionMode: "plan", approvalPolicy: "workspace-auto" },
    { executionMode: "go", approvalPolicy: "read-only" },
  ]) {
    const gated = await loadSessionPolicy(workspace, "", {
      ...policyInput,
      mcpServers: ["milksu-playwright"],
      projectMcpServers: [],
      codingBrowser,
    });
    assert.equal(gated.activeTools.includes("mcp"), false);
    assert.equal(
      gated.capabilities.find(value => value.id === "browser").status,
      "unavailable",
    );
  }
});

test("Computer Use requires an explicit app-scoped session under every Go policy", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-computer-use-policy-"));
  const computerUse = {
    sessionId: "computer_12345678",
    socketPath:
      "/private/tmp/milksu-computer-use/computer_12345678/driver.sock",
    targetBundleId: "com.milksu.app",
    targetName: "MilkSU",
    targetPid: 4242,
  };
  const automaticWithoutSession = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
  });
  assert.equal(
    automaticWithoutSession.capabilities.find(
      value => value.id === "computer-use",
    ).status,
    "unavailable",
  );
  assert.equal(automaticWithoutSession.activeTools.includes("mcp"), false);

  for (const approvalPolicy of ["ask", "workspace-auto", "full-auto"]) {
    const enabled = await loadSessionPolicy(workspace, "", {
      executionMode: "go",
      approvalPolicy,
      mcpServers: ["milksu-computer-use"],
      projectMcpServers: [],
      computerUse,
    });
    assert.equal(enabled.activeTools.includes("mcp"), true);
    assert.deepEqual(enabled.computerUse, computerUse);
    assert.equal(
      enabled.capabilities.find(value => value.id === "computer-use").status,
      "approval-required",
    );
    assert.match(
      enabled.capabilities.find(value => value.id === "computer-use").detail,
      /模型不能改 PID、窗口或桌面范围/,
    );
  }

  for (const policyInput of [
    { executionMode: "plan", approvalPolicy: "workspace-auto" },
    { executionMode: "go", approvalPolicy: "read-only" },
  ]) {
    const gated = await loadSessionPolicy(workspace, "", {
      ...policyInput,
      mcpServers: ["milksu-computer-use"],
      projectMcpServers: [],
      computerUse,
    });
    assert.equal(gated.activeTools.includes("mcp"), false);
    assert.equal(
      gated.capabilities.find(value => value.id === "computer-use").status,
      "unavailable",
    );
  }
});

test("Coding read/search tools can access reviewed resources but no other outside path", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-policy-"));
  const resourceRoot = await mkdtemp(join(tmpdir(), "milksu-archify-resource-"));
  const skillPath = join(resourceRoot, "SKILL.md");
  const exampleDirectory = join(resourceRoot, "examples");
  const examplePath = join(exampleDirectory, "architecture.example.json");
  const outside = join(await mkdtemp(join(tmpdir(), "milksu-unreviewed-")), "secret.txt");
  await mkdir(exampleDirectory);
  await writeFile(skillPath, "# Archify\n", "utf8");
  await writeFile(examplePath, '{"diagram_type":"architecture"}\n', "utf8");
  await writeFile(outside, "outside-secret", "utf8");

  const policy = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
    readOnlyResourceRoots: [resourceRoot],
  });
  const read = policy.customTools.find(tool => tool.name === "read");
  const response = await read.execute(
    "read-reviewed-skill",
    { path: skillPath },
    undefined,
    undefined,
    {},
  );
  assert.match(response.content[0].text, /Archify/);

  const ls = policy.customTools.find(tool => tool.name === "ls");
  const listing = await ls.execute(
    "list-reviewed-skill",
    { path: resourceRoot },
    undefined,
    undefined,
    {},
  );
  assert.match(listing.content[0].text, /SKILL\.md/);
  assert.match(listing.content[0].text, /examples/);

  const find = policy.customTools.find(tool => tool.name === "find");
  const found = await find.execute(
    "find-reviewed-example",
    { path: resourceRoot, pattern: "**/*.json" },
    undefined,
    undefined,
    {},
  );
  assert.match(found.content[0].text, /architecture\.example\.json/);

  const grep = policy.customTools.find(tool => tool.name === "grep");
  const matches = await grep.execute(
    "grep-reviewed-example",
    { path: resourceRoot, pattern: "diagram_type" },
    undefined,
    undefined,
    {},
  );
  assert.match(matches.content[0].text, /architecture\.example\.json/);

  await assert.rejects(
    read.execute("read-unreviewed", { path: outside }, undefined, undefined, {}),
    /denied path outside/,
  );
  await assert.rejects(
    ls.execute(
      "list-unreviewed",
      { path: dirname(outside) },
      undefined,
      undefined,
      {},
    ),
    /denied path outside/,
  );
});

test("Architecture product action gets a narrow typed tool policy", async () => {
  const workspace = await mkdtemp(join(
    process.platform === "darwin" ? "/private/tmp" : tmpdir(),
    "milksu-architecture-action-",
  ));
  const resourceRoot = join(process.cwd(), "third_party", "archify", "archify");
  const specRelative = "docs/architecture/generated/project-current-system.architecture.json";
  const htmlRelative = "docs/architecture/generated/project-current-system.html";
  const candidate = await readFile(
    join(resourceRoot, "examples", "web-app.architecture.json"),
    "utf8",
  );

  const action = parseCodingProductAction(
    `[MilkSU product action: Generate architecture diagram]\n`
      + `Product spec path: ${specRelative}\n`
      + `Product HTML path: ${htmlRelative}\n`,
  );
  assert.deepEqual(action, {
    kind: "architecture",
    specPath: specRelative,
    htmlPath: htmlRelative,
  });
  const policy = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
    productAction: action,
    readOnlyResourceRoots: [resourceRoot],
  });
  assert.deepEqual(policy.activeTools, [
    "read",
    "grep",
    "find",
    "ls",
    "write",
    "milksu_archify",
    "milksu_progress",
    "goal_complete",
    "goal_blocked",
  ]);
  assert.equal(policy.activeTools.includes("bash"), false);
  assert.equal(policy.activeTools.includes("edit"), false);

  const write = policy.customTools.find(tool => tool.name === "write");
  await write.execute(
    "write-architecture-spec",
    { path: join(workspace, specRelative), content: candidate },
    undefined,
    undefined,
    {},
  );
  await assert.rejects(
    write.execute(
      "write-unrelated-source",
      { path: join(workspace, "src.js"), content: "changed" },
      undefined,
      undefined,
      {},
    ),
    /only allows writing/,
  );

  const archify = policy.customTools.find(tool => tool.name === "milksu_archify");
  const validation = await archify.execute(
    "validate-architecture",
    {
      action: "validate",
      diagramType: "architecture",
      inputPath: specRelative,
      quality: "showcase",
    },
    undefined,
    undefined,
    {},
  );
  assert.match(validation.content[0].text, /"ok": true/);
  const delivery = await archify.execute(
    "deliver-architecture",
    {
      action: "deliver",
      diagramType: "architecture",
      inputPath: specRelative,
      outputPath: htmlRelative,
      quality: "showcase",
    },
    undefined,
    undefined,
    {},
  );
  assert.match(delivery.content[0].text, /"ok": true/);
  await access(join(workspace, htmlRelative));
});

test("Daily Coding product actions get action-specific tool policies", async () => {
  const workspace = await mkdtemp(join(
    process.platform === "darwin" ? "/private/tmp" : tmpdir(),
    "milksu-product-actions-",
  ));
  const readOnlyTools = [
    "read",
    "grep",
    "find",
    "ls",
    "milksu_progress",
    "lsp_diagnostics",
    "goal_complete",
    "goal_blocked",
  ];
  const testTools = [
    "read",
    "bash",
    "grep",
    "find",
    "ls",
    "milksu_progress",
    "lsp_diagnostics",
    "goal_complete",
    "goal_blocked",
  ];
  const fixTools = [
    "read",
    "bash",
    "edit",
    "write",
    "grep",
    "find",
    "ls",
    "milksu_progress",
    "lsp_diagnostics",
    "lsp_fix",
    "goal_complete",
    "goal_blocked",
  ];
  const cases = [
    {
      header: "[MilkSU product action: Understand project]",
      kind: "understand",
      executionMode: "plan",
      tools: readOnlyTools,
    },
    {
      header: "[MilkSU product action: Run tests]",
      kind: "test",
      executionMode: "go",
      tools: testTools,
    },
    {
      header: "[MilkSU product action: Review changes]",
      kind: "review",
      executionMode: "plan",
      tools: readOnlyTools,
    },
    {
      header: "[MilkSU product action: Fix failure]",
      kind: "fix",
      executionMode: "go",
      tools: fixTools,
    },
    {
      header: "[MilkSU product action: Summarize work]",
      kind: "summary",
      executionMode: "plan",
      tools: readOnlyTools,
    },
  ];

  for (const value of cases) {
    const action = parseCodingProductAction(`${value.header}\nexecute now`);
    assert.deepEqual(action, { kind: value.kind });
    const policy = await loadSessionPolicy(workspace, "", {
      executionMode: value.executionMode,
      approvalPolicy: "workspace-auto",
      productAction: action,
    });
    assert.deepEqual(policy.activeTools, value.tools);
    assert.deepEqual(policy.productAction, { kind: value.kind });
  }

  const understand = await loadSessionPolicy(workspace, "", {
    executionMode: "plan",
    approvalPolicy: "workspace-auto",
    productAction: { kind: "understand" },
  });
  assert.equal(understand.activeTools.includes("bash"), false);
  assert.equal(understand.activeTools.includes("edit"), false);
  assert.equal(understand.activeTools.includes("write"), false);

  const testAction = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
    productAction: { kind: "test" },
  });
  assert.equal(testAction.activeTools.includes("bash"), true);
  assert.equal(testAction.activeTools.includes("edit"), false);
  assert.equal(testAction.activeTools.includes("write"), false);

  const fix = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
    productAction: { kind: "fix" },
  });
  assert.equal(fix.activeTools.includes("bash"), true);
  assert.equal(fix.activeTools.includes("edit"), true);
  assert.equal(fix.activeTools.includes("write"), true);
  assert.equal(fix.activeTools.includes("milksu_archify"), false);
  const write = fix.customTools.find(tool => tool.name === "write");
  await write.execute(
    "write-fix-regression",
    {
      path: join(workspace, "src", "created-by-fix.js"),
      content: "export const fixed = true\n",
    },
    undefined,
    undefined,
    {},
  );
  assert.equal(
    await readFile(join(workspace, "src", "created-by-fix.js"), "utf8"),
    "export const fixed = true\n",
  );
});

test("Go Project Auto runs normal development commands but contains filesystem writes", {
  skip: process.platform !== "darwin",
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-policy-"));
  const outside = join(tmpdir(), `milksu-policy-outside-${Date.now()}.txt`);
  const policy = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
  });
  const bash = policy.customTools.find(tool => tool.name === "bash");
  await bash.execute(
    "normal-development-command",
    {
      command: "printf medium > generated.txt && git init -q && git add generated.txt && git status --short",
    },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(join(workspace, "generated.txt"), "utf8"), "medium");
  await assert.rejects(
    bash.execute(
      "outside-command-write",
      { command: `printf escaped > ${JSON.stringify(outside)}` },
      undefined,
      undefined,
      {},
    ),
    /Operation not permitted|Permission denied|exited with code/,
  );
  const write = policy.customTools.find(tool => tool.name === "write");
  await assert.rejects(
    write.execute(
      "outside-write",
      { path: outside, content: "blocked" },
      undefined,
      undefined,
      {},
    ),
    /denied path outside/,
  );
});

test("Coding collaboration exposes subagent and lets only the main shell integrate registered worktrees", {
  skip: process.platform !== "darwin",
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-policy-"));
  const collaborationRoot = await mkdtemp(join(tmpdir(), "milksu-collaboration-policy-"));
  const worktree = join(collaborationRoot, "writer-1");
  const outside = join(tmpdir(), `milksu-collaboration-outside-${Date.now()}.txt`);
  await mkdir(worktree);
  await writeFile(join(worktree, "agent-change.txt"), "candidate\n");
  const policy = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
    codingCollaboration: {
      schemaVersion: 1,
      conversationId: "fixture",
      workspace,
      baseHead: "a".repeat(40),
      worktrees: [{
        id: "writer-1",
        path: worktree,
        branch: "codex/agent-fixture-writer-1",
      }],
    },
  });
  assert.equal(policy.activeTools.includes("subagent"), true);
  assert.equal(
    policy.capabilities.find(value => value.id === "collaboration").status,
    "approval-required",
  );

  const read = policy.customTools.find(tool => tool.name === "read");
  const inspected = await read.execute(
    "inspect-writer",
    { path: join(worktree, "agent-change.txt") },
    undefined,
    undefined,
    {},
  );
  assert.match(inspected.content[0].text, /candidate/);

  const bash = policy.customTools.find(tool => tool.name === "bash");
  await bash.execute(
    "main-agent-integration",
    {
      command: `printf reviewed > ${JSON.stringify(join(worktree, "reviewed.txt"))}`,
    },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(join(worktree, "reviewed.txt"), "utf8"), "reviewed");
  await assert.rejects(
    bash.execute(
      "unregistered-worktree-write",
      { command: `printf escaped > ${JSON.stringify(outside)}` },
      undefined,
      undefined,
      {},
    ),
    /Operation not permitted|Permission denied|exited with code/,
  );

  const write = policy.customTools.find(tool => tool.name === "write");
  await assert.rejects(
    write.execute(
      "file-tool-worktree-write",
      { path: join(worktree, "blocked.txt"), content: "blocked" },
      undefined,
      undefined,
      {},
    ),
    /denied path outside/,
  );
});

test("Go Project Auto can run a reviewed Node CLI outside the project", {
  skip: process.platform !== "darwin",
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-policy-"));
  const resourceRoot = join(process.cwd(), "third_party", "archify", "archify");
  const policy = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
    readOnlyResourceRoots: [resourceRoot],
  });
  const bash = policy.customTools.find(tool => tool.name === "bash");
  const response = await bash.execute(
    "reviewed-node-cli",
    {
      command: `test -n "$TMPDIR" && touch "$TMPDIR/runtime-write-check" && node ${JSON.stringify(join(resourceRoot, "bin", "archify.mjs"))} doctor`,
    },
    undefined,
    undefined,
    {},
  );
  assert.match(response.content[0].text, /Archify doctor/i);
});

test("Go Project Auto keeps command runtime files outside the project", {
  skip: process.platform !== "darwin",
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-runtime-project-"));
  const runtime = await mkdtemp(join(tmpdir(), "milksu-coding-runtime-home-"));
  const previous = process.env.MILKSU_WORKSPACE_RUNTIME;
  process.env.MILKSU_WORKSPACE_RUNTIME = runtime;
  try {
    const policy = await loadSessionPolicy(workspace, "", {
      executionMode: "go",
      approvalPolicy: "workspace-auto",
    });
    const bash = policy.customTools.find(tool => tool.name === "bash");
    await bash.execute(
      "external-runtime",
      { command: 'printf "%s\\n%s" "$HOME" "$TMPDIR"' },
      undefined,
      undefined,
      {},
    );
    await assert.rejects(access(join(workspace, ".milksu")), /ENOENT/);
    await access(join(runtime, "home"));
    await access(join(runtime, "tmp"));
    await access(join(runtime, "runtime-bin", "node"));
  } finally {
    if (previous === undefined) delete process.env.MILKSU_WORKSPACE_RUNTIME;
    else process.env.MILKSU_WORKSPACE_RUNTIME = previous;
  }
});

test("Go Full Access automatically runs outside-project commands without leaking model keys", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-full-"));
  const outside = join(
    await mkdtemp(join(tmpdir(), "milksu-coding-full-outside-")),
    "result.txt",
  );
  const previousKey = process.env.DEEPSEEK_API_KEY;
  process.env.DEEPSEEK_API_KEY = "must-not-reach-child";
  try {
    const policy = await loadSessionPolicy(workspace, "", {
      executionMode: "go",
      approvalPolicy: "full-auto",
    });
    assert.equal(
      policy.capabilities.find(value => value.id === "network").status,
      "allowed",
    );
    assert.equal(
      policy.capabilities.find(value => value.id === "credentials").status,
      "allowed",
    );
    const bash = policy.customTools.find(tool => tool.name === "bash");
    await bash.execute(
      "full-access-write",
      {
        command: `test -z "$DEEPSEEK_API_KEY" && printf full > ${JSON.stringify(outside)}`,
      },
      undefined,
      undefined,
      {},
    );
    assert.equal(await readFile(outside, "utf8"), "full");
  } finally {
    if (previousKey === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = previousKey;
  }
});

test("coach mode removes bash even if a manifest requests it", async () => {
  const workspace = await workspaceWithManifest(
    manifest("coach", ["read", "bash", "edit", "write", "grep", "find", "ls"]),
  );
  const policy = await loadSessionPolicy(workspace);
  assert.equal(policy.ctf, true);
  assert.equal(policy.activeTools.includes("bash"), false);
  assert.equal(policy.activeTools.includes("milksu_progress"), true);
  assert.equal(policy.customTools.some(tool => tool.name === "bash"), false);
  assert.equal(policy.activeTools.includes("ctf_capabilities"), true);
});

test("CTF capabilities report only the fixed sandbox-visible command catalog", async () => {
  const workspace = await workspaceWithManifest(
    manifest("coach", ["read"]),
  );
  const policy = await loadSessionPolicy(workspace);
  const capabilities = policy.customTools.find(tool => tool.name === "ctf_capabilities");
  assert.ok(capabilities);
  const response = await capabilities.execute(
    "capabilities",
    { category: "core" },
    undefined,
    undefined,
    {},
  );
  const result = JSON.parse(response.content[0].text);
  assert.equal(result.category, "core");
  assert.ok(result.available.python3 || result.missing.includes("python3"));
  assert.ok(Object.keys(result.available).every(name => (
    ["python3", "node", "bash", "file", "strings", "curl", "openssl"].includes(name)
  )));
});

test("CTF decode applies one strict transform and reports reproducible output facts", async () => {
  const workspace = await workspaceWithManifest(
    manifest("coach", ["read"]),
  );
  const policy = await loadSessionPolicy(workspace);
  assert.equal(policy.activeTools.includes("ctf_decode"), true);
  const decode = policy.customTools.find(tool => tool.name === "ctf_decode");
  const hex = await decode.execute(
    "decode-hex",
    { input: "4d696c6b5355", encoding: "hex" },
    undefined,
    undefined,
    {},
  );
  const result = JSON.parse(hex.content[0].text);
  assert.equal(result.bodyEncoding, "utf8");
  assert.equal(result.body, "MilkSU");
  assert.equal(result.decodedBytes, 6);
  assert.match(result.sha256, /^[0-9a-f]{64}$/);

  const base32 = await decode.execute(
    "decode-base32",
    { input: "JBSWY3DP", encoding: "base32" },
    undefined,
    undefined,
    {},
  );
  assert.equal(JSON.parse(base32.content[0].text).body, "Hello");
  await assert.rejects(
    decode.execute(
      "invalid-base64",
      { input: "not base64!", encoding: "base64" },
      undefined,
      undefined,
      {},
    ),
    /not canonical Base64/,
  );
});

test("CTF HTTP uses exact granted origins without ambient redirects", async () => {
  const server = createHTTPServer((request, response) => {
    const chunks = [];
    request.on("data", chunk => chunks.push(chunk));
    request.on("end", () => {
      if (request.url === "/redirect") {
        response.writeHead(302, { location: "https://outside.example/path" });
        response.end("redirect");
        return;
      }
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({
        method: request.method,
        marker: request.headers["x-fixture"],
        body: Buffer.concat(chunks).toString("utf8"),
      }));
    });
  });
  const port = await listen(server);
  try {
    const origin = `http://127.0.0.1:${port}`;
    const workspace = await workspaceWithManifest(
      manifest("coach", ["read"], {}, [{ kind: "origin", value: origin }]),
    );
    const policy = await loadSessionPolicy(workspace);
    assert.equal(policy.activeTools.includes("ctf_http"), true);
    assert.equal(policy.activeTools.includes("bash"), false);
    const http = policy.customTools.find(tool => tool.name === "ctf_http");
    const response = await http.execute(
      "http-post",
      {
        url: `${origin}/baseline`,
        method: "POST",
        headers: { "X-Fixture": "scoped" },
        body: "hello",
      },
      undefined,
      undefined,
      {},
    );
    const result = JSON.parse(response.content[0].text);
    assert.equal(result.status, 200);
    assert.equal(result.bodyEncoding, "utf8");
    assert.deepEqual(JSON.parse(result.body), {
      method: "POST",
      marker: "scoped",
      body: "hello",
    });

    const redirected = await http.execute(
      "http-redirect",
      { url: `${origin}/redirect` },
      undefined,
      undefined,
      {},
    );
    const redirectResult = JSON.parse(redirected.content[0].text);
    assert.equal(redirectResult.status, 302);
    assert.equal(redirectResult.redirected, true);
    assert.equal(redirectResult.responseUrl, `${origin}/redirect`);

    await assert.rejects(
      http.execute(
        "outside-origin",
        { url: `http://127.0.0.1:${port + 1}/outside` },
        undefined,
        undefined,
        {},
      ),
      /outside the exact authorized origins/,
    );
  } finally {
    await close(server);
  }
});

test("managed lab shell remains networkless while ctf_http keeps exact loopback access", async () => {
  const origin = "http://127.0.0.1:41234";
  const value = manifest(
    "copilot",
    ["read", "bash"],
    {},
    [
      { kind: "lab", value: "instance-1" },
      { kind: "origin", value: origin },
    ],
  );
  value.source.kind = "local-lab";
  assert.equal(scopeAllowsNetwork(value), false);

  const workspace = await workspaceWithManifest(value);
  const policy = await loadSessionPolicy(workspace);
  assert.equal(policy.activeTools.includes("ctf_http"), true);
  assert.equal(policy.activeTools.includes("bash"), true);
});

test("CTF socket exchanges one bounded payload only with an exact granted target", async () => {
  const server = createTCPServer(socket => {
    socket.once("data", data => socket.end(Buffer.concat([Buffer.from("ACK:"), data])));
  });
  const port = await listen(server);
  try {
    const target = `127.0.0.1:${port}`;
    const workspace = await workspaceWithManifest(
      manifest("copilot", ["read"], {}, [{ kind: "socket", value: target }]),
    );
    const policy = await loadSessionPolicy(workspace);
    assert.equal(policy.activeTools.includes("ctf_socket"), true);
    const socket = policy.customTools.find(tool => tool.name === "ctf_socket");
    const response = await socket.execute(
      "socket-request",
      { target, payload: "PING\n", payloadEncoding: "utf8" },
      undefined,
      undefined,
      {},
    );
    const result = JSON.parse(response.content[0].text);
    assert.equal(result.bodyEncoding, "utf8");
    assert.equal(result.body, "ACK:PING\n");
    assert.equal(result.payloadBytes, 5);
    await assert.rejects(
      socket.execute(
        "outside-socket",
        { target: `127.0.0.1:${port + 1}`, payload: "" },
        undefined,
        undefined,
        {},
      ),
      /outside the exact authorized sockets/,
    );
  } finally {
    await close(server);
  }
});

test("tool-builder role gets sandboxed bash without gaining candidate-file writes", async () => {
  const workspace = await workspaceWithManifest(
    manifest("coach", ["read", "edit", "write", "grep", "find", "ls"]),
  );
  await writeFile(join(workspace, "candidate-flags.txt"), "# solver-owned\n", "utf8");
  const policy = await loadSessionPolicy(workspace, "tool-builder");
  assert.equal(policy.ctf, true);
  assert.equal(policy.activeTools.includes("bash"), true);
  assert.equal(policy.activeTools.includes("milksu_progress"), true);
  assert.ok(policy.customTools.some(tool => tool.name === "bash"));

  const write = policy.customTools.find(tool => tool.name === "write");
  await assert.rejects(
    write.execute(
      "candidate-write",
      { path: join(workspace, "candidate-flags.txt"), content: "blocked" },
      undefined,
      undefined,
      {},
    ),
    /denied mutation of protected entry/,
  );
  await write.execute(
    "tool-write",
    { path: join(workspace, "work", "tools", "helper.py"), content: "print('ok')\n" },
    undefined,
    undefined,
    {},
  );
  assert.equal(
    await readFile(join(workspace, "work", "tools", "helper.py"), "utf8"),
    "print('ok')\n",
  );
});

test("tool-builder never inherits solver HTTP or socket scope", async () => {
  const workspace = await workspaceWithManifest(
    manifest(
      "copilot",
      ["read", "bash"],
      {},
      [
        { kind: "origin", value: "https://challenge.example" },
        { kind: "socket", value: "challenge.example:31337" },
      ],
    ),
  );
  const policy = await loadSessionPolicy(workspace, "tool-builder");
  assert.equal(policy.activeTools.includes("bash"), true);
  assert.equal(policy.activeTools.includes("ctf_http"), false);
  assert.equal(policy.activeTools.includes("ctf_socket"), false);
  assert.equal(policy.customTools.some(tool => tool.name === "ctf_http"), false);
  assert.equal(policy.customTools.some(tool => tool.name === "ctf_socket"), false);
});

test("strategist can write only its review and cannot execute or alter solver state", async () => {
  const workspace = await workspaceWithManifest(
    manifest(
      "delegate",
      ["read", "bash", "edit", "write", "grep", "find", "ls"],
      {},
      [{ kind: "origin", value: "https://challenge.example" }],
    ),
  );
  await mkdir(join(workspace, "work", "tool-requests"), { recursive: true });
  await writeFile(join(workspace, "notes.md"), "# solver facts\n", "utf8");
  await writeFile(join(workspace, "candidate-flags.txt"), "# solver candidates\n", "utf8");

  const policy = await loadSessionPolicy(workspace, "strategist");
  assert.equal(policy.ctf, true);
  assert.deepEqual(
    policy.activeTools,
    ["read", "write", "grep", "find", "ls", "milksu_progress"],
  );
  assert.equal(policy.customTools.some(tool => tool.name === "bash"), false);
  assert.equal(policy.customTools.some(tool => tool.name === "ctf_http"), false);

  const write = policy.customTools.find(tool => tool.name === "write");
  await write.execute(
    "strategy-review",
    {
      path: join(workspace, "work", "strategy-review.md"),
      content: "# Next experiment\n",
    },
    undefined,
    undefined,
    {},
  );
  assert.equal(
    await readFile(join(workspace, "work", "strategy-review.md"), "utf8"),
    "# Next experiment\n",
  );
  for (const protectedPath of [
    "notes.md",
    "candidate-flags.txt",
    join("work", "tool-requests", "001.md"),
  ]) {
    await assert.rejects(
      write.execute(
        `protected-${protectedPath}`,
        { path: join(workspace, protectedPath), content: "blocked" },
        undefined,
        undefined,
        {},
      ),
      /denied mutation of protected entry/,
    );
  }
  await assert.rejects(
    write.execute(
      "unowned-review",
      { path: join(workspace, "work", "other.md"), content: "blocked" },
      undefined,
      undefined,
      {},
    ),
    /denied mutation outside work\/strategy-review\.md/,
  );
});

test("network tools reject an expired user scope before connecting", async () => {
  const value = manifest(
    "coach",
    ["read"],
    {},
    [{ kind: "origin", value: "http://127.0.0.1:65535" }],
  );
  value.source.scope.expiresAt = "2000-01-01T00:00:00Z";
  const workspace = await workspaceWithManifest(value);
  const policy = await loadSessionPolicy(workspace);
  const http = policy.customTools.find(tool => tool.name === "ctf_http");
  await assert.rejects(
    http.execute(
      "expired",
      { url: "http://127.0.0.1:65535/" },
      undefined,
      undefined,
      {},
    ),
    /scope expired/,
  );
});

test("tool-builder bash stays offline and cannot overwrite solver candidates", {
  skip: process.platform !== "darwin",
}, async () => {
  const workspace = await workspaceWithManifest(
    manifest("coach", ["read", "edit", "write", "grep", "find", "ls"]),
  );
  await writeFile(join(workspace, "candidate-flags.txt"), "# solver-owned\n", "utf8");
  const policy = await loadSessionPolicy(workspace, "tool-builder");
  const bash = policy.customTools.find(tool => tool.name === "bash");

  await bash.execute(
    "run-local-test",
    { command: "mkdir -p work/tools && printf 'print(1)\\n' > work/tools/helper.py && python3 work/tools/helper.py" },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(join(workspace, "work", "tools", "helper.py"), "utf8"), "print(1)\n");
  await assert.rejects(
    bash.execute(
      "candidate-write",
      { command: "printf blocked > candidate-flags.txt" },
      undefined,
      undefined,
      {},
    ),
    /Operation not permitted|Permission denied|exited with code/,
  );
  assert.equal(await readFile(join(workspace, "candidate-flags.txt"), "utf8"), "# solver-owned\n");
});

test("CTF inspect gives bounded deterministic file facts without leaving the workspace", async () => {
  const workspace = await workspaceWithManifest(
    manifest("coach", ["read", "ctf_inspect"]),
  );
  const samplePath = join(workspace, "work", "sample.bin");
  await writeFile(
    samplePath,
    Buffer.concat([
      Buffer.from([0x4d, 0x5a, 0x00, 0x01]),
      Buffer.from("VISIBLE_FLAG_HINT"),
      Buffer.from([0xff, 0x00]),
    ]),
  );
  const outside = await mkdtemp(join(tmpdir(), "milksu-ctf-inspect-outside-"));
  const outsidePath = join(outside, "secret.bin");
  await writeFile(outsidePath, "outside-secret", "utf8");

  const policy = await loadSessionPolicy(workspace);
  const inspect = policy.customTools.find(tool => tool.name === "ctf_inspect");
  assert.ok(inspect);

  const summary = await inspect.execute(
    "summary",
    { path: "work/sample.bin", operation: "summary" },
    undefined,
    undefined,
    {},
  );
  const summaryValue = JSON.parse(summary.content[0].text);
  assert.equal(summaryValue.detectedType, "application/x-dosexec");
  assert.equal(summaryValue.size, 23);
  assert.match(summaryValue.sha256, /^[0-9a-f]{64}$/);

  const strings = await inspect.execute(
    "strings",
    { path: samplePath, operation: "strings", minimumStringLength: 6 },
    undefined,
    undefined,
    {},
  );
  const stringsValue = JSON.parse(strings.content[0].text);
  assert.deepEqual(stringsValue.strings, [{ offset: 4, value: "VISIBLE_FLAG_HINT" }]);

  const hex = await inspect.execute(
    "hex",
    { path: samplePath, operation: "hex", offset: 0, length: 8 },
    undefined,
    undefined,
    {},
  );
  assert.match(JSON.parse(hex.content[0].text).hex, /^00000000  4d 5a 00 01/);

  await assert.rejects(
    inspect.execute(
      "outside",
      { path: outsidePath, operation: "summary" },
      undefined,
      undefined,
      {},
    ),
    /denied path outside/,
  );
});

test("CTF triage inventories nested materials deterministically and stays bounded", async () => {
  const workspace = await workspaceWithManifest(
    manifest("coach", ["ctf_triage"]),
  );
  await mkdir(join(workspace, "materials", "nested"), { recursive: true });
  await writeFile(join(workspace, "materials", "z.txt"), "last", "utf8");
  await writeFile(join(workspace, "materials", "a.txt"), "first", "utf8");
  await writeFile(
    join(workspace, "materials", "nested", "sample.bin"),
    Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0x00, 0x01]),
  );
  const outside = await mkdtemp(join(tmpdir(), "milksu-ctf-triage-outside-"));
  const outsidePath = join(outside, "secret.txt");
  await writeFile(outsidePath, "outside-secret", "utf8");
  await symlink(outsidePath, join(workspace, "materials", "linked-secret.txt"));

  const policy = await loadSessionPolicy(workspace);
  const triage = policy.customTools.find(tool => tool.name === "ctf_triage");
  assert.ok(triage);

  const response = await triage.execute(
    "triage",
    { path: "materials", maxFiles: 2 },
    undefined,
    undefined,
    {},
  );
  const result = JSON.parse(response.content[0].text);
  assert.deepEqual(
    result.files.map(file => file.path),
    ["materials/a.txt", "materials/nested/sample.bin"],
  );
  assert.equal(result.files[1].detectedType, "application/x-elf");
  assert.equal(result.truncated, true);
  assert.deepEqual(result.skipped, [{
    path: "materials/linked-secret.txt",
    reason: "symbolic links are not inspected",
  }]);

  await assert.rejects(
    triage.execute(
      "outside",
      { path: outsidePath },
      undefined,
      undefined,
      {},
    ),
    /denied path outside/,
  );
});

test("file tools reject absolute paths and symlink escapes outside the workspace", async () => {
  const workspace = await workspaceWithManifest(
    manifest("copilot", ["read", "write", "edit", "grep", "find", "ls"]),
  );
  const outside = await mkdtemp(join(tmpdir(), "milksu-ctf-outside-"));
  const outsideFile = join(outside, "secret.txt");
  await writeFile(outsideFile, "outside", "utf8");
  await symlink(outside, join(workspace, "work", "escape"));
  const policy = await loadSessionPolicy(workspace);
  const read = policy.customTools.find(tool => tool.name === "read");
  const write = policy.customTools.find(tool => tool.name === "write");

  await assert.rejects(
    read.execute("read-outside", { path: outsideFile }, undefined, undefined, {}),
    /denied path outside/,
  );
  await assert.rejects(
    write.execute(
      "write-symlink",
      { path: join(workspace, "work", "escape", "created.txt"), content: "blocked" },
      undefined,
      undefined,
      {},
    ),
    /denied path outside or through a symlink/,
  );
  await assert.rejects(
    write.execute(
      "write-policy",
      { path: join(workspace, "challenge.json"), content: "{}" },
      undefined,
      undefined,
      {},
    ),
    /denied mutation of protected entry/,
  );
});

test("copilot bash writes inside the workspace and cannot read outside it", {
  skip: process.platform !== "darwin",
}, async () => {
  const workspace = await workspaceWithManifest(
    manifest("copilot", ["bash"]),
  );
  const outside = await mkdtemp(join(tmpdir(), "milksu-ctf-bash-outside-"));
  const outsideFile = join(outside, "secret.txt");
  await writeFile(outsideFile, "outside-secret", "utf8");
  const policy = await loadSessionPolicy(workspace);
  const bash = policy.customTools.find(tool => tool.name === "bash");

  await bash.execute(
    "write-inside",
    { command: "printf contained > work/result.txt" },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(join(workspace, "work", "result.txt"), "utf8"), "contained");

  await assert.rejects(
    bash.execute(
      "read-outside",
      { command: `/bin/cat ${JSON.stringify(outsideFile)}` },
      undefined,
      undefined,
      {},
    ),
    /Operation not permitted|Permission denied|exited with code/,
  );
  await assert.rejects(
    bash.execute(
      "write-policy",
      { command: "printf blocked > challenge.json" },
      undefined,
      undefined,
      {},
    ),
    /Operation not permitted|Permission denied|exited with code/,
  );
});

test("copilot bash enforces a default timeout when the model omits one", {
  skip: process.platform !== "darwin",
}, async () => {
  const workspace = await workspaceWithManifest(
    manifest("copilot", ["bash"], {
      defaultCommandTimeoutSeconds: 1,
      maxCommandTimeoutSeconds: 1,
    }),
  );
  const policy = await loadSessionPolicy(workspace);
  const bash = policy.customTools.find(tool => tool.name === "bash");

  await assert.rejects(
    bash.execute(
      "timeout",
      { command: "/bin/sleep 3" },
      undefined,
      undefined,
      {},
    ),
    /timed out after 1 seconds/,
  );
});
