# 当前目标覆盖台账

> 状态：广度优先盘点的事实台账
>
> 快照：2026-08-03，`2f9d4ca`
>
> 本文件不是发布说明。它把 `current-objectives.md` 的大项拆成可单独核对的细项，用于先看清
> 全局，再共同决定修复批次。

## 计分与工作规则

每个细项暂时等权，只使用五档：

| 分值 | 含义 |
| ---: | --- |
| 0% | 未开始，或当前没有足够证据证明已经开始 |
| 25% | 已有设计、局部代码或局部记录，但还没有形成可验收纵切 |
| 50% | 工程实现与窄测试存在，尚缺真实场景验收 |
| 75% | 已有真实场景证据，但完整矩阵、跨项目或最终门槛尚未通过 |
| 100% | 该行定义的精确完成条件已经通过 |

规则：

1. 当前阶段采用广度优先；先让所有一级目标完成一轮只读盘点。
2. 任何低于 100% 的行本身就是问题记录，行 ID 是稳定的问题编号。
3. 发现问题时只更新证据、分值和缺口，不立即修改产品代码。
4. 用户与主 Agent 完成一轮共同评估后，再选择一批问题进入修复；没有进入批次的项继续冻结。
5. 文档、按钮、单次 fixture 和代码存在都不能自动折算为真实验收。
6. “待用户条件”不是删除目标的理由；仍保留为 0% 或 75%，直到条件满足并实际执行。
7. 暂时等权是为了让分母透明，不代表所有项具有相同产品价值；共同评估时可以调整分组和
   权重，但不能为了提高百分比而移动完成线。

## 汇总

| 分组 | 细项数 | 当前分 | 完成度 |
| --- | ---: | ---: | ---: |
| Coding Agent 与高频替代能力 | 30 | 1,450 / 3,000 | **48%** |
| CTF 通用闭环与网络边界 | 15 | 525 / 1,500 | **35%** |
| Memory 与能力画像 | 11 | 425 / 1,100 | **39%** |
| Runtime Reliability 与 NYU Bench | 10 | 700 / 1,000 | **70%** |
| 架构约束 | 6 | 125 / 600 | **21%** |
| 本地数据安全与正式交付 | 15 | 575 / 1,500 | **38%** |
| 最终文档 | 2 | 75 / 200 | **38%** |
| **整体** | **89** | **3,875 / 8,900** | **44%** |

此前约 58% 的估值按大块综合判断，分母中没有逐项展开真实验收、跨项目、六赛道、RC 和
架构约束。44% 是新细项口径的基线，不表示代码倒退。后续只使用同一张表比较变化。

## Coding Agent 与高频替代能力

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| COD-01 | 冷启动核对仓库、HEAD、工作区和指令 | 多次真实 MilkSU 任务已有记录 | 75% | 在最终自举任务中固定留存 |
| COD-02 | Vue、Go、TypeScript 普通跨文件修改 | 代码路径、测试和真实任务均存在 | 75% | 同一打包 App 自举任务覆盖三者 |
| COD-03 | 运行测试、构建、修复失败并复验 | deterministic delivery 与真实任务均有证据 | 75% | 最终打包 App 自举 Gate |
| COD-04 | TypeScript、Vue、Go Code Action | LSP 实现、负向测试和既有真实验收 | 75% | 在最终自举纵切再次覆盖 Vue + Go |
| COD-05 | 跨文件 Action 原子拒绝与超大 Diff 拒绝 | 自动化测试存在 | 50% | 打包 App 负向真实验收 |
| COD-06 | “请求批准”覆盖所有能力入口 | Bridge/UI 自动化存在 | 50% | Browser、Computer Use、MCP、委托组合验收 |
| COD-07 | “替我审批”拦截无意义审批 | Browser 真实任务与策略测试存在 | 75% | Computer Use 与项目 MCP 真实任务 |
| COD-08 | “完全访问”仍保持硬边界 | 策略测试存在 | 50% | 打包 App 越界负向验收 |
| COD-09 | 付费、账户授权、扩大 Scope、发布仍独立确认 | ImageGen、MCP、Endpoint、PR 测试存在 | 75% | 真实 Provider 与托管发布确认 |
| COD-10 | Markdown、HTML、图片产物预览 | Go/Vue 实现与安全测试存在 | 50% | 打包 App 三种产物真实预览 |
| COD-11 | HTML 隔离、CSP、禁网、路径与大小限制 | `artifact_preview_test.go` 等自动化 | 50% | 原生 WebView 负向验收 |
| COD-12 | 隔离 Browser 自动化与证据边界 | Browser integration 与 41 项窄测试通过 | 100% | — |
| COD-13 | MilkSU 项目前端视觉 QA 真实纵切 | `frontend-visual-qa-acceptance.md` | 100% | — |
| COD-14 | 用户授权的其他项目前端视觉 QA | 尚无项目与任务证据 | 0% | 用户提供一个授权前端项目 |
| COD-15 | Computer Use 可见会话与固定应用范围 | 代码、策略和打包 UI 已核对 | 50% | macOS 权限后运行真实会话 |
| COD-16 | Computer Use 一次性系统权限真实验收 | Accessibility 与 Screen Recording 未授权 | 0% | 用户在 macOS 完成授权 |
| COD-17 | Pi 持久会话、Compaction 与连续性 | fixture、事件投影和既有真实任务 | 75% | 完整 App 重启长上下文验收 |
| COD-18 | 重启后后台任务、PID、端口、日志和长任务恢复 | Sidecar fixture 与部分打包任务存在 | 50% | 跨 App 重启的真实长任务 |
| COD-19 | 旧 PTY 明确结束且审批跨重启过期 | 自动化测试存在 | 50% | 原生 App 真实重启负向验收 |
| COD-20 | Diff、Hunk、stage、commit、push 日常闭环 | 代码、测试和历史真实验收完成 | 100% | — |
| COD-21 | PR 预览、一次性确认和私有远端限制 | `pull_request_test.go` 与 UI 流程 | 50% | 真实托管平台 Draft PR |
| COD-22 | 经确认发布 MilkSU 私有 Draft PR | 尚无本轮真实发布回执 | 0% | 在最终自举 Gate 中执行 |
| COD-23 | 多 Agent 独立 worktree、恢复和安全收尾 | Manager 与 Bridge 自动化存在 | 50% | 真实有价值的协作任务 |
| COD-24 | 多 Agent 在真实任务中证明并行有用 | 尚无成功率与成本证据 | 0% | 选择自然可并行的任务验收 |
| COD-25 | 完整 “MilkSU develops MilkSU” Gate | 有多个局部自举任务 | 25% | 一次完整 Vue + Go、重启、交付、PR |
| COD-26 | ImageGen 文生图、参考图编辑和项目资产 | 受控工具、UI、测试与打包存在 | 50% | 真实 Provider 生成 |
| COD-27 | 打包 App 真实 ImageGen Provider 与预览 | Provider 尚未在 App 内配置 | 0% | 用户自行配置后执行，不接触 Key |
| COD-28 | Project MCP 来源、版本、工具面与权限审阅 | Go/Vue/Bridge 实现和测试存在 | 50% | 实际 MCP 工具任务 |
| COD-29 | 高频 Plugin 候选完成真实任务 | 尚未由使用频率选出候选 | 0% | 先收集重复工作流与替代失败 |
| COD-30 | 代表任务成功率、接管、恢复、成本对照 | 尚无固定 20 项对照集 | 0% | 从用户真实历史选择代表任务 |

## CTF 通用闭环与网络边界

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| CTF-01 | 动态 Endpoint 申请、逐条确认、不可变 Scope | 代码、UI、自动化和本机 HTTP 授权记录 | 75% | 真实远端 Web/Pwn 扩样本 |
| CTF-02 | HTTP 精确 Origin broker、禁重定向 | 自动化与本机精确 Endpoint 验收 | 75% | 真实 Web 题网络证据 |
| CTF-03 | TCP 与 SSH 分离的精确 `host:port` | 领域和策略自动化存在 | 50% | 真实 Pwn TCP 与 SSH 各一次 |
| CTF-04 | 通用 Shell 默认无网络且不因 Scope 广开 | 策略与负向测试存在 | 50% | 打包 App 真实拒绝证据 |
| CTF-05 | Endpoint 不继承 Cookie、Token 或浏览器会话 | 隔离设计和自动化存在 | 50% | 真实跨能力负向验收 |
| CTF-06 | Web 真实 Judge-verified 完整闭环 | NSSCTF P3879 `correct=true` 记录 | 75% | 纳入固定六题回归清单 |
| CTF-07 | Pwn 真实 Judge-verified 完整闭环 | 无真实通过证据 | 0% | 完整题目、轨迹、Judge、恢复、复盘 |
| CTF-08 | Reverse 真实 Judge-verified 完整闭环 | 无真实通过证据 | 0% | 完整题目、轨迹、Judge、恢复、复盘 |
| CTF-09 | Crypto 真实 Judge-verified 完整闭环 | 无真实通过证据 | 0% | 完整题目、轨迹、Judge、恢复、复盘 |
| CTF-10 | Forensics 真实 Judge-verified 完整闭环 | 无真实通过证据 | 0% | 独立于 Misc 的完整题目闭环 |
| CTF-11 | Misc 真实 Judge-verified 完整闭环 | 无真实通过证据 | 0% | 独立于 Forensics 的完整题目闭环 |
| CTF-12 | 六题固定回归清单 | 能力轴和覆盖 UI 存在 | 25% | 固定平台、题号、材料、日期与回执 |
| CTF-13 | Solver 卡关 → Coding Tool Builder → Solver | Tool Workshop 代码与测试存在 | 25% | 真实自然卡关闭环 |
| CTF-14 | 重复失败 → 独立 Strategist → Solver | 角色与恢复基础存在 | 25% | 真实独立会话重规划闭环 |
| CTF-15 | Evidence、候选、Judge、Checkpoint、恢复和复盘主链 | 主链代码、测试及一题真实记录 | 75% | 在其余五赛道重复验证 |

## Memory 与能力画像

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| MEM-01 | `actor=user/agent/shared/imported` | 领域模型和归属测试存在 | 50% | 真实轨迹校准 |
| MEM-02 | `assistance=none/hint/copilot/delegated` | 领域模型和模式测试存在 | 50% | 真实轨迹校准 |
| MEM-03 | 用户独立步骤只来自显式用户记录 | 自动化拒绝反思/导入冒充 | 50% | 打包 App 真实操作证据 |
| MEM-04 | 模型猜测写入用户能力事实为 0 | 未知 actor fail closed 测试存在 | 50% | 36 条真实轨迹审计 |
| MEM-05 | Judge 正确性与用户贡献度独立 | 服务与投影测试存在 | 50% | 真实题目回执核对 |
| MEM-06 | Memory 与 Ability Profile 分离 | 数据结构和 UI 基础存在 | 50% | 用户侧可解释性验收 |
| MEM-07 | delegate 成功不增加独立完成 | 自动化测试存在 | 50% | 真实 delegate 样本 |
| MEM-08 | 推荐理由链接 Judge、提示、步骤和失败 | 局部推荐/报告实现存在 | 25% | 端到端可点击证据 |
| MEM-09 | 当前题排除、相关旧题优先、无关题负对照 | 局部 Memory 测试存在 | 25% | 跨题真实召回对照 |
| MEM-10 | 删除/归档证据后画像与推荐同步 | 归档基础存在 | 25% | 端到端一致性验收 |
| MEM-11 | 36 条分层样本与跨题校准 | 尚未执行 | 0% | 6 赛道 × 3 模式 × 每组 2 条 |

## Runtime Reliability 与 NYU Bench

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| RUN-01 | 多轮规划、文件、命令和工具 fixture | deterministic delivery Gate | 100% | — |
| RUN-02 | Sidecar 重启恢复同一会话与后台 Watch | reliability 子报告 | 100% | — |
| RUN-03 | 完整 App 重启恢复 | 部分真实任务和生命周期基础 | 50% | 打包 App 长任务连续性 |
| RUN-04 | 正式 Pi Context Compaction | fixture 与专门测试通过 | 100% | — |
| RUN-05 | 超时、取消和继续响应 | fixture 与专门测试通过 | 100% | — |
| RUN-06 | Token、工具、时长和成本预算 | 固定预算报告存在 | 75% | 真实 Provider 成本核对 |
| RUN-07 | 失败分类与统一 Reliability 报告 | 三类失败和报告 Gate 已通过 | 100% | — |
| RUN-08 | 打包 App 真实长任务恢复 | 只有局部任务证据 | 25% | 用户可见的完整重启验收 |
| RUN-09 | NYU 安全准入与 safe-static smoke | one-shot 和两回合只读记录 | 50% | 仍不能称完整 Outcome |
| RUN-10 | NYU CTF Outcome Bench | 尚未在六赛道稳定后执行 | 0% | 人工准入子集与正式 Runtime |

## 架构约束

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| ARC-01 | 触碰即拆 `CTFPage.vue` | 已抽出多个组件，当前 2,997 行 | 25% | 后续纵切继续按职责拆分 |
| ARC-02 | 触碰即拆 `browsercap/manager.go` | 有专项测试，当前 1,967 行 | 25% | 扩 Browser/Judge 时拆 Adapter |
| ARC-03 | 触碰即拆 `bridge-policy.js` | 已抽策略模块，当前 2,080 行 | 25% | 后续网络/Computer Use 继续拆 |
| ARC-04 | 收敛 `app.go` 平台适配职责 | 当前 1,499 行，比目标快照更大 | 0% | 相关纵切迁出业务规则 |
| ARC-05 | 拆 CTF Runner/Recovery 与 Service | `service.go` 当前 967 行 | 0% | 修改恢复语义时拆分 |
| ARC-06 | Wails、领域、Pi、平台 Adapter 边界 | 架构测试和包边界部分存在 | 50% | 用后续纵切持续证明无反向依赖 |

## 本地数据安全与正式交付

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| DEL-01 | 五库编号迁移、事务、兼容检查与安全备份 | 代码、自动化和设置入口存在 | 75% | 最终结构收口后全新目录回归 |
| DEL-02 | Pre-release 旧 schema 一次性破坏性收口 | 按契约明确后置 | 0% | 产品纵切完成后集中执行 |
| DEL-03 | 上次启动/异常退出标记与恢复入口 | 打包 App lifecycle baseline 通过 | 75% | 真实异常退出人工验收 |
| DEL-04 | Sidecar、恢复、迁移、后台任务脱敏诊断 | 诊断包、UI 和离线错误测试存在 | 75% | 真实故障包审阅 |
| DEL-05 | 不保存正文、原始工具输出或 Credential | 多处边界测试存在 | 50% | 完整诊断与本地文件审计 |
| DEL-06 | `1080×680` 最低窗口 | Browser 真实截图与布局审计 | 75% | 原生 App 全流程人工 QA |
| DEL-07 | 启动时间基线 | 隔离 HOME 打包 App 已测 | 75% | 多次冷启动和目标机器矩阵 |
| DEL-08 | RSS、前端 chunk、App/Sidecar 体积基线 | `local-delivery-baseline.md` | 75% | 多机器重复测量 |
| DEL-09 | 性能回归阈值与支持矩阵 | 只有单机基线 | 25% | 先定阈值，再纳入门禁 |
| DEL-10 | 全新 macOS、无开发工具安装 | 尚未执行 | 0% | Release Candidate 机器验收 |
| DEL-11 | Developer ID Application 签名 | 当前仍允许 ad-hoc `-` | 0% | RC 签名身份与验证 |
| DEL-12 | Hardened Runtime 与 Entitlements | 尚无完成证据 | 0% | RC 配置和验收 |
| DEL-13 | Apple notarization 与 stapling | 尚无完成证据 | 0% | RC 公证回执 |
| DEL-14 | 签名升级、旧版升级与失败回滚 | 尚无完成证据 | 0% | RC 升级渠道和回滚 |
| DEL-15 | 离线/网络失败的可理解降级 | synthetic 离线模型失败已验收 | 50% | 打包 App 多入口真实离线验收 |

## 最终文档

| ID | 可判定细项 | 证据快照 | 当前 | 尚缺 |
| --- | --- | --- | ---: | --- |
| DOC-01 | 开发期只保留测试、回执、验收记录和 ADR | 当前验收文档遵守此规则 | 75% | 持续保持，不提前写完成声明 |
| DOC-02 | 最后统一更新架构、里程碑、状态和发布说明 | 按目标后置 | 0% | 所有产品与发行 Gate 通过后执行 |

## 横向观察记录

以下观察不是本轮修复项：

| ID | 观察 | 处理 |
| --- | --- | --- |
| OBS-01 | `current-objectives.md` 中热点文件行数是旧快照；当前为 `2,997 / 1,967 / 2,080 / 1,499 / 967` | 保留原目标文字，本台账记录当前值；修复批次再决定是否更新 |
| OBS-02 | `challenge-intake-and-automation.md` 仍把部分已经落地的 Browser/Computer Use 写成 Planned | 留到最终统一文档收口，不在盘点期修 |
| OBS-03 | Plugin 已有审阅与选择基础，但没有由真实高频历史选出的候选，也没有实际工具成功率 | 保持 COD-29、COD-30 冻结 |
| OBS-04 | Computer Use 的代码边界已存在，但 macOS Accessibility 和 Screen Recording 是独立系统权限 | 等用户参与，不由自动审批绕过 |
| OBS-05 | safe-static 与 Reliability fixture 很强，但不等于六赛道或 NYU Outcome 成绩 | 分别由 CTF-06..11、RUN-10 保持未完成 |

## 下一轮共同评估入口

完成第一轮盘点后，优先讨论而不是立即修复：

1. 89 个细项是否需要合并、拆分或调整权重；
2. 哪些 0% 项需要用户条件，哪些可以由主 Agent 独立完成；
3. 第一批修复是否按“高价值 / 低风险 / 可真实验收”选择，而不是按文件或旧计划顺序；
4. 每个修复批次的容量上限，避免重新退回单条问题的无边界深挖。
