import assert from "node:assert/strict";
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  destructiveDeleteApproval,
  destructiveDeleteDecision,
  destructiveJustification,
  expandDeleteTarget,
  commandForTool,
  consumeDestructiveDeleteCredential,
  consumeMatchingDestructiveDeleteCredential,
  issueDestructiveDeleteCredential,
  recursiveDeleteTargets,
  shellScriptArgument,
  resetDestructiveDeleteCredentials,
  stripFdOnlyRedirections,
  writesPath,
} from "./bridge-destructive-delete.js";

test("recursive deletion parser covers POSIX, PowerShell, Windows, find, and git clean", () => {
  assert.deepEqual(recursiveDeleteTargets('rm -rf -- "$HOME"'), ["$HOME"]);
  assert.deepEqual(
    recursiveDeleteTargets('powershell.exe -Command "Remove-Item -Recurse -Force $env:USERPROFILE"'),
    ["$env:USERPROFILE"],
  );
  assert.deepEqual(recursiveDeleteTargets('rmdir /s /q "%USERPROFILE%"'), ["%USERPROFILE%"]);
  assert.deepEqual(
    recursiveDeleteTargets('rmdir /s /q "C:\\Users\\demo\\large"'),
    ["C:\\Users\\demo\\large"],
  );
  assert.deepEqual(recursiveDeleteTargets("find . -type f -delete"), ["."]);
  assert.deepEqual(recursiveDeleteTargets("git clean -fdx"), ["."]);
  assert.deepEqual(recursiveDeleteTargets("rm -f notes.txt"), []);
});

test("delete target expansion handles home and cross-platform environment forms", () => {
  const options = {
    environment: { HOME: "/users/demo", USERPROFILE: "C:\\Users\\demo" },
    homeDirectory: "/users/demo",
  };
  assert.equal(expandDeleteTarget("~/cache", options).value, "/users/demo/cache");
  assert.equal(expandDeleteTarget("${HOME}/cache", options).value, "/users/demo/cache");
  assert.equal(
    expandDeleteTarget("%USERPROFILE%\\cache", { ...options, platform: "win32" }).value,
    "C:\\Users\\demo\\cache",
  );
  assert.match(expandDeleteTarget("$UNKNOWN/cache", options).error, /无法安全解析/);
});

test("Full Access still asks before deleting home or the conversation workspace", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "milksu-delete-gate-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const workspace = join(home, "project");
  await mkdir(workspace, { recursive: true });
  const policy = {
    approvalPolicy: "full-auto",
    workspace,
    uiLocale: "zh",
  };

  const homeDecision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: 'rm -rf "$HOME"' },
    policy,
    environment: { HOME: home },
    homeDirectory: home,
  });
  assert.equal(homeDecision.action, "approval");
  assert.match(homeDecision.content, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(homeDecision.content, /用户主目录/);

  const workspaceDecision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: "rm -rf ." },
    policy,
    environment: { HOME: home },
    homeDirectory: home,
  });
  assert.equal(workspaceDecision.action, "approval");
  assert.match(workspaceDecision.content, /当前工作区根目录/);
});

test("symlink and glob targets are normalized before the confirmation decision", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "milksu-delete-link-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = join(root, "home");
  const workspace = join(root, "workspace");
  const link = join(workspace, "home-link");
  await mkdir(home, { recursive: true });
  await mkdir(workspace, { recursive: true });
  await symlink(home, link, "dir");
  const policy = { workspace, uiLocale: "zh" };
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `rm -rf '${link}'/*` },
    policy,
    environment: { HOME: home },
    homeDirectory: home,
  });
  assert.equal(decision.action, "approval");
  assert.match(decision.content, /用户主目录/);
  assert.match(decision.content, new RegExp(home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("small recursive deletes remain automatic while large directories require confirmation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "milksu-delete-size-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workspace = join(root, "workspace");
  const small = join(workspace, "small");
  const large = join(workspace, "large");
  await mkdir(small, { recursive: true });
  await mkdir(large, { recursive: true });
  await writeFile(join(small, "one.txt"), "one");
  await Promise.all(Array.from({ length: 1001 }, (_value, index) => (
    writeFile(join(large, `${index}.txt`), "x")
  )));
  const policy = { workspace, uiLocale: "zh" };

  assert.equal(await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `rm -rf '${small}'` },
    policy,
    environment: {},
    homeDirectory: join(root, "home"),
  }), null);
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `rm -rf '${large}'` },
    policy,
    environment: {},
    homeDirectory: join(root, "home"),
  });
  assert.equal(decision.action, "approval");
  assert.match(decision.content, /大型目录/);
});

test("unresolved recursive delete targets are blocked instead of being approved ambiguously", async () => {
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: 'rm -rf "$UNKNOWN_ROOT"' },
    policy: { workspace: process.cwd(), uiLocale: "zh" },
    environment: {},
    homeDirectory: "/nonexistent-home",
  });
  assert.equal(decision.action, "block");
  assert.match(decision.reason, /明确的绝对路径/);
});

// A background task must be judged exactly like the foreground call; anything that
// reaches "needs approval" is refused instead, because nobody can approve it.
test("judges a background task like the foreground command", async () => {
  const directory = await mkdtemp(join(tmpdir(), "milksu-bg-guard-"));
  const target = join(directory, "many");
  await mkdir(target, { recursive: true });
  for (let index = 0; index < 1100; index += 1) {
    await writeFile(join(target, `file-${index}.txt`), "x");
  }

  const foreground = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `rm -rf ${target}` },
    policy: { workspace: directory },
  });
  for (const input of [
    { action: "spawn", command: `rm -rf ${target}` },
    { action: "resume", argv: ["rm", "-rf", target] },
    { action: "restart", commandText: `rm -rf ${target}` },
  ]) {
    const background = await destructiveDeleteDecision({
      toolName: "bg_task",
      input,
      policy: { workspace: directory },
    });
    assert.deepEqual(
      background?.action ?? null,
      foreground?.action ?? null,
      `bg_task action ${input.action} must match the foreground verdict`,
    );
  }

  const harmless = await destructiveDeleteDecision({
    toolName: "bg_task",
    input: { action: "spawn", command: "echo hello" },
    policy: { workspace: directory },
  });
  assert.equal(harmless, null);
});

// A recursive delete must carry the requester's own reason; a bare rm -rf fails closed
// so the card can never show "the requester did not provide a purpose".
test("requires a purpose and a safety note for a recursive delete", () => {
  const missing = destructiveJustification({ command: "rm -rf /x" });
  assert.equal(missing.ok, false);
  assert.match(missing.reason, /request_destructive_delete/);

  assert.equal(destructiveJustification({ justification: { purpose: " ", safety: "x" } }).ok, false);
  assert.equal(destructiveJustification({ justification: { purpose: "x", safety: "  " } }).ok, false);
  assert.equal(destructiveJustification({ purpose: "", safety: "" }).ok, false);

  const provided = destructiveJustification({
    justification: { purpose: "删除旧备份", safety: "程序副本，可重建" },
  });
  assert.equal(provided.ok, true);
  assert.equal(provided.purpose, "删除旧备份");
  assert.equal(provided.safety, "程序副本，可重建");
});

// A pattern or a heredoc body is data, not a command: searching for "rm -rf" must not be
// treated as deleting, while a delete hidden inside a shell string still must be.
test("the parser ignores quoted text, grep patterns and heredoc bodies", () => {
  assert.deepEqual(recursiveDeleteTargets('grep -rn "rm -rf /" .'), []);
  assert.deepEqual(recursiveDeleteTargets("grep rm -rf ."), []);
  assert.deepEqual(recursiveDeleteTargets('echo "rm -rf /tmp/x"'), []);
  assert.deepEqual(recursiveDeleteTargets("cat <<EOF\nrm -rf /tmp/x\nEOF\n"), []);
  assert.deepEqual(recursiveDeleteTargets("cat <<-\"EOT\"\n\trm -rf /tmp/x\n\tEOT\n"), []);
  // ... but a real delete is still found.
  assert.deepEqual(recursiveDeleteTargets("rm -rf /tmp/x"), ["/tmp/x"]);
  assert.deepEqual(recursiveDeleteTargets('rm -rf "/tmp/a b"'), ["/tmp/a b"]);
  assert.deepEqual(recursiveDeleteTargets('bash -c "rm -rf /tmp/y"'), ["/tmp/y"]);
  assert.deepEqual(recursiveDeleteTargets('bash -lc "rm -rf /tmp/y"'), ["/tmp/y"]);
  assert.deepEqual(recursiveDeleteTargets("sh -c 'rm -rf /tmp/z'"), ["/tmp/z"]);
  assert.deepEqual(recursiveDeleteTargets("find /tmp/x -delete"), ["/tmp/x"]);
  // A pipe into xargs has no visible target, so the working directory is assumed.
  assert.deepEqual(recursiveDeleteTargets("grep x . | xargs rm -rf"), ["."]);
})

// An approval authorises one concrete action, once. The credential binds the normalised
// command, the conversation and the targets, and is spent on first use.
test("a destructive credential is spent on first use", () => {
  resetDestructiveDeleteCredentials();
  const input = { command: "rm -rf /tmp/x", conversationId: "conversation-a", targets: ["/tmp/x"] };
  const token = issueDestructiveDeleteCredential(input);

  assert.equal(consumeDestructiveDeleteCredential(token, input).ok, true);
  const replay = consumeDestructiveDeleteCredential(token, input);
  assert.equal(replay.ok, false);
  assert.match(replay.reason, /approval/i);
})

test("a credential only matches the command it was issued for", () => {
  resetDestructiveDeleteCredentials();
  const token = issueDestructiveDeleteCredential({
    command: "rm -rf /tmp/x",
    conversationId: "conversation-a",
    targets: ["/tmp/x"],
  })

  assert.equal(consumeDestructiveDeleteCredential(token, {
    command: "rm -rf /tmp/y",
    conversationId: "conversation-a",
    targets: ["/tmp/y"],
  }).ok, false)
  // Spent by the mismatching attempt, so the original no longer passes either.
  assert.equal(consumeDestructiveDeleteCredential(token, {
    command: "rm -rf /tmp/x",
    conversationId: "conversation-a",
    targets: ["/tmp/x"],
  }).ok, false)
})

test("a credential belongs to one conversation", () => {
  resetDestructiveDeleteCredentials();
  const token = issueDestructiveDeleteCredential({
    command: "rm -rf /tmp/x",
    conversationId: "conversation-a",
    targets: ["/tmp/x"],
  })
  assert.equal(consumeDestructiveDeleteCredential(token, {
    command: "rm -rf /tmp/x",
    conversationId: "conversation-b",
    targets: ["/tmp/x"],
  }).ok, false)
})

// The argv shape and the string shape describe the same delete, so they must decide
// identically - at the parser and at the execution point.
test("the argv shape and the string shape decide alike", () => {
  const asString = commandForTool("bash", { command: "rm -rf a b" })
  const asArgv = commandForTool("bash", { shell: false, argv: ["rm", "-rf", "a", "b"] })
  assert.deepEqual(recursiveDeleteTargets(asArgv), recursiveDeleteTargets(asString))

  resetDestructiveDeleteCredentials();
  issueDestructiveDeleteCredential({
    command: asString,
    conversationId: "conversation-a",
    targets: recursiveDeleteTargets(asString),
  })
  assert.equal(consumeMatchingDestructiveDeleteCredential({
    command: asArgv,
    conversationId: "conversation-a",
    targets: recursiveDeleteTargets(asArgv),
  }).ok, true)
})

// The execution point refuses a delete it never saw approved, even when the tool layer
// was bypassed.
test("a background launch refuses an unreviewed recursive delete", async () => {
  resetDestructiveDeleteCredentials()
  const { spawnCommand } = await import("./bridge-background-process.js")
  assert.throws(
    () => spawnCommand({ command: "rm -rf /tmp/unreviewed" }, "/tmp/milksu-d9-test.log", false),
    /refused this deletion/i,
  )
  // A command that deletes nothing is not refused by this guard (any other failure of
  // the background runtime is unrelated).
  try {
    spawnCommand({ command: "echo hello" }, "/tmp/milksu-d9-test.log", false)
  } catch (error) {
    assert.doesNotMatch(String(error?.message ?? error), /refused this deletion/i)
  }
})

// A command that creates the tree it deletes must be refused: the pre-flight check would
// otherwise see a missing target and let a 1200-file deletion through.
test("a command that creates its own delete target is blocked", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-created-target-"));
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const target = join(workspace, "fresh");
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: {
      command: `rm -rf ${target}; mkdir -p ${target}; `
        + `for i in $(seq 1 1200); do : > "${target}/f$i"; done; rm -rf ${target}`,
    },
    policy: { workspace },
  });
  assert.equal(decision?.action, "block");
  assert.match(String(decision?.reason ?? ""), /creates the target first/i);

  // A delete of a directory the command does not create is judged normally.
  const plain = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `rm -rf ${target}` },
    policy: { workspace },
  });
  assert.notEqual(plain?.action, "block");
});

// The three quoting forms of the same delete must reach the same decision on the sidecar
// side too: the card's "核验 / 风险" line is produced here, not only in the renderer.
test("quoted, single-quoted and bare delete targets decide alike", async (t) => {
  const workspace = await mkdtemp(join(tmpdir(), "milksu-quoting-"));
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const target = join(workspace, "probe-quoting");
  const actions = [];
  for (const command of [`rm -rf "${target}"`, `rm -rf '${target}'`, `rm -rf ${target}`]) {
    const decision = await destructiveDeleteDecision({
      toolName: "bash",
      input: { command },
      policy: { workspace },
    });
    actions.push(decision?.action ?? "none");
  }
  assert.equal(new Set(actions).size, 1, `actions differed: ${JSON.stringify(actions)}`);
  // Quoting must not change whether the guard recognises the target at all.
  const guarded = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: 'rm -rf "/"' },
    policy: { workspace },
  });
  assert.ok(guarded?.action, "a quoted root target must still be recognised as destructive");
});

// The first half of the script guard: recognising which file a command would execute.
// `bash -e x.sh`, `source x.sh` and `. x.sh` must all resolve to x.sh, while an ordinary
// command must not be mistaken for a script reference.
test("guard-script-ref: the named script is recognised", () => {
  assert.equal(shellScriptArgument(["bash", "/tmp/x.sh"]), "/tmp/x.sh")
  assert.equal(shellScriptArgument(["sh", "-e", "/tmp/x.sh"]), "/tmp/x.sh")
  assert.equal(shellScriptArgument(["/bin/bash", "/tmp/x.sh"]), "/tmp/x.sh")
  assert.equal(shellScriptArgument(["source", "/tmp/x.sh"]), "/tmp/x.sh")
  assert.equal(shellScriptArgument([".", "/tmp/x.sh"]), "/tmp/x.sh")
  assert.equal(shellScriptArgument(["python3", "/tmp/x.py"]), "/tmp/x.py")
  assert.equal(shellScriptArgument(["./wipe.sh"]), "./wipe.sh")

  // Ordinary commands are not script references.
  assert.equal(shellScriptArgument(["rm", "-rf", "/tmp/x"]), undefined)
  assert.equal(shellScriptArgument(["bash", "-c", "rm -rf /tmp/x"]), undefined)
  assert.equal(shellScriptArgument(["find", "/tmp/x", "-delete"]), undefined)
  assert.equal(shellScriptArgument([]), undefined)
})


// A delete can hide inside a script the command merely names. The guard reads the file and
// judges its contents with this same parser - without turning every script into a refusal.
test("guard-script: a script that removes a tree is caught", async (t) => {
  // /tmp keeps the path free of spaces: an unquoted path would be split by the shell
  // word parser, which is a property of the command text rather than of this feature.
  const workspace = await mkdtemp("/tmp/milksu-script-guard-");
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const target = join(workspace, "big");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "f1"), "");
  const script = join(workspace, "wipe.sh");
  await writeFile(script, `#!/bin/sh\nrm -rf "${target}"\n`);

  // guard-script-1: the delete lives in the named script.
  assert.deepEqual(recursiveDeleteTargets(`bash ${script}`), [target]);
  assert.deepEqual(recursiveDeleteTargets(`sh -e ${script}`), [target]);
  assert.deepEqual(recursiveDeleteTargets(`source ${script}`), [target]);

  // guard-script-2: an ordinary build script that removes nothing recursive is untouched.
  const build = join(workspace, "build.sh");
  await writeFile(build, "#!/bin/sh\nnpm run build\nrm -f dist/app.js\n");
  assert.deepEqual(recursiveDeleteTargets(`bash ${build}`), []);

  // guard-script-3: indirect calls are followed (two levels).
  const outer = join(workspace, "outer.sh");
  await writeFile(outer, `#!/bin/sh\nbash ${script}\n`);
  assert.deepEqual(recursiveDeleteTargets(`bash ${outer}`), [target]);

  // guard-script-4: a missing script is not a refusal trigger.
  assert.deepEqual(recursiveDeleteTargets(`bash ${join(workspace, "nope.sh")}`), []);

  // A cycle terminates instead of recursing forever.
  const a = join(workspace, "a.sh");
  const b = join(workspace, "b.sh");
  await writeFile(a, `#!/bin/sh\nbash ${b}\n`);
  await writeFile(b, `#!/bin/sh\nbash ${a}\n`);
  assert.deepEqual(recursiveDeleteTargets(`bash ${a}`), []);
});

// The guard must not turn ordinary project work into a refusal: a build script that clears
// its own cache is not a destructive request.
test("guard-script-benign: a project-local build script still runs", async (t) => {
  const workspace = await mkdtemp("/tmp/milksu-script-benign-");
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const script = join(workspace, "build.sh");
  await writeFile(script, "#!/bin/sh\nnpm run build\nrm -rf node_modules/.cache\nrm -rf dist\n");

  // The targets are still recognised (as written in the script) ...
  assert.deepEqual(
    recursiveDeleteTargets(`bash ${script}`).sort(),
    ["dist", "node_modules/.cache"],
  )
  // ... but they stay inside the project, so the gate lets them through.
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `bash ${script}` },
    policy: { workspace },
  })
  assert.notEqual(decision?.action, "block")
});

// A delete reached through two levels of scripts must still be caught: depth really works.
test("guard-script-indirect: a two-level indirection is still caught", async (t) => {
  const workspace = await mkdtemp("/tmp/milksu-script-indirect-");
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const target = join(workspace, "big");
  await mkdir(target, { recursive: true });
  for (let index = 0; index < 1200; index += 1) {
    await writeFile(join(target, `f${index}`), "");
  }
  const inner = join(workspace, "inner.sh");
  const outer = join(workspace, "outer.sh");
  await writeFile(inner, `#!/bin/sh\nrm -rf "${target}"\n`);
  await writeFile(outer, `#!/bin/sh\nbash ${inner}\n`);

  assert.deepEqual(recursiveDeleteTargets(`bash ${outer}`), [target]);
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `bash ${outer}` },
    policy: { workspace },
  })
  assert.equal(decision?.action, "approval");
});

// A script that is not there must not freeze the command.
test("guard-script-missing: a missing script does not block anything", async (t) => {
  const workspace = await mkdtemp("/tmp/milksu-script-missing-");
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const missing = join(workspace, "nope.sh");
  assert.deepEqual(recursiveDeleteTargets(`bash ${missing}`), []);
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `bash ${missing}` },
    policy: { workspace },
  })
  assert.notEqual(decision?.action, "block")
});

// A -> B -> A must terminate thanks to the visited set.
test("guard-script-cycle: mutual references converge", async (t) => {
  const workspace = await mkdtemp("/tmp/milksu-script-cycle-");
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const a = join(workspace, "a.sh");
  const b = join(workspace, "b.sh");
  await writeFile(a, `#!/bin/sh\nbash ${b}\n`);
  await writeFile(b, `#!/bin/sh\nbash ${a}\n`);
  assert.deepEqual(recursiveDeleteTargets(`bash ${a}`), []);
});

// `./wipe.sh` is read, but a script run by an absolute path (`/tmp/wipe.sh`) was still skipped:
// it is the same delete, so the file has to be read either way.
test("guard-script-path: a script run by an absolute path is read", async (t) => {
  const workspace = await mkdtemp("/tmp/milksu-script-path-");
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const target = join(workspace, "big");
  await mkdir(target, { recursive: true });
  await writeFile(join(target, "f1"), "");
  const script = join(workspace, "wipe.sh");
  await writeFile(script, `#!/bin/sh\nrm -rf "${target}"\n`);

  assert.equal(shellScriptArgument([script]), script);
  assert.deepEqual(recursiveDeleteTargets(`${script}`), [target]);
  assert.deepEqual(recursiveDeleteTargets(`cd / && ${script}`), [target]);

  // A bare binary path is not a script and is not read as text.
  assert.equal(shellScriptArgument(["/usr/bin/rm"]), undefined);
});

// A script the command writes itself does not exist when the decision is made, so its contents
// cannot be read. Reporting "no targets" would let the delete run unseen.
test("guard-script-written: a script the command writes is refused", async (t) => {
  const workspace = await mkdtemp("/tmp/milksu-script-written-");
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const script = join(workspace, "wipe.sh");

  const written = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `printf 'rm -rf /tmp/big' > ${script} && bash ${script}` },
    policy: { workspace },
  });
  assert.equal(written?.action, "block");

  // A heredoc counts as writing it too.
  const heredoc = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `cat > ${script} <<'EOF'\nrm -rf /tmp/big\nEOF\nbash ${script}` },
    policy: { workspace },
  });
  assert.equal(heredoc?.action, "block");

  // A script that is merely missing is not a refusal: the command naming it cannot run anyway.
  const missing = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `bash ${join(workspace, "nope.sh")}` },
    policy: { workspace },
  });
  assert.notEqual(missing?.action, "block");
});

// The guard has to see `~` as the real home directory rather than as a literal name.
test("guard-home: `~` is expanded before the target is judged", async () => {
  const decision = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: "rm -rf ~" },
    policy: { workspace: "/tmp/not-the-home" },
    homeDirectory: "/Users/probe",
  });
  assert.equal(decision?.action, "approval");
  assert.match(decision.content, /\/Users\/probe/);
});

// The card can only judge a delete if the approval carries the delete: a bare path arrives as
// plain text, which is not recognisable as a deletion.
test("guard-approval-input: request_destructive_delete always sends a structured delete", () => {
  const approval = destructiveDeleteApproval({ target: "/tmp/gate-probe", decision: null });
  const parsed = JSON.parse(approval.input);
  assert.equal(parsed.command, 'rm -rf "/tmp/gate-probe"');
  assert.deepEqual(parsed.normalizedTargets.map(entry => entry.path), ["/tmp/gate-probe"]);
  assert.ok(recursiveDeleteTargets(parsed.command).length > 0);

  // When the guard already produced structured input, that one is used unchanged.
  const withDecision = destructiveDeleteApproval({
    target: "/tmp/gate-probe",
    decision: { content: "ready", input: '{"command":"rm -rf \\"/x\\""}' },
  });
  assert.equal(withDecision.content, "ready");
  assert.equal(withDecision.input, '{"command":"rm -rf \\"/x\\""}');
});

// `2>&1` merges stderr into the pipe; it writes no file. Treating it as a redirection made the
// write-detection fire and then match whatever path the command happened to mention, so
// `./node_modules/.bin/vitest run X 2>&1 | tail` was refused as "writes X".
test("guard-fd: descriptor redirections are not file writes", () => {
  const script = "/tmp/guard-fd-target.sh";
  // No file redirection at all -> not a write, whatever the path looks like.
  assert.equal(writesPath(`./node_modules/.bin/vitest run ${script} 2>&1 | tail`, script), false);
  assert.equal(writesPath(`bash -c 'run ${script}' 2>&1`, script), false);
  assert.equal(writesPath(`node ${script} 2>&1 >/dev/null`, script), false);
  // The fd forms themselves are stripped, not the path.
  assert.equal(stripFdOnlyRedirections("cmd 2>&1 | tail").replace(/\s+/g, " ").trim(), "cmd | tail");
  assert.equal(stripFdOnlyRedirections("cmd >/dev/null 2>&1").trim(), "cmd");
  // A real redirection that names the same path must still count.
  assert.equal(writesPath(`printf 'rm -rf /tmp/x' > ${script} && bash ${script}`, script), true);
  // A real redirection naming a different path must not.
  assert.equal(writesPath(`printf 'x' > /tmp/other.sh && bash ${script}`, script), false);
});

// The depth limit stops the guard from reading further. Reporting "no targets" there made a
// delete four scripts deep pass unseen, so a chain that goes past the limit is refused.
test("guard-script-depth: a chain past the depth limit is refused", async (t) => {
  const workspace = await mkdtemp("/tmp/milksu-script-depth-");
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const script = level => join(workspace, `level-${level}.sh`);
  await writeFile(script(4), `#!/bin/sh\nrm -rf "${workspace}"\n`);
  for (const level of [3, 2, 1, 0]) {
    await writeFile(script(level), `#!/bin/sh\nbash ${script(level + 1)}\n`);
  }

  // Within the limit the delete is found and judged: depth 0 is the command, then one level
  // per script it reads, so entering at level-2 still reaches level-4's delete.
  const shallow = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `bash ${script(2)}` },
    policy: { workspace },
  });
  assert.equal(shallow?.action, "approval");

  // One level earlier the chain runs past the limit, so the guard cannot see the delete; it
  // has to refuse rather than allow.
  const deep = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `bash ${script(1)}` },
    policy: { workspace },
  });
  assert.equal(deep?.action, "block");

  // The depth reason is its own sentence: a chain that merely nests too deep is NOT a script the
  // command writes, and it must not be described as one.
  assert.match(String(deep?.reason ?? ""), /嵌套超过 3 层（已到第 4 层）/);
  assert.doesNotMatch(String(deep?.reason ?? ""), /命令自己写入的脚本/);

  const english = await destructiveDeleteDecision({
    toolName: "bash",
    input: { command: `bash ${script(1)}` },
    policy: { workspace, uiLocale: "en" },
  });
  assert.equal(english?.action, "block");
  assert.match(String(english?.reason ?? ""), /nests deeper than 3 levels \(reached level 4\)/);
  // No Chinese fragment may be pasted into the English sentence.
  assert.doesNotMatch(String(english?.reason ?? ""), /[\u4e00-\u9fff]/);
});

// The other reason keeps its own wording, in both languages: the command writes a script that does
// not exist yet, so the guard cannot read what it would delete.
test("a written-but-unreadable script is refused with the write reason", async (t) => {
  const workspace = await mkdtemp("/tmp/milksu-script-written-copy-");
  t.after(async () => {
    await rm(workspace, { recursive: true, force: true });
  });
  const script = join(workspace, "generated.sh");
  const command = `printf 'rm -rf ${workspace}' > ${script} && bash ${script}`;

  for (const [locale, expected, forbidden] of [
    ["zh", /命令自己写入的脚本/, /嵌套超过/],
    ["en", /it writes the script\(s\)/, /嵌套/],
  ]) {
    const decision = await destructiveDeleteDecision({
      toolName: "bash",
      input: { command },
      policy: { workspace, uiLocale: locale },
    });
    assert.equal(decision?.action, "block");
    assert.match(String(decision?.reason ?? ""), expected);
    assert.doesNotMatch(String(decision?.reason ?? ""), forbidden);
    if (locale === "en") {
      // The English sentence must not carry a Chinese fragment from the other copy.
      assert.doesNotMatch(String(decision?.reason ?? ""), /[\u4e00-\u9fff]/);
    }
  }
});
