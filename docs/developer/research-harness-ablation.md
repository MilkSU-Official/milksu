# 研究：Pi 之上的 MilkSU harness 消融

> 文档状态：**Historical / Research**。不是产品完成线，也不是实现队列。
>
> 日期：2026-09-05。模型：`deepseek/deepseek-v4-flash`。种子：1。
> 运行器：`spikes/harness-ablation/`（隔离 spike，不进生产链）。

## 问题

MilkSU 在 Pi Agent 之上还包了哪些层？其中哪些对文件型 Coding 任务是多余的，会不会把解题率做差？

## 方法

同一模型、同一组独立 Judge 任务，只改 MilkSU 附加层：

| 变体 | 模型看到的附加物 |
| --- | --- |
| `pi_native` | Pi 默认提示 + 文件/Shell 工具 |
| `host_facts` | + OS/arch/shell + 权威 cwd |
| `product_ui` | + `milksu_progress` / `milksu_ask` / `milksu_workspace` 及其 MUST 文案 |
| `current_coding` | 接近现行 Coding：完整 runtime 政策、产品工具、常驻目录 stub、已审阅 Skill 名 |

`milksu_ask` 在 runner 里自动点第一项，避免挂起；产品里这一步会暂停回合等用户点选。Token 估计用 Pi 的 chars/4。`current_coding` 的 goal/LSP/web/subagent schema 是短 stub，**低估**真实目录体积。

## 静态体积（用户还没说话）

现行 Coding 附加层合计约 **3627** token。其中看起来最像空转税的是：

| 层 | 约 token | 本轮文件任务里有没有被用到 |
| --- | ---: | --- |
| 已审阅 Skill 名录（7 个 description） | 1106 | 无 |
| `milksu_workspace` schema + 长 guidance | 1061 | 无 |
| 常驻目录 stub（goal / bg / web / lsp / subagent） | 390+（真实 schema 更大） | 无 |
| runtime 政策（界面语言、现场证据） | 189 | 无 |
| `milksu_ask` MUST 文案 + schema | 271 | `ask_trap` 才触发 |
| `milksu_progress` MUST 文案 + schema | 215 | `json_names` 触发了 2 次 |
| tool_result 截断提醒 | 58 | Pi 已经截断 |
| 宿主 OS/cwd 事实 | 174 | 路径任务需要，本轮中性 |

`host_facts` 只加 174 token。从 `pi_native` 到 `current_coding`，附加上下文大约从 0 升到 3600。

## 现场结果

易题 6 道 + 较难题 `quoted_csv` 1 道。独立 Judge（import / 文件内容），不是模型自述。

| 变体 | 易题解题 | 较难 CSV | 产品工具空转 | billed input | 均时 |
| --- | ---: | ---: | ---: | ---: | ---: |
| `pi_native` | 5/6 | 通过 | 0 | 12340 | 2.8s |
| `host_facts` | 5/6 | 通过 | 0 | 12086 | 3.2s |
| `product_ui` | 6/6 | 通过 | 1 次 ask | 23350 | 3.9s |
| `current_coding` | 5/6 | 通过 | 1 ask + 2 progress | 30442 | 4.5s |

唯一共同失败是 `multistep`：写出了 `result.txt=42`，但 `src/double.js` 不能被 Judge import。`product_ui` 这道过了，所以**不能**把失败算到附加层头上。

## 结论

在这组短文件任务、单一 flash 模型和 1 个种子上：

1. **解题率没有被附加层做差。** 没有测到“错误率随 MilkSU 层数上升”。
2. **测到的是税，不是更笨。** `current_coding` 的 billed input 约是裸 Pi 的 **2.5 倍**，均时约 **1.6 倍**。
3. **最像多余的层**（本轮零调用或只产生空转）：
   - 每回合注入的 `milksu_workspace` 长 schema / guidance；
   - 默认铺开的 7 个 Skill description；
   - 文件任务用不到的 goal / bg / web / lsp / subagent 常驻目录；
   - 与 Pi `tool_result` bound 重复的截断说明。
4. **会改行为、在产品里会伤自主循环的层**：
   - `milksu_ask` 的 MUST 文案：用户说“先给我两个方案”时，裸 Pi 直接做完；带产品层会先停下来等选择卡。Runner 自动点选后仍做对，但真产品会中断回合。
   - `milksu_progress` 的“多步必须发计划”：简单的 `json_names` 被叫了两次。Pi 已有 goal 工具；白皮名单也写过 progress 应只做投影。
5. **应保留的薄层**：OS/shell/cwd 事实（174 token，解题率与裸 Pi 相同）、凭据/审批/路径边界、领域 Judge。这些不是第二套 harness。

Agent Harness 的常见失败模式是把产品 UI 工具和长政策写进每一轮的 tool catalog / system prompt。模型多半仍会用 `read`/`edit`/`write` 完成文件活，但上下文被占满，并在“选项 / 计划 / 工作台”话术上多走空转。本轮证据支持“减税”，还不支持“这些层会把短任务做砸”。

## 不能外推

- 一种模型、一个种子、短任务。长 CTF / CVE、弱模型、或真实 `milksu_ask` 挂起，都可能更差。
- 没有拆掉 Go 审批、没有跑 Cybench。
- 常驻目录 schema 是 stub，真实 LSP/MCP/subagent 描述会更贵。

## 复跑

```bash
npm run spike:harness-ablation:test
npm run spike:harness-ablation:inventory
MILKSU_SPIKE_PROVIDER=deepseek MILKSU_SPIKE_MODEL=deepseek-v4-flash npm run spike:harness-ablation
```
