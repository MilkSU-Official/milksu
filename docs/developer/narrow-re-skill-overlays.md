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

## Scout 终稿钉点（2026-09-06；Security 仍作决定）

禁止范围不因 Scout 扩表。实现钉点以 Security 终裁为准；本表是 Scout 推荐，供清单对照。

| 序 | 短名 / 路径 | Scout 终稿钉点 | 出厂计划 | 本 PR |
| --- | --- | --- | --- | --- |
| 1 | `ghidra_idareverseengineeringskill` → babysitter `…/ghidra-ida-re/` | 正文自 `da7723a` 起实质未变。若必须整仓钉：HEAD `feb68abe` 或 release `v0.0.188` → `b10d119` | **仍不出厂内置** | **不做** factory overlay。IDA 继续 `milksu-ida-pro` |
| 2 | `ghidra-rpc-main`（短名即 main zip） | **首选** HEAD `1743305487b1de754fb750486dd468ea4d3c4141`（v0.2.0 之后的 headless 写入修复 + `--with-instructions` breaking）。备选稳定 tag `v0.2.0` → `ad507753469d01c7a0faee8b2b2b54ba9367b46e`。非首选 fork：`assaflevy/ghidra-rpc-win` | 内置 overlay，默认关 / 检测就绪。MIT 只写在 README，**无 LICENSE 文件** | **做。** 代码钉首选 HEAD；tag 只作备选常量 |
| 3 | JADX Android malware skill | **钉** `v1.3.0` → `101ca0bd887a295e39cc20a100efa571937ca969`。main tip `54a79883` 只改 description，**不跟 tip**。`scripts/agent.py` 包 apktool/jadx subprocess；androguard **不一定**被脚本调用。权威源 `mukul975`；镜像 `plurigrid/asi` 不 vendor | 内置，**必须默认关** | **做。** 只 vendor 该子树 |

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
