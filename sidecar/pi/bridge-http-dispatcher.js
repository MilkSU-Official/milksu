/**
 * 让 MilkSU 掌握模型请求的「连接建立」超时。
 *
 * 定因（2026-09-29）：旧 Dev Extend 会话每次请求在 ~10.5s 报
 * `APIConnectionTimeoutError: Request timed out.`。真实 sidecar 指向不可达地址时
 * 精确复现同一时间，指向正常地址时 15s 首字节、40s 断流都不报错 —— 说明那个
 * 「一刀切 ~10s」不是 TTFB 闹钟，而是 **undici 的默认 `connect.timeout = 10s`**
 * （pi/Node 都没有改过它），只在 TCP/TLS 连接迟迟建不起来时才开枪。
 *
 * pi 的 `configureHttpDispatcher` 只管 `headersTimeout`/`bodyTimeout`，不管连接超时；
 * 而且 SDK 路径根本不会调用它。所以这里在 sidecar 启动时装一个由 MilkSU 掌握的
 * 全局 dispatcher：连接超时拉齐到首字节预算的上限，配合每个请求的两段式预算
 * （`bridge-request-budget.js`）共同判定 —— 连接慢不再被固定 10s 误杀，
 * 真正的死流由断流检测在 30s 判死。
 *
 * 只改「连接建立」一个量：headers/body 保持 undici 的 300s 兜底，避免影响
 * MCP / 网页研究 / 插件等其它 fetch。
 *
 * 定因（2026-10-12）：只 setGlobalDispatcher 不够。Node 26 的原生 fetch 经 npm
 * undici 的 dispatcher 消费压缩响应时不会解压（pi 的 http-dispatcher.js 注释
 * 记录了同一个坑）；DeepSeek 官方 API 的 SSE 正是 gzip 压缩，SDK 会把压缩字节
 * 当明文解析，报 "Stream ended without finish_reason"。install() 把
 * globalThis.fetch 换成与 dispatcher 同一个 undici 的 fetch，解压恢复。pi 1.1.0
 * 尊重外部对 globalThis.fetch 的覆盖，启动后不会换回去。
 */
import { Agent, install as installUndiciFetch, setGlobalDispatcher } from "undici";
import { requestBudgetThresholds } from "./bridge-request-budget.js";

/** 连接超时与首字节预算上限对齐（默认 300s，随 MILKSU_PI_REQUEST_TTFB_MAX_MS），保证每个请求的预算看门狗才是权威。 */
export function connectTimeoutMs(environment = process.env) {
  return requestBudgetThresholds(environment).ttfbMaxMs;
}

/**
 * 装全局 dispatcher，并把 globalThis.fetch 换成与 dispatcher 同源的 undici fetch。
 * `createAgent` / `setDispatcher` / `installFetch` 可注入，单测不用真改进程状态。
 * 失败不抛：装不上就沿用 undici 默认（会退回 10s 连接超时），但绝不能拦住 sidecar 启动。
 */
export function installRequestHttpDispatcher({
  environment = process.env,
  createAgent,
  setDispatcher,
  installFetch,
  onError,
} = {}) {
  const timeout = connectTimeoutMs(environment);
  try {
    const create = createAgent ?? (options => new Agent(options));
    const set = setDispatcher ?? setGlobalDispatcher;
    const agent = create({ connect: { timeout } });
    set(agent);
    const installFetchFn = installFetch ?? installUndiciFetch;
    const fetchCoherent = typeof installFetchFn === "function";
    let fetchInstalled = false;
    if (fetchCoherent) {
      try {
        installFetchFn();
        fetchInstalled = true;
      } catch {
        // fetch 换不动就保留现状：未压缩的 provider 不受影响，只有压缩 SSE 的
        // provider（如 DeepSeek 官方 API）会继续报 Stream ended。
      }
    }
    return { connectTimeoutMs: timeout, installed: true, agent, fetchInstalled };
  } catch (error) {
    onError?.(error);
    return { connectTimeoutMs: timeout, installed: false, error };
  }
}
