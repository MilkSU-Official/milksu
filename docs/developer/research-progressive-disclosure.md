# 研究：按需加载不该自造，应对齐 Agent Skills + Pi Dynamic Tools

> 文档状态：**Historical / Research**。不是实现队列。
>
> 日期：2026-09-05。起因：消融里看到现行 Coding 附加层约 3600 token，
> 其中 workspace / Skill 名录 / 常驻目录本轮零调用；同时又担心“不注入就永远不触发”。

## 社区已经收敛的答案

“注入多少才刚好”不是 MilkSU 要发明的旋钮。开源编码 Agent 在 2025–2026 收敛成两套标准，职责不同：

| 对象 | 标准 | 始终在上下文里的 | 真正按需加载的 | 用户强制 |
| --- | --- | --- | --- | --- |
| 流程 / 长说明书（Skill） | [Agent Skills](https://agentskills.io/integrate-skills) | `name` + `description`（约 50–100 token / 个） | `SKILL.md` 正文；再按需 `read` references/scripts | `/skill:name` |
| 可执行工具目录（MCP / 胖工具） | MCP progressive discovery + Anthropic `defer_loading` / Tool Search | 3–5 个高频核心工具 | 被搜到或被激活的 schema | GUI / 斜杠 / 类型化产品动作 |

Claude Code、Pi、OpenAI Codex、Microsoft Agent Framework、OpenHands 的 Skill 层都走第一套。
Anthropic Tool Search、MCP 客户端最佳实践、Pi `docs/extensions.md` 的 Dynamic Tool Loading 走第二套。

**不要**再加第三套：按用户句子关键词决定注入哪段 system prompt / 哪组工具。MilkSU 已经禁止这种路由。OpenHands 的 `triggers` 关键词注入也不采用。

## Pi 已经有的，不要重写

钉住的 `pi-coding-agent@0.84.1` 已经实现两套：

1. **Skill 渐进披露**（`formatSkillsForPrompt`，对齐 agentskills.io）  
   系统提示只放 `<available_skills>` 的 name / description / location。  
   说明原文：*Use the read tool to load a skill's file when the task matches its description.*  
   Pi 自己承认：模型不一定会 `read`；补偿是 **更好的 description** 或 **`/skill:name`**，不是把正文再贴进 system prompt。  
   `disable-model-invocation: true` 可从名录隐藏，只留斜杠。

2. **动态工具加载**（`docs/extensions.md` § Dynamic Tool Loading）  
   先 `registerTool` 全部，初始只 `setActiveTools` 一小撮；需要时**只增不减**地激活。  
   Anthropic 4.5+ / OpenAI `gpt-5.4`+ 走原生 `defer_loading` + `tool_reference`，前缀缓存不破。  
   其他模型退回“下一轮带上新激活的完整 schema”。  
   官方例子就是 `search_tools` loader。Pi 写明：带 `promptSnippet` / `promptGuidelines` 的懒加载工具会重建 system prompt、打断缓存；懒工具应只靠 `description`。

MilkSU 注释“`createAgentSession` 时没列入的工具以后加不进去”仍然成立：**定义必须先注册**。这和“全部激活并再写一遍 MUST 文案”不是一回事。隔离浏览器已经是正确范例：Playwright MCP 只在用户打开右栏或类型化动作后才进会话。

## “不注入就永远不触发”在成熟实现里怎么处理

社区不靠猜阈值，靠三条并行通道：

1. **名录里的 routing description**（始终注入，但很短）  
   写 *when to use*，带用户会说的触发语，不要写成摘要。坏例子：`Helps with PDFs.`  
   好例子：`Extracts text and tables from PDFs. Use when working with PDF documents.`  
   不触发 = description 太窄或太含糊，**改 description**，不要改成“把正文常驻”。

2. **用户强制**  
   `/skill:name`（Pi / Claude / Codex 都有）。  
   MilkSU 已有更强的通道：GUI 类型化 product action（打开浏览器、选 Computer Use、点选择卡）。这比模型自己发现更可靠。

3. **承认模型会漏**  
   Pi 文档原文：*models don't always do this; use prompting or `/skill:name` to force it.*  
   成熟实现接受偶发漏触发，用斜杠/按钮补；**不接受**把全文预加载当补偿。

Anthropic 对工具目录的对称规则：高频 3–5 个工具**不要** `defer_loading`，否则模型会为了日常 `read`/`edit` 先搜一轮。

## 对照：MilkSU 现在偏了哪里

消融里贵的不是“注册了工具”，而是 **双重披露 + 全量激活**：

| 层 | 成熟做法 | 现行 MilkSU |
| --- | --- | --- |
| Skill | 名录 ~50–100 tok / 个，正文 `read` | Pi 名录已在；但 7 个 description 合计约 1106 tok（偏长），且 `release-milksu` 对每个 Coding 会话可见 |
| `milksu_workspace` | 一个工具 + 短 when-to-use；或 GUI 打开后再激活 | schema ≈ 711 tok **再加** `codingWorkspaceGuidance()` ≈ 350 tok，内容重复 |
| `milksu_ask` / `milksu_progress` | 工具 description 说明何时用；桌面投影事件 | 工具已注册，**另外** system prompt MUST 再命令一次 |
| LSP / ImageGen / CUA driver / 浏览器 MCP | 注册，默认不激活；类型化动作或 search 再打开 | 会话创建时写进 `codingWorkspaceAutoToolNames` 并 `setActiveTools` 全开 |
| 宿主 OS / cwd | 始终注入（不是 Skill） | 正确，应保留 |

白皮名单里的 disposition 已经和社区一致：`milksu_progress` 只做投影，计划语义交给 Pi goal/plan；`tomsej/pi-ext` Ask User Question 等扩展 UI 能 round-trip 再考虑。不要再写第二套 `load_skill` / `search_tools` 包装器。

## 本切片已收（步骤 1–2）

`feat/pi-progressive-disclosure` 只做提示与 Skill 名录，不改 MCP / Skills **配置**（路径、Settings 开关、`disabledSkills` 加载器、`internal/agentresources`、`setActiveTools` 政策）：

1. **删双重披露**：`before_agent_start` 不再复述 ask / progress / workspace 动作表 / `tool_result` 截断 MUST。when-to-use 只留在对应 tool description。宿主 OS/cwd、角色、以及浏览器/子 Agent 已打开时的短说明仍注入。
2. **Skill 按 Pi 标准收描述**：first-party `description` 改成 routing rule；`release-milksu` 设 `disable-model-invocation: true`。正文继续靠 `read` 或 `/skill:`。不改 `bridge-skills.js` 的路径解析。

## 未做（留给 MCP/Skills 配置重构或其他切片）

3. **可选胖工具学隔离浏览器**：继续在 extension 里 `registerTool`，初始 `activeTools` 只留 Pi 文件/Shell + 最多 3 个产品 UI 工具；LSP / ImageGen / CUA 准备器跟浏览器一样，由类型化动作激活。  
4. **只有目录真的涨到几十上百**（大量项目 MCP）才接 Pi 自带的 `search_tools` + `setActiveTools` 加法激活。现在大约十个可选工具，不够资格自造搜索层。  
5. **不要**扫描用户句子来决定加载；**不要**为“怕不触发”把 Skill 正文或 workspace 动作表贴回 system prompt。

## 来源

- https://agentskills.io/integrate-skills  
- https://agentskills.io/specification  
- `node_modules/@earendil-works/pi-coding-agent/docs/skills.md`  
- `node_modules/@earendil-works/pi-coding-agent/docs/extensions.md`（Dynamic Tool Loading）  
- https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool  
- https://modelcontextprotocol.io/docs/2026-07-28/develop/clients/client-best-practices  
- https://docs.openhands.dev/overview/skills（Skill 三层披露可对齐；其 keyword `triggers` 不采用）
