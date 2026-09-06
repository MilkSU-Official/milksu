# 窄逆向 Skill / MCP 出厂覆盖

> 状态：Current / Tracking note（2026-09-06）
>
> 不是实现队列，也不恢复 `development-plan.md`。决策、候选解析和会签清单与对应
> PR 同步；实现事实以当前代码为准。

## 产品决策（已锁定）

Milk SU + Security Harness Lead（weight=3）锁定：

- 出厂默认只做窄内置 MCP / Skill 覆盖，风格与现有 IDA / capa 相同（设置「安全工具」已并入 MCP 页）。
- 候选只许三项：(1) IDA/Ghidra 逆向工作流，短名 `ghidra_idareverseengineeringskill`；(2) Ghidra RPC，短名 `ghidra-rpc-main`；(3) JADX 安卓恶意样本，短名 `reverse-engineering-android-malware-with-jadx`。
- 默认关闭；或仅在本机工具检测为就绪后可启用。进入模型名录必须 **就绪且启用**。
- Skill 正文留在磁盘，由 Pi 渐进披露（`name` + when-to-use `description`，正文经 `read` / `/skill:name`）。不要把 Skill 正文贴进 system prompt。不要另造 harness 或关键词路由。
- 本切片禁止：七言逆向 Skill 全表、toolbox / Kali 商店 UX、`windows-ir-skill` GPL 包作出厂默认、任何 NEO 反封禁 / 指纹 / 隐匿自动化。
- 不扩 CTF plugin #34，不加无关 UI。

来源帖：[七言 2026-09-03](https://x.com/0xQiYan/status/2095523029954806074)。该帖列出 7 项；本切片只取上面 3 项。

## 候选解析（2026-09-06）

| 出厂 ID | 帖内短名 | 解析到的来源 | 许可 | 钉点 | 本 PR 处理 |
| --- | --- | --- | --- | --- | --- |
| `ghidra-ida-re` | `ghidra_idareverseengineeringskill` | 无独立可钉仓库。公开副本：`tomysh1337/openstarry-code` 的 `Ghidra_IDAReverseEngineeringSkill/SKILL.md`（blob `086315d16ee2a30bb18feb45582d5dabfd55dcb5`）；相近稿 `a5c-ai/babysitter` 的 `ghidra-ida-re` | 副本许可未单独会签 | 无稳定 tag | **不 vendor**。只出 MilkSU stub |
| `ghidra-rpc` | `ghidra-rpc-main` | https://github.com/cellebrite-labs/ghidra-rpc | MIT（README） | tag `v0.2.0` @ `ad507753469d01c7a0faee8b2b2b54ba9367b46e`；HEAD `1743305487b1de754fb750486dd468ea4d3c4141`（2026-08-06） | **不 vendor / 不启动**。CLI+daemon，不是现成 MCP；会签前只做检测与可编辑覆盖 |
| `jadx-android-malware` | `reverse-engineering-android-malware-with-jadx` | https://github.com/mukul975/Anthropic-Cybersecurity-Skills `skills/reverse-engineering-android-malware-with-jadx/SKILL.md` | Apache-2.0 | tag `v1.3.0` @ `101ca0bd887a295e39cc20a100efa571937ca969`；文件 blob `d1068d5f318ffd171389312bfaa78c37b8f08e3e` | **不 vendor**。只出 MilkSU stub |

未审阅的第三方 Skill 正文不得进签名包或模型名录。会签通过后再钉 URL+tag，写 NOTICE，并走现有 Pi `additionalSkillPaths` / 内置 MCP 覆盖。

## 三门会签清单

每一项都要由 Security、Coding、Lab 会签后，才能把检测状态升到 `ready` 或把正文/适配器接入名录。

| 门 | 要回答的问题 | `ghidra-ida-re` | `ghidra-rpc` | `jadx-android-malware` |
| --- | --- | --- | --- | --- |
| 稳定来源 | 是否有稳定 git URL + tag/commit，而不是聚合副本？ | 待补独立来源 | `cellebrite-labs/ghidra-rpc@v0.2.0` 可用，是否钉它？ | `mukul975/Anthropic-Cybersecurity-Skills@v1.3.0` 是否可接受？ |
| 许可 | AGPL 主项目能否带这份许可？NOTICE 是否写清？ | 来源未定 | MIT，待写 NOTICE | Apache-2.0，待写 NOTICE |
| 恶意 / 注入 / 授权 | Skill 或 CLI 是否诱导越权、贴密钥、扫未授权目标、或把大段正文打进 prompt？ | stub 未含上游正文 | CLI 会写 Ghidra 工程、用本机 socket；路径与授权边界未审 | 上游正文含动态分析/C2 提取示例，未审 |
| Coding + Lab 会签 | 是否只服务用户授权样本，三端如何检测本机工具，失败时产品文案是否诚实？ | 待会签 | 待会签；Windows/Linux 检测目前主要靠 PATH | 待会签；目前只认 PATH 上的 `jadx` / `jadx-gui` |

会签记录直接写回本文件和同一 PR，不要另开跟踪单。

## 本切片已落地的代码合同

- 设置 → MCP「内置 MCP」多三行：`ghidra-ida-re`、`ghidra-rpc`、`jadx-android-malware`。
- 默认关闭。恢复默认也回到关闭，不会像 IDA/capa 那样恢复成开启。
- 本机检测到 IDA/Ghidra/JADX 时状态是「已检测」，不是 `ready`。`usableByAgent` 保持 false。
- `RuntimeTools` 仍只放已审阅的 IDA MCP 与 `capa_analyze`。Sidecar 不接收这三项。
- Skill stub 在 `internal/securitytools/overlays/<id>/SKILL.md`。只有 `ready` 且启用才会物化到数据目录并进入 `additionalSkillPaths`。
- 不扫描用户句子，不把 stub 或上游正文贴进 system prompt。

## 下一步（会签后才做）

1. Security / Coding / Lab 在本 PR 勾上面四门，或明确拒绝某一项。
2. 通过项：钉 URL+tag，写 NOTICE，把检测升到 `ready`（仍默认关，或仅本机就绪可开）。
3. Skill 走 Pi 名录；MCP/CLI 走现有内置覆盖，不新造 harness。
4. 用授权本地样本留一条真实任务回执后再谈进发行包。
