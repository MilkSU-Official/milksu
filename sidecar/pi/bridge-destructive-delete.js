import { createHash } from "node:crypto";
import { readFileSync as readScriptFileSync } from "node:fs";
import {
  lstat,
  readdir,
  realpath,
} from "node:fs/promises";
import { homedir } from "node:os";
import {
  dirname,
  isAbsolute,
  parse,
  relative,
  resolve,
  sep,
} from "node:path";

const largeDirectoryEntryLimit = 1000;
const largeDirectoryByteLimit = 1024 * 1024 * 1024;

// An approval is for one concrete action, not for a class of actions. The credential
// binds the normalised command, the conversation and the targets together, and it is
// spent on first use, so re-running "the same" delete needs a fresh review.
const destructiveCredentialTtlMs = 5 * 60 * 1000;
const destructiveCredentials = new Map();

function normalizeCommandText(command) {
  return String(command ?? "").replace(/\s+/g, " ").trim();
}

export function destructiveCredentialFingerprint(input = {}) {
  const targets = [...(input.targets ?? [])].map(value => String(value)).sort();
  return createHash("sha256")
    .update([
      normalizeCommandText(input.command),
      String(input.conversationId ?? ""),
      targets.join("\u0000"),
    ].join("\u0001"))
    .digest("hex");
}

export function issueDestructiveDeleteCredential(input, now = Date.now()) {
  const fingerprint = destructiveCredentialFingerprint(input);
  const token = createHash("sha256")
    .update(`${fingerprint}:${now}:${Math.random()}:${destructiveCredentials.size}`)
    .digest("hex");
  destructiveCredentials.set(token, { fingerprint, issuedAt: now });
  return token;
}

// Returns the reason instead of throwing so both callers report the same wording.
export function consumeDestructiveDeleteCredential(token, input, now = Date.now()) {
  const key = String(token ?? "");
  const record = destructiveCredentials.get(key);
  if (!record) {
    return {
      ok: false,
      reason:
        "MilkSU refused this deletion: it has no reviewed approval left (an approval is "
        + "spent once, so run it again to review it again)",
    };
  }
  // Spent on first use, whatever the outcome: a mismatching replay must not keep it alive.
  destructiveCredentials.delete(key);
  if (now - record.issuedAt > destructiveCredentialTtlMs) {
    return { ok: false, reason: "MilkSU refused this deletion: the approval expired" };
  }
  if (record.fingerprint !== destructiveCredentialFingerprint(input)) {
    return {
      ok: false,
      reason: "MilkSU refused this deletion: it does not match the command that was approved",
    };
  }
  return { ok: true, reason: "" };
}

export function resetDestructiveDeleteCredentials() {
  destructiveCredentials.clear();
}

// The execution point does not receive a token: it presents the command it is about to
// run and only passes when a reviewed approval for exactly that command is still unspent.
export function consumeMatchingDestructiveDeleteCredential(input, now = Date.now()) {
  const fingerprint = destructiveCredentialFingerprint(input);
  for (const [token, record] of destructiveCredentials) {
    if (record.fingerprint !== fingerprint) continue;
    return consumeDestructiveDeleteCredential(token, input, now);
  }
  return {
    ok: false,
    reason:
      "MilkSU refused this deletion: it was never reviewed here, and a background launch "
      + "cannot be approved interactively. Run it in the foreground so it can be reviewed.",
  };
}

function samePath(left, right, platform = process.platform) {
  const normalize = value => (
    platform === "win32" ? value.toLowerCase() : value
  );
  return normalize(resolve(left)) === normalize(resolve(right));
}

function containsPath(parent, child, platform = process.platform) {
  const value = relative(resolve(parent), resolve(child));
  if (value === "") return true;
  const normalized = platform === "win32" ? value.toLowerCase() : value;
  return normalized !== ".."
    && !normalized.startsWith(`..${sep}`)
    && !isAbsolute(normalized);
}

function environmentValue(environment, name, platform) {
  if (Object.hasOwn(environment, name)) return String(environment[name] ?? "");
  if (platform !== "win32") return undefined;
  const key = Object.keys(environment).find(value => (
    value.toLowerCase() === name.toLowerCase()
  ));
  return key ? String(environment[key] ?? "") : undefined;
}

export function expandDeleteTarget(
  rawTarget,
  {
    environment = process.env,
    homeDirectory = homedir(),
    platform = process.platform,
  } = {},
) {
  let value = String(rawTarget ?? "").trim();
  if (!value) return { error: "删除命令没有给出目标路径" };
  value = value.replace(/^['"]|['"]$/g, "");
  if (value === "~" || value.startsWith(`~${sep}`) || value.startsWith("~/")) {
    value = `${homeDirectory}${value.slice(1)}`;
  }
  let unresolved = "";
  const replaceVariable = (_match, name) => {
    const replacement = environmentValue(environment, name, platform);
    if (replacement === undefined) {
      unresolved = name;
      return _match;
    }
    return replacement;
  };
  value = value
    .replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, replaceVariable)
    .replace(/\$env:([A-Za-z_][A-Za-z0-9_]*)/gi, replaceVariable)
    .replace(/\$([A-Za-z_][A-Za-z0-9_]*)/g, replaceVariable)
    .replace(/%([A-Za-z_][A-Za-z0-9_]*)%/g, replaceVariable);
  if (unresolved || /`|\$\(|\$\{|\$[A-Za-z_]|%[A-Za-z_][A-Za-z0-9_]*%/.test(value)) {
    return {
      error: `MilkSU 无法安全解析删除目标中的变量或命令替换：${unresolved || rawTarget}`,
    };
  }

  const globIndex = value.search(/[?*[]/);
  if (globIndex >= 0) {
    const prefix = value.slice(0, globIndex);
    const slash = Math.max(prefix.lastIndexOf("/"), prefix.lastIndexOf("\\"));
    value = slash >= 0 ? prefix.slice(0, slash) || parse(prefix).root : ".";
  }
  return { value };
}

function shellWords(command) {
  const words = [];
  let word = "";
  let quote = "";
  let escaped = false;
  const flush = () => {
    if (word) words.push(word);
    word = "";
  };
  const source = String(command ?? "");
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (escaped) {
      word += character;
      escaped = false;
      continue;
    }
    if (character === "\\" && quote !== "'") {
      const next = source[index + 1] ?? "";
      const escapesNext = quote === '"'
        ? ['"', "\\", "$", "`", "\n"].includes(next)
        : /[\s'"\\;&|]/.test(next);
      if (escapesNext) escaped = true;
      else word += character;
      continue;
    }
    if (quote) {
      if (character === quote) quote = "";
      else word += character;
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      continue;
    }
    if (/\s/.test(character)) {
      flush();
      continue;
    }
    if ([";", "|", "&", "\n"].includes(character)) {
      flush();
      words.push(character);
      continue;
    }
    word += character;
  }
  flush();
  return words;
}

// A heredoc body is data, not commands: "cat <<EOF" followed by "rm -rf /" must not be
// read as a delete. Only the line that opens the heredoc is kept.
function stripHeredocBodies(command) {
  const lines = String(command ?? "").split("\n");
  const kept = [];
  let pending = null;
  for (const line of lines) {
    if (pending) {
      const candidate = pending.stripTabs ? line.replace(/^\t+/, "") : line;
      if (candidate.trim() === pending.marker) pending = null;
      continue;
    }
    kept.push(line);
    const match = /<<(-?)\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\2/.exec(line);
    if (match) pending = { marker: match[3], stripTabs: match[1] === "-" };
  }
  return kept.join("\n");
}

// These read, print or search - they never delete a tree. Without this, a pattern like
// `grep rm -rf .` (or any unquoted search term) looked like an actual recursive delete.
const readOnlyShellCommands = new Set([
  "grep", "egrep", "fgrep", "rg", "ag", "ack",
  "echo", "printf", "cat", "head", "tail", "less", "more", "wc",
  "which", "whereis", "type",
]);

function commandSegments(command) {
  const segments = [[]];
  for (const word of shellWords(command)) {
    if ([";", "|", "&", "\n"].includes(word)) {
      if (segments.at(-1).length) segments.push([]);
      continue;
    }
    segments.at(-1).push(word);
  }
  return segments.filter(segment => segment.length);
}

function optionHasRecursive(option) {
  return option === "--recursive"
    || option.toLowerCase() === "-recurse"
    || /^-[^-]*[rR]/.test(option)
    || /^\/[sS]$/.test(option);
}

function positionalTargets(words, start, ignoredOptions = new Set()) {
  const targets = [];
  let optionsEnded = false;
  for (let index = start; index < words.length; index += 1) {
    const value = words[index];
    if (value === "--") {
      optionsEnded = true;
      continue;
    }
    if (!optionsEnded && value.startsWith("-")) {
      if (ignoredOptions.has(value.toLowerCase())) index += 1;
      continue;
    }
    if (!optionsEnded && /^\/[A-Za-z]+$/.test(value)) continue;
    targets.push(value);
  }
  return targets;
}

const scriptDeleteMaxDepth = 3;

/**
 * Split a command into its top-level statements (newline, `;`, `&&`, `||`) outside quotes.
 * Each statement is judged on its own: a read-only statement must not hide the delete that
 * follows it on the next line.
 */
export function splitTopLevelStatements(command) {
  const source = String(command ?? "");
  const parts = [];
  let current = "";
  let quote = "";
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      current += character;
      if (character === quote) quote = "";
      continue;
    }
    if (character === "'" || character === '"') {
      quote = character;
      current += character;
      continue;
    }
    const isBreak = character === "\n" || character === ";"
      || (character === "&" && source[index + 1] === "&")
      || (character === "|" && source[index + 1] === "|");
    if (isBreak) {
      if (current.trim()) parts.push(current.trim());
      current = "";
      if (character === "&" || character === "|") index += 1;
      continue;
    }
    current += character;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/**
 * `bash script.sh`, `sh -e script.sh`, `source file`, `. file`, `python file`: the file the
 * command would execute. Flags are skipped so `bash -e x.sh` still resolves to x.sh, while
 * `bash -c "..."` is not a file at all and therefore returns nothing.
 */
export function shellScriptArgument(words) {
  const list = Array.isArray(words) ? words.map(value => String(value)) : [];
  const head = (list[0] ?? "").split(/[\\/]/).at(-1).toLowerCase();
  if (head === "source" || head === ".") return list[1];
  if (list[0] && (/^\.\//.test(list[0]) || (!list[0].includes('/') && head.endsWith('.sh')))) return list[0];
  const interpreters = new Set([
    "sh", "bash", "zsh", "dash", "ksh", "python", "python3", "perl", "ruby", "node",
  ]);
  if (!interpreters.has(head)) return undefined;
  let index = 1;
  while (index < list.length && list[index].startsWith("-")) {
    // A combined flag containing `c` carries an inline script, not a file name.
    if (/c/.test(list[index])) return undefined;
    index += 1;
  }
  return list[index];
}

// A missing, unreadable or oversized script is not itself a reason to refuse: the command
// that named it is still judged on its own.
function scriptText(file, readScript) {
  try {
    const content = readScript(file, "utf8");
    return typeof content === "string" && content.length <= 1_000_000 ? content : undefined;
  } catch {
    return undefined;
  }
}

export function recursiveDeleteTargets(command, options = {}) {
  const depth = Number(options.depth ?? 0);
  const seen = options.seen instanceof Set ? options.seen : new Set();
  const readScript = options.readScript ?? readScriptFileSync;
  // Depth and a visited set keep indirect scripts and cycles bounded.
  if (depth > scriptDeleteMaxDepth) return [];
  // Strip heredoc bodies first: their text is data, and splitting it into statements would
  // judge a "rm -rf" that only appears inside the heredoc.
  const statements = splitTopLevelStatements(stripHeredocBodies(command));
  if (statements.length > 1) {
    // Splitting is not a new indirection level, so the depth stays the same.
    return statements.flatMap(statement => recursiveDeleteTargets(statement, { depth, seen, readScript }));
  }
  const targets = [];
  for (const words of commandSegments(stripHeredocBodies(command))) {
    // A delete hides easily in a file the command merely names (`bash /tmp/x.sh`). Read it
    // and judge its contents through this same parser, so project-local work still passes.
    const scriptArgument = shellScriptArgument(words);
    if (scriptArgument && !scriptArgument.startsWith("$")) {
      const resolved = resolve(scriptArgument);
      if (!seen.has(resolved)) {
        const content = scriptText(resolved, readScript);
        if (content !== undefined) {
          seen.add(resolved);
          targets.push(...recursiveDeleteTargets(content, { depth: depth + 1, seen, readScript }));
        }
      }
    }
    const head = (words[0] ?? "").split(/[\\/]/).at(-1).toLowerCase();
    if (readOnlyShellCommands.has(head)) continue;
    // A delete hidden in a shell string (`bash -c "rm -rf x"`) is still a delete.
    if (["sh", "bash", "zsh", "dash", "ksh"].includes(head)) {
      const commandFlag = words.slice(1).findIndex(value => value === "-c" || /^-[A-Za-z]*c$/.test(value));
      if (commandFlag >= 0 && words[commandFlag + 2]) {
        targets.push(...recursiveDeleteTargets(words.slice(commandFlag + 2).join(" ")));
      }
      continue;
    }
    // `... | xargs rm -rf` takes its targets from stdin, so the target is unknown: treat
    // it as the working directory instead of letting it pass unseen.
    if (head === "xargs") {
      const inner = recursiveDeleteTargets(words.slice(1).join(" "));
      if (inner.length) targets.push(...inner);
      else if (words.some(value => /(^|\/)rm$/.test(value))) targets.push(".");
      continue;
    }
    const lowered = words.map(value => value.toLowerCase());
    const powershellIndex = lowered.findIndex(value => (
      ["powershell", "powershell.exe", "pwsh", "pwsh.exe"].includes(
        value.split(/[\\/]/).at(-1),
      )
    ));
    const commandIndex = lowered.findIndex((value, index) => (
      index > powershellIndex && ["-command", "-c"].includes(value)
    ));
    if (powershellIndex >= 0 && commandIndex >= 0 && words[commandIndex + 1]) {
      targets.push(...recursiveDeleteTargets(words.slice(commandIndex + 1).join(" ")));
    }
    for (let index = 0; index < words.length; index += 1) {
      const executable = lowered[index].split(/[\\/]/).at(-1);
      if (executable === "find" && lowered.includes("-delete")) {
        const candidate = words[index + 1];
        if (candidate && !candidate.startsWith("-")) targets.push(candidate);
        continue;
      }
      if (executable === "git" && lowered[index + 1] === "clean") {
        const options = words.slice(index + 2).filter(value => value.startsWith("-"));
        if (options.some(value => /f/i.test(value)) && options.some(value => /d/i.test(value))) {
          const pathIndex = lowered.indexOf("--", index + 2);
          targets.push(...(pathIndex >= 0 ? words.slice(pathIndex + 1) : ["."]));
        }
        continue;
      }
      if (!["rm", "rmdir", "rd", "del", "remove-item"].includes(executable)) continue;
      const recursive = words.slice(index + 1).some(optionHasRecursive);
      if (!recursive) continue;
      if (executable === "remove-item") {
        const pathOption = lowered.findIndex((value, valueIndex) => (
          valueIndex > index && ["-path", "-literalpath"].includes(value)
        ));
        if (pathOption >= 0 && words[pathOption + 1]) targets.push(words[pathOption + 1]);
        else targets.push(...positionalTargets(
          words,
          index + 1,
          new Set(["-filter", "-include", "-exclude"]),
        ));
      } else {
        targets.push(...positionalTargets(words, index + 1));
      }
    }
  }
  return [...new Set(targets.filter(Boolean))];
}

async function canonicalPath(value) {
  const absolute = resolve(value);
  let existing = absolute;
  for (;;) {
    try {
      const reviewed = await realpath(existing);
      return resolve(reviewed, relative(existing, absolute));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    const parent = dirname(existing);
    if (parent === existing) return absolute;
    existing = parent;
  }
}

async function inspectDirectory(root) {
  const queue = [root];
  let entries = 0;
  let bytes = 0;
  while (queue.length) {
    const current = queue.shift();
    let info;
    try {
      info = await lstat(current);
    } catch (error) {
      if (error?.code === "ENOENT") return { exists: false, entries, bytes };
      return { exists: true, entries, bytes, incomplete: true };
    }
    entries += 1;
    bytes += Number(info.size ?? 0);
    if (
      entries > largeDirectoryEntryLimit
      || bytes > largeDirectoryByteLimit
    ) {
      return { exists: true, entries, bytes, large: true };
    }
    if (!info.isDirectory() || info.isSymbolicLink()) continue;
    let children;
    try {
      children = await readdir(current);
    } catch {
      return { exists: true, entries, bytes, incomplete: true };
    }
    for (const child of children) queue.push(resolve(current, child));
  }
  return { exists: true, entries, bytes, large: false };
}

/**
 * A recursive delete must carry the requester's own purpose and safety note. Blank or
 * whitespace-only text counts as missing, and a missing note never reaches the card.
 */
export function destructiveJustification(input) {
  const record = input && typeof input === "object" ? input : {};
  const nested = record.justification && typeof record.justification === "object"
    ? record.justification
    : {};
  const purpose = String(nested.purpose ?? record.purpose ?? "").trim();
  const safety = String(nested.safety ?? record.safety ?? "").trim();
  return {
    ok: Boolean(purpose) && Boolean(safety),
    purpose,
    safety,
    reason: "MilkSU refused this recursive delete: it has no reason attached. "
      + "Use request_destructive_delete and fill in 用途 (purpose) and 安全性 (safety).",
  };
}

export function commandForTool(toolName, input) {
  const record = input && typeof input === "object" ? input : {};
  // An argv shape and a command string describe the same execution, so they must be read
  // the same way for every tool - including shell:false, where only argv exists.
  const argv = Array.isArray(record.argv)
    ? record.argv
    : Array.isArray(record.args)
      ? record.args
      : null;
  if (argv?.length) return argv.map(value => String(value)).join(" ");
  if (toolName === "bash") return String(record.command ?? "");
  if (toolName !== "bg_task") return "";
  // Any action that carries a command or an argv executes something; the guard must
  // judge all of them (spawn/start/restart/resume), not just the ones we remembered.
  return typeof record.command === "string"
    ? record.command
    : typeof record.commandText === "string"
      ? record.commandText
      : "";
}

// A command can create the very tree it deletes (`mkdir -p X; …; rm -rf X`). The target
// then looks missing or tiny to the pre-flight check, so it must be refused outright.
function createsItsOwnTarget(command, targets) {
  const unquote = value => String(value ?? "").replace(/^['"]|['"]$/g, "");
  for (const match of String(command).matchAll(/mkdir\s+(?:-p\s+)?("[^"]+"|'[^']+'|[^\s;&|]+)/g)) {
    const created = unquote(match[1]).trim();
    if (!created) continue;
    const prefix = created.endsWith("/") ? created : `${created}/`;
    if (targets.some(target => String(target) === created || String(target).startsWith(prefix))) {
      return true;
    }
  }
  return false;
}

export async function destructiveDeleteDecision({
  toolName,
  input,
  policy,
  environment = process.env,
  homeDirectory = homedir(),
  platform = process.platform,
}) {
  const command = commandForTool(toolName, input);
  if (!command) return null;
  const rawTargets = recursiveDeleteTargets(command);
  if (!rawTargets.length) return null;
  if (createsItsOwnTarget(command, rawTargets)) {
    return {
      action: "block",
      reason:
        "MilkSU refused this deletion: the same command creates the target first, so what "
        + "it would remove cannot be checked before running it.",
    };
  }

  const workspace = String(policy?.workspace ?? process.cwd()).trim() || process.cwd();
  const protectedRoots = [
    { path: homeDirectory, reason: "用户主目录" },
    { path: workspace, reason: "当前工作区根目录" },
  ];
  const canonicalProtectedRoots = [];
  for (const entry of protectedRoots) {
    try {
      canonicalProtectedRoots.push({
        path: await canonicalPath(entry.path),
        reason: entry.reason,
      });
    } catch {
      // A missing optional root is not a deletion target.
    }
  }

  const reviewedTargets = [];
  for (const rawTarget of rawTargets) {
    const expanded = expandDeleteTarget(rawTarget, {
      environment,
      homeDirectory,
      platform,
    });
    if (expanded.error) {
      return {
        action: "block",
        reason: `${expanded.error}。请先解析成一个明确的绝对路径，再重新发起删除。`,
      };
    }
    const absolute = isAbsolute(expanded.value)
      ? resolve(expanded.value)
      : resolve(workspace, expanded.value);
    const canonical = await canonicalPath(absolute);
    const reasons = [];
    if (samePath(canonical, parse(canonical).root, platform)) {
      reasons.push("文件系统根目录");
    }
    for (const protectedRoot of canonicalProtectedRoots) {
      if (
        samePath(canonical, protectedRoot.path, platform)
        || containsPath(canonical, protectedRoot.path, platform)
      ) {
        reasons.push(protectedRoot.reason);
      }
    }
    const inspection = await inspectDirectory(canonical);
    if (inspection.large) {
      reasons.push(
        `大型目录（已扫描超过 ${largeDirectoryEntryLimit} 项或 ${largeDirectoryByteLimit} 字节）`,
      );
    } else if (inspection.incomplete) {
      reasons.push("无法完整统计影响范围的目录");
    }
    if (reasons.length) {
      reviewedTargets.push({
        raw: rawTarget,
        path: canonical,
        reasons: [...new Set(reasons)],
      });
    }
  }
  if (!reviewedTargets.length) return null;

  const chinese = policy?.uiLocale !== "en";
  const targetSummary = reviewedTargets.map(target => (
    `${target.path}（${target.reasons.join("、")}）`
  )).join("\n");
  return {
    action: "approval",
    content: chinese
      ? `大范围删除需要再次确认\n规范化目标：\n${targetSummary}\n影响：目标中的内容将被递归删除，通常无法从 MilkSU 恢复。\n原始命令：${command}`
      : `Broad deletion requires confirmation\nNormalized target(s):\n${targetSummary}\nImpact: contents will be deleted recursively and usually cannot be recovered by MilkSU.\nOriginal command: ${command}`,
    input: JSON.stringify({
      command,
      normalizedTargets: reviewedTargets,
    }, null, 2),
  };
}

export function destructiveDeleteGuidance() {
  return " Before recursively deleting a workspace root, user home, filesystem root, explicitly authorized root, or a very large directory, explain the exact normalized target and impact. MilkSU requires a separate confirmation for that concrete deletion even under Full Access. Never hide a broad target behind environment variables, command substitution, a symlink, or a glob.";
}
