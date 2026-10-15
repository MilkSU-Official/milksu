import assert from "node:assert/strict";
import {
  access,
  mkdtemp,
  mkdir,
  readFile,
  realpath,
  symlink,
  writeFile,
} from "node:fs/promises";
import { createServer as createHTTPServer } from "node:http";
import { createServer as createTCPServer } from "node:net";
import { tmpdir } from "node:os";
import { delimiter, dirname, join } from "node:path";
import { computerUseSocket } from "../hostpath.js";
import test from "node:test";
import {
  loadSessionPolicy,
  normalizeCodingPolicy,
  normalizeCodingProductAction,
  sandboxProfile,
} from "./bridge-policy.js";

let scopeFixtureID = 0;

function grantedScope(targets, overrides = {}) {
  scopeFixtureID += 1;
  return {
    id: `scope_fixture_${scopeFixtureID}`,
    source: "test:fixture",
    purpose: "workspace policy test",
    targets,
    grantedBy: "local-user",
    createdAt: new Date(Date.now() - 60_000).toISOString(),
    expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    revocable: true,
    ...overrides,
  };
}

function manifest(
  mode,
  allowedTools,
  execution = {},
  targets = [{ kind: "directory", value: "workspace" }],
  networkScopes = [],
) {
  return {
    schemaVersion: "ctf-workspace.milksu.dev/v1alpha2",
    source: {
      scope: grantedScope(targets),
    },
    networkScopes,
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

test("Coding sessions expose Pi native file and shell tools without MilkSU workspace tools", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-policy-"));
  const policy = await loadSessionPolicy(workspace);
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
      "milksu_ask",
      "milksu_workspace",
      "prepare_computer_use_driver",
      "computer_use",
      "milksu_archify",
      "lsp_diagnostics",
      "lsp_fix",
      "web_search",
      "web_fetch",
      "goal_complete",
      "goal_blocked",
      "subagent",
    ],
  );
  assert.equal(policy.customTools.some(tool => tool.name === "bash"), true);
  assert.equal(policy.activeTools.includes("lsp_fix"), true);
  assert.equal(policy.activeTools.includes("env_status"), false);
});

test("lab and CVE sessions expose env tools", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-env-policy-"));
  const policy = await loadSessionPolicy(workspace, "lab-job");
  assert.equal(policy.activeTools.includes("env_status"), true);
  assert.equal(policy.activeTools.includes("env_start"), true);
  assert.equal(policy.activeTools.includes("env_stop"), true);
});

test("ImageGen is exposed only when its isolated Provider credential is configured", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-imagegen-policy-"));
  const unavailable = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
    imageGenConfigured: false,
  });
  assert.equal(unavailable.activeTools.includes("milksu_imagegen"), false);
  assert.equal(
    unavailable.capabilities.find(value => value.id === "imagegen").status,
    "unavailable",
  );

  const available = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "full-auto",
    imageGenConfigured: true,
  });
  assert.equal(available.activeTools.includes("milksu_imagegen"), true);
  assert.equal(
    available.capabilities.find(value => value.id === "imagegen").status,
    "approval-required",
  );
  assert.match(
    available.capabilities.find(value => value.id === "imagegen").detail,
    /每次请求/,
  );

  const draw = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
    imageGenConfigured: true,
    imageDraw: true,
  });
  assert.equal(
    draw.capabilities.find(value => value.id === "imagegen").status,
    "allowed",
  );
  assert.equal(draw.imageDraw, true);
  for (const name of ["milksu_imagegen", "bash", "web_search", "web_fetch"]) {
    assert.equal(draw.activeTools.includes(name), true, name);
    assert.equal(available.activeTools.includes(name), true, name);
  }
  assert.equal(draw.customTools.some(tool => tool.name === "milksu_imagegen"), true);
  assert.equal(available.customTools.some(tool => tool.name === "milksu_imagegen"), true);
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
        "milksu_ask",
        "milksu_workspace",
        "lsp_diagnostics",
        "web_search",
        "web_fetch",
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
    "allowed",
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
  assert.equal(
    browserEnabled.capabilities.find(value => value.id === "browser").status,
    "allowed",
  );
  assert.match(
    browserEnabled.capabilities.find(value => value.id === "browser").detail,
    /MilkSU 隔离浏览器/,
  );

  const browserUse = {
    sessionId: "browser_user-12345678-abcd-4567-8901-123456789abc",
  };
  const userBrowserEnabled = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
    mcpServers: ["milksu-playwright-user"],
    projectMcpServers: [],
    browserUse,
  });
  assert.deepEqual(userBrowserEnabled.browserUse, browserUse);
  assert.equal(userBrowserEnabled.activeTools.includes("mcp"), true);
  assert.match(
    userBrowserEnabled.capabilities.find(value => value.id === "browser").detail,
    /Playwright MCP 官方扩展/,
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

test("Computer Use lists windows under Go and locks only after the model chooses", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-computer-use-policy-"));
  const computerUse = {
    sessionId: "computer_12345678",
    socketPath: computerUseSocket("computer_12345678"),
    targetBundleId: "com.openai.codex",
    targetName: "Codex",
    targetPid: 4242,
    targetWindowId: 9001,
  };
  const automaticWithoutSession = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
  });
  assert.equal(
    automaticWithoutSession.capabilities.find(
      value => value.id === "computer-use",
    ).status,
    "allowed",
  );
  assert.match(
    automaticWithoutSession.capabilities.find(
      value => value.id === "computer-use",
    ).detail,
    /列出可见窗口/,
  );
  assert.match(
    automaticWithoutSession.capabilities.find(
      value => value.id === "computer-use",
    ).detail,
    /不能用 Shell、截图目录、SQLite、IPC 或私有协议绕过/,
  );
  assert.equal(automaticWithoutSession.activeTools.includes("mcp"), false);
  assert.equal(automaticWithoutSession.activeTools.includes("computer_use"), true);

  for (const approvalPolicy of ["ask", "workspace-auto", "full-auto"]) {
    const enabled = await loadSessionPolicy(workspace, "", {
      executionMode: "go",
      approvalPolicy,
      projectMcpServers: [],
      computerUse,
    });
    assert.equal(enabled.activeTools.includes("mcp"), true);
    assert.deepEqual(enabled.mcpServers, []);
    assert.deepEqual(enabled.projectMcpServers, []);
    assert.deepEqual(enabled.computerUse, computerUse);
    assert.equal(
      enabled.capabilities.find(value => value.id === "computer-use").status,
      approvalPolicy === "ask" ? "approval-required" : "allowed",
    );
    assert.match(
      enabled.capabilities.find(value => value.id === "computer-use").detail,
      /操作只针对这一窗/,
    );
    assert.match(
      enabled.capabilities.find(value => value.id === "computer-use").detail,
      /Codex \(com\.openai\.codex\)/,
    );
  }

  for (const policyInput of [
    { executionMode: "plan", approvalPolicy: "workspace-auto" },
    { executionMode: "go", approvalPolicy: "read-only" },
  ]) {
    const gated = await loadSessionPolicy(workspace, "", {
      ...policyInput,
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

test("Coding read/search tools use Pi native absolute-path semantics", async () => {
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

  const outsideRead = await read.execute(
    "read-user-file",
    { path: outside },
    undefined,
    undefined,
    {},
  );
  assert.match(outsideRead.content[0].text, /outside-secret/);
  const outsideListing = await ls.execute(
    "list-user-directory",
    { path: dirname(outside) },
    undefined,
    undefined,
    {},
  );
  assert.match(outsideListing.content[0].text, /secret\.txt/);
});

test("Coding file tools do not require a second MilkSU workspace grant", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-primary-"));
  const authorized = await mkdtemp(join(tmpdir(), "milksu-coding-authorized-"));
  const unauthorized = await mkdtemp(join(tmpdir(), "milksu-coding-third-root-"));
  const authorizedFile = join(authorized, "authorized.txt");
  const unauthorizedFile = join(unauthorized, "unauthorized.txt");
  await writeFile(authorizedFile, "before\n", "utf8");
  await writeFile(unauthorizedFile, "private\n", "utf8");

  const policy = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
  });

  const read = policy.customTools.find(tool => tool.name === "read");
  const inspected = await read.execute(
    "read-authorized-project",
    { path: authorizedFile },
    undefined,
    undefined,
    {},
  );
  assert.match(inspected.content[0].text, /before/);

  const write = policy.customTools.find(tool => tool.name === "write");
  await write.execute(
    "write-authorized-project",
    { path: join(authorized, "created.txt"), content: "created\n" },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(join(authorized, "created.txt"), "utf8"), "created\n");

  const edit = policy.customTools.find(tool => tool.name === "edit");
  await edit.execute(
    "edit-authorized-project",
    {
      path: authorizedFile,
      edits: [{ oldText: "before\n", newText: "after\n" }],
    },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(authorizedFile, "utf8"), "after\n");

  const thirdRead = await read.execute(
    "read-user-project",
    { path: unauthorizedFile },
    undefined,
    undefined,
    {},
  );
  assert.match(thirdRead.content[0].text, /private/);
  await write.execute(
    "write-user-project",
    { path: join(unauthorized, "created.txt"), content: "created\n" },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(join(unauthorized, "created.txt"), "utf8"), "created\n");
});

test("Daily Coding product actions get action-specific tool policies", async () => {
  const workspace = await mkdtemp(join(
    tmpdir(),
    "milksu-product-actions-",
  ));
  const readOnlyTools = [
    "read",
    "grep",
    "find",
    "ls",
    "milksu_progress",
    "milksu_ask",
    "milksu_workspace",
    "lsp_diagnostics",
    "web_search",
    "web_fetch",
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
    "milksu_ask",
    "milksu_workspace",
    "lsp_diagnostics",
    "web_search",
    "web_fetch",
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
    "milksu_ask",
    "milksu_workspace",
    "lsp_diagnostics",
    "lsp_fix",
    "web_search",
    "web_fetch",
    "goal_complete",
    "goal_blocked",
  ];
  const cases = [
    {
      kind: "understand",
      executionMode: "plan",
      tools: readOnlyTools,
    },
    {
      kind: "test",
      executionMode: "go",
      tools: testTools,
    },
    {
      kind: "review",
      executionMode: "plan",
      tools: readOnlyTools,
    },
    {
      kind: "fix",
      executionMode: "go",
      tools: fixTools,
    },
    {
      kind: "summary",
      executionMode: "plan",
      tools: readOnlyTools,
    },
  ];

  for (const value of cases) {
    const action = normalizeCodingProductAction(workspace, { kind: value.kind });
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

test("Go Project Auto uses Pi native shell and file semantics", {
  skip: process.platform !== "darwin",
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-policy-"));
  const outside = join(tmpdir(), `milksu-policy-outside-${Date.now()}.txt`);
  const policy = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
  });
  assert.equal(policy.activeTools.includes("milksu_archify"), true);
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
  await bash.execute(
    "outside-command-write",
    { command: `printf native > ${JSON.stringify(outside)}` },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(outside, "utf8"), "native");
  const write = policy.customTools.find(tool => tool.name === "write");
  await write.execute(
    "outside-write",
    { path: outside, content: "pi-native" },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(outside, "utf8"), "pi-native");
});

test("Go Project Auto shell can follow the user's request into another directory", {
  skip: process.platform !== "darwin",
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-primary-"));
  const authorized = await mkdtemp(join(tmpdir(), "milksu-coding-authorized-"));
  const unauthorized = await mkdtemp(join(tmpdir(), "milksu-coding-unauthorized-"));
  const policy = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
  });
  const bash = policy.customTools.find(tool => tool.name === "bash");
  await bash.execute(
    "command-in-authorized-project",
    {
      command: `cd ${JSON.stringify(authorized)} && printf allowed > command.txt`,
    },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(join(authorized, "command.txt"), "utf8"), "allowed");
  await bash.execute(
    "command-in-user-project",
    {
      command: `cd ${JSON.stringify(unauthorized)} && printf native > command.txt`,
    },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(join(unauthorized, "command.txt"), "utf8"), "native");
});

test("Coding exposes read-only subagent without collaboration worktrees", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-subagent-"));
  const policy = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
  });
  assert.equal(policy.activeTools.includes("subagent"), true);
  const collaboration = policy.capabilities.find(value => value.id === "collaboration");
  assert.equal(collaboration.status, "allowed");
  assert.match(collaboration.detail, /主工作区/);
  assert.match(collaboration.detail, /writer worktree/);

  const gated = await loadSessionPolicy(workspace, "", {
    executionMode: "plan",
    approvalPolicy: "workspace-auto",
  });
  assert.equal(gated.activeTools.includes("subagent"), false);
});

test("Coding collaboration exposes subagent and aligns main tools on registered worktrees", {
  skip: process.platform !== "darwin",
}, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-policy-"));
  const collaborationRoot = await mkdtemp(join(tmpdir(), "milksu-collaboration-policy-"));
  const worktree = join(collaborationRoot, "writer-1");
  const outside = join(tmpdir(), `milksu-collaboration-outside-${Date.now()}.txt`);
  await mkdir(worktree);
  await writeFile(join(worktree, "agent-change.txt"), "candidate\n");
  await mkdir(join(workspace, "node_modules"));
  await writeFile(join(workspace, "node_modules", "fixture.js"), "main dependency\n");
  await mkdir(join(worktree, "node_modules"));
  await writeFile(join(worktree, "node_modules", "fixture.js"), "writer dependency\n");
  await writeFile(join(workspace, "main-only.txt"), "main\n");
  await symlink(join(workspace, "main-only.txt"), join(worktree, "escape.txt"));
  const policy = await loadSessionPolicy(workspace, "", {
    executionMode: "go",
    approvalPolicy: "workspace-auto",
    codingCollaboration: {
      schemaVersion: 2,
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
    "allowed",
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
  await bash.execute(
    "writer-local-dependency-update",
    {
      command: `printf updated > ${JSON.stringify(join(worktree, "node_modules", "fixture.js"))}`,
    },
    undefined,
    undefined,
    {},
  );
  assert.equal(
    await readFile(join(worktree, "node_modules", "fixture.js"), "utf8"),
    "updated",
  );
  assert.equal(
    await readFile(join(workspace, "node_modules", "fixture.js"), "utf8"),
    "main dependency\n",
  );
  await bash.execute(
    "user-path-write",
    { command: `printf native > ${JSON.stringify(outside)}` },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(outside, "utf8"), "native");

  const write = policy.customTools.find(tool => tool.name === "write");
  await write.execute(
    "file-tool-worktree-write",
    { path: join(worktree, "written.txt"), content: "written\n" },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(join(worktree, "written.txt"), "utf8"), "written\n");

  const edit = policy.customTools.find(tool => tool.name === "edit");
  await edit.execute(
    "file-tool-worktree-edit",
    {
      path: join(worktree, "agent-change.txt"),
      edits: [{
        oldText: "candidate\n",
        newText: "reviewed candidate\n",
      }],
    },
    undefined,
    undefined,
    {},
  );
  assert.equal(
    await readFile(join(worktree, "agent-change.txt"), "utf8"),
    "reviewed candidate\n",
  );

  await write.execute(
    "file-tool-user-path-write",
    { path: outside, content: "written" },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(outside, "utf8"), "written");
  await write.execute(
    "file-tool-dependency-write",
    { path: join(worktree, "node_modules", "added.js"), content: "native" },
    undefined,
    undefined,
    {},
  );
  assert.equal(
    await readFile(join(worktree, "node_modules", "added.js"), "utf8"),
    "native",
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

test("Pi native Bash does not create a parallel MilkSU command runtime", {
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
    await assert.rejects(access(join(runtime, "home")), /ENOENT/);
    await assert.rejects(access(join(runtime, "tmp")), /ENOENT/);
    await assert.rejects(access(join(runtime, "runtime-bin")), /ENOENT/);
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

test("Coding network sandbox permits public system TLS configuration only when network is allowed", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-tls-policy-"));
  const networkProfile = sandboxProfile(workspace, true, [], false);
  assert.match(networkProfile, /subpath "\/private\/etc\/ssl"/);
  assert.match(networkProfile, /allow network\*/);

  const offlineProfile = sandboxProfile(workspace, false, [], false);
  assert.doesNotMatch(offlineProfile, /subpath "\/private\/etc\/ssl"/);
  assert.doesNotMatch(offlineProfile, /allow network\*/);
});

test("tool-builder role uses Pi native file and shell tools", async () => {
  const workspace = await workspaceWithManifest(
    manifest("coach", ["read", "edit", "write", "grep", "find", "ls"]),
  );
  await writeFile(join(workspace, "candidate-flags.txt"), "# solver-owned\n", "utf8");
  const policy = await loadSessionPolicy(workspace, "tool-builder");
  assert.equal(policy.activeTools.includes("bash"), true);
  assert.equal(policy.activeTools.includes("milksu_progress"), true);
  assert.equal(policy.activeTools.includes("milksu_ask"), true);
  assert.ok(policy.customTools.some(tool => tool.name === "bash"));

  const write = policy.customTools.find(tool => tool.name === "write");
  await write.execute(
    "candidate-write",
    { path: join(workspace, "candidate-flags.txt"), content: "pi-native" },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(join(workspace, "candidate-flags.txt"), "utf8"), "pi-native");
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

test("strategist can execute and still uses Pi file semantics", async () => {
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
  assert.equal(policy.activeTools.includes("bash"), true);
  assert.equal(policy.activeTools.includes("edit"), true);
  assert.equal(policy.customTools.some(tool => tool.name === "bash"), true);

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
  for (const writablePath of [
    "notes.md",
    "candidate-flags.txt",
    join("work", "tool-requests", "001.md"),
    join("work", "other.md"),
  ]) {
    await write.execute(
      `write-${writablePath}`,
      { path: join(workspace, writablePath), content: "pi-native" },
      undefined,
      undefined,
      {},
    );
    assert.equal(await readFile(join(workspace, writablePath), "utf8"), "pi-native");
  }
});

test("tool-builder bash uses Pi native process semantics", async () => {
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
  await bash.execute(
    "candidate-write",
    { command: "printf pi-native > candidate-flags.txt" },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(join(workspace, "candidate-flags.txt"), "utf8"), "pi-native");
});

test("copilot bash uses Pi native filesystem semantics", async () => {
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

  await bash.execute(
    "read-outside",
    { command: `/bin/cat ${JSON.stringify(outsideFile)}` },
    undefined,
    undefined,
    {},
  );
  await bash.execute(
    "write-policy",
    { command: "printf pi-native > challenge.json" },
    undefined,
    undefined,
    {},
  );
  assert.equal(await readFile(join(workspace, "challenge.json"), "utf8"), "pi-native");
});

