# ADR-0004：学习产品、能力与开源发布边界

> 文档状态：**Historical ADR with active invariants**。授权、Evidence、风险分级和发布边界
> 仍有效；里程碑和实现状态以[当前目标](/developer/current-objectives)为准。
>
> 状态：已接受，M2 后续与 M3 前置约束
>
> 日期：2026-07-20

## 决策

MilkSU 的产品主旨改为：**一站式网络安全 AI 学习客户端**。

它帮助人与安全 Agent 在明确授权的环境中共同学习 CTF、漏洞研究以及未来的红蓝攻防。每个 Workspace 同时产出两类结果：

- `Domain Outcome`：Flag 是否被 Judge 接受、漏洞是否稳定复现、检测或处置是否通过验证；
- `Human Outcome`：用户是否理解假设、证据、根因和方法，并能减少提示或迁移到变体任务。

这项决策不删除 Security Harness。相反，授权范围、真实环境、Evidence、Effect、Evaluator、Recovery 与教学投影，正是学习客户端区别于“聊天机器人讲安全知识”的核心。

## 为什么不能只改宣传语

“教育”“研究”“开源”描述的是目的，不能自动改变软件实际提供的能力，也不能替开发者或使用者免除对具体行为的责任。如果首页说学习，默认界面却允许导入任意目标列表、扫描公网网段、喷洒凭据或无人审批地执行外部攻击，它在产品事实上仍是通用进攻工具。

因此，学习定位必须同时落实在五个位置：

1. **任务入口**：以 Competition、Training Task、Challenge、Research Workspace、Lab 和用户显式授权目标为中心；
2. **授权记录**：保存来源、目标范围、用途、时限、用户确认和可撤销状态；
3. **默认能力**：最小权限、可观察、可暂停，禁止把高风险批量能力当默认便利功能；
4. **结果形态**：必须显示证据与方法复盘，而不是只返回攻击结果；
5. **发布方式**：本地开源客户端、可选能力包与未来托管服务分别评审，不能视为同一风险面。

## 支持与不支持

### 默认支持

- 正规 CTF 平台、比赛与训练题；
- MilkSU 固定并管理的本地 Lab；
- 开源项目自带靶场、测试夹具和用户自己拥有的实验环境；
- 用户明确有权研究、显式接入且范围可记录的漏洞研究目标；
- 聊天题面、文件、截图、用户选择的目录、受控浏览器标签页、明确的 URL/Socket/SSH；
- Coach、Copilot、Delegate 三种协作方式，其中 Delegate 仍受同一 Scope、Effect 与 Evaluator 约束。

### 默认开源产品不提供

- 任意域名/IP 清单或互联网网段的批量扫描编排；
- 凭据喷洒、撞库、钓鱼投递或大规模账号尝试；
- 隐蔽、持久化、规避检测或清除痕迹的自动流水线；
- 在没有可见 Scope 和用户确认时接管浏览器、Shell、网络或本地目录；
- 自动扩大目标范围、从一个已授权目标横向发现并攻击未授权目标；
- 绕过 CTF 平台规则、反自动化限制或提交限额。

“不默认提供”不是对所有安全研究技术作学术禁谈，而是说它们不能成为公开产品里一键可用、无范围约束的执行能力。以后若确有合法训练场景，必须以固定 Lab、单独能力包、显式策略和新的 ADR 重新评审。

## 运行时约束

### Scope 是可执行事实

外部目标必须绑定 `ScopeGrant`（名称可在实现时调整），至少保存：

```text
source       用户粘贴、选择文件、分享标签页、创建本地 Lab 等
targets      精确 Origin / Host / Socket / Directory / Lab instance
purpose      CTF / training / authorized vulnerability research
granted_by   本机用户确认
created_at   授权时间
expires_at   到期时间或任务结束
revocable    能否立即撤销
```

模型不能自己创建或扩大 Scope。重定向到新 Origin、下载后执行、从网页抽取新 Host、打开本地目录外路径，都必须重新经过策略判断。

### 外部 Effect 分级

读取题面与静态附件不等于提交 Flag、启动目标、发起网络探测或修改远端状态。每个 Action 在执行前必须得到 `PolicyDecision`：

- 只读且在范围内：可自动执行并保存 Observation；
- 有限外部交互：限制频率、并发和目标，保存请求与响应证据；
- 提交、修改、认证或可能影响可用性：默认人工批准；
- 超范围、批量化、隐蔽化或规则禁止：拒绝。

### 平台与靶机隔离

CTF 平台登录态属于 `Platform Context`，题目靶机属于 `Target Context`。Cookie、凭据、存储和工具权限不能自动从前者流向后者。浏览器 Agent 遇到提示词注入时按 Agent Integrity 处理，但这不是 CTF Role 的定义。

## 发布分级

| 级别 | 内容 | 发布条件 |
| --- | --- | --- |
| Core | 桌面 UI、Runtime、离线 Intake、Evidence、Judge、教学投影 | 自动测试、依赖审计、无明文密钥 |
| Managed Training | 固定本地 Lab、专用 Browser Profile、受控 File/Shell/Socket | 固定版本、SBOM、签名、Scope/Approval、资源限制 |
| External Bridge | 用户浏览器标签页、远程 URL/Socket/SSH | 显式逐目标授权、可撤销、速率限制、完整 Evidence |
| Hosted/Public Service | 任何面向公众的远程服务 | 单独法律、合规、滥用防护、身份与运营评审；不由本 ADR 自动批准 |

仓库开源不等于所有能力都要编译进默认二进制，也不等于项目维护者替使用者判断目标授权。发布包可以只启用通过当前风险门的层级。

## M3 前的发布门

进入 Vulnerability Research MVP 前，至少验证：

1. Provider 与 Relay 密钥不再写入明文 JSON，也不回传给 React；
2. Pi Sidecar 与运行时依赖可固定版本、脱离源码树运行，并有可审计的构建来源；
3. Browser、Shell、Network、Lab 的授权、范围、审批和撤销契约已经写入代码；
4. 默认 UI 没有任意目标列表、批量公网扫描或隐蔽攻击入口；
5. 外部动作保存原始 Evidence，提交或状态修改可由用户看到并批准；
6. 每个 CTF/Vuln 任务同时呈现 Domain Outcome 与 Human Outcome。

未通过发布门时，相关能力只能对固定本地 fixture 开发和测试，不能包装成可自由操作外部目标的公开 MVP。

## 法律与运营说明

本 ADR 是产品与工程风险控制，不是法律意见。中国大陆现行网络安全、刑事、漏洞管理、网络数据和生成式 AI 规则会根据软件功能、提供方式、实际行为、明知程度和造成后果分别判断责任；“学习工具”或“开源”名称不能替代具体评估。

在公开发布可执行 Browser/Shell/Network 能力、提供托管服务、收集用户任务数据或面向公众提供生成式 AI 服务前，项目应让熟悉中国大陆网络安全与开源软件的律师审阅最终功能、许可证、免责声明、日志与响应流程。

本轮设计核对的官方依据包括：[《中华人民共和国网络安全法》第二十七条](https://www.cac.gov.cn/2016-11/07/c_1119867116_2.htm?ivk_sa=1025883j)、[《网络产品安全漏洞管理规定》](https://www.cac.gov.cn/2021-07/13/c_1627761607640342.htm?Offer=ab_ss_reeng_plt_ctrl)、[《中华人民共和国刑法》第二百八十五条相关条文](https://www.npc.gov.cn/WZWSREL2MyL2MzMDgzNC8yMDIzMDcvdDIwMjMwNzA0XzQzMDQyMC5odG1s)、[《网络数据安全管理条例》](https://www.cac.gov.cn/2024-09/30/c_1729384452307680.htm)与[《生成式人工智能服务管理暂行办法》](https://www.cac.gov.cn/2023-07/13/c_1690898327029107.htm)。这些链接用于约束产品评审问题，不代表项目已经完成个案法律判断。

## 后果

好处是 MilkSU 的开源动机、用户体验和技术边界一致：用户进入的是学习 Workspace，Agent 的强能力也必须留下授权、证据与复盘。代价是某些看似方便的自动化会增加确认步骤，外部目标兼容速度也会慢于无约束扫描器；这是项目主动接受的取舍。
