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

export function recursiveDeleteTargets(command) {
  const targets = [];
  for (const words of commandSegments(command)) {
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

function commandForTool(toolName, input) {
  if (toolName === "bash") return String(input?.command ?? "");
  if (toolName !== "bg_task") return "";
  const action = String(input?.action ?? "").trim();
  if (!["start", "restart"].includes(action)) return "";
  if (typeof input?.command === "string") return input.command;
  return Array.isArray(input?.argv) ? input.argv.join(" ") : "";
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

  const workspace = String(policy?.workspace ?? process.cwd()).trim() || process.cwd();
  const protectedRoots = [
    { path: homeDirectory, reason: "用户主目录" },
    { path: workspace, reason: "当前工作区根目录" },
    ...((policy?.workspaceAccessPaths ?? []).map(path => ({
      path,
      reason: "当前会话授权目录根",
    }))),
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
