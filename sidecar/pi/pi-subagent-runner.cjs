"use strict";

const { spawn } = require("node:child_process");
const { createHash } = require("node:crypto");
const {
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} = require("node:fs");
const { tmpdir } = require("node:os");
const {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  sep,
} = require("node:path");
const { providerRuntimeFor } = require("./current-provider-runtime.cjs");

const readOnlyAgents = new Set([
  "planner",
  "reviewer",
  "scout",
  "security-auditor",
]);
const worktreeAgents = new Set([
  "debugger",
  "docs-writer",
  "refactorer",
  "verifier",
  "worker",
]);
const requiredIsolationFlags = [
  "--no-extensions",
  "--no-skills",
  "--no-prompt-templates",
  "--no-themes",
  "--no-context-files",
  "--no-approve",
  "--no-session",
];
const maxManifestBytes = 64 * 1024;
const maxPromptBytes = 128 * 1024;
function quoted(value) {
  return JSON.stringify(value);
}

function pathWithin(root, target) {
  const value = relative(root, target);
  return value === ""
    || (
      value !== ".."
      && !value.startsWith(`..${sep}`)
      && !isAbsolute(value)
    );
}

function canonical(value, label) {
  try {
    return realpathSync(String(value ?? "").trim());
  } catch {
    throw new Error(`${label} is unavailable`);
  }
}

function readActiveManifest(root, cwd) {
  if (!pathWithin(root, cwd) || cwd === root) {
    throw new Error("effectful subagent cwd is outside MilkSU collaboration storage");
  }
  const taskDirectory = dirname(cwd);
  if (dirname(taskDirectory) !== root) {
    throw new Error("effectful subagent cwd does not match a managed writer slot");
  }
  const key = basename(taskDirectory);
  if (!/^[0-9a-f]{32}$/.test(key)) {
    throw new Error("effectful subagent cwd has an invalid task reservation");
  }
  const manifestPath = join(taskDirectory, "manifest.json");
  const info = lstatSync(manifestPath);
  if (!info.isFile() || info.isSymbolicLink() || info.size > maxManifestBytes) {
    throw new Error("Coding collaboration manifest is not a bounded regular file");
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (
    Number(manifest.schemaVersion) !== 2
    || manifest.phase !== "active"
    || !Array.isArray(manifest.worktrees)
    || manifest.worktrees.length < 1
    || manifest.worktrees.length > 2
    || createHash("sha256")
      .update(String(manifest.conversationId ?? "").trim())
      .digest("hex")
      .slice(0, 32) !== key
  ) {
    throw new Error("Coding collaboration manifest is not active");
  }
  const id = basename(cwd);
  const worktree = manifest.worktrees.find(entry => (
    entry
    && typeof entry === "object"
    && String(entry.id ?? "") === id
    && canonical(entry.path, "manifest worktree") === cwd
  ));
  const expectedBranch = `codex/agent-${key.slice(0, 12)}-${id}`;
  if (
    !worktree
    || !/^writer-[12]$/.test(id)
    || String(worktree.branch ?? "") !== expectedBranch
    || worktree.provisioned !== true
    || worktree.prepared !== true
  ) {
    throw new Error("subagent cwd is not registered by the active collaboration");
  }
  const workspace = canonical(manifest.workspace, "manifest workspace");
  if (pathWithin(root, workspace)) {
    throw new Error("manifest workspace overlaps MilkSU collaboration storage");
  }
  return {
    id,
    branch: expectedBranch,
    workspace,
    manifestPath,
  };
}

function metadataAncestors(roots) {
  const ancestors = new Set(["/opt"]);
  for (const root of roots) {
    let current = dirname(root);
    while (current !== dirname(current)) {
      ancestors.add(current);
      current = dirname(current);
    }
  }
  return [...ancestors];
}

function sandboxProfile({
  cwd,
  mainWorkspace,
  readableFiles = [],
  runtimeDirectory,
  temporaryDirectory,
  writable,
}) {
  const readableRoots = [
    cwd,
    ...(cwd === mainWorkspace ? [] : [join(mainWorkspace, ".git")]),
    runtimeDirectory,
    temporaryDirectory,
    "/System",
    "/usr",
    "/bin",
    "/sbin",
    "/Library",
    "/private/var/select",
    "/Applications/Xcode.app",
    "/opt/homebrew",
    "/usr/local",
  ];
  const writableRoots = [temporaryDirectory, ...(writable ? [cwd] : [])];
  const rules = [
    "(version 1)",
    '(import "system.sb")',
    "(allow process*)",
    "(allow sysctl-read)",
    `(allow file-read-metadata ${metadataAncestors([
      ...readableRoots,
      ...readableFiles,
    ]).map(path => (
      `(literal ${quoted(path)})`
    )).join(" ")})`,
    `(allow file-read* ${readableRoots.map(path => (
      `(subpath ${quoted(path)})`
    )).join(" ")} ${readableFiles.map(path => (
      `(literal ${quoted(path)})`
    )).join(" ")})`,
    `(allow file-write* ${writableRoots.map(path => (
      `(subpath ${quoted(path)})`
    )).join(" ")})`,
    "(allow network*)",
  ];
  if (writable) {
    rules.push(
      `(deny file-write* (literal ${quoted(join(cwd, ".git"))}) `
      + `(subpath ${quoted(join(cwd, ".git"))}))`,
    );
  }
  return rules.join("\n");
}

function prepareRunnerPolicy(environment = process.env, cwd = process.cwd()) {
  if (process.platform !== "darwin") {
    throw new Error("MilkSU subagent containment is currently available only on macOS");
  }
  const agent = String(environment.MILKSU_PI_SUBAGENT_AGENT ?? "").trim();
  if (!readOnlyAgents.has(agent) && !worktreeAgents.has(agent)) {
    throw new Error("MilkSU runner rejected an unsupported subagent role");
  }
  const canonicalCwd = canonical(cwd, "Subagent working directory");
  const collaborationRoot = canonical(
    environment.MILKSU_CODING_COLLABORATION_ROOT,
    "MilkSU collaboration root",
  );
  const runtimeCli = canonical(
    environment.MILKSU_PI_SUBAGENT_CLI,
    "MilkSU subagent Pi runtime",
  );
  const effectful = worktreeAgents.has(agent);
  let worktree;
  let mainWorkspace = canonicalCwd;
  if (pathWithin(collaborationRoot, canonicalCwd) && canonicalCwd !== collaborationRoot) {
    worktree = readActiveManifest(collaborationRoot, canonicalCwd);
    mainWorkspace = worktree.workspace;
  } else {
    if (effectful) {
      throw new Error(`${agent} must run in a managed writer worktree`);
    }
  }
  return {
    agent,
    cwd: canonicalCwd,
    effectful,
    mainWorkspace,
    collaborationRoot,
    runtimeCli,
    runtimeDirectory: dirname(runtimeCli),
    worktree,
  };
}

function validateCLIArguments(argumentsList) {
  for (const flag of requiredIsolationFlags) {
    if (!argumentsList.includes(flag)) {
      throw new Error(`MilkSU subagent runtime is missing required isolation flag ${flag}`);
    }
  }
  for (const value of argumentsList) {
    if (
      value === "--extension"
      || value === "--skill"
      || value === "--prompt-template"
      || value === "--theme"
      || value === "--context-file"
      || value.startsWith("--extension=")
      || value.startsWith("--skill=")
    ) {
      throw new Error("MilkSU subagent runtime rejected an ambient resource flag");
    }
  }
}

function reviewedPromptFiles(
  argumentsList,
  environment = process.env,
) {
  const promptFiles = [];
  for (let index = 0; index < argumentsList.length; index += 1) {
    if (argumentsList[index] !== "--append-system-prompt") continue;
    const rawPath = argumentsList[index + 1];
    if (!rawPath || rawPath.startsWith("--") || promptFiles.length > 0) {
      throw new Error("MilkSU subagent runtime rejected invalid system prompt arguments");
    }
    const rawInfo = lstatSync(rawPath);
    const promptPath = canonical(rawPath, "Subagent system prompt");
    const temporaryRoot = canonical(
      environment.TMPDIR || tmpdir(),
      "MilkSU temporary directory",
    );
    const expectedName = `prompt-${String(
      environment.MILKSU_PI_SUBAGENT_AGENT ?? "",
    ).trim()}.md`;
    if (
      rawInfo.isSymbolicLink()
      || !rawInfo.isFile()
      || rawInfo.size > maxPromptBytes
      || !pathWithin(temporaryRoot, promptPath)
      || basename(dirname(promptPath)).startsWith("pi-subagent-") === false
      || basename(promptPath) !== expectedName
    ) {
      throw new Error("MilkSU subagent runtime rejected an unreviewed system prompt");
    }
    promptFiles.push(promptPath);
    index += 1;
  }
  return promptFiles;
}

function rewriteRoutedModelArguments(argumentsList) {
  const index = argumentsList.indexOf("--model");
  if (index < 0 || typeof argumentsList[index + 1] !== "string") return argumentsList;
  const selected = argumentsList[index + 1].trim();
  if (!selected.startsWith("milksu-route/")) return argumentsList;
  // The parent session uses a virtual milksu-route provider. The isolated
  // child CLI does not register that provider, so map it to the account
  // TokenFlux transport the parent already configured as milksu-relay.
  const next = [...argumentsList];
  next[index + 1] = `milksu-relay/${selected.slice("milksu-route/".length)}`;
  return next;
}

function selectedModel(argumentsList) {
  const index = argumentsList.indexOf("--model");
  if (index < 0 || typeof argumentsList[index + 1] !== "string") return undefined;
  const selected = argumentsList[index + 1].trim();
  const separator = selected.indexOf("/");
  if (separator <= 0 || separator === selected.length - 1) return undefined;
  const provider = selected.slice(0, separator);
  let model = selected.slice(separator + 1);
  const thinkingMatch = model.match(
    /:(off|minimal|low|medium|high|xhigh|max)$/,
  );
  const thinkingLevel = thinkingMatch?.[1];
  if (thinkingMatch) model = model.slice(0, -thinkingMatch[0].length);
  if (
    !/^[a-z0-9][a-z0-9._-]{0,63}$/.test(provider)
    || !model
    || model.length > 256
    || /[\u0000-\u001f\u007f]/u.test(model)
  ) {
    return undefined;
  }
  return { model, provider, thinkingLevel };
}

function writeRuntimeModelConfig(
  agentDirectory,
  argumentsList,
  environment = process.env,
) {
  const selection = selectedModel(argumentsList);
  if (!selection) return undefined;
  let runtime;
  const customProvider = String(
    environment.MILKSU_CUSTOM_PROVIDER_ID ?? "",
  ).trim() === selection.provider;
  if (customProvider) {
    runtime = {
      api: "openai-completions",
      apiKey: "MILKSU_CUSTOM_PROVIDER_KEY",
      baseUrl: "MILKSU_CUSTOM_PROVIDER_URL",
    };
  } else if (selection.provider === "milksu-relay" || selection.provider === "milksu-route") {
    runtime = {
      api: "openai-completions",
      apiKey: "MILKSU_RELAY_KEY",
      baseUrl: "MILKSU_RELAY_URL",
      defaultBaseUrl: "https://api.ciyuanliudong.com/v1",
    };
  } else {
    runtime = providerRuntimeFor(selection.provider);
  }
  if (!runtime) return undefined;
  const baseUrl = String(
    environment[runtime.baseUrl] ?? runtime.defaultBaseUrl ?? "",
  ).trim();
  const needsCustomProvider = customProvider
    || selection.provider === "milksu-relay"
    || selection.provider === "milksu-route"
    || Boolean(baseUrl);
  if (!needsCustomProvider) return undefined;
  if (!/^https?:\/\/[^\s]+$/u.test(baseUrl)) {
    throw new Error("MilkSU subagent runtime rejected an invalid provider endpoint");
  }
  const path = join(agentDirectory, "models.json");
  mkdirSync(agentDirectory, { recursive: true, mode: 0o700 });
  const models = {
    providers: {
      [selection.provider]: {
        baseUrl,
        api: runtime.api,
        apiKey: `$${runtime.apiKey}`,
        models: [{
          id: selection.model,
          name: selection.model,
          reasoning: Boolean(selection.thinkingLevel),
          thinkingLevelMap: selection.thinkingLevel
            ? {
                [selection.thinkingLevel]: selection.thinkingLevel === "off"
                  ? "none"
                  : selection.thinkingLevel,
              }
            : undefined,
          contextWindow: require("./known-context-window.cjs").resolveModelContextWindow(selection.model, 0),
          maxTokens: 32768,
          compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: Boolean(selection.thinkingLevel),
            maxTokensField: "max_tokens",
          },
        }],
      },
    },
  };
  writeFileSync(path, `${JSON.stringify(models, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  return path;
}

function run(argumentsList = process.argv.slice(2), environment = process.env) {
  const resolvedArguments = rewriteRoutedModelArguments(argumentsList);
  validateCLIArguments(resolvedArguments);
  const policy = prepareRunnerPolicy(environment, process.cwd());
  const readableFiles = reviewedPromptFiles(resolvedArguments, environment);
  const temporaryDirectory = mkdtempSync(
    join(environment.TMPDIR || tmpdir(), "milksu-pi-subagent-"),
  );
  const agentDirectory = join(temporaryDirectory, "agent");
  try {
    writeRuntimeModelConfig(
      agentDirectory,
      resolvedArguments,
      environment,
    );
  } catch (error) {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    throw error;
  }
  const childEnvironment = {
    ...environment,
    HOME: temporaryDirectory,
    TMPDIR: temporaryDirectory,
    PI_CODING_AGENT_DIR: agentDirectory,
    PI_CODING_AGENT_SESSION_DIR: join(temporaryDirectory, "sessions"),
    MILKSU_PI_NO_PROJECT_RESOURCE_DISCOVERY: "1",
    MILKSU_PI_SUBAGENT_RUNTIME: "1",
    PI_SKIP_VERSION_CHECK: "1",
  };
  delete childEnvironment.NODE_OPTIONS;
  delete childEnvironment.MILKSU_PI_AGENT_DIR;
  const child = spawn(
    "/usr/bin/sandbox-exec",
    [
      "-p",
      sandboxProfile({
        cwd: policy.cwd,
        mainWorkspace: policy.mainWorkspace,
        readableFiles,
        runtimeDirectory: policy.runtimeDirectory,
        temporaryDirectory,
        writable: policy.effectful,
      }),
      process.execPath,
      policy.runtimeCli,
      ...resolvedArguments,
    ],
    {
      cwd: policy.cwd,
      env: childEnvironment,
      stdio: "inherit",
    },
  );
  const forward = signal => {
    if (!child.killed) child.kill(signal);
  };
  process.once("SIGTERM", () => forward("SIGTERM"));
  process.once("SIGINT", () => forward("SIGINT"));
  child.once("error", error => {
    process.stderr.write(`MilkSU could not start the subagent runtime: ${error.message}\n`);
    rmSync(temporaryDirectory, { recursive: true, force: true });
    process.exitCode = 1;
  });
  child.once("close", (code, signal) => {
    rmSync(temporaryDirectory, { recursive: true, force: true });
    if (signal) {
      process.kill(process.pid, signal);
      return;
    }
    process.exitCode = code ?? 1;
  });
}

module.exports = {
  pathWithin,
  prepareRunnerPolicy,
  readActiveManifest,
  reviewedPromptFiles,
  sandboxProfile,
  validateCLIArguments,
  rewriteRoutedModelArguments,
  writeRuntimeModelConfig,
};

if (require.main === module) {
  try {
    run();
  } catch (error) {
    process.stderr.write(
      `MilkSU subagent runner denied execution: ${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
