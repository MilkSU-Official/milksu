# 产品闭环冲刺

> 状态：Active / Short-term sprint
>
> 生效日期：2026-08-03；2026-08-04 收缩 Lab/CVE 短期范围
>
> 目的：用 MilkSU 自己的 Agent 能力，在数小时内跑通一个能被用户真实体验的产品闭环。当前
> 冲刺不追求把每条安全、CTF、Lab、发行边界做到完整，只要求 UI/UX 上核心 Coding 产品闭环
> 能跑，并让 CVE 作为一级菜单具备“情报追踪 + 可练习环境”的最小闭环；Lab 暂不做自建平台或
> 通用靶场后端。

## 当前冲刺原则

1. **先跑通流程。** 优先让用户看到并使用：选择任务 → Agent 执行 → 产物/页面验证 →
   失败继续 → Git 交付。
2. **少做防御性编程。** 除 Provider Credential、workspace/Scope、私有远端、Judge 结果和
   用户能力归因等硬红线外，细节 Bug、视觉问题和边界矩阵先登记。
3. **不要扩大战线。** 已有 CTF 模块继续保留；CVE 本冲刺做可见学习/追踪骨架，不给红队式
   批量打靶能力；Lab 暂不做自建平台或本地靶场，只作为未来外部靶场辅助与进度追踪方向。
4. **成熟项目默认只作长期候选，但 Obelisk / Session Index 是当前 P0 例外。** pwn.college、
   HTB、TryHackMe 以及优秀开源 Security Skills / Harness 项目仍只作为未来集成、能力来源或
   UX 参照；当前几个小时冲刺不直接接入平台账号、API、虚拟机后端、漏洞环境或第三方执行能力。
   Obelisk 方向已经由用户明确选定为当前内置长期记忆能力，目标是 MilkSU 自己维护兼容的
   session-index，而不是要求用户安装外部 Obelisk。开源 Skills 生态的长期接入计划见
   [开源安全 Skills / Harness 生态接入调研与计划](/developer/research/2026-08-04-open-source-security-skills-ecosystem)。
5. **每轮都留接力棒。** 交付时写清：已跑的命令、当前缺口、下一步用户验收动作、适合交给
   后续 Coding Agent 的任务。

## 2026-08-04 纠偏：停止软性元工作循环

最近一轮冲刺暴露了一个软性死循环风险：真实闭环没跑通时，反复增加状态卡、下一步按钮、
复制 Prompt、文字测试、验收文档和微提交，会让项目看起来一直推进，但没有消费掉真实未完成
能力。后续立即采用下面的节奏：

1. **冻结新增状态卡、复制 Prompt 和验收文档章节。** 除非它直接替换错误门禁或删除误导 UI，
   不再用新的提示卡、清单或接力文案作为一个开发纵切。
2. **一项纵切必须以真实结果结束。** 可接受的结果包括：真实外部 App 的 Computer Use 操作、
   真实 Browser 截图/DOM/Console/Network 证据、真实 Feed 导入与来源时间、真实测试/build
   命令、真实 commit/push、真实跨模块恢复。`enabled`、`localStorage confirmed`、有消息、
   有工具记录、工作区干净、复制了 prompt 都不算完成。
3. **批量提交，不做微提交流水线。** 同一纵切内允许多次窄测，但只在形成真实结果或明确纠偏后
   集中一次测试、一次提交、一次 push；不再每个文案和按钮单独 build、写验收章节、commit。
4. **默认界面不摊开内部验收后台。** 用户默认应看到任务、对话/实验、当前需要处理的一件事和
   结果；内部验收、接力摘要、测试明细只能折叠或进入开发者视图，不再占据普通工作流。
5. **下一阶段只做会消耗真实缺口的纵切。** 如果一个改动不能让下面任一真实门禁更接近完成，
   就先不做。

下一阶段真实门禁按顺序为：

- 当前代码基线：2026-08-05 在 `72049da` 完整执行 `npm run m3:release-check` 通过，并重新
  生成 `/Users/milksu/code/milksu/build/bin/MilkSU.app`；这只证明当前工程门禁和打包可用，
  不把它误算成完整自举、Developer ID、公证、升级或外部 Beta 完成；
- Session Index：首轮原生闭环已通过；继续做“用户确认后沉淀为 Memory / CVE Note /
  Coding Handoff”和跨历史导入。后续不得重复把“App data 初始化、索引 MilkSU 会话/工具事件、
  打包 App 搜索、脱敏搜索结果”当作未完成；
- Coding：在打包 App 中完成一个小 MilkSU 修改，跑真实测试/build，做真实 Browser 或
  Computer Use 验证，commit 并 push；
- Computer Use：packaged proxy → Cua Driver → 外部 Calculator 精确窗口的 live smoke 已通过；
  packaged MilkSU App facade 的 list/start/status/descriptor/stop live smoke 也已通过；下一步只补
  用户在 MilkSU UI 内点击选择/启动会话、重启后权限检测一致性，以及主模型消费截图完成真实任务；
- CVE：packaged App 进程内 NVD 单 CVE 导入 live smoke 已通过，已保存来源、获取时间、
  snapshot 哈希/大小和选中 CVE 的事实变化；下一步只补 UI 内 Feed 导入状态、Vulhub/Docker
  启停/清理或更完整源矩阵，不能再说“只有四条 mock 数据”。2026-08-05 Browser 已验证
  CVE 首页默认不铺 Feed/NVD/EPSS/KEV/Vulhub/缓存维护台，点击统一设置后才进入情报源设置；
- CTF：从题库进入解题会话，切到 CVE/Coding 再返回，题库/会话/最近位置不丢失；Browser
  真实渲染烟测已证明 `CTF(P382)` → `CVE` → `Coding` → `CTF` 后仍回到 P382 工作台且
  Console 无 error/warn；下一步只补打包原生 App + 运行中 Agent job 的继续验收；
- UI：减少默认工作台噪音，把内部验收模型移到折叠区域或开发者视图。
  2026-08-05 Browser 验证 Coding 右栏开发者验收默认折叠，展开后四个快捷按钮在窄右栏不叠字。

## 几小时内的主闭环

当前首要闭环是 Coding 产品闭环，同时补齐 CVE 的一级菜单体验；不是 CTF/CVE/Lab 纵深：

1. 在 MilkSU 中选择当前仓库和一个小产品任务；
2. 使用“替我审批”或“完全访问”让 Agent 完成修改；
3. 自动运行相关测试和前端 build；
4. 打开/预览至少一种用户可见产物，优先使用 Browser 或 Computer Use；
5. 触发一次失败或中断后的继续路径，确认不会重复已完成步骤；
6. 通过 Diff/Hunk、stage、commit、push 完成交付；
7. 保留验收记录，明确哪些是真实 App 验收，哪些只是窄自动化。

本闭环通过后，才能说 MilkSU 正在接近“替代用户日常 Codex 工作流”。不能把它外推为完整
CTF、CVE、Lab 或发行成绩。

## UI/UX 产品地图最低要求

短期内，用户打开 MilkSU 应能看出每个主模块的用途和状态：

| 模块 | 当前冲刺最低要求 | 不在当前冲刺深挖 |
| --- | --- | --- |
| Coding | 能跑一条端到端产品任务；Browser、Computer Use、Artifact Preview、Git 交付在 UI 上可见 | 完整审批组合矩阵、全部 LSP/Code Action 真实矩阵 |
| CTF | 有解题模式/复盘模式、题目入口、Endpoint 授权、Evidence/Judge/Memory 状态；六赛道计划清楚 | 立即补齐 6/6 真实 Judge |
| CVE / Vuln | 具备“情报追踪 + 可练习环境”最小闭环：CVE 情报、关注、研究任务、资产命中、学习路径、安全边界、后续 Agent 可接手任务；若能通过 CVE ID 匹配到 Vulhub 等隔离 Docker 练习环境，则在 CVE 详情页直接展示并由用户确认启动 | 批量打靶、红队 Agent、自动攻击外部目标、披露流程、通用 Lab 平台 |
| Lab | 本冲刺先不做；长期只考虑辅助用户在 HTB/TryHackMe/pwn.college 等外部靶场学习并追踪进度 | 自建 Lab 平台、VM 后端、完整 Docker/VM Provider、所有靶场实跑 |
| Memory | 显示推荐依据和能力画像边界，能解释 Agent 代做不等于用户能力 | 36 条完整校准矩阵 |
| Bench | 显示 Reliability / Outcome 的区别和当前 smoke 状态 | NYU Outcome 成绩 |

### 跨模块视觉一致性约束

CTF、CVE 和 Coding 是同一级主工作区，不能像三个不同应用拼在一起。无论每个模块内部功能
完成度如何，同一位置、同一语义的 UI 必须保持一致：

- 页面主标题字号、字重、行高一致；
- 顶部说明文字字号和颜色层级一致；
- 顶部主要操作按钮、次要操作按钮、筛选控件的尺寸和字号一致；
- 同一层级的状态 Badge、统计卡、空态说明使用同一密度；
- 用户看起来是同一种功能的组件必须复用同一种视觉规格，例如下拉菜单、筛选 Select、主按钮、
  次按钮、Icon Button、Tab、Badge、搜索框和表格操作不能在不同页面出现多套字号、圆角、
  高度、间距或图标尺寸；
- 页面局部可以通过容器布局体现差异，但不能通过随意改变基础控件样式来表达差异；
- 如果某个模块暂时没有对应功能，宁可隐藏或用同尺寸空态，不用不同字号/不同风格硬凑。

这是全局产品约束。后续触碰 CTF、CVE 或 Coding 顶部区域时，必须顺手检查同层级视觉一致性；
但当前冲刺不因此开启全量视觉重构。

### 左侧导航口径

短期先隐藏 CTF / CVE 的二层侧边栏，不为了“看起来完整”放只有一个选项的假菜单。Coding 保留
历史任务列表，因为它有真实会话历史和项目分组；CTF、CVE 当前直接进入各自主页，由页面内部
承载题库、工作区、复盘和追踪状态。

未来只有出现真实对象时才加二层：

| 模块 | 未来可能新增 | 启用条件 |
| --- | --- | --- |
| CTF | 当前工作区、复盘、训练记录、Memory | 真实工作区和复盘记录足够多，二层能减少页面复杂度 |
| CVE | 追踪列表、学习笔记、影响检查、练习记录 | CVE record、练习环境和学习轨迹多到直接详情页容纳不下 |
| Lab | 外部靶场进度 | HTB/TryHackMe/pwn.college 辅助与进度追踪真实启用后 |

在这些条件满足前，二层菜单隐藏比占位更好。

## CVE 与 Lab 的收缩策略

CVE 作为一级菜单进入当前几个小时冲刺的最小实现目标；Lab 不作为独立平台进入当前实现。
用户理想闭环不是“另开一个 Lab 菜单再选题”，而是点进一个 CVE 后直接看到：

1. 来自成熟情报源的 CVE 事实和优先级；
2. 当前项目/资产是否可能受影响；
3. 是否有可对应到该 CVE ID 的隔离练习环境；
4. 用户确认后启动本地练习；
5. Agent 在练习范围内辅助理解、观察、记录和复盘；
6. 学习证据沉淀回该 CVE 的笔记、资产、研究任务和 Memory。

因此短期不恢复 CVE 二级菜单。若有“漏洞追踪 / 练习”两个概念，也在同一个 CVE 详情页里以
状态卡或分段区块展示；只有记录数量和练习历史真的变复杂后，才考虑二层导航。

### Lab：后置为外部靶场辅助与进度追踪

用户原始诉求是让 MilkSU 辅助打 HTB、TryHackMe、pwn.college 这类成熟靶场，并追踪学习进度。
MilkSU 不应在短期内自建 Lab 平台，否则会引入虚拟机后端、靶场环境、网络隔离和大量内容维护。

长期 Lab 方向只保留为：

- 打开用户授权的外部靶场页面；
- 记录房间、目标、尝试、提示依赖、用户贡献和平台完成状态；
- 用 Browser / Computer Use 辅助用户操作，但不接管账号密码；
- 通过用户粘贴回执或平台页面观察形成 Judge evidence；
- 将进度沉淀到 Memory / 能力画像。

候选只作为未来 UX/Adapter 研究，不进入当前实现：

| 候选 | 用途 | 当前判断 | MilkSU 首期接法 |
| --- | --- | --- | --- |
| HTB / TryHackMe | 主流外部靶场与学习路径 | 最贴近用户想要的“辅助打靶与追踪进度” | 未来用 Browser/Computer Use + 手动回执/页面状态追踪，不自建后端 |
| pwn.college / Dojo | 在线 hands-on 学习房间 | 可作为外部平台 Judge 与学习轨迹映射参考 | 未来只做外部页面辅助和进度记录，不自托管完整 Dojo |
| Labtainers | 本地/课程型 Docker cyber lab 框架 | 内容丰富，但接入会引入安装、镜像、网络和课程导入复杂度 | 后置调研；不进入当前冲刺 |

安全 Skills / Harness 生态也只作为长期能力来源，不进入当前冲刺执行面。详见
[开源安全 Skills / Harness 生态接入调研与计划](/developer/research/2026-08-04-open-source-security-skills-ecosystem)；
后续若接入，必须先经过只读导入、固定版本、许可证审查、Skill/MCP 安全扫描和 MilkSU
Scope / Evidence / Judge / Memory 策略覆盖。

### CVE：先做学习与追踪，不做红队能力

CVE 模块当前和长期都先定位为学习与追踪，不是批量打靶或自动攻击。它不应重新发明 CVE
数据库，而应复用成熟情报源，在 MilkSU 里做学习、资产关联、练习编排、证据和能力画像。
当前冲刺至少需要让用户能看出它可以追踪一个 CVE、找到对应练习环境，并把后续工作交给
Coding Agent 继续：

- 记录 CVE ID、组件、版本、材料链接、补丁、学习状态和用户笔记；
- 从 NVD、CISA KEV、FIRST EPSS、OSV、GitHub Advisory Database 和厂商公告等成熟源形成
  情报聚合模型；不同源的含义必须分清，EPSS/KEV 是排序与优先级信号，不是 Judge；
- 帮用户理解根因、影响范围和修复思路；
- 在用户授权代码仓库中做静态影响检查或补丁阅读；
- 通过 CVE ID / 组件 / 版本匹配 Vulhub 这类可本地运行的 Docker 练习环境；VulnHub、
  HTB、TryHackMe、pwn.college 更适合作为外部靶场辅助和进度追踪候选，不作为 CVE 情报源；
- 对匹配到的练习环境展示来源、版本/commit、目录、服务端口、资源需求、网络边界、清理方式
  和安全提示；默认只读展示，拉取镜像、启动容器、开放端口或运行漏洞触发输入都需要用户确认；
- 练习环境默认本地隔离、可停止、可清理，不自动接外部目标、不复用平台 Cookie/Token、
  不把练习成功写成真实资产已验证；
- Agent 可以在练习 Scope 内辅助读公告、读补丁、观察容器日志、解释请求/响应和记录复盘，
  但不能把批量攻击、红队横向移动或未经授权的外部扫描作为产品能力；
- 将学习进度和关键概念沉淀到 Memory；
- 复现模式仅作为后期，在明确授权、固定环境和安全边界下单独实现。

当前几个小时内不拆“学习/审计/修复/复现”四套复杂模式；先做一条可见骨架：

```text
CVE 情报源聚合 → CVE 详情 → 资产/项目影响记录 → 匹配练习环境
→ 用户确认启动本地隔离练习 → Agent 辅助学习 → 笔记/证据/Memory
```

后续再由 Coding Agent 迭代真实 Feed、Vulhub catalog import、Docker 启动器、授权仓库影响
检查、练习日志、停止/清理和复盘沉淀。

## 暂停但保留入口的范围

- Lab 不进入当前冲刺实现目标；
- CVE 进入当前冲刺的情报追踪与本地练习骨架目标，但不提供红队 Agent 或批量攻击能力；
- 不运行未经审核的漏洞触发输入、附件、服务或 exploit；
- 不把 UI 架子描述成真实安全研究能力；
- 不把开源项目写进候选表等价为已经成为依赖；
- 真实接入前仍需许可证、供应链、架构、离线/网络、资源、Docker 安全和 Judge/学习证据审查。

## 下一步执行队列

1. 收尾当前 Computer Use 接入提示、恢复超时识别和 CTF/CVE 二层侧栏隐藏；
2. 选择一个小 MilkSU 产品任务，跑完整 Coding 产品闭环；
3. 用 Browser 或 Computer Use 做一次用户可见验证；如果本机权限阻塞，就保留恢复点并改用
   Browser / Artifact Preview 验证；
4. 通过 Git Diff → stage → commit → push 完成交付；
5. CVE 保留情报追踪 + 可练习环境骨架并记录后续 Agent 可接手任务；Lab 后置记录外部靶场辅助/进度追踪计划；
6. 把新发现问题登记到覆盖台账，不在当前冲刺深挖。
