# 当前开发目标

> 文档状态：当前唯一目标契约
>
> 执行状态：**Active / Product-loop sprint**；2026-08-03 经用户确认从广度优先覆盖调整为
> 先跑通完整产品闭环
>
> 生效日期：2026-08-03
>
> 这是一份工作范围与验收顺序，不是发布说明，也不用于提前宣称能力完成。
>
> **持久目标入口：** 每次新会话、任务移交或上下文压缩后，必须先重新读取本文件和当前
> 仓库状态。不得用对话摘要缩小这里记录的范围，也不得把部分 smoke 当作整体完成。

## 事实源与执行原则

1. 当前代码、自动化测试、打包 Sidecar、原生 App 和真实平台回执优先于旧对话与文档。
2. 每次开始工作先读取仓库状态，不根据历史计划重复已经完成的功能。
3. 通用 Coding 能力优先复用固定版本的 Pi、成熟 Extension、Skill、MCP 和平台 CLI。
4. MilkSU 自研集中在 CTF Evidence、Judge、Memory、教学和 Agent 协作。
5. 每个可交付纵切必须测试、审阅、提交并只推送到 MilkSU 自己的私有仓库。
6. Provider API Key 不进入模型上下文、工具输出、日志、诊断包、迁移或文档。
7. Lab 纵深闭环保持暂停，不作为当前真实完成条件；CVE 作为一级主菜单必须在当前冲刺中
   形成情报追踪、资产关联与可练习环境的最小闭环，但不做红队式批量打靶、自动 PoC 复现
   或披露流程。
8. 从现在开始新增的代码不为尚未发布的临时设计增加迁移、双写或兼容分支，直接实现当前
   干净模型。已经工作的旧代码和既有 schema 不在功能开发中途返工；确需调整时集中到全部
   产品纵切完成后的最终收口，一次破坏性修改并重新执行完整回归。
9. Obelisk 形态的 Session Index / 相关历史进入当前 P0。它不是外部可选插件，也不要求用户
   手动安装 Obelisk CLI；MilkSU 直接内置兼容 Obelisk 思路的会话索引、初始化器和检索入口。
   默认索引归 MilkSU 数据目录管理，例如 `session-index/obelisk.sqlite`；`~/.obelisk/obelisk.sqlite`
   只能作为未来导入/兼容来源，不能作为产品默认依赖。
10. Session Index 用来提升 Agent 的长期工作记忆和用户体验：召回历史会话、工具调用、失败
    路径、交接记录、项目上下文和人工确认记忆。它提供“相关历史线索”，但不能自动变成 CTF
    Judge、CVE 情报事实、用户能力画像、Git 交付证明或安全结论；进入正式档案必须经过 MilkSU
    对应模块的证据、测试、回执或用户确认。

## 当前冲刺执行规则

[当前目标覆盖台账](./objective-coverage-ledger.md) 已完成第一轮全局拆分和共同评估。2026-08-03
用户确认后，短期执行节奏从“广度优先补覆盖”调整为
[产品闭环冲刺](./product-loop-sprint.md)：

1. 先用 MilkSU 自己的 Coding Agent 能力，在数小时内跑通一个完整、可由用户验收的产品闭环：
   规划 → 修改 → 构建/测试 → 预览/Browser 或 Computer Use 验证 → 恢复/继续 → Git 交付。
2. 当前冲刺少做防御性编程；除 Provider Credential、工作区/Scope、私有远端、Judge 正确性和
   用户能力归因等硬红线外，非阻塞 Bug、视觉细节和边界问题先登记，不现场深挖。
3. CTF 与 CVE 都需要有用户可见、可继续迭代的产品入口和状态；CVE 当前做情报追踪 +
   可练习环境骨架，展示情报、资产命中、学习路径、隔离练习环境、安全边界和后续 Agent
   可接手任务，不做漏洞纵深。
   Lab 暂不实现，只保留 HTB / TryHackMe / pwn.college 等外部靶场辅助与进度追踪的长期计划。
   NYU、发行门禁等不在本冲刺展开复杂矩阵。
4. 每个冲刺批次必须留下可继续的恢复点、测试命令、产物位置和下一步清单，方便后续 Coding
   Agent 接手完善。
5. CTF、CVE 和 Coding 是同一级主工作区；同一位置、同一语义的标题、顶部说明、操作按钮、
   状态 Badge、筛选控件和空态密度必须保持一致。用户看起来是同一种功能的组件，例如下拉、
   Select、主按钮、次按钮、Icon Button、Tab、Badge、搜索框和表格操作，必须复用同一种视觉
   规格，不能在不同页面各自出现多套字号、高度、圆角、间距或图标尺寸。当前冲刺不做全量
   视觉重构，但后续触碰这些页面顶部区域和基础控件时必须检查跨模块一致性。
6. 2026-08-04 起停止“软性元工作循环”：不再把新增状态卡、复制 Prompt、文字测试、验收文档
   章节或微提交当作产品推进。真实完成只能由实际能力证明，例如真实测试/build、真实
   Browser 证据、真实 Computer Use 外部窗口操作、真实 Feed 导入、真实 commit/push 或真实
   跨模块恢复。`enabled`、有消息、有工具记录、工作区干净、localStorage confirmed、复制
   prompt 都不能单独计为完成。
7. 同一纵切内不再每个微小 UI/文案变动单独 build、写验收章节、commit；集中到一个真实结果
   后再运行相关测试并提交。默认界面不得继续铺开内部验收后台，内部证据和接力摘要应折叠或
   移入开发者视图。
8. 修完并验收过的问题必须及时登记到覆盖台账或对应冲刺文档；后续 Agent 不应把同一件事反复
   当成新任务处理。只有出现新的用户复现、测试失败或代码回归证据，才重新打开已闭环问题。

长期目标仍按本文件和台账保留；以下规则仅用于后续从全量目标中挑选与衡量工作，不能把冲刺
闭环 smoke 宣称为全产品完成：

1. 先按 P0 → P1 → P2 顺序，让同一层中尚未实现的必要能力各形成一个最小可用纵切，再回头
   深化某一项的完整矩阵、视觉细节和极端边界；
2. “堆功能”只计算已经接入正式 Runtime、具备窄自动化并能被用户使用的纵切；按钮、空壳、
   假数据或第二套测试 Runner 不计进度；
3. 开发或验收中发现的 Bug、视觉细节、偶发失败和非阻塞缺口，先在台账登记稳定 `BUG-*`
   或 `OBS-*` ID、复现条件和影响，不在现场顺手深挖；
4. 只有以下问题立即修复：阻断同层其他纵切、可能损坏数据或 Credential、突破路径/Scope/
   私有远端硬边界，或会让 Judge 和验收结果失真；
5. 每完成一轮功能覆盖，再统一评估已登记问题，按影响批量修复；不能因某个局部问题反复停留
   数小时而失去全局位置；
6. 每个最小纵切仍需审阅、窄测试、提交并只推送到 MilkSU 私有远端；真实验收条件暂缺时，
   明确停在 50%，转向同层下一项。

目标范围和最终完成条件仍以本文件为准；台账负责拆分、证据定位和进度计算，不能缩小这里
记录的范围。

用户与主 Agent 共同增删、合并、排序和备注目标时，使用
[目标共同评估工作簿](./objective-review-workbook.md)。工作簿中的填写和讨论只表示评估，
不构成产品开发、外部发布或真实平台操作授权；只有双方明确选定的有界批次才进入实现。

## 当前产品取舍与优先级

当前优先级以用户第一轮共同评估为准：

1. **P0 · Obelisk 形态 Session Index / Agent 长期记忆。** 当前先把跨 Coding、CTF、CVE 的
   相关历史能力接进来，再继续其他目标。MilkSU 必须自己初始化和维护本地 session-index，
   不要求用户安装 Obelisk，不默认读取 `~/.obelisk`。首个闭环是：索引一条真实 MilkSU
   会话或工具事件 → App/Wails 可查询状态和结果 → 前端共享入口展示相关历史 → 搜索结果脱敏
   → 用户确认后才能沉淀为 MilkSU Memory、CVE Note 或 Coding Handoff。2026-08-05 已补
   CVE 页面“相关历史 → 记入笔记”、Coding Chat“相关历史 → 引用到输入”和 CTF 复盘
   “相关历史 → 引用到复盘”的显式确认路径；剩余优先做历史导入、许可证/NOTICE/ADR 收口，
   以及在完整 Coding 自举任务中证明 Agent 实际消费相关历史。
2. **P0 · 当前冲刺：完整产品闭环。** Session Index 首轮闭环通过后，继续让 MilkSU 像裸
   Pi Agent 一样顺滑完成一个真实产品任务，并在 MilkSU 自己的产品壳里走完修改、测试、
   预览/验证、恢复和 Git 交付。详见 [产品闭环冲刺](./product-loop-sprint.md)。
   同时补齐 CVE 情报追踪、资产关联与可练习环境的最小可见骨架，让它作为一级菜单不再像空模块。
   2026-08-05 packaged CVE feed live smoke 已证明打包 App 进程能真实拉取 NVD 单 CVE、
   持久化 snapshot，并提取来源时间与选中 CVE facts；同日 packaged CVE feed matrix smoke
   已证明打包 App 进程能为 `CVE-2023-46604` 同步 NVD、FIRST EPSS、CISA KEV 和 Vulhub
   练习目录，保留四份来源 snapshot，并匹配到 `activemq/CVE-2023-46604`。后续不再把 CVE
   说成只有 mock 数据或只有单 NVD；CVE 设置页主同步入口已升级为 NVD、FIRST EPSS、CISA KEV
   和 Vulhub 四源矩阵，并保留逐源成功/失败状态；同日真实打包 MilkSU UI 已点击该设置入口，
   对 `CVE-2024-3400` 完成 4/4 来源同步，并在隔离 App data 下落盘 NVD、FIRST EPSS、
   CISA KEV 与 Vulhub snapshot。仍未完成 Docker 练习环境启动/停止、完整研究结果回写和
   资产验证。
3. **P0 · 长时间自主开发。** 打包 MilkSU 在“替我审批”或“完全访问”下持续完成真实功能，
   自动构建、测试、预览、恢复和交付，普通已授权操作不以无意义审批反复打断用户。
   Computer Use 必须能由用户选择一个当前可见的外部 App / 窗口作为不可变 Scope，并让
   纯文本主模型通过辅助视觉理解工具截图；不能只硬编码操作 MilkSU 自身。2026-08-05
   packaged live smoke 已证明打包 proxy / Cua Driver 能在外部 Calculator 精确窗口 Scope
   内完成可见点击；同日真实 MilkSU 打包 UI 已完成 Coding → 浏览器与 App → 选择 Calculator
   → 启动可见会话 → 状态变为已接入当前任务 → 停止会话；随后又用同一隔离 App data
   重启真实 MilkSU，确认任务保留但旧 Calculator Scope 不会幽灵恢复为已接入，并用
   Computer Use 对 Calculator 完成 `2+3=5` 的真实点击操作。后续不再重复验证 UI 内
   选择/启动或重启清理，只补主模型消费截图完成真实 GUI 任务的闭环。
4. **P1 · 成熟能力集成。** ImageGen、Browser、前端设计/视觉回归 Skill、Project MCP、
   高频 Plugin 以及经用户明确选定的成熟开源能力，优先复用固定版本、可审阅的成熟组件。
   Obelisk / Session Index 是当前 P0 例外，不再按“长期候选”后置。
5. **P1 · CTF 广度验收。** 六个赛道作为独立验收线运行；允许不同 subagent 分赛道执行，
   主 Agent 负责授权边界、证据审阅、问题去重和最终汇总。发现问题先登记，不在单题中无限
   深挖修复。
6. **P2 · Memory 用户体验。** 先保证推荐理由可追溯、Memory 与能力画像对用户可理解、
   删除或归档后的结果一致；36 条完整校准矩阵和精细统计后置。
7. **持续约束。** 架构不做独立清债冲刺，但相关纵切不得继续给热点文件增加新职责；测试、
   Judge 回执、Checkpoint 和必要 ADR 随任务保留。
8. **后期。** 完整“请求批准”组合矩阵、NYU Outcome Bench、pre-release 破坏性收口、
   Developer ID、Hardened Runtime、公证、升级、新机器矩阵和最终发布文档后置。

“先功能、后细节”不取消少量不可绕过的不变量：

- Provider Credential 不进入模型上下文、终端、日志、诊断包、普通文件或迁移；
- 不向引用的开源项目发布 PR，只允许当前明确授权的 MilkSU 私有远端；
- 付费、外部账户授权、扩大网络或应用 Scope、托管平台发布仍需要一次有意义的确认；
- 文件路径、项目边界和精确 Endpoint 不能因权限档位而逃逸；
- 未经用户要求的删除、覆盖和不可逆外部操作不能静默执行。

恢复后的执行顺序以本节和下方优先级为准，不恢复任何旧里程碑或候选批次。每个工作批次需
写明允许修改范围、禁止顺带修复的相邻问题、窄自动化和证据位置；持久目标继续指向本文件。

## Pre-release 破坏性演进原则

MilkSU 当前没有需要承诺向后兼容的外部发行基线。后续开发固定遵守：

1. **新代码现在就写干净。** 新增领域模型、DTO、事件和数据结构直接表达当前设计，不为
   尚未发布的旧设想增加 fallback、双写、影子字段、临时 Adapter 或 Migration。
2. **不在纵切中途为清债而清债。** 已经工作的旧代码和旧 schema 若不阻碍当前功能正确性，
   继续保持回归，不打断 CTF、Memory、Runtime 和交付主线去做纯重构。
3. **确需修改旧设计时先登记，最后集中破坏性收口。** 在全部产品纵切与真实验收完成后、
   最终文档更新前，一次性删除不再需要的兼容代码、历史 schema 和过渡结构，不长期保留
   两套设计。
4. **开发数据不构成兼容承诺。** 最终收口可以要求显式重置 pre-release 本地数据；应用
   不能擅自删除数据，也不能读取、迁移、导出或记录 Provider Credential。
5. **收口不是只改代码。** 破坏性调整后必须从全新数据目录重新执行完整自动化、打包
   Sidecar、原生 App、恢复、六赛道、Memory 校准、Bench 和发行回归；失败项修复后重跑。
6. **最后才冻结和写文档。** 回归全部通过后再冻结首个外部 Beta schema/API baseline，
   从该版本起维护正式向前 Migration 与兼容承诺，并统一更新架构、里程碑、状态和发布说明。

## 1. Coding Agent 替代与自举底座

MilkSU 的首要产品目标是替代用户日常对 Codex 的大部分依赖。这个目标最硬的完成条件是：
打包后的 MilkSU 能够安全、持续地开发、验证、恢复并交付 MilkSU 自身，而不是依赖外部
Coding Agent 才能继续迭代。

自举不等于只服务 MilkSU 仓库。相同的 Coding Runtime、权限、工具、恢复和交付能力也必须
适用于用户明确授权的其他项目。替代也不等于复制 Codex 的全部功能；优先级由真实高频工作
负载和替代缺口决定，通用能力优先复用固定版本的 Pi、成熟 Extension、Skill、Plugin、MCP
和平台 CLI，不为追求功能数量继续扩大自研 Coding Harness。

### B1 · 自主修改

- 冷启动核对仓库、HEAD、工作区和项目指令；
- 规划并完成 Vue、Go、TypeScript 的普通跨文件修改；
- 运行测试、构建、修复失败并复验；
- Vue/Go 可应用 Code Action 通过真实验收；
- 跨文件 LSP Action 在不能完整审阅和原子应用时必须拒绝，不能部分写入；
- 已完成的超大 Diff 拒绝边界保持回归。

Coding 权限档位必须对所有能力入口保持可理解的一致语义，不能只对基础文件/终端工具生效。
当前开发优先保证“替我审批”和“完全访问”的连续执行体验；“请求批准”保留现有正确能力
和回归，但覆盖所有工具组合、边角交互和完整审批矩阵放到后期：

- **请求批准：** 普通写入、命令、Browser、Computer Use、MCP 和 Agent 委托逐次确认；
- **替我审批：** 在用户已经显式启用且固定边界的任务范围内，自动执行普通文件、命令、
  Browser、Computer Use、只读 MCP 和合规 Agent 委托，不用无意义审批打断用户；
- **完全访问：** 自动执行已启用能力，但仍受 Provider Credential 隔离、禁止工具、路径
  防逃逸等不可绕过的硬边界约束；
- 付费 ImageGen、外部账户授权、扩大 Scope、托管平台发布和其他不可逆外部副作用仍属于
  有意义的独立确认，不得借“替我审批”静默扩大授权。

验收重点不是审批弹窗数量，而是长任务中的无意义中断次数、人工接管次数、恢复结果和最终
交付成功率。

### B2 · 自主验证

- 预览工作区内普通 Markdown、HTML 和图片产物；
- HTML 使用隔离渲染、严格 CSP、禁网、路径和大小限制；
- Coding Browser 继续使用隔离 Profile，工具调用遵循统一 Coding 权限档位；
- Computer Use 使用用户可见会话、明确应用范围，并遵循统一 Coding 权限档位。用户可以
  选择当前可见的 App / 窗口，生成精确到 bundle、PID 和窗口的不可变 Scope；模型不能在
  会话中切换到未确认的其他 App、桌面或窗口；
- Computer Use 的观察优先使用 Accessibility 结构；当目标控件缺少可靠结构信息时，
  纯文本主模型必须能通过受控辅助视觉读取工具返回的截图，再回到结构化元素或坐标操作，
  不能退化成盲猜位置；
- Workspace Auto 不得隐式启用 Computer Use。

### B3 · 持续执行

- Pi 持久会话、上下文压缩、失败恢复和结构化移交不重复已经完成的工作；
- 原生 App 重启后核对后台任务、PID、端口、日志和长任务状态；
- 旧 PTY 可以明确结束，但不能伪装为可重连；
- 已失效的审批跨重启自动过期。

### B4 · 安全交付

- 文件与 Hunk Diff、stage、commit、push 保持回归；
- 托管平台 PR 在发布前展示仓库、分支、提交和目标并单独确认；
- 只允许当前明确授权的 MilkSU 私有远端；
- 不向引用的开源项目创建 PR。

### B5 · 规模化协作

- 单 Agent 自举通过后，再验证多 Agent 分工；
- 每个写入 Agent 使用独立 Git worktree；
- 主 Agent 负责审阅、冲突处理、集成、真实验收和最终交付；
- 只有真实任务证明并行有用时才保留，不以 Agent 数量作为完成指标。

最终验收是一次真实的 “MilkSU develops MilkSU”：在打包 MilkSU 中完成一个此前未实现的
Vue + Go 纵切，运行测试与原生 App，预览产物，中途重启并恢复，最后审阅、提交、推送并
经确认向 MilkSU 私有仓库创建 PR。

### B6 · 高频替代能力

在 P0 自主工作主线保持可用的前提下，高频替代能力作为 P1 并行扩面，不等待完整“请求批准”
矩阵或所有自举细节完成。目标不是继续增加低频开发工具，而是补齐用户实际高频使用、目前
替代效果不足的通用能力：

1. **ImageGen**
   - 支持从文本生成图片、使用参考图编辑和产出可预览的项目内资产；
   - 优先复用成熟的 ImageGen Skill、Provider Adapter 或受控外部工具，不自研图像模型；
   - 输入、输出、尺寸、成本和失败状态可见；Provider Credential 不进入提示词、工具输出、
     终端、日志或诊断包。
2. **Browser**
   - 将“隔离 Coding Browser”从存在工具提升为可靠的日常研究、页面验证、调试和回归能力；
   - 隔离 Profile、用户登录态浏览器和 Computer Use 保持三个不同授权面，不能隐式继承
     Cookie、Token、页面会话或网络权限；
   - 浏览器任务保留页面、控制台、网络失败、截图和回归结果等可审阅证据。
3. **前端设计、视觉验证与浏览器回归 Skill**
   - 形成可复用的设计方向、参考图到代码、响应式检查、视觉 QA、交互回归、Console 错误和
     可访问性检查工作流；
   - Skill 必须调用真实 Browser、测试和产物预览，不能只依靠模型文字声明“视觉已验证”；
   - 至少使用一个 MilkSU 纵切和一个用户授权的其他项目做真实验收。
4. **高频通用 Plugin**
   - 候选由真实使用记录和替代失败证据驱动，优先覆盖反复出现的工作流，不按插件数量验收；
   - 优先复用可审阅、可固定版本的 Pi Package、Skill、Plugin、MCP 或官方平台连接器；
   - 启用前展示来源、版本、工具面、文件/网络/凭据权限和任务范围，不允许 Agent 静默安装
     或自动扩大权限；
   - Codex 的宠物、装饰性 UI 和低频功能不进入替代完成条件。

集成成熟组件可以减少自研和组件级测试，但不能省略 MilkSU 的权限适配、打包兼容和至少
一个真实任务验收。高频替代能力以实际任务成功率为准：同时保留 MilkSU 自举任务和其他
授权项目任务，记录完成结果、人工接管次数、恢复、耗时、模型/工具成本和失败分类。安装了
Skill、出现了按钮或通过单次 fixture 都不能单独证明已经替代。

### B7 · Obelisk 形态 Session Index 与相关历史

Session Index 是 Coding Agent 自举体验的基础能力：Agent 需要能找回过去的项目讨论、失败
原因、工具输出摘要、用户偏好、任务移交和跨模块学习记录，而不是每次压缩或重启后从零开始。

当前目标不是做一个“检测用户有没有安装 Obelisk”的中间方案，而是把 Obelisk 已验证过的会话
索引形态内化到 MilkSU：

- MilkSU 自己在本机 App data 下初始化和维护 `session-index/obelisk.sqlite` 或等价兼容 schema；
- 不要求用户安装 Obelisk CLI，不把 `~/.obelisk/obelisk.sqlite` 作为默认产品路径；
- 首期先索引 MilkSU 自己产生的 Coding、CTF、CVE 会话、工具调用、任务移交、失败摘要和
  人工确认记忆；
- Session Index 必须覆盖主 Agent、侧边 Agent、CTF Solver、Tool Builder、Strategist 和
  Coding Agent 的会话/工具/移交记录；目标不是单一搜索框，而是让不同 Agent 能在权限边界内
  找回彼此已完成的结论、失败路径和交接上下文；
- 后续再扩展导入 Claude、Kimi、Codex、Pi 等历史，不阻塞首期闭环；
- 搜索结果必须脱敏 Provider Credential、Token、Cookie、私有 URL secret 和工具原始敏感输出；
- 搜索结果在 UI 中统一称为“相关历史”；不要在界面里写“事实源”“正式档案”“历史线索”等
  边界说教文案，可信边界留在内部规则、测试和开发文档中；
- 首期 UI 以“相关历史”为轻量入口，优先支持查看来源、保存为 Memory / CVE Note /
  Coding Handoff、生成接力任务，不把完整内部索引后台摊到默认工作区；
- 用户明确确认后，相关历史才能转化为 MilkSU Memory、CVE Note、Coding Handoff 或任务计划；
- CTF Judge、CVE source snapshot、Coding 测试/commit/screenshot、Ability Profile 仍由 MilkSU
  对应模块决定；
- 若复制、改造或深度派生 Obelisk 源码，必须在发布前完成许可证/授权记录；用户已提供上游
  作者授权线索，但工程实现仍应保留 NOTICE/ADR 和可审计来源。

首期验收门槛：

1. 全新数据目录启动后能自动创建 session-index；
2. 至少一条真实 MilkSU 会话或工具事件进入索引；
3. App/Wails 暴露索引状态和搜索；
4. Coding、CTF、CVE 至少共享一个轻量“相关历史”入口；
5. 搜索返回来源、模块、时间、会话、片段和脱敏状态；
6. 缺少历史时显示可理解空态，而不是要求用户安装 Obelisk；
7. 单测覆盖 schema、FTS/LIKE 搜索、脱敏、缺索引空态和只读/写入边界；
8. 原生 App 中完成一次真实搜索验收。

2026-08-05 首轮状态：上述 1–8 已通过当前代码和打包 App smoke 证明。新增
`MILKSU_SESSION_INDEX_SMOKE_*` 隔离验收路径后，`node scripts/test-local-delivery-baseline.mjs`
会用隔离 HOME 启动真实 `build/bin/MilkSU.app`，预置一条本地会话，等待 App 进程内完成
`SearchSessionHistory`，并断言 `session-index/obelisk.sqlite` 位于 App data、命中结果来自
`milksu-coding`、工具事件计数存在、搜索片段脱敏且不泄漏 fixture secret。后续不要重复把
“原生 App 中能搜索相关历史”当作缺口；下一步是用户确认后转 Memory / CVE Note /
Coding Handoff，以及 Claude/Kimi/Codex/Pi 历史导入。

## 其余目标审查与调整

除 Coding Agent 外，其余目标也需要调整。总体方向没问题，但目前把“产品完成条件、真实
验收活动、内部研究、架构维护和正式发布”混在了一起。

总体收敛为四条主线：CTF 通用闭环、Memory 可信度、Runtime 评测、正式交付。架构拆分
作为这些主线的工程约束，不单独追求“清债完成”。

## 2. CTF 通用能力：六赛道并行验收

当前代码实际定义了六个能力轴：Web、Pwn、Reverse、Crypto、Forensics、Misc，而不是
五个；并且只有六个赛道都出现 Judge-verified 成功才会 Ready：
`internal/nssctf/catalog.go:474`、`internal/nssctf/catalog.go:686`。

因此目标调整为：

- Web、Pwn、Reverse、Crypto、Forensics、Misc 各至少一个真实 Judge-verified 闭环；
- Forensics 与 Misc 不再合并，否则和能力画像模型不一致；
- 一题成功只是通用能力 smoke，不得描述为整体 CTF 成绩；
- 为六题建立固定的回归清单，记录平台、题号、类别、材料类型和验收日期。

每题统一验收：

- 授权题面及材料；
- Solver 轨迹和 Checkpoint；
- 候选及依据；
- 平台 Judge 回执；
- 提示依赖和用户贡献；
- 中断/恢复；
- 复盘和训练证据。

Tool Builder 与 Strategist 不要求每题都调用，改为两个跨赛道场景：

- 至少一题自然卡关后，Solver 提交工具请求，Coding Agent 交付工具，Solver 使用结果
  继续；
- 至少一题在重复失败后，由 Strategist 使用独立会话复盘，提出不同路线，再交回 Solver
  验证。

这两条是产品协作能力验收，不是额外 Agent 数量指标。

执行方式采用广度优先：

- 六个赛道可以分别交给独立 subagent 运行，避免一题卡住阻塞全局；
- 每个 subagent 使用授权题目和材料，保留轨迹、候选、Checkpoint 与 Judge 回执；
- 主 Agent 负责核对正式 Runtime、授权 Scope、证据完整性、问题去重和最终结论；
- 赛道中发现的产品缺口先登记到覆盖台账，不在同一验收任务里无限修改产品；
- 没有真实 Judge 回执只能记为 attempted 或 completed，不能记为 solved。

六赛道不是普通单元测试。外部平台、动态服务或本机权限不足时，应保留恢复点并明确标记
未验收，不能用模型自评代替平台 Judge。

## 3. 动态 Endpoint 与网络边界：保持回归并接受真实赛道检验

动态 Endpoint 申请、不可变 Scope、HTTP 精确 Origin、TCP/SSH 精确 `host:port` 和通用 Shell
默认无网络的主链已经落地，不再作为新的独立功能纵切重复开发。后续在 Web/Pwn 等真实赛道
中保持以下回归：

- 页面或 Agent 发现的新 Endpoint 只能提出授权申请，不能自动加入 Scope；
- UI 清楚展示协议、域名/IP、端口、来源和用途；
- 用户一次确认后，普通请求不再重复审批；
- HTTP、TCP、SSH 分开授权，动态 Endpoint 不继承 Cookie、Token 或浏览器会话；
- 通用 Shell 默认无网络，不能因存在一个 Origin 就访问任意网络；
- 发现边界或体验问题先登记，统一进入后续修复批次，不回到旧的 Endpoint 开发计划。

## 4. Memory 与能力画像：先做用户可感知的可信体验

Memory 是 MilkSU 的核心差异，但当前不把完整归属矩阵、36 条轨迹和精细统计作为近期功能
扩面的前置条件。已有证据归属模型保持回归；近期只优先处理直接影响用户体验和数据可信度
的结果：

- 推荐理由能指向具体 Judge、提示、步骤和失败记录；
- 用户能理解 Memory 与 Ability Profile 的区别；
- Agent 代做不会显示成用户独立完成；
- 删除或归档证据后，推荐和画像同步变化；
- 模型总结、猜测和复盘文本不能自动变成用户能力事实。

其余目标保留为后期校准合同，分成三层。

### 第一层：证据归属

- `actor = user / agent / shared / imported`；
- `assistance = none / hint / copilot / delegated`；
- 用户独立步骤只能来自显式用户操作或用户确认的结构化记录；
- Agent 总结、推测和复盘文本不能自动变成用户能力事实；
- Judge 正确性与用户贡献度必须是两个独立维度。

### 第二层：画像与 Memory 分离

- Memory 表示“过去题目中可复用的经验”；
- Ability Profile 表示“有证据支持的用户能力”；
- Agent 代做的成功可以形成 Agent Memory，但不能等价提升用户能力；
- 提示依赖、独立完成和协作完成分别显示，不能压成一个模糊分数。

### 第三层：后期校准活动

第一轮采用 36 条分层样本：

- 6 个赛道；
- coach、copilot、delegate 三种协作方式；
- 每个组合至少两条轨迹。

36 不是神奇完成线，而是足以发现系统性误归因的第一轮矩阵。还要增加同知识点跨题召回
和无关题负对照。

验收指标包括：

- 模型猜测写入用户能力事实的次数必须为 0；
- delegate 成功不增加“独立完成”计数；
- 推荐理由能链接到具体 Judge、提示、步骤和失败记录；
- 当前题不召回自己的复盘；
- 相关旧题优先于同类别但无关的旧题；
- 删除/归档证据后推荐与画像同步变化。

## 5. Runtime：产品连续性优先，NYU 后置

Runtime 当前只优先补直接支撑 P0 自主工作的缺口：

- 完整 App 重启后恢复用户可见的会话和长任务；
- 核对后台任务、PID、端口、日志和最终状态；
- Context Compaction 后不重复已经完成的工作；
- 超时、取消和恢复能继续响应；
- 记录无意义审批、人工接管、失败分类、耗时和成本。

这些内容并入 Coding 自举验收，不再作为独立 Bench 追求百分比。已经通过的安全、可复跑
fixture 继续作为回归：

- 多轮规划；
- 文件读取；
- 普通开发命令；
- 工具调用；
- Sidecar/App 重启；
- 上下文压缩；
- 超时与取消；
- 成本和工具预算；
- 失败分类。

这是测 Harness，不需要借 NYU 题目，也不会产生虚假的 CTF 分数。

### NYU CTF Outcome Bench

NYU Outcome 属于后期研究和对照，不是近期产品完成条件。等六赛道真实闭环稳定后再做：

- 只采用人工准入的安全子集；
- 复用正式 CTF Runtime、Evidence 和 Checkpoint，不能另造第二套 Runner；
- 记录 admission、工具面、成本、超时和恢复；
- 不运行未经审核的附件、服务或漏洞触发输入；
- 报告继续明确区分 attempted、completed 和 solved。

当前 safe-static 结果继续称为“Pi Runtime safe-static smoke”，不能称为完整 MilkSU CTF
成绩：`docs/developer/nyu-ctf-bench-eval.md:116`。

## 6. 架构：作为持续约束，功能稳定后集中收口

这些拆分确实必要，因为热点已经很大：

- `CTFPage.vue`：3,021 行；
- `internal/browsercap/manager.go`：1,951 行；
- `bridge-policy.js`：2,417 行；
- `app.go`：1,352 行；
- `internal/ctf/service.go`：920 行。

当前先做功能并通过用户测试，不停止产品开发进行大规模纯重构。与此同时，“以后再整理”
不能成为新增明显技术债的理由，继续采用“触碰即拆分”：

- 做 Endpoint/Memory UI 前拆 `CTFPage.vue` 对应区域；
- 修改网络和 Computer Use 前拆 `bridge-policy.js`；
- 扩平台 Judge/Browser 前拆 `internal/browsercap/manager.go`；
- 修改恢复语义前拆 CTF Runner/Recovery；
- `app.go` 只在相关纵切里继续把业务规则移到 Adapter/应用服务。

持续约束：

- Wails 只做桌面调用和 DTO；
- 领域层不依赖 Wails；
- Pi Runtime 不知道 NSSCTF/CTFshow 页面细节；
- 平台 Adapter 不决定学习成功或用户能力；
- 新功能不得继续给这些巨型文件增加新的职责。

## 7. 本地交付：拆成数据安全和正式发行两阶段

### Pre-release 最终数据收口

现有五个数据库的编号、事务、兼容检查与迁移前安全备份已经实现，功能纵切期间保持回归，
不把移除这些旧实现当作当前优先事项。

从现在开始：

- 新数据结构直接按当前领域模型设计，不为尚未发布的中间形态新增兼容层；
- 若一个纵切必须修改既有 schema，先完成不依赖兼容技巧的领域语义和测试，不用保留旧
  字段、影子表或双写来伪装完成；
- 所有破坏性的旧代码与 schema 简化集中到产品目标完成后、最终文档更新前一次执行；
- 最终收口允许显式重置 pre-release 开发数据，但不能自动删除本机数据，也不能读取、迁移
  或导出 Credential；
- 收口后从全新数据目录重跑完整自动化、原生 App、六赛道、Memory 校准、恢复和发行回归；
- 首个外部 Beta 以收口后的结构冻结正式 baseline，从此才承诺编号式向前 Migration 和
  版本升级兼容。

诊断入口已经存在，应从“未完成”中删除：`app/src/components-vue/SettingsPage.vue:229`。
剩余目标改为：

- 持久化的上次启动/异常退出标记；
- Sidecar、恢复、迁移和后台任务的脱敏日志；
- 崩溃后下次启动提供恢复/诊断入口；
- 不保存会话正文、工具原始输出或凭据。

### 正式发行，Release Candidate 阶段

Developer ID、公证、升级渠道很重要，但不阻塞当前功能迭代。现在默认允许 ad-hoc
签名 `-`：`scripts/package-sidecar.mjs:1277`。

只有准备外部 Beta/正式版时，将以下设为发布门禁：

- Developer ID Application 签名；
- hardened runtime 和 entitlements；
- Apple notarization 与 stapling；
- 签名升级包和升级源；
- 旧版本 → 新版本迁移；
- 升级失败回滚；
- 全新 macOS 用户、无开发工具机器安装；
- 离线/网络失败时的可理解降级。

尺寸目标具体化。当前最低窗口是 `1080×680`：`main.go:23`。先定义支持矩阵，再做 QA，
不使用模糊的“小窗口”。性能同样先记录启动时间、空闲内存、前端 chunk 和 App 体积基线，
再设回归阈值。

## 8. 文档：维持最后统一更新

这一条不需要调整。

开发过程中只保留：

- 测试输出；
- Judge 回执；
- 轨迹和 Checkpoint；
- 版本化验收记录；
- 必要 ADR。

不反复修改“已完成/当前成绩”声明。等六赛道、Memory 校准、自举 Coding Gate 和发行门禁
实际通过后，再统一更新架构、里程碑、状态和发布说明。

## 调整后的总体顺序

以下是优先级队列，不是授权开发的固定流水线。每次只从最高可执行层选择一个有界批次；
发现相邻问题先登记，不自动扩大范围。

0. **当前冲刺 · 完整产品闭环。** 先按 [product-loop-sprint.md](./product-loop-sprint.md)
   跑通一个可演示、可恢复、可交付的真实 Coding 产品任务；CVE 做到学习/追踪工作台骨架，
   CTF 保持现有主链可理解，Lab 只保留长期外部靶场辅助/进度追踪计划，不进入实现。
1. **P0 · 自主工作主线。** 在打包 MilkSU 中使用“替我审批”或“完全访问”完成真实功能，
   覆盖修改、构建、测试、产物预览、Context Compaction、完整 App 重启、长任务恢复、
   Git 交付和必要的发布确认，以无意义审批次数、人工接管次数和交付结果验收。
2. **P1 · 成熟能力扩面。** 集成并真实验收 ImageGen、Project MCP、Browser、前端设计/
   视觉回归 Skill；Plugin 由用户真实高频历史和替代失败证据选择，不按数量堆积。
3. **P1 · CTF 六赛道广度验收。** 不同 subagent 分别执行授权赛道，主 Agent 统一核对
   Evidence、Judge、Checkpoint、恢复、Tool Builder 和 Strategist 协作；发现问题先形成
   清单，再另选修复批次。
4. **P2 · Memory 用户体验。** 优先做可追溯推荐、可理解画像和删除一致性；用前面产生的
   真实轨迹逐步校准，不先等待完整 36 条矩阵。
5. **稳定后收口。** 用户测试确认主要功能方向后，集中整理架构热点和 pre-release 旧代码/
   schema，从全新数据目录执行完整回归。
6. **Release Candidate。** 再执行全新机器、Developer ID、Hardened Runtime、公证、签名
   升级、失败回滚、支持矩阵和性能门禁。
7. **后期评测与文档。** 六赛道稳定后运行 NYU Outcome Bench；所有 Gate 通过后统一更新
   架构、里程碑、状态、验收结论和发布说明。

Lab 纵深闭环继续暂停，不进入上述真实完成条件；CVE 纵深研究也暂停，但产品界面必须有
可理解的学习/追踪入口、状态、安全边界和后续计划，避免用户看到空白一级模块。
