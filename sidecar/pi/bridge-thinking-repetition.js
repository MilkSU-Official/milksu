// 思考（reasoning）复读护栏。
//
// 真机案例：一次思考烧掉 6 分钟 / 23,276 reasoning token，内容全在同一行上打转（`(unchanged)` ×8 连续多行），
// 模型自己停不下来。引擎原有的"不许无进展续跑"护栏是 createToolRepeatGuard（bridge-tool-repeat.js），
// 它只在**工具调用**处被喂数据（bridge.js 的 repeatGuard.inspect(toolName, input)）⇒ reasoning 文本
// **从不经过它** ⇒ 那种复读永远不会被拦。所以这是**思考内容**这一层的第一条护栏。
//
// 只在**真的复读**时触发：判据是"**连续** N 行完全相同"。长但每行都不同的思考必然放行（有测试钉住）。

/** 连续多少行完全相同才算复读（真机上用户看到的是连续 8 行）。 */
export const THINKING_REPEAT_LINES = 8;

/** 命中时给读者的句子（成对双语，前端按界面语言选一句）。 */
export const THINKING_REPEAT_NOTICE = {
  notice: "这一步思考在原地重复了，已提醒你——要不要停由你决定。",
  noticeEnglish: "This thinking step started repeating; you decide whether to stop it.",
};

/**
 * 每个会话一份护栏：吃 thinking 增量，**按行**切段，连续 N 行完全相同即命中一次。
 * 只记内容、不改内容：命中后把事实交给调用方去告诉读者（绝不静默）。
 */
export function createThinkingRepetitionGuard({ threshold = THINKING_REPEAT_LINES } = {}) {
  const states = new Map();

  function stateFor(conversationId) {
    const key = String(conversationId ?? "");
    let state = states.get(key);
    if (!state) {
      state = { buffer: "", previous: "", run: 0, fired: false };
      states.set(key, state);
    }
    return state;
  }

  return {
    /** 新一轮思考开始 ⇒ 清掉这一会话的累积（不跨轮误判）。 */
    reset(conversationId) {
      states.delete(String(conversationId ?? ""));
    },
    /**
     * 喂一个 thinking 增量。返回 null 或 { line, run }（同一会话每个"思考步"只报一次）。
     */
    push(conversationId, delta) {
      const state = stateFor(conversationId);
      state.buffer += String(delta ?? "");
      let hit = null;
      for (let index = state.buffer.indexOf("\n"); index >= 0; index = state.buffer.indexOf("\n")) {
        const line = state.buffer.slice(0, index).trim();
        state.buffer = state.buffer.slice(index + 1);
        if (!line) continue;
        if (line === state.previous) {
          state.run += 1;
        } else {
          state.previous = line;
          state.run = 1;
        }
        if (!state.fired && state.run >= threshold) {
          state.fired = true;
          hit = { line, run: state.run };
        }
      }
      return hit;
    },
  };
}
