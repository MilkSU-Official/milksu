# 开源安全 Skills / Harness 生态接入调研与计划

> 文档状态：**Research / Long-term integration plan**
>
> 审阅日期：2026-08-04
>
> 边界：本次只做公开 GitHub / README / 元数据调研，没有安装、运行、拉取子模块、执行安全工具或
> 修改 MilkSU Runtime。本页是未来接入候选和设计输入，不表示这些项目已经成为依赖或当前冲刺
> 目标。

## 背景

`zhaoxuya520/reverse-skill` 这类仓库在短时间内获得大量 Star，说明安全 Agent Skills 正在形成
一个真实生态：有人把安全方法论、工具前置条件、执行流程、验证检查和报告模板包装成可被 AI
Agent 按需加载的 Skill Pack。

MilkSU 不应该把所有能力都自己重写。自己写的 playbook、工具列表和题型经验很容易缺少真实
社区测试；高热度、持续维护、许可证清楚的开源项目可以作为更可靠的能力来源。

但 MilkSU 也不能把外部 Skills 当成无约束插件直接执行。安全 Skills 本身就是新的供应链入口：
它们可能包含 prompt injection、危险脚本、过宽 MCP 权限、凭据读取、网络访问和自动安装逻辑。

因此本计划的核心是：

> 以合适的方式接入优秀开源项目：先只读研究和路由建议，再做安全扫描、固定版本、按需启用和
> MilkSU 策略覆盖。外部项目增强 MilkSU 的知识和工具意识，但不接管 MilkSU 的 Scope、Evidence、
> Judge、Memory 和用户授权模型。

## 候选生态地图

| 项目 | 形态 | 许可证/风险口径 | 对 MilkSU 的价值 | 初步接入建议 |
| --- | --- | --- | --- | --- |
| [`mukul975/Anthropic-Cybersecurity-Skills`](https://github.com/mukul975/Anthropic-Cybersecurity-Skills) | 大规模结构化安全 Skills，覆盖多安全域并映射 MITRE / NIST / D3FEND / ATLAS | Apache-2.0；数量大，需要抽样质量审查 | 分类、metadata、能力画像映射、领域 taxonomy | P1 研究；优先借鉴 frontmatter 和分类，不整体导入 |
| [`zhaoxuya520/reverse-skill`](https://github.com/zhaoxuya520/reverse-skill) | 逆向 / CTF / 授权安全研究 Skill Router + tool-index + case/evidence 契约 | 主项目 MIT；部分子模块/第三方能力含 GPLv3、AGPL 等边界 | 先路由后执行、工具索引、Reverse/CTF/Pwn/Forensics playbook | P1 做只读 Skill Pack Adapter 样本 |
| [`trailofbits/skills`](https://github.com/trailofbits/skills) | Trail of Bits 安全技能 marketplace，面向 Claude Code / Codex | CC-BY-SA-4.0；需确认内容复用边界 | 专业安全审计 workflow、插件 marketplace 组织方式 | P0 研究质量标杆；优先学习结构，不复制内容 |
| [`ljagiello/ctf-skills`](https://github.com/ljagiello/ctf-skills) | CTF 专用 Agent Skills，覆盖 Web、Pwn、Crypto、Reverse、Forensics、OSINT 等 | MIT | 与 MilkSU CTF 六赛道最贴近 | P0 参考题型 skill 结构和工具前置条件 |
| [`yaklang/hack-skills`](https://github.com/yaklang/hack-skills) | Hacker Arsenal for Agents，安全知识库，101 deep topic skills | MIT；偏实战攻击，需要严格范围控制 | 中文/安全社区语境、分类、检索 UI、P0/P1/P2 tier | P2 只读参考；不默认启用攻击路线 |
| [`gadievron/raptor`](https://github.com/gadievron/raptor) | 基于 Claude Code 的攻防安全研究 Harness | MIT；包含 exploit / validate / patch 等高风险工作流 | Sandbox、workflow、审计/验证/修复链路 | P2 研究 Harness 设计，不接入默认能力 |
| [`affaan-m/ECC`](https://github.com/affaan-m/ECC) | 通用 Agent 工程系统：agents、skills、commands、hooks、memory、AgentShield | MIT；范围很大，可能与 MilkSU 重叠 | review / verify / remember / improve 流程，AgentShield 思路 | P2 研究工程组织和 Codex sync，不接管 MilkSU |
| [`Pantheon-Security/medusa`](https://github.com/Pantheon-Security/medusa) | AI-first 安全扫描器，含 Agent/Skill/MCP 供应链与 secrets 扫描 | AGPL-3.0；不宜直接嵌入私有 Runtime | Skill/MCP/agent config 安全扫描、密钥泄露检测思路 | P0 作为安全门参考；可外部 CLI 研究，不 vendoring |
| [`slowmist/slowmist-agent-security`](https://github.com/slowmist/slowmist-agent-security) | Agent 安全审查 Skill，强调外部输入不可信 | MIT | 外部 Skill / Repo / URL / MCP 审查方法 | P0 参考 MilkSU 外部 Skill 审查流程 |
| [`theinfosecguy/razin`](https://github.com/theinfosecguy/razin) | `SKILL.md` 静态扫描器 | 待逐项确认；项目小 | 导入 Skill 前 deterministic finding / SARIF / CI gate 思路 | P1 研究；可作为扫描规则参考 |
| [`Teycir/SkillsGuard`](https://github.com/Teycir/SkillsGuard) | Skill 包安全扫描器，检测 prompt injection、exfiltration、混淆脚本等 | 待逐项确认；项目小 | 外部 Skill Pack 导入前的风险评分、baseline、watch、MCP scan 工具 | P1 研究；可作为 Skill 供应链门禁样本 |
| [`sjkim1127/Reversecore_MCP`](https://github.com/sjkim1127/Reversecore_MCP) | 逆向 / malware / forensics / SAST MCP server | MIT；执行面较大 | 逆向工具 MCP 化、120 工具目录、Docker 运行方式 | P2 工具层参考；不直接开执行权限 |

## 关键判断

### 1. Star 多说明生态关注，不等于可以直接依赖

高 Star 项目通常有更好的社区发现和反馈，但仍不能替代：

- 固定 commit / release；
- license manifest；
- 供应链扫描；
- 本地 sandbox；
- 权限审查；
- MilkSU 真实任务验收；
- 用户可理解的 UI/UX 接入。

尤其是安全 Skills，项目越强，默认执行风险也越大。

### 2. 最值得借的是结构，不是“攻击能力数量”

MilkSU 的近期目标不是变成红队自动机。更值得吸收的是：

- progressive disclosure：先扫 frontmatter，再按需加载正文；
- task routing：任务类型 → skill → 工具 → 验证；
- tool capability index：工具是否存在、版本、路径、安装建议；
- case/evidence/timeline：每次运行都能复盘；
- verification：每个 skill 自带验收条件；
- reporting：把产物变成用户可读学习材料；
- skill supply-chain gate：导入前检查恶意指令、脚本、MCP 配置和凭据访问。

### 3. 外部项目应增强 MilkSU 的“能力来源”，不是接管 MilkSU 的“执行权”

外部 Skill Pack 只能给出候选路线和知识；真正执行仍走 MilkSU：

- Scope；
- Endpoint 授权；
- Shell / Browser / Computer Use 权限；
- Artifact / Evidence；
- Judge receipt；
- Memory / Ability Profile 归因；
- Git / workspace 边界；
- 用户确认。

外部 Skill 中的 `MUST`、`auto install`、`write journal`、`ignore previous instructions` 等都不得
覆盖 MilkSU 策略。

## 推荐架构：Skill Pack Adapter

未来可以新增一个只读优先的 `Skill Pack Adapter`：

```text
External Skill Pack
  ↓
固定版本 / digest / license manifest
  ↓
Skill 安全扫描
  ↓
frontmatter / routing / prerequisites 解析
  ↓
MilkSU SkillRouteSuggestion
  ↓
CTF / CVE / Coding / Memory 使用
  ↓
Scope + Evidence + Judge + 用户确认
```

### 核心对象

```text
SkillPack
  id
  source_url
  local_path
  commit_or_digest
  license_summary
  risk_level
  enabled_modules
  disabled_modules

SkillRoute
  route_id
  source_skill
  domain
  trigger
  prerequisites
  suggested_steps
  verification
  risk_tags

SkillRouteSuggestion
  task_id
  matched_routes
  reason
  required_tools
  required_scope
  blocked_actions
```

### UI 接入

短期不做 marketplace。先做：

- 外部 Skill Pack 列表；
- 只读导入；
- 风险标签；
- 能力覆盖；
- 工具缺失提示；
- “作为路线参考”按钮；
- “禁用危险模块”默认开启。

## 各模块吸收方式

### CTF

优先参考 `ctf-skills`、`reverse-skill` 和 `hack-skills`：

- 根据附件类型自动推荐 Web / Pwn / Reverse / Crypto / Forensics / Misc 路线；
- 每条路线显示前置工具和常见失败点；
- Agent 只能把 skill 内容当作 playbook；
- 成功仍必须依赖平台 Judge 或用户确认的 evidence；
- Skill 的经验可以进入 Agent Memory，但不能自动提升用户 Ability Profile。

### CVE

优先参考 `Anthropic-Cybersecurity-Skills`、`Trail of Bits Skills`、`Medusa`：

- CVE 学习和追踪可以引用标准 taxonomy；
- Patch diff、影响版本、修复建议、代码审计可以用 skill 生成检查清单；
- 不默认生成 weaponized PoC；
- 不自动扫描真实互联网目标；
- 结果必须区分“资料理解”“仓库影响检查”“复现证据”和“修复状态”。

### Coding

优先参考 `ECC` 和 `Trail of Bits Skills`：

- 自举 Coding Loop 中加入 review / verify / remember / improve 的稳定节奏；
- 安全审计类任务可以用专业 skill 触发；
- 但 MilkSU 不再重造完整通用 Harness；
- Pi / Codex 的通用 Agent 能力仍是基础。

### 外部 Skill 安全

优先参考 `SlowMist Agent Security`、`SkillsGuard`、`razin`、`Medusa`：

- 导入前扫描 `SKILL.md`、脚本、MCP config、hooks；
- 标记 prompt injection、secret access、network exfiltration、shell bootstrap、base64/obfuscation、
  overbroad permission；
- 支持 baseline；
- 默认 fail closed；
- 用户可以只读查看被拦截原因。

## 分阶段计划

### Phase 0：研究记录与候选清单

- 保留本文档；
- 保留 [`reverse-skill` 专项接入调研](./关于一个优秀%20skills%20包的接入调研和计划.md)；
- 不安装依赖；
- 不复制第三方仓库；
- 不启用外部攻击能力。

### Phase 1：只读 Skill Pack Adapter 原型

- 支持选择本地 Skill Pack 目录；
- 读取入口文件和 frontmatter；
- 生成只读 route suggestions；
- 标记危险模块；
- CTF/CVE 页面能看到“参考路线”。

### Phase 2：外部 Skill 安全门

- 加入静态扫描规则；
- 固定 commit / digest；
- license summary；
- 风险等级；
- blocked reasons；
- 导入记录写入 Evidence / Audit Log。

### Phase 3：工具能力索引

- 检测常用 CTF / Reverse / Forensics / CVE 学习工具；
- 展示缺失和版本；
- 提供安装建议；
- 用户主动确认后刷新；
- 默认不自动安装。

### Phase 4：CTF/CVE 路由融合

- CTF 根据题目和附件推荐 skill route；
- CVE 根据 ID、补丁、组件和版本推荐学习/追踪 route；
- Agent 执行时引用 route；
- Judge、Evidence 和 Memory 仍由 MilkSU 控制。

### Phase 5：长期插件化

- 支持多个 Skill Pack；
- 支持远程索引；
- 支持用户启用/禁用模块；
- 支持版本更新提醒；
- 支持安全扫描差异；
- 支持 Skill Pack 对 MilkSU 任务成功率和学习效果的贡献评估。

## 当前不做

- 不把任一安全 Skill 仓库整体 vendoring 到 MilkSU；
- 不把 AGPL/GPL 内容并入私有 Runtime；
- 不让外部 Skill 自动安装工具；
- 不开放 attack-chain、EDR bypass、内网横向、凭据提取、批量扫描等默认能力；
- 不把外部 Skill 的报告自动写成用户能力事实；
- 不把 Star 数当成可信度本身；
- 不为了“接入生态”打断当前产品闭环冲刺。

## 对当前产品节奏的影响

这项调研强化当前节奏，而不是扩大当前冲刺：

1. 近期仍先跑通 MilkSU 自己的产品闭环；
2. CTF/CVE 先有用户能理解的 UI/UX 骨架；
3. 外部优秀项目作为长期能力来源和路线参考；
4. 真正接入时先只读、可关闭、可审计；
5. 等 MilkSU 自身 Scope / Evidence / Judge / Memory 稳定后，再逐步把外部 Skills 转为可用路线。

一句话：

> MilkSU 应该站在这些开源项目肩膀上，但不能把方向盘交出去。优秀 Skills 提供知识和方法，
> MilkSU 提供安全边界、学习闭环、证据可信度和用户体验。
