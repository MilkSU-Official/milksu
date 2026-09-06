# 窄逆向 Skill / MCP 出厂覆盖

> 状态：Current / Tracking note（2026-09-06）
>
> 不是实现队列，也不恢复 `development-plan.md`。Scout 钉仓、脚手架决策和会签清单
> 与 PR #55 同步；实现事实以当前代码为准。

## 产品决策（已锁定）

Milk SU + Security Harness Lead（weight=3）锁定：

- 出厂默认只做窄内置 MCP / Skill 覆盖，风格与现有 IDA / capa 相同（设置「安全工具」已并入 MCP 页）。
- **只搭 `ghidra-rpc` 与 JADX skill 脚手架。babysitter / `ghidra-ida-re` / `ghidra_idareverseengineeringskill` 不出厂。** IDA 只保留 first-party `milksu-ida-pro` / `ida-pro`。
- 进入模型名录必须 **就绪且启用**。Skill 正文留在磁盘，由 Pi 渐进披露。不要把 Skill 正文贴进 system prompt。不要另造 harness 或关键词路由。
- 本切片禁止：七言逆向 Skill 全表、toolbox / Kali 商店 UX、`windows-ir-skill` GPL 包作出厂默认、任何 NEO 反封禁 / 指纹 / 隐匿自动化。
- 不扩 CTF plugin #34，不加无关 UI。

来源帖：[七言 2026-09-03](https://x.com/0xQiYan/status/2095523029954806074)。该帖列出 7 项；本切片只取 Scout 排序中的获准项。

## Scout 钉仓（来源发现，2026-09-06）

排序与脚手架决策如下。禁止范围不因 Scout 扩表。

| 序 | 候选 | Scout 建议 | 钉点（两处都写，Security 选） | 许可 / 风险 | 本 PR 脚手架 |
| --- | --- | --- | --- | --- | --- |
| 1 | `ghidra-rpc`（`cellebrite-labs/ghidra-rpc`） | 推荐内置 overlay；默认关 / 检测就绪。依赖 Ghidra 11+、Java 17+ | **main HEAD** `1743305487b1de754fb750486dd468ea4d3c4141`（2026-08-06）；备选 tag `v0.2.0` / `ad507753469d01c7a0faee8b2b2b54ba9367b46e`。不采用 assaflevy/ghidra-rpc-win | README 称 MIT，**无 LICENSE 文件**。主风险=宿主 Bash 调 CLI + 样本/路径回流；subprocess 主要用于拉 daemon，不是到处 `shell=True` | **做。** 短 when-to-use，不 vendor 上游仓 |
| 2 | JADX Android malware skill | 有条件内置，**必须默认关**；样本隔离 + 输出清洗 | 权威源 `mukul975/Anthropic-Cybersecurity-Skills` `skills/reverse-engineering-android-malware-with-jadx` @ `v1.3.0` / `101ca0bd887a295e39cc20a100efa571937ca969`。镜像 `plurigrid/asi` `plugins/asi/skills/reverse-engineering-android-malware-with-jadx`（不跟 tip、不从镜像 vendor） | Apache-2.0。子树含 `scripts/agent.py`（apktool/jadx/androguard subprocess）与 `references/` | **做。** 只 vendor 该子树 |
| 3 | `ghidra_ida` / babysitter（`ghidra_idareverseengineeringskill`） | **不要**作出厂内置 overlay | HEAD `feb68abe…` 或 `v0.0.188→b10d119` | 巨型仓耦合；`allowed-tools` 裸 Bash/Write/Edit/Glob/Grep，无 RPC 边界 | **不做。** 用户可自行导入（默认关） |

Security 已选 `ghidra-rpc` **main**（含 v0.2.0 之后的 headless 修复与 `--with-instructions` breaking）。代码钉 `GhidraRPCRevision`；`GhidraRPCTag` / `GhidraRPCTagRevision` 只作备选记录。

## 会签（保持打开）

| 项 | Security | Coding | Lab |
| --- | --- | --- | --- |
| Scout 排序写入文档 + 只搭 1+2 脚手架 | 待勾 | 待勾 | 待勾 |
| babysitter `ghidra-ida-re` 不出厂 | 待勾 | 待勾 | 待勾 |
| `ghidra-rpc` 默关 / 检测就绪 / 双 pin 入档 / 无 LICENSE 备注 | 待勾 | 待勾 | 待勾 |
| JADX 默关 / 只 vendor 子树 / 隔离+清洗 / lab 路径 | 待勾 | 待勾 | 待勾 |

会签记录写回本文件和 PR #55，不要另开跟踪单。不要合并。

## 本切片已落地的代码合同

- 设置 → MCP「内置 MCP」多两行：`ghidra-rpc`、`jadx-android-malware`。没有 `ghidra-ida-re` 出厂行。
- 默认关闭。恢复默认也回到关闭，不会像 IDA/capa 那样恢复成开启。
- `ghidra-rpc` 在 Ghidra≥11、Java≥17、且设置了 `GHIDRA_INSTALL_DIR` 时为 `ready`；仍默认关，未启用不进名录。
- JADX 在 PATH 上有 `jadx` / `jadx-gui` 时为 `ready`；仍默认关。只服务 `Documents/MilkSU/Lab` 与 `envbroker/cache/InjuredAndroid*`。
- `RuntimeTools` 仍只放已审阅的 IDA MCP 与 `capa_analyze`。Sidecar 不接收这两项 overlay。
- `ghidra-rpc` 只物化短 when-to-use。JADX 物化 MilkSU 包装 `SKILL.md` 加上 `vendor/` 子树（含 `scripts/agent.py` 与 `references/`）。只有 `ready` 且启用才进入 `additionalSkillPaths`。
- 不扫描用户句子，不把 stub 或上游正文贴进 system prompt。
