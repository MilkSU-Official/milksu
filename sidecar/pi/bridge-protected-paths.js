import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

// The host hands the absolute protected roots over at spawn. The sidecar is where tools run,
// so this is the only place a write can be refused before it happens.
export const PROTECTED_ROOTS_ENV = "MILKSU_PROTECTED_ROOTS";

// .git/hooks is an execution-injection point anywhere on disk, so it is matched by shape
// rather than by root.
const GIT_HOOKS_SHAPE = /(^|[\\/])\.git[\\/]hooks([\\/]|$)/;

function normalizePath(value) {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) return "";
  return resolve(trimmed).replace(/[\\/]+$/, "");
}

function isInside(candidate, root) {
  if (!candidate || !root) return false;
  if (candidate === root) return true;
  return candidate.startsWith(root + sep);
}

export function parseProtectedRoots(raw) {
  let parsed;
  try {
    parsed = JSON.parse(String(raw ?? ""));
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const roots = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const path = normalizePath(entry.path);
    if (!path) continue;
    roots.push({ path, label: String(entry.label ?? "").trim() || "protected" });
  }
  return roots;
}

// The runtime data directory, derived from the collaboration root the host sets
// (`<dataDir>/agent-home/coding-collaboration`). Used only when the host did not pass roots.
export function dataDirectoryFromEnvironment(env = process.env) {
  const collaborationRoot = String(env.MILKSU_CODING_COLLABORATION_ROOT ?? "").trim();
  if (!collaborationRoot) return "";
  return dirname(dirname(normalizePath(collaborationRoot)));
}

// Roots the host did not pass (development, or an older host) still need closing: the coding
// roots are derived from this session's own workspace and the real user home.
export function derivedProtectedRoots({ workspace, userHome, dataDirectory } = {}) {
  const roots = [];
  const home = String(userHome ?? "").trim() || homedir();
  if (dataDirectory) {
    roots.push({ path: normalizePath(dataDirectory), label: "runtime-data" });
  }
  const normalizedWorkspace = normalizePath(workspace);
  if (!normalizedWorkspace) return roots;
  const codingRoot = normalizePath(join(home, "MilkSU", "Coding"));
  if (isInside(normalizedWorkspace, codingRoot)) {
    roots.push({ path: codingRoot, label: "coding-workspaces" });
  }
  const scratch = /^(.*[\\/]agent-workspaces[\\/]Coding)[\\/]/.exec(normalizedWorkspace);
  if (scratch?.[1]) {
    roots.push({ path: normalizePath(scratch[1]), label: "coding-workspaces" });
  }
  return roots;
}

export function mergeProtectedRoots(...lists) {
  const seen = new Set();
  const merged = [];
  for (const list of lists) {
    for (const root of list ?? []) {
      if (!root?.path || seen.has(root.path)) continue;
      seen.add(root.path);
      merged.push(root);
    }
  }
  // Most specific first, so the audit label names the narrowest root that matched.
  return merged.sort((left, right) => right.path.length - left.path.length);
}

/**
 * The violation, or null. `.git/hooks` is checked before the workspace exception: it is an
 * execution-injection point, so it is never writable - not even inside the session's own
 * tree. The session's own workspace is otherwise always writable.
 */
export function protectedWriteViolation(
  target,
  { roots = [], enforcedRoots = [], ownWorkspace } = {},
) {
  const candidate = normalizePath(target);
  if (!candidate) return null;
  if (GIT_HOOKS_SHAPE.test(candidate)) return { path: candidate, label: "git-hooks" };
  // 读者在设置里指定的受限文件夹优先于「会话自己的 workspace 永远可写」那条例外：
  // 他要保护的往往正是自己项目里的某个目录。内置清单不走这一支（它们的作用域仍按原来的
  // 顺序判定，否则主目录那条会把整个工作区都盖住）。
  let enforced = null;
  for (const root of enforcedRoots) {
    if (!isInside(candidate, root.path)) continue;
    if (!enforced || root.path.length > enforced.path.length) enforced = root;
  }
  if (enforced) return { path: candidate, label: enforced.label };
  const workspace = normalizePath(ownWorkspace);
  if (workspace && isInside(candidate, workspace)) return null;
  // Name the narrowest root that matched, whatever order the host sent them in.
  let best = null;
  for (const root of roots) {
    if (!isInside(candidate, root.path)) continue;
    if (!best || root.path.length > best.path.length) best = root;
  }
  return best ? { path: candidate, label: best.label } : null;
}

// Shell words that name a write target. Anything not listed is not a write this guard
// understands, and is left alone: the guard must never refuse a read.
const SINGLE_TARGET_COMMANDS = new Set(["cp", "mv", "install", "ln"]);
const ALL_TARGET_COMMANDS = new Set(["rm", "truncate", "touch", "mkdir", "chmod", "chown"]);

// Split a command line into segments on the shell operators that end one command.
function commandSegments(command) {
  return String(command ?? "")
    .split(/(?:\r?\n|;|&&|\|\||\|)/)
    .map(segment => segment.trim())
    .filter(Boolean);
}

// Tokenize one segment, keeping quoted words whole and dropping the quotes themselves.
function segmentTokens(segment) {
  const tokens = [];
  let current = "";
  let quote = "";
  let started = false;
  for (let index = 0; index < segment.length; index += 1) {
    const character = segment[index];
    if (quote) {
      if (character === "\\" && quote === "\"" && index + 1 < segment.length) {
        current += segment[index + 1];
        index += 1;
        continue;
      }
      if (character === quote) {
        quote = "";
        continue;
      }
      current += character;
      continue;
    }
    if (character === "'" || character === "\"") {
      quote = character;
      started = true;
      continue;
    }
    if (/\s/.test(character)) {
      if (started || current) {
        tokens.push(current);
        current = "";
        started = false;
      }
      continue;
    }
    // A redirect is its own token so the target after it can be read directly.
    if (character === ">") {
      if (started || current) {
        tokens.push(current);
        current = "";
        started = false;
      }
      const next = segment[index + 1];
      if (next === ">") {
        tokens.push(">>");
        index += 1;
      } else {
        tokens.push(">");
      }
      continue;
    }
    current += character;
  }
  if (started || current) tokens.push(current);
  return tokens;
}

// The concrete paths a shell command can write to. Relative targets resolve against the
// command's own working directory, exactly as the shell would.
function shellWriteTargets(command) {
  const targets = new Set();
  for (const segment of commandSegments(command)) {
    const tokens = segmentTokens(segment);
    if (!tokens.length) continue;
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if ((token === ">" || token === ">>") && tokens[index + 1]) {
        targets.add(tokens[index + 1]);
      }
    }
    const commandName = String(tokens[0] ?? "").split("/").pop();
    const args = tokens.slice(1).filter(token => token !== ">" && token !== ">>");
    const plain = args.filter(token => !token.startsWith("-"));
    if (commandName === "tee") {
      for (const token of plain) targets.add(token);
      continue;
    }
    if (commandName === "dd") {
      for (const token of args) {
        if (token.startsWith("of=")) targets.add(token.slice(3));
      }
      continue;
    }
    if (commandName === "sed") {
      if (args.some(token => token.startsWith("-i")) && plain.length) {
        targets.add(plain[plain.length - 1]);
      }
      continue;
    }
    if (SINGLE_TARGET_COMMANDS.has(commandName)) {
      if (plain.length) targets.add(plain[plain.length - 1]);
      continue;
    }
    if (ALL_TARGET_COMMANDS.has(commandName)) {
      for (const token of plain) targets.add(token);
    }
    // `git config`/`hook` style commands write inside `.git`; the resolved path check below
    // covers them through the `.git/hooks` shape and the protected roots.
  }
  return targets;
}

// Expand the variables a shell would expand, so `$HOME/...` is judged by where it really
// points rather than by its text.
function expandShellTarget(target, env = process.env) {
  let value = String(target ?? "").trim();
  if (!value) return "";
  if (value === "~" || value.startsWith("~/")) {
    // The shell expands `~` to $HOME, which for a sidecar is the isolated runtime home.
    value = join(String(env.HOME ?? "").trim() || homedir(), value.slice(1));
  }
  value = value.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g, (match, braced, bare) => {
    const name = braced ?? bare;
    if (name === "HOME") return String(env.HOME ?? homedir());
    if (name === "PWD") return String(env.PWD ?? env.MILKSU_USER_HOME ?? "");
    if (name === "MILKSU_USER_HOME") return String(env.MILKSU_USER_HOME ?? "");
    return match;
  });
  return value;
}

/**
 * The violation for a shell command, or null. Only writes are considered: a read that merely
 * mentions a protected path is ordinary work and must pass. This is still a soft guard - a
 * deliberately obfuscated command can slip past - but it must never be a coin flip, and it
 * must never block a read.
 */
export function protectedCommandViolation(
  command,
  { roots = [], enforcedRoots = [], ownWorkspace, cwd, env = process.env } = {},
) {
  const text = String(command ?? "");
  if (!text.trim()) return null;
  const base = String(cwd ?? ownWorkspace ?? env.HOME ?? "").trim();
  for (const raw of shellWriteTargets(text)) {
    let resolved = expandShellTarget(raw, env);
    if (!resolved) continue;
    // A `$=`-style suffix or a trailing quote leftover is not a path we can judge.
    if (!isAbsolute(resolved)) {
      resolved = base ? join(base, resolved) : resolved;
    }
    if (!isAbsolute(resolved)) continue;
    const violation = protectedWriteViolation(resolved, { roots, enforcedRoots, ownWorkspace });
    if (violation) return violation;
  }
  return null;
}
