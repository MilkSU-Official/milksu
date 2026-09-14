/**
 * MilkSU 防挂死守卫（Pi sidecar 扩展）
 *
 * Pi 的 bash 工具把 `timeout` 当成可选参数：不传就没有上界，一次调用可以无限期
 * 占住整个回合（现场：iCloud 驱逐目录里的 `git fsck` 跑了 1 小时 40 分，
 * CPU 只用掉 1.45 秒，其余时间等 iCloud 现下载）。
 *
 * 已有的重复调用熔断（`bridge-tool-repeat.js`）只比较多次调用之间有没有新进展，
 * 单次调用不返回落在它的判定之外，所以这一层是必要的。
 *
 * 这里只做两件确定性的事：
 *   1) `tool_call` 给缺少 `timeout` 的 bash 调用注入默认值，并把超过上限的值收敛。
 *      该钩子拿到的 `event.input` 与随后执行的参数是同一个对象，就地写入会被采用。
 *   2) `tool_result` 在超时结果上补一段诊断，让停下来的原因可查。
 *
 * 不在这一层判断「哪条命令危险」。那需要解析 shell（`cd`、`git -C`、变量、子 shell、
 * 符号链接），而超时已经把无界等待变成有界失败；猜错的代价是拦掉用户的合法命令。
 * iCloud 只作为超时之后的解释出现，不作为执行前的拦截理由。
 */

import { spawnSync } from "node:child_process";
import { homedir, userInfo } from "node:os";
import { isAbsolute, join, resolve as resolvePath, sep } from "node:path";

export const DEFAULT_BASH_TIMEOUT_SECONDS = 600;
export const MAX_BASH_TIMEOUT_SECONDS = 3600;

/**
 * 超时之后才使用的诊断阈值：看到这么多仅存云端的文件，才在结果里点名 iCloud。
 * 它不参与任何拦截决定，所以判断偏松只会少一句解释。
 */
export const DATALESS_DIAGNOSTIC_THRESHOLD = 20;
export const DATALESS_SCAN_TIMEOUT_MS = 2500;
/** 命中这么多即可停止扫描：`head` 关闭管道，重度驱逐的树在毫秒级返回。 */
export const DATALESS_EARLY_EXIT_LIMIT = DATALESS_DIAGNOSTIC_THRESHOLD + 1;

function readPositiveInteger(environment, name, fallback) {
  const raw = environment?.[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

export function hangGuardConfig(environment = process.env) {
  return {
    enabled: environment?.MILKSU_PI_HANG_GUARD !== "0",
    defaultTimeoutSeconds: readPositiveInteger(
      environment,
      "MILKSU_PI_BASH_DEFAULT_TIMEOUT_SECONDS",
      DEFAULT_BASH_TIMEOUT_SECONDS,
    ),
    maxTimeoutSeconds: readPositiveInteger(
      environment,
      "MILKSU_PI_BASH_MAX_TIMEOUT_SECONDS",
      MAX_BASH_TIMEOUT_SECONDS,
    ),
  };
}

/**
 * 给一次 bash 调用补上超时。返回实际写入的秒数，未改动时返回 undefined。
 * - 未传 timeout：注入默认值
 * - 传了超过上限的值：收敛到上限
 * - 传了合理值：保持不变
 */
export function applyBashTimeout(input, config) {
  if (!input || typeof input !== "object") return undefined;
  const { defaultTimeoutSeconds, maxTimeoutSeconds } = config;
  const raw = input.timeout;
  const missing = raw === undefined || raw === null || raw === "";
  if (!missing) {
    const value = Number(raw);
    if (!Number.isFinite(value) || value <= 0) return undefined;
    if (value > maxTimeoutSeconds) {
      input.timeout = maxTimeoutSeconds;
      return maxTimeoutSeconds;
    }
    return undefined;
  }
  input.timeout = defaultTimeoutSeconds;
  return defaultTimeoutSeconds;
}

/**
 * The home directory a command's `~` actually resolves to.
 *
 * MilkSU sandboxes the sidecar's own HOME (e.g. `…/com.milksu.app/agent-home`) but runs
 * tool commands with the real user home, and it publishes that as `MILKSU_USER_HOME`.
 * Using `os.homedir()` here would resolve a path that does not exist.
 */
export function resolveUserHome(environment = process.env) {
  const configured = String(environment?.MILKSU_USER_HOME ?? "").trim();
  if (configured) return configured;
  try {
    return userInfo().homedir;
  } catch {
    return homedir();
  }
}

function iCloudRoots(home) {
  const homes = Array.isArray(home) ? home : [home];
  const roots = [];
  for (const entry of homes) {
    const base = String(entry ?? "").trim();
    if (!base) continue;
    roots.push(
      join(base, "Documents"),
      join(base, "Desktop"),
      join(base, "Library", "Mobile Documents"),
    );
  }
  return roots;
}

/**
 * Paths whose contents iCloud may keep in the cloud only. Only used after a timeout, to
 * decide whether the dataless count is worth reporting; outside these roots the scan is
 * skipped so a timeout on an ordinary project costs nothing extra.
 */
export function isICloudSyncedPath(directory, options = {}) {
  const { platform = process.platform, home = resolveUserHome() } = options;
  if (platform !== "darwin") return false;
  const target = String(directory ?? "").trim();
  if (!target) return false;
  const resolved = resolvePath(target);
  return iCloudRoots(home).some(root => resolved === root || resolved.startsWith(root + sep));
}

/**
 * Directories a timed-out bash command may have been reading: the session cwd plus every
 * `cd`/`pushd` target in the command. This is a best-effort hint for the diagnostic only;
 * missing a target costs one sentence of explanation, never a blocked command.
 */
export function commandDirectories(command, cwd, options = {}) {
  const { home = resolveUserHome() } = options;
  const candidates = [];
  const push = value => {
    const raw = String(value ?? "").trim();
    if (!raw || raw === "-" || raw.startsWith("$")) return;
    let expanded = raw;
    if (expanded === "~") expanded = home;
    else if (expanded.startsWith("~/")) expanded = join(home, expanded.slice(2));
    if (!isAbsolute(expanded)) {
      if (!cwd) return;
      expanded = resolvePath(cwd, expanded);
    }
    candidates.push(expanded);
  };

  push(cwd);

  const text = String(command ?? "");
  const cdPattern = /(?:^|[;&|()\s])(?:cd|pushd)\s+(?:"([^"]*)"|'([^']*)'|([^\s;&|()<>]+))/g;
  for (const match of text.matchAll(cdPattern)) {
    push(match[1] ?? match[2] ?? match[3]);
  }

  return [...new Set(candidates)];
}

/**
 * 统计目录下「仅存于云端」（dataless）的文件数量。
 * 该扫描只读文件标志，不会触发下载；命中达到 limit 即提前结束。
 * 返回 -1 表示无法判定（平台不支持 / 扫描超时 / find 失败）。
 */
export function countDatalessFiles(directory, options = {}) {
  const {
    platform = process.platform,
    spawn = spawnSync,
    scanTimeoutMs = DATALESS_SCAN_TIMEOUT_MS,
    limit = DATALESS_EARLY_EXIT_LIMIT,
  } = options;
  if (platform !== "darwin") return -1;
  const target = String(directory ?? "").trim();
  if (!target) return -1;
  const quoted = `'${target.replace(/'/g, `'\\''`)}'`;
  const result = spawn(
    "/bin/sh",
    ["-c", `find ${quoted} -maxdepth 8 -flags +dataless 2>/dev/null | head -n ${limit}`],
    { timeout: scanTimeoutMs, maxBuffer: 4 << 20, encoding: "utf8" },
  );
  if (!result || result.error || result.status !== 0 || typeof result.stdout !== "string") {
    return -1;
  }
  const lines = result.stdout.split("\n").filter(Boolean);
  return lines.length;
}

/**
 * 超时结果上追加的说明。命中 iCloud 时点名具体目录和文件数，其余情况只说明超时边界
 * 与更合适的做法（后台任务），不要求模型再猜。
 */
export function timeoutDiagnostic({
  timeoutSeconds,
  directory,
  count = -1,
  threshold = DATALESS_DIAGNOSTIC_THRESHOLD,
  limit = DATALESS_EARLY_EXIT_LIMIT,
}) {
  const lines = [
    "",
    `Command exceeded its ${timeoutSeconds}s foreground limit and was terminated.`,
  ];
  if (directory && count >= threshold) {
    const capped = count >= limit ? "+" : "";
    lines.push(
      `${count}${capped} files under ${directory} exist only in iCloud, so reading them forces `
      + `on-demand downloads; that is the likely cause. Run "brctl download '${directory}'" first, `
      + `narrow the scope, or move the project out of iCloud.`,
    );
  }
  lines.push(
    "For work that legitimately runs this long, use the background task tools instead of a "
    + "foreground wait, or pass an explicit larger timeout.",
  );
  return lines.join("\n");
}

function textOf(content) {
  if (!Array.isArray(content)) return "";
  return content
    .filter(block => block?.type === "text")
    .map(block => String(block.text ?? ""))
    .join("\n");
}

/**
 * 返回一个 Pi 扩展工厂：注册 tool_call 与 tool_result 钩子。
 */
export function createHangGuardExtension({
  environment = process.env,
  platform = process.platform,
  home = resolveUserHome(environment),
  spawn,
  scanCacheTtlMs = 60_000,
} = {}) {
  const config = hangGuardConfig(environment);
  if (!config.enabled) {
    return () => {};
  }
  const cache = new Map();
  const countCached = directory => {
    const now = Date.now();
    const hit = cache.get(directory);
    if (hit && now - hit.at < scanCacheTtlMs) return hit.count;
    const count = countDatalessFiles(directory, { platform, spawn });
    cache.set(directory, { at: now, count });
    return count;
  };

  return pi => {
    pi.on("tool_call", async event => {
      try {
        if (event?.toolName !== "bash") return undefined;
        applyBashTimeout(event.input, config);
      } catch {
        // 注入失败不能挡住调用本身。
      }
      return undefined;
    });

    pi.on("tool_result", async (event, ctx) => {
      try {
        if (!event?.isError) return undefined;
        const text = textOf(event.content);
        if (!/timeout[:：]/i.test(text) && !/timed out/i.test(text)) return undefined;
        // Only iCloud roots can hold cloud-only files, so skip the scan elsewhere.
        const synced = commandDirectories(event.input?.command, ctx?.cwd, { home })
          .filter(candidate => isICloudSyncedPath(candidate, { platform, home }));
        const directory = synced[0];
        const detail = timeoutDiagnostic({
          timeoutSeconds: Number(event.input?.timeout) || config.defaultTimeoutSeconds,
          directory,
          count: directory ? countCached(directory) : -1,
        });
        return { content: [...(event.content ?? []), { type: "text", text: detail }] };
      } catch {
        return undefined;
      }
    });
  };
}
