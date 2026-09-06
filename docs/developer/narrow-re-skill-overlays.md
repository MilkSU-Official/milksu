# 窄逆向 Skill / MCP 出厂覆盖

> 状态：Current / Tracking note（2026-09-06）
>
> 不是实现队列，也不恢复 `development-plan.md`。决策、候选解析和会签清单与对应
> PR 同步；实现事实以当前代码为准。

## 产品决策（已锁定）

Milk SU + Security Harness Lead（weight=3）锁定：

- 出厂默认只做窄内置 MCP / Skill 覆盖，风格与现有 IDA / capa 相同（设置「安全工具」已并入 MCP 页）。
- **babysitter `ghidra-ida-re` 不出厂。** IDA 只保留 first-party `milksu-ida-pro` / `ida-pro`。
- `ghidra-rpc`：Security **CONDITIONAL PASS**。内置 overlay，默认关；检测 Ghidra≥11、Java≥17、`GHIDRA_INSTALL_DIR`；钉 `cellebrite-labs/ghidra-rpc` main `1743305487b1de754fb750486dd468ea4d3c4141`；只出短 when-to-use；NOTICE 写明上游没有 LICENSE 文件；样本/工程限制在 `Documents/MilkSU/{Coding,Lab,CVE}`。
- JADX skill：Security **CONDITIONAL PASS**。只 vendor `mukul975/Anthropic-Cybersecurity-Skills` 的 `skills/reverse-engineering-android-malware-with-jadx`，钉 `v1.3.0` / `101ca0bd887a295e39cc20a100efa571937ca969`；必须默认关；样本隔离 + 输出清洗；只走 lab / InjuredAndroid 路径，不用 Computer Use。禁止 vendor 整个 Anthropic 仓库。
- 进入模型名录必须 **就绪且启用**。Skill 正文留在磁盘，由 Pi 渐进披露。不要把 Skill 正文贴进 system prompt。不要另造 harness 或关键词路由。
- 本切片禁止：七言逆向 Skill 全表、toolbox / Kali 商店 UX、`windows-ir-skill` GPL 包作出厂默认、任何 NEO 反封禁 / 指纹 / 隐匿自动化。
- 不扩 CTF plugin #34，不加无关 UI。

来源帖：[七言 2026-09-03](https://x.com/0xQiYan/status/2095523029954806074)。该帖列出 7 项；本切片只取获准项。

## 候选解析（Security 终裁 2026-09-06）

| 出厂 ID | 帖内短名 | 解析到的来源 | 许可 | 钉点 | 终裁 |
| --- | --- | --- | --- | --- | --- |
| （无） | `ghidra_idareverseengineeringskill` | babysitter `ghidra-ida-re`；公开副本 `tomysh1337/openstarry-code` | MIT 可，仍不适合签名包内置 | HEAD `feb68abe…` / `v0.0.188` | **否。不出厂。** IDA 继续 `milksu-ida-pro` |
| `ghidra-rpc` | `ghidra-rpc-main` | https://github.com/cellebrite-labs/ghidra-rpc | README 称 MIT；仓内无 LICENSE 文件 | **main** `1743305487b1de754fb750486dd468ea4d3c4141`（不采用 `v0.2.0` 或 assaflevy/ghidra-rpc-win） | **CONDITIONAL PASS**。内置 overlay，不 vendor 上游仓 |
| `jadx-android-malware` | `reverse-engineering-android-malware-with-jadx` | https://github.com/mukul975/Anthropic-Cybersecurity-Skills `skills/reverse-engineering-android-malware-with-jadx` | Apache-2.0 | **v1.3.0** / `101ca0bd887a295e39cc20a100efa571937ca969`（不跟 main tip） | **CONDITIONAL PASS**。只 vendor 该子树 |

## 会签

| 项 | Security | Coding | Lab |
| --- | --- | --- | --- |
| babysitter `ghidra-ida-re` | 否 · 不出厂（已落地） | 待对照本轮实现副签 | 待对照本轮实现副签 |
| `ghidra-rpc` | CONDITIONAL PASS（已落地） | 待对照本轮实现副签 | 待对照本轮实现副签 |
| `jadx-android-malware` | CONDITIONAL PASS（已落地） | 待对照本轮实现副签 | 待对照本轮实现副签 |

会签记录写回本文件和 PR #55，不要另开跟踪单。不要合并，直到 Coding / Lab 对照实现再签。

## 本切片已落地的代码合同

- 设置 → MCP「内置 MCP」多两行：`ghidra-rpc`、`jadx-android-malware`。没有 `ghidra-ida-re` 出厂行。
- 默认关闭。恢复默认也回到关闭，不会像 IDA/capa 那样恢复成开启。
- `ghidra-rpc` 在 Ghidra≥11、Java≥17、且设置了 `GHIDRA_INSTALL_DIR` 时为 `ready`；仍默认关，未启用不进名录。
- JADX 在 PATH 上有 `jadx` / `jadx-gui` 时为 `ready`；仍默认关。只服务 `Documents/MilkSU/Lab` 与 `envbroker/cache/InjuredAndroid*`。
- `RuntimeTools` 仍只放已审阅的 IDA MCP 与 `capa_analyze`。Sidecar 不接收这两项 overlay。
- `ghidra-rpc` 只物化短 when-to-use。JADX 物化 MilkSU 包装 `SKILL.md` 加上 `vendor/` 子树。只有 `ready` 且启用才进入 `additionalSkillPaths`。
- 不扫描用户句子，不把 stub 或上游正文贴进 system prompt。
