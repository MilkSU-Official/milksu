import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";

// The host hands the absolute protected roots over at spawn. The sidecar is where tools run,
// so this is the only place a write can be refused before it happens.
export const PROTECTED_ROOTS_ENV = "MILKSU_PROTECTED_ROOTS";

// 读者的「紧急关闭」：环境变量 MILKSU_PROTECTED_DISABLED=1，或数据目录下放一个
// agent-protection-off 文件（引擎会把它转成这个环境变量下发）。
// 读者原话：怕出问题「连救都救不了」。所以这条退路必须不依赖界面、也不依赖 App 能正常启动。
// 命中即整套受限保护失效：派生根不再生效，写判定、命令判定、git-hooks 硬规则全部放行。
export const PROTECTED_DISABLED_ENV = "MILKSU_PROTECTED_DISABLED";

export function protectedGuardDisabled(env = process.env) {
  const raw = String(env?.[PROTECTED_DISABLED_ENV] ?? "").trim().toLowerCase();
  return raw === "1" || raw === "true" || raw === "yes" || raw === "on";
}

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
  // 紧急关闭：连侧车自己派生的根也不再生效，否则读者关了开关仍然被拦。
  if (protectedGuardDisabled()) return roots;
  const home = String(userHome ?? "").trim() || homedir();
  if (dataDirectory) {
    roots.push({ path: normalizePath(dataDirectory), label: "runtime-data" });
  }
  const normalizedWorkspace = normalizePath(workspace);
  if (!normalizedWorkspace) return roots;
  // 这里曾经把整个 ~/MilkSU/Coding 当成「coding-workspaces」保护起来，理由是「别的会话
  // 的沙箱不能互相写坏」。但真正的沙箱住在 <runtime-data>/agent-home/workspaces 下，
  // 已经被 runtime-data 这一条盖住了；而 ~/MilkSU/Coding 里放的是读者自己的项目、
  // 工作副本与文档（例如 PR 提交准备）——把它们一并封死，会直接堵住这些活。
  // 读者反馈："PR 因为这点事情连写文档都写不了"。所以只留下真正窄的那条（协作沙箱）。
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
  // 紧急关闭：一切都放行（包括下面的 git-hooks 硬规则）。
  if (protectedGuardDisabled()) return null;
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
function shellWriteTargets(command, { env = process.env, bindings = new Map(), cwd = "" } = {}) {
  const targets = new Set();
  let currentCwd = String(cwd ?? "");
  // Judge a relative write target by where the shell would really put it: `cd <dir> && ... > f`
  // writes inside <dir>, not inside the session workspace.
  const resolveTarget = (target) => {
    const expanded = expandShellTarget(target, env, bindings);
    if (!expanded) return "";
    if (expanded.startsWith("/")) return expanded;
    if (expanded.startsWith("~")) return expandShellTarget(expanded, env, bindings);
    return currentCwd ? join(currentCwd, expanded) : expanded;
  };
  for (const segment of commandSegments(command)) {
    const tokens = segmentTokens(segment);
    if (!tokens.length) continue;
    const leadingName = String(tokens[0] ?? "").split("/").pop();
    if (leadingName === "cd") {
      const destination = tokens.slice(1).find(token => !token.startsWith("-"));
      if (destination) {
        const resolved = expandShellTarget(destination, env, bindings);
        if (resolved.startsWith("/")) currentCwd = resolved;
        else if (currentCwd) currentCwd = join(currentCwd, resolved);
      }
      continue;
    }
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index];
      if ((token === ">" || token === ">>") && tokens[index + 1]) {
        targets.add(resolveTarget(tokens[index + 1]));
      }
    }
    const commandName = String(tokens[0] ?? "").split("/").pop();
    const args = tokens.slice(1).filter(token => token !== ">" && token !== ">>");
    const plain = args.filter(token => !token.startsWith("-"));
    if (commandName === "tee") {
      for (const token of plain) targets.add(resolveTarget(token));
      continue;
    }
    if (commandName === "dd") {
      for (const token of args) {
        if (token.startsWith("of=")) targets.add(resolveTarget(token.slice(3)));
      }
      continue;
    }
    if (commandName === "sed") {
      if (args.some(token => token.startsWith("-i")) && plain.length) {
        targets.add(resolveTarget(plain[plain.length - 1]));
      }
      continue;
    }
    if (SINGLE_TARGET_COMMANDS.has(commandName)) {
      if (plain.length) targets.add(resolveTarget(plain[plain.length - 1]));
      continue;
    }
    if (ALL_TARGET_COMMANDS.has(commandName)) {
      for (const token of plain) targets.add(resolveTarget(token));
    }
    // `git config`/`hook` style commands write inside `.git`; the resolved path check below
    // covers them through the `.git/hooks` shape and the protected roots.
  }
  return targets;
}

// Expand the variables a shell would expand, so `$HOME/...` is judged by where it really
// points rather than by its text.
function expandShellTarget(target, env = process.env, bindings = new Map()) {
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
    if (bindings.has(name)) return bindings.get(name);
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
// The shell variables the command binds itself (`D=/path; ... > $D/f`). Ignoring them hands
// the agent a ready-made way around a protected folder - that was the real bug: the write was
// created through a variable, so the literal-path check never saw a protected path at all.
// Values are expanded to a fixed point, so a variable built from another variable still counts.
function shellVariableBindings(command, env = process.env) {
  const bindings = new Map();
  for (const segment of commandSegments(command)) {
    for (const token of segmentTokens(segment)) {
      const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=([\s\S]*)$/.exec(token);
      if (!match) continue;
      const raw = match[2].replace(/^["']|["']$/g, "");
      bindings.set(match[1], raw ? expandShellTarget(raw, env, bindings) : "");
    }
  }
  return bindings;
}

// Commands that can put bytes on disk. Used only by the strict-when-in-doubt branch below.
// Commands whose whole job is to put bytes on disk.
const WRITE_COMMAND_NAMES = new Set([
  "rm", "rmdir", "mv", "cp", "install", "ln", "touch", "truncate", "mkdir", "mkfifo",
  "chmod", "chown", "chgrp", "rsync", "tar", "unzip", "patch", "tee", "dd", "ed",
]);
// Interpreters and editors can write, but only when the script says so: a plain
// `sed 's/x/y/' file` or `python -c 'print(1)'` is a read and must never be blocked.
const WRITE_CAPABLE_COMMAND_NAMES = new Set([
  "python", "python3", "node", "perl", "ruby", "sh", "bash", "zsh", "osascript", "awk",
  "sed", "ex", "vi", "vim", "nano", "emacs", "git", "find", "xargs", "sqlite3",
]);
const WRITE_ACTIVITY_SHAPE = /(?:open\s*\([^)]*["'](?:w|a|x)|writeFile|write_text|appendFile|>\s*["']?\/|(?:^|\s)-i\b|<<-?\s*["']?\w|hook|chmod|truncate|cp\b|mv\b|rm\b)/;

const DISCARD_TARGET_SHAPE = /^(?:\/dev\/(?:null|stdout|stderr|tty)|\/dev\/fd\/\d+|&\d+)$/;

// A command whose write lives inside a quoted script (`sh -c 'echo x > f'`,
// `python3 -c "open('f','w')"`) cannot be judged by reading its tokens: the shell only sees the
// script text. Judge it by what the script says it does. Without this, a write hidden inside
// `-c` walked straight past the protected-folder check (verified on the real machine).
const INLINE_SCRIPT_COMMAND_NAMES = new Set([
  "sh", "bash", "zsh", "dash", "ksh", "python", "python3", "node", "perl", "ruby",
  "osascript", "php", "eval", "xargs", "awk", "gawk",
]);
const INLINE_SCRIPT_WRITE_SHAPE = /(?:open\s*\([^)]*["'](?:w|a|x)|writeFile|write_text|appendFile|writeFileSync|>\(?\s*["']?\S|>>|\btee\b|\brm\b|\bcp\b|\bmv\b|\btouch\b|\bmkdir\b|\btruncate\b|\bdd\b|(?:^|\s)-i\b|(?:^|\s)-delete\b|(?:^|\s)-exec\b)/;

// True when the command runs a script we cannot read token by token and that script writes.
function commandHidesWriteInScript(command) {
  for (const segment of commandSegments(command)) {
    const tokens = segmentTokens(segment);
    const name = String(tokens[0] ?? "").split("/").pop();
    if (!name || !INLINE_SCRIPT_COMMAND_NAMES.has(name)) continue;
    if (INLINE_SCRIPT_WRITE_SHAPE.test(tokens.slice(1).join(" "))) return true;
  }
  return false;
}

// True when a write target cannot be resolved (an undefined variable, a command substitution),
// so we cannot tell where the write lands. Strict-on-doubt applies to these only: a write that
// resolves outside every protected root is none of this guard's business, even when the same
// command reads a protected folder. Treating "any redirect at all" as write intent blocked plain
// `ls "$DIR/log" 2>&1 | tail -5` diagnostics on the real machine.
function commandWritesWhereWeCannotSee(command, { env = process.env, bindings = new Map(), cwd = "" } = {}) {
  for (const target of shellWriteTargets(command, { env, bindings, cwd })) {
    const expanded = expandShellTarget(target, env, bindings);
    if (!expanded) return true;
    // A value that still holds a substitution or an unknown variable is not a destination we can
    // judge: `D=$(echo <folder>); echo x > "$D/f"` must count as "cannot see where this writes".
    if (/[$`]/.test(expanded)) return true;
  }
  return false;
}

function commandHasWriteIntent(command, { env = process.env, bindings = new Map(), cwd = "" } = {}) {
  const text = String(command ?? "");
  // Real write targets only: `2>/dev/null` and `>/dev/null` discard output, they do not write,
  // and a read that merely contains a `>` must still pass.
  for (const target of shellWriteTargets(text, { env, bindings, cwd })) {
    const expanded = expandShellTarget(target, env, bindings);
    if (expanded && !DISCARD_TARGET_SHAPE.test(expanded)) return true;
  }
  for (const segment of commandSegments(text)) {
    const tokens = segmentTokens(segment);
    const name = String(tokens[0] ?? "").split("/").pop();
    if (!name) continue;
    const inPlace = /(?:^|\s)-i/.test(segment);
    if (WRITE_COMMAND_NAMES.has(name)) {
      if (name === "sed" && !inPlace) continue;
      return true;
    }
    if (SINGLE_TARGET_COMMANDS.has(name) || ALL_TARGET_COMMANDS.has(name)) return true;
    if (WRITE_CAPABLE_COMMAND_NAMES.has(name) && (name === "sed" ? inPlace : WRITE_ACTIVITY_SHAPE.test(segment))) {
      return true;
    }
  }
  return false;
}

function protectedViolationForPath(candidate, { roots = [], enforcedRoots = [], ownWorkspace } = {}) {
  const expanded = String(candidate ?? "").trim();
  if (!expanded) return null;
  if (!expanded.startsWith("/") && !expanded.startsWith("~")) return null;
  return protectedWriteViolation(expanded, { roots, enforcedRoots, ownWorkspace });
}

// Every path-like substring of a token. A quoted script arrives as one token
// (`echo x > /root/f`), and a `-c` program arrives as one token too
// (`open('/root/f','w')`), so judging only the whole token never sees the path inside it - that
// is how a write hidden in `sh -c` walked past this check.
const PATH_LIKE_SHAPE = /(?:~|\/)[^\s'"`;|&)]*/g;

function mentionedPaths(token) {
  const found = [];
  for (const match of String(token ?? "").matchAll(PATH_LIKE_SHAPE)) {
    const value = match[0].replace(/[.,;:]+$/, "");
    if (value.length > 1) found.push(value);
  }
  return found;
}

// Expand the command's own `$VAR` / `${VAR}` references the way the shell would. Without this,
// a protected folder hidden inside a script (`bash -c 'echo x > $D/f'`) leaves no path-shaped
// text to judge.
function expandShellText(text, env = process.env, bindings = new Map()) {
  let current = String(text ?? "");
  for (let pass = 0; pass < 3; pass += 1) {
    const next = current.replace(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g, (whole, name) => {
      if (bindings.has(name)) return String(bindings.get(name) ?? "");
      if (env && env[name] !== undefined) return String(env[name]);
      return whole;
    });
    if (next === current) break;
    current = next;
  }
  return current;
}

// Strict when in doubt: if the command can write and any path it mentions (after expanding its
// own variables) lands inside a protected root, block it and say why. Reads still pass - only
// commands that can write are judged here. "Cannot tell, so let it through" is exactly the
// crack the agent kept widening.
//
// A variable that merely *holds* a protected path is not a violation: `R=<folder>; ls "$R"` is a
// read, and judging the assignment alone blocked plain diagnostics on the real machine. The
// variable is judged where it is used - as a write target (resolved in the caller) or as text.
function protectedCommandMentionViolation(
  command,
  { roots = [], enforcedRoots = [], ownWorkspace, bindings = new Map(), env = process.env } = {},
) {
  const judge = (candidate) => protectedViolationForPath(
    expandShellTarget(candidate, env, bindings),
    { roots, enforcedRoots, ownWorkspace },
  );
  for (const segment of commandSegments(command)) {
    for (const token of segmentTokens(segment)) {
      if (token === ">" || token === ">>" || token.startsWith("-")) continue;
      // A binding token (`D=<folder>`) is not a mention: the variable is judged where it is used
      // - as a resolved write target, or as text inside a script. Judging the assignment alone
      // blocked read commands that merely kept a protected folder in a variable.
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
      const violation = judge(token);
      if (violation) return { ...violation, reason: "protected-path-in-command" };
      for (const inner of mentionedPaths(expandShellText(token, env, bindings))) {
        const nested = judge(inner);
        if (nested) return { ...nested, reason: "protected-path-in-command" };
      }
    }
  }
  return null;
}

/**
 * What the **agent** is told when it is blocked. Deliberately different from the notice the
 * reader sees: the reader is told "it was blocked", the agent is told "this road is closed, do
 * not look for another one". The reader's own words: an agent that is not told will keep
 * hunting for a way in.
 */
// 内置保护位置的中文名。它们和读者在设置里加的「受限文件夹」不是一回事：不受总开关影响，
// 也不能从设置里移除。文案必须说实话——读者曾被误导成「我只加了一个测试文件夹，为什么被拦」。
const BUILTIN_PROTECTED_LABELS = new Map([
  ["app-bundle", "MilkSU 应用本体"],
  ["app-sources", "MilkSU 源码目录"],
  ["runtime-data", "MilkSU 运行数据"],
  ["pi-sessions", "会话记录"],
  ["coding-workspaces", "Coding 工作区"],
  ["git-hooks", "Git 钩子"],
]);

/** 内置保护的显示名；读者列表里的项（label 为 protected 或自定义）返回空串。 */
export function builtinProtectedName(label) {
  return BUILTIN_PROTECTED_LABELS.get(String(label ?? "").trim()) ?? "";
}

// agent 的 ~ 是运行时隔离沙箱，不是读者的真实主目录。写读者目录的活必须用绝对路径，
// 否则文件落在沙箱里（读者看不到）并且撞上 runtime-data 这把锁。读者为此来回传过话，
// 所以把这条纠正信息直接附在拦截提示里，并给出可照抄的正确路径。
function sandboxHomeHint(target, locale) {
  const sandboxHome = normalizePath(process.env.HOME ?? "");
  const realHome = normalizePath(process.env.MILKSU_USER_HOME ?? "");
  if (!sandboxHome || !realHome || sandboxHome === realHome) return "";
  const candidate = normalizePath(target);
  if (!candidate || !isInside(candidate, sandboxHome)) return "";
  const rest = candidate.slice(sandboxHome.length);
  if (String(locale ?? "") === "en") {
    return " Note: your ~ is an isolated sandbox (" + sandboxHome + "), not the reader's home;"
      + " this file would land in the sandbox, where the reader cannot see it. Write the reader's own"
      + " folders with an absolute path, or replace ~ with $MILKSU_USER_HOME (= " + realHome + "):"
      + " suggested path " + realHome + rest;
  }
  return "另外：你的 ~ 是隔离沙箱（" + sandboxHome + "），不是读者的真实主目录；"
    + "这个文件会落在沙箱里，读者看不到。要写读者自己的目录，请用绝对路径，"
    + "或把 ~ 换成 $MILKSU_USER_HOME（= " + realHome + "）：建议改成 " + realHome + rest;
}

// 包一层：所有给 agent 的拦截提示都带上上面这条纠正信息（否则它会一直用错的 ~ 写法）。
export function protectedAgentNotice(violation, locale) {
  const note = protectedAgentNoticeBody(violation, locale);
  const hint = sandboxHomeHint(String(violation?.path ?? "").trim(), locale);
  return hint ? note + hint : note;
}

function protectedAgentNoticeBody(violation, locale) {
  const target = String(violation?.path ?? "").trim() || "(the path you tried to write)";
  const throughVariable = violation?.reason === "protected-path-in-command";
  const builtin = builtinProtectedName(violation?.label);
  const spelled = throughVariable
    ? (String(locale ?? "") === "en"
      ? " This command was blocked because it pointed at that folder through a shell variable"
        + " or after a cd, not because of how it was spelled."
      : "这条命令被拦不是因为写法，而是它通过 shell 变量或 cd 指到了那个目录。")
    : "";
  if (String(locale ?? "") === "en") {
    if (builtin) {
      return "Blocked: " + target + " is inside " + builtin + ", a location MilkSU always protects"
        + " (it is not on the reader's protected list, and the master switch does not affect it),"
        + " so agents may not write there." + spelled
        + " Do not work around it: do not retry with a shell variable, a cd, another tool, or "
        + "another spelling of the path - the write stays blocked and repeated attempts stop the "
        + "turn. The reader has to do this one themselves: tell them what you need written and where.";
    }
    return "Blocked: " + target + " is inside a folder on the reader's protected list "
      + "(Settings, Files, protected folders), so agents may not write there." + spelled
      + " Do not work around it: do not retry with a shell variable, a cd, another tool, or "
      + "another spelling of the path - the write stays blocked and repeated attempts stop the "
      + "turn. The only way through is for the reader to remove that folder in Settings (or turn "
      + "the master switch off): tell them what you need written and where, and wait for them.";
  }
  if (builtin) {
    return "已拦截：" + target + " 在" + builtin + "里，这是 MilkSU 内置保护的位置"
      + "（**不在**读者设置的「受限文件夹」列表里，也不受总开关影响），agent 不能写入。"
      + spelled
      + "**不要绕过**：不要改用 shell 变量、cd、别的工具或别的路径拼法再试 —— 写入仍会被拒，"
      + "同一轮反复试（第 3 次起）会终止本轮。这种事要由读者本人来做："
      + "把你要写什么、写到哪里告诉读者，等读者处理。";
  }
  return "已拦截：" + target + " 在读者的「受限文件夹」列表里（设置 → 文件 → 受限文件夹），"
    + "agent 不能写入。" + spelled
    + "**不要绕过**：不要改用 shell 变量、cd、别的工具或别的路径拼法再试 —— 写入仍会被拒，"
    + "同一轮反复试（第 3 次起）会终止本轮。唯一可行的是让读者在设置里把该目录移出列表（或关掉总开关）："
    + "把你要写什么、写到哪里告诉读者，等读者处理。";
}

// 读者要的是「拒绝这次写入并告知」，不是「一碰就把整轮掐死」。
// 口径：单次写入一律拒绝并告知 agent；同一条命令反复换写法（同一轮第 N 次）才算在找绕过，
// 那时才停止本轮，并且**必须**把原因写给读者（不能静默）。
export const PROTECTED_WRITE_ATTEMPT_LIMIT = 3;

export function protectedBlockEscalates(attempt) {
  const count = Number(attempt ?? 0);
  return Number.isFinite(count) && count >= PROTECTED_WRITE_ATTEMPT_LIMIT;
}

// 给**读者**的升级提示：读者永远不应该需要问「刚刚发生了什么」。
// 说清：哪个目录、试了几次、没有写进去、已告知它别绕。
export function protectedEscalationNotice(violation, attempt, locale) {
  const target = String(violation?.path ?? "").trim() || "(a protected path)";
  const tries = String(Number(attempt ?? 0) || PROTECTED_WRITE_ATTEMPT_LIMIT);
  if (String(locale ?? "") === "en") {
    return "Stopped this turn: the agent tried " + tries + " times to write a protected path ("
      + target + "). Nothing was written, and it was told to stop looking for a way around.";
  }
  return "已停止本轮：agent 连续 " + tries + " 次试图写入受限路径（" + target + "）。"
    + "写入都没有发生，也已明确告诉它不要再找绕过的写法。";
}

export function protectedCommandViolation(
  command,
  { roots = [], enforcedRoots = [], ownWorkspace, cwd, env = process.env } = {},
) {
  const text = String(command ?? "");
  if (!text.trim()) return null;
  // 紧急关闭：命令判定（含「写目标看不到就宁严勿松」那一支）整体失效。
  if (protectedGuardDisabled(env)) return null;
  const base = String(cwd ?? ownWorkspace ?? env.HOME ?? "").trim();
  const bindings = shellVariableBindings(text, env);
  for (const raw of shellWriteTargets(text, { env, bindings, cwd: base })) {
    let resolved = expandShellTarget(raw, env, bindings);
    if (!resolved) continue;
    // A `$=`-style suffix or a trailing quote leftover is not a path we can judge.
    if (!isAbsolute(resolved)) {
      resolved = base ? join(base, resolved) : resolved;
    }
    if (!isAbsolute(resolved)) continue;
    const violation = protectedWriteViolation(resolved, { roots, enforcedRoots, ownWorkspace });
    if (violation) return violation;
  }
  // Strict on doubt only: a write whose destination cannot be resolved, or a write hidden inside
  // a script, is refused as soon as the command names a protected folder. Commands that merely
  // read one - even while writing somewhere else - stay allowed: the reader asked for "no writes
  // into my folders", not for the agent to lose its sight.
  if (
    commandWritesWhereWeCannotSee(text, { env, bindings, cwd: base })
    || commandHidesWriteInScript(text)
  ) {
    const mentioned = protectedCommandMentionViolation(text, {
      roots,
      enforcedRoots,
      ownWorkspace,
      bindings,
      env,
    });
    if (mentioned) return mentioned;
  }
  return null;
}
