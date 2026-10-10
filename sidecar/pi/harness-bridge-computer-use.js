// PR-2 批次 B2f：门开路径的 Computer Use 控窗两件。
//
// 挂载对象（B2 对照表里最后两件暂缓面）：
//   prepare_computer_use_driver —— bridge-computer-use-driver.js
//     createComputerUseDriverExtension（50 行薄壳）：action=status|prepare；
//     只有 prepare 过 policy 门（go 档且非 read-only，status 任何档可查——门关同款
//     只有这一道门，无审批卡）；请求经 workspaceActionBroker.request
//     （{action: prepare_computer_use_driver | computer_use_driver_status}），桌面侧
//     （Go computercap.Manager.Prepare）复制/构建 MilkSU 审阅过的 cua-driver；回包
//     result || `${action} completed` 直通文本。B2c 的 milksu_workspace 走同一个
//     broker——本件照抄该注入面。
//   computer_use —— bridge-computer-use-tool.js
//     createComputerUseToolExtension（117 行薄壳）：policy 门（go 档且非 read-only）
//     + computerUse descriptor 门（policy.computerUse 的 sessionId/socketPath——由
//     milksu_workspace lock_computer_use_window 成功后写进会话策略，或由共享
//     loadRuntimeSessionPolicy 按命令 descriptor 派生）+ createComputerUseExecutor
//     （sidecar/computer-use/computer-use-proxy.js 纯 node 模块零 pi-coding-agent
//     依赖：observe→act 快照配对、AX addressing 的 snapshot_id 注入、背景优先
//     delivery 摘要）。executor 按 descriptor 键（sessionId:socketPath:targetPid:
//     targetWindowId）单槽缓存——门关是每会话一个工厂闭包，这里的缓存同样按会话
//     （alias）分槽，逐字保真。macOS 走 createCuaCliRunner（execFile 打包 driver
//     `call <tool> <json> --socket <path>`），Linux 走 portal socket runner。
//
// 执行面复用门关工厂原样（collectExtensionToolDefinitions 只收集 registerTool）：
// execute 逐字节同源——策略门文案、descriptor 门文案、executor 行为、JSON 序列化
// 全部来自同一份定义代码，没有第二实现。
//
// 审批/隔离：不需要另接——两件都在 codingWorkspaceAutoToolNames（go 档 activeTools），
// B1 审判链的白名单/turn contract/重复熔断对挂上即自动生效；plan 档 activeTools
//（codingReadOnlyToolNames）不含两件，工具面自然不配置（execute 级 policy 门是第二
// 道防线，与门关同构）。
//
// replay 声明：两件都 unsafe——prepare 改本机 driver 状态，computer_use 操作真实
// 桌面窗口（崩溃重放不该再点一次）。

import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { collectExtensionToolDefinitions } from "./harness-bridge-daily-tools.js";
import {
  computerUseDriverToolName,
  createComputerUseDriverExtension,
} from "./bridge-computer-use-driver.js";
import {
  computerUseToolName,
  createComputerUseToolExtension,
} from "./bridge-computer-use-tool.js";

export const MILKSU_COMPUTER_USE_EXTENSION = "milksu-computer-use";

/** B2f 挂载的控窗两件（mountedHarnessToolNames 与对照断言共用）。 */
export const MILKSU_COMPUTER_USE_TOOL_NAMES = Object.freeze([
  computerUseDriverToolName,
  computerUseToolName,
]);

/** 注册面原型（描述/参数不依赖会话；execute 永不触达——原型 requestAction 抛错）。 */
const prototypeDefinitions = new Map([
  ...collectExtensionToolDefinitions(
    createComputerUseDriverExtension("", () => undefined, () => {
      throw new Error("MilkSU prototype computer-use driver tool must not execute");
    }),
  ).map(definition => [definition.name, definition]),
  ...collectExtensionToolDefinitions(
    createComputerUseToolExtension(() => undefined),
  ).map(definition => [definition.name, definition]),
]);
if (
  !prototypeDefinitions.has(computerUseDriverToolName)
  || !prototypeDefinitions.has(computerUseToolName)
) {
  throw new Error("MilkSU computer-use extensions did not register both tools");
}

/** 找不到定义时的统一显式报错。 */
function missingDefinitionError(name) {
  return new Error(`MilkSU could not resolve the ${name} definition for this conversation`);
}

/**
 * 门开路径的 Computer Use 控窗扩展。context（来自 harness-bridge-session 的会话层）：
 *   resolveConversation    durable conversationId → MilkSU conversationId
 *   getPolicy              alias → 会话策略（computerUse descriptor 挂在策略上）
 *   workspaceActionBroker  与门关同一个工作区动作 broker（prepare 的桌面回路）
 */
export function createMilksuComputerUseExtension(context) {
  const required = ["resolveConversation", "getPolicy", "workspaceActionBroker"];
  for (const name of required) {
    if (!context || !context[name]) {
      throw new TypeError(`createMilksuComputerUseExtension requires ${name}`);
    }
  }
  const { resolveConversation, getPolicy, workspaceActionBroker } = context;

  // computer_use：门关每会话一个工厂闭包（executor 单槽缓存在闭包里）。这里按
  // alias 缓存工厂产物——同会话复用同一份定义，executor 的 observe 快照状态与
  // sessionStarted 缓存跨调用存活（重配 descriptor 才换槽，与门关 executorKey 同款
  // 单槽替换语义）。锁新窗口 = 新 sessionId → 新 executor。
  const computerUseDefinitions = new Map();
  function computerUseDefinitionFor(alias) {
    let definition = computerUseDefinitions.get(alias);
    if (!definition) {
      const [collected] = collectExtensionToolDefinitions(
        createComputerUseToolExtension(() => getPolicy(alias)),
      );
      if (!collected) throw missingDefinitionError(computerUseToolName);
      definition = collected;
      computerUseDefinitions.set(alias, definition);
    }
    return definition;
  }

  // prepare_computer_use_driver：无会话内状态（每次执行都从 policy 读门、从 broker
  // 发请求），按调用实例化定义（B2c milksu_workspace 同款）。
  function driverDefinitionFor(alias) {
    const [definition] = collectExtensionToolDefinitions(
      createComputerUseDriverExtension(
        alias,
        () => getPolicy(alias),
        request => workspaceActionBroker.request(request),
      ),
    );
    if (!definition) throw missingDefinitionError(computerUseDriverToolName);
    return definition;
  }

  const sessionBoundTool = (name, resolveDefinition) => defineTool({
    name,
    description: String(prototypeDefinitions.get(name)?.description ?? name),
    parameters: prototypeDefinitions.get(name)?.parameters,
    async execute(args, api) {
      const alias = resolveConversation(api.conversationId);
      const result = await resolveDefinition(alias).execute(api.callId, args, undefined, undefined, {});
      return {
        ...(Array.isArray(result?.content) ? { content: result.content } : {}),
        ...(result?.isError !== undefined ? { isError: Boolean(result.isError) } : {}),
        ...(result?.details !== undefined ? { details: result.details } : {}),
      };
    },
  });

  return defineExtension({
    name: MILKSU_COMPUTER_USE_EXTENSION,
    tools: [
      sessionBoundTool(computerUseDriverToolName, driverDefinitionFor),
      sessionBoundTool(computerUseToolName, computerUseDefinitionFor),
    ],
  });
}
