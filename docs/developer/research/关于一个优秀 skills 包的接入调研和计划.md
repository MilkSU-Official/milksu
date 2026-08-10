# 关于一个优秀 skills 包的接入调研和计划

> 文档状态：**Research snapshot / Candidate options**
>
> 审阅日期：2026-08-04
>
> 审阅对象：[`zhaoxuya520/reverse-skill`](https://github.com/zhaoxuya520/reverse-skill)
>
> 边界：本次只阅读公开仓库、README、AI Bootstrap、路由文件和项目元数据，没有安装、执行、
> 拉取子模块、运行安全工具或修改 MilkSU 代码。文中的阶段和 P0/P1 是当时的方案
> 排列，不是现行 backlog。本页不是接入授权，也不是新的自动攻击能力计划。

## 结论

`reverse-skill` 值得关注，也可以作为 MilkSU 的外部 Skill Pack 候选，但不建议直接并入
MilkSU 主仓或让它接管 MilkSU 的 Runtime。

更准确的定位是：

> `reverse-skill` 是一个面向 AI Coding Agent 的安全研究技能路由包。它擅长把 APK、ELF、JS
> 逆向、Pwn、Forensics、Patch diff、Pentest、LLM Security 等任务分发到对应方法论和工具链。
> 它不是 MilkSU 所需的完整产品 Harness，也不应该绕过 MilkSU 的 Scope、Evidence、Judge、
> Memory 和用户授权模型。

MilkSU 可以吸收它的“先路由后执行”“工具能力索引”“case / evidence / timeline 契约”和
“按场景组织 playbook”的思路；但执行、授权、网络、凭据、证据沉淀和学习画像仍必须由 MilkSU
自己的产品边界控制。

## 公开信息摘要

| 项目 | 调研结果 | 对 MilkSU 的意义 |
| --- | --- | --- |
| 仓库 | [`zhaoxuya520/reverse-skill`](https://github.com/zhaoxuya520/reverse-skill) | 可作为外部 Skill Pack / 方法论包观察 |
| 定位 | 逆向、授权渗透、安全研究技能路由包 | 与 CTF、CVE 学习、Reverse、Forensics 有重合 |
| 热度 | 审阅时约 15k stars、2.2k forks | 社区关注高，但不能直接证明效果或安全性 |
| 许可证 | 主项目 MIT；仓库说明中列出部分第三方/子模块有 GPLv3、AGPL-3.0 等约束 | 不能粗暴 vendoring；需逐项做 license 边界 |
| 主要入口 | [`README_AI.md`](https://github.com/zhaoxuya520/reverse-skill/blob/main/README_AI.md)、[`RULES.md`](https://github.com/zhaoxuya520/reverse-skill/blob/main/RULES.md)、[`skills/SKILL.md`](https://github.com/zhaoxuya520/reverse-skill/blob/main/skills/SKILL.md)、[`skills/MASTER-ROUTING.md`](https://github.com/zhaoxuya520/reverse-skill/blob/main/skills/MASTER-ROUTING.md) | 适合被 MilkSU 读取并转换为“路线建议”，不适合直接作为系统指令覆盖 |
| 技能覆盖 | APK、mobile、JS、IDA、radare2、Pwn、Forensics、Firmware、Patch diff、API、Supply chain、LLM security 等 | 覆盖面比 MilkSU 当前 CTF/CVE 学习架子更广 |
| 工具模型 | `tool-index.md` 记录本机工具可用性，缺工具时 bootstrap | MilkSU 可做成 UI 化工具检测，但不应自动乱装 |
| 运行契约 | case-init、scope、timeline、Evidence→Finding→Path | 与 MilkSU Evidence / Checkpoint / Recovery 可互相借鉴 |

## 它做得好的地方

### 1. 先路由后执行

它不是让 Agent 一上来就猜命令，而是先根据任务类型选择 PRIMARY 路线。例如 APK 进
`apk-reverse`，JS 签名进 `js-reverse`，Pwn 进 `pwn-chain`，取证进 `digital-forensics`。

这对 MilkSU 很有价值。用户上传附件或打开题目时，MilkSU 可以先生成：

```text
任务类型 → 推荐路线 → 所需工具 → 授权需求 → 证据目录 → 下一步
```

这比把所有能力都塞进一个万能 Agent Prompt 更可控。

### 2. 工具能力索引

它要求 Agent 不要猜工具路径，而是读取 `tool-index.md`。这点很适合 MilkSU 的本地交付：

- `jadx` 是否可用；
- `apktool` 是否可用；
- `radare2` 是否可用；
- `ghidra` 或 IDA MCP 是否可用；
- `frida` 是否可用；
- `tshark` / `binwalk` / `strings` / `file` 是否可用；
- `pwntools` 是否可用。

MilkSU 更适合把它产品化成“能力检测面板”，而不是让 Agent 自动安装所有东西。

### 3. Case / Scope / Evidence 契约

它的 `case-init`、`scope.md`、timeline、Evidence→Finding→Path 结构，与 MilkSU 的 CTF
Evidence、Judge、Checkpoint、Recovery 很契合。

可以吸收成统一表达：

```text
Evidence：我看到了什么
Finding：这说明什么
Path：下一步如何验证
```

这对教学尤其重要，因为它能逼 Agent 解释“为什么这么做”，而不是只给最终答案。

### 4. 覆盖面适合补 MilkSU 的知识架子

MilkSU 当前的核心不应变成红队 Agent，但可以把这些内容作为学习路线、题型辅助和工具说明：

- Reverse：APK / ELF / .NET / JS 逆向路线；
- Forensics：PCAP、文件雕刻、内存镜像、时间线；
- Pwn：checksec、崩溃、保护、primitive、exploitability；
- CVE：patch diff、影响版本、代码定位、修复建议、学习笔记；
- LLM Security：仅作为防御学习和 Agent 安全边界资料；
- Supply Chain：依赖、SBOM、构建链路学习。

## 不适合直接照搬的地方

### 1. 不能让外部 Skill 的规则覆盖 MilkSU

`reverse-skill` 的 AI Bootstrap 有较强的“读完立即执行”“自动配置”“自动写回”等指令风格。
这些适合它自己的工具包，但不能成为 MilkSU 的上层系统规则。

在 MilkSU 中，外部 Skill 只能是资料和候选路线，不能越过：

- 用户授权；
- 动态 Endpoint Scope；
- Shell / Browser / Computer Use 权限；
- Evidence 写入规则；
- Memory 和 Ability Profile 归因；
- CTF / CVE 的产品边界。

### 2. 许可证不能粗暴并库

主项目是 MIT，但仓库说明中列出 `CTF-Sandbox-Orchestrator/` 为 GPLv3，Pentest Swarm AI
原项目为 AGPL-3.0，其他工具也有各自许可证。

因此 MilkSU 不能把整个仓库直接复制进私有主仓。更安全的方式是：

- 只读取用户本地安装的外部 Skill Pack；
- 或将 MIT 部分做成可选插件；
- 对 GPL / AGPL / 第三方工具只做外部调用或文档引用；
- 在正式接入前做逐文件 license manifest。

### 3. 不应扩成红队自动化

MilkSU 当前定位是学习、CTF、CVE 追踪、代码理解和自举开发，不是批量攻击平台。

因此不应默认接入或突出：

- attack-chain；
- EDR bypass；
- 内网横向；
- 凭据提取；
- 自动化扫描真实目标；
- N-day weaponization。

这些最多作为“受限学习资料 / 只读方法论 / 明确授权的实验路线”，不能成为默认产品能力。

## 推荐接入形态

### 第一阶段：只读 Skill Pack 导入

目标：让 MilkSU 能读取外部 Skill Pack 的目录结构、入口文件和路由矩阵，并在 UI 中展示
“可用路线建议”。

建议能力：

- 用户选择一个本地 Skill Pack 目录；
- MilkSU 读取 `skills/SKILL.md`、`skills/routing.md`、`skills/MASTER-ROUTING.md`；
- 解析模块名、适用场景、推荐工具；
- 将危险模块标记为“只读/受限/不启用”；
- 不执行 bootstrap；
- 不自动安装工具；
- 不写入外部 Skill Pack 的 journal。

验收方式：

- 用 `reverse-skill` 作为样本；
- 导入后能看到 Reverse、Pwn、Forensics、CVE / Patch diff 等学习路线；
- 禁用 attack-chain、edr-bypass、真实 pentest 执行路线；
- 关闭外部包后 MilkSU 功能不受影响。

### 第二阶段：工具能力检测面板

目标：把 `tool-index.md` 思路产品化。

建议能力：

- 检测本机安全学习常用工具；
- 给出状态：可用、缺失、版本未知、需要用户配置；
- 提供复制安装命令或文档链接；
- 用户点击“重新检测”后刷新；
- 不默认自动安装；
- 不保存用户敏感路径以外的信息。

适合优先检测：

- `file`、`strings`、`objdump`、`otool`；
- `radare2`；
- `jadx`、`apktool`；
- `python3`、`pipx`、`pwntools`；
- `binwalk`、`tshark`；
- `ghidra` / IDA MCP 只做可选检测。

### 第三阶段：Playbook 映射到 CTF / CVE

目标：把外部 Skill 的方法论变成 MilkSU 的学习卡片和 Agent 路由建议。

CTF 中：

- 上传 ELF → 推荐 Pwn / Reverse 路线；
- 上传 PCAP → 推荐 Forensics 路线；
- 上传 APK → 推荐 Mobile / APK reverse 路线；
- Web 题 → 推荐浏览器观察、HTTP 证据、Endpoint Scope；
- 每条路线都要求 Evidence、Candidate、Judge、复盘。

CVE 中：

- 输入 CVE 或项目版本 → 推荐“学习/追踪/影响判断”路线；
- Patch diff 仅定位和解释，不默认生成武器化 PoC；
- 输出受影响版本、修复提交、学习笔记、代码审计要点；
- 可记录“我理解了什么”和“后续复习”。

### 第四阶段：可选 Skill Marketplace

目标：未来允许用户管理多个外部 Skill Pack。

但这不是当前 M3 的必要条件。后续可以做：

- Skill Pack 安装源；
- 固定 commit / digest；
- license 和风险提示；
- 安全评分；
- 启用/禁用；
- MilkSU 内部安全策略覆盖外部 Skill 指令。

## 与 MilkSU 当前方向的关系

这项接入不应该改变 MilkSU 的核心方向：

1. Coding Agent 先具备足够自举能力；
2. CTF/CVE 先形成用户可理解的产品闭环；
3. Lab 暂停，不自建靶场平台；
4. CVE 以学习和追踪为主，不提供红队批量攻击能力；
5. CTF 继续依赖 Evidence、Judge、Memory、复盘；
6. 外部 Skill Pack 只增强路线和工具知识，不替代 MilkSU Runtime。

换句话说，`reverse-skill` 能帮 MilkSU 更快“有知识、有路线、有工具意识”，但不能代替
MilkSU 自己证明：

> 用户打开 App → 选择任务 → 获得帮助 → 产出证据 → 验证结果 → 复盘学习 → 下次变强。

## 当时评估的可落地顺序（非现行 backlog）

### P0：记录为候选集成，不进入当前冲刺主路径

- 保留本文档；
- 暂不引入依赖；
- 暂不复制仓库内容；
- 暂不启用任何外部攻击链或自动安装。

### P1：做一个只读 Adapter 原型

- 新建 `SkillPack` 领域模型；
- 支持读取本地目录；
- 解析入口文件和路由矩阵；
- 生成 MilkSU 内部的 `SkillRouteSuggestion`；
- 在 CTF/CVE 中只展示学习路线，不执行危险动作。

### P2：工具检测 UI

- 检测常用工具；
- 展示缺失项；
- 提供安装建议；
- 用户主动确认后刷新；
- 不自动安装，不迁移凭据。

### P3：CTF/CVE 路由结合

- CTF 根据附件类型推荐路线；
- CVE 根据 CVE / patch / repo 输入推荐学习路线；
- 路线上的每一步都要求 Evidence；
- 结果仍由 MilkSU Judge / 用户确认 / 平台回执决定。

### P4：正式插件化

- 支持多个 Skill Pack；
- 固定版本和 digest；
- license manifest；
- 风险等级；
- 外部指令隔离；
- MilkSU 策略优先级高于外部 Skill。

## 暂不做

- 不把 `reverse-skill` 整仓复制进 MilkSU；
- 不接入完整 Pentest Swarm；
- 不启用 attack-chain / EDR bypass 默认功能；
- 不自动安装 nmap、nuclei、sqlmap、frida 等工具；
- 不把外部 Skill 的 journal 写回机制接入 MilkSU Memory；
- 不把模型猜测或外部报告自动写成用户能力事实；
- 不把它包装成“最强红队 Agent Harness”。

## 一句话研究结论

短期把 `reverse-skill` 当成“优秀安全 Skill 包样本”研究和借鉴；中期做只读 Skill Pack
Adapter，让 MilkSU 能从这类包里提取路线、工具和方法论；长期再考虑安全插件化。执行权和
学习归因始终留在 MilkSU 自己的 Scope、Evidence、Judge、Memory 系统里。
