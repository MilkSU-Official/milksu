import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { createServer as createHTTPServer } from "node:http";
import { createServer as createTCPServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  loadSessionPolicy,
  normalizeCodingPolicy,
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
      "milksu_progress",
      "lsp_diagnostics",
    ],
  );
  assert.equal(policy.customTools.some(tool => tool.name === "bash"), true);
  assert.equal(policy.activeTools.includes("lsp_fix"), false);
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
      ["read", "grep", "find", "ls", "milksu_progress", "lsp_diagnostics"],
    );
    for (const denied of ["bash", "edit", "write", "lsp_fix"]) {
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
  for (const gated of ["bash", "edit", "write"]) {
    assert.equal(policy.activeTools.includes(gated), true);
  }
  assert.equal(
    ask.capabilities.find(value => value.id === "workspace-write").status,
    "approval-required",
  );
  assert.equal(
    ask.capabilities.find(value => value.id === "command").status,
    "approval-required",
  );
});

test("Coding read can access reviewed packaged skill resources but no other outside path", async () => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-coding-policy-"));
  const resourceRoot = await mkdtemp(join(tmpdir(), "milksu-archify-resource-"));
  const skillPath = join(resourceRoot, "SKILL.md");
  const outside = join(await mkdtemp(join(tmpdir(), "milksu-unreviewed-")), "secret.txt");
  await writeFile(skillPath, "# Archify\n", "utf8");
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
  await assert.rejects(
    read.execute("read-unreviewed", { path: outside }, undefined, undefined, {}),
    /denied path outside/,
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
