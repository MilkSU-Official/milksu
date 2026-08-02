# 当前开发目标

> 状态：当前唯一执行契约
>
> 生效日期：2026-08-02
>
> 这是一份工作范围与验收顺序，不是发布说明，也不用于提前宣称能力完成。

## 事实源与执行原则

1. 当前代码、自动化测试、打包 Sidecar、原生 App 和真实平台回执优先于旧对话与文档。
2. 每次开始工作先读取仓库状态，不根据历史计划重复已经完成的功能。
3. 通用 Coding 能力优先复用固定版本的 Pi、成熟 Extension、Skill、MCP 和平台 CLI。
4. MilkSU 自研集中在 CTF Evidence、Judge、Memory、教学和 Agent 协作。
5. 每个可交付纵切必须测试、审阅、提交并只推送到 MilkSU 自己的私有仓库。
6. Provider API Key 不进入模型上下文、工具输出、日志、诊断包、迁移或文档。
7. Labs 与 CVE Research 保持暂停，不作为当前完成条件。

## 1. Coding Agent 自举底座

Coding Agent 的北极星不是复制 Codex 的全部功能，而是能够安全地开发、验证、恢复并交付
MilkSU 自身。

### B1 · 自主修改

- 冷启动核对仓库、HEAD、工作区和项目指令；
- 规划并完成 Vue、Go、TypeScript 的普通跨文件修改；
- 运行测试、构建、修复失败并复验；
- Vue/Go 可应用 Code Action 通过真实验收；
- 跨文件 LSP Action 在不能完整审阅和原子应用时必须拒绝，不能部分写入；
- 已完成的超大 Diff 拒绝边界保持回归。

### B2 · 自主验证

- 预览工作区内普通 Markdown、HTML 和图片产物；
- HTML 使用隔离渲染、严格 CSP、禁网、路径和大小限制；
- Coding Browser 继续使用隔离 Profile 与逐次批准；
- Computer Use 使用用户可见会话、明确应用范围和逐次授权，用于验证 MilkSU 原生 App；
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

## 2. 本地数据与 Memory 可信度

在继续积累真实训练轨迹前：

1. 为 Event、Credential、Memory、NSSCTF Catalog 和 CTFshow Catalog 建立各库独立、
   编号、事务化、幂等的 SQLite migration；
2. 旧数据库可无损升级，未来版本被旧 App 拒绝，失败迁移可回滚并有升级前备份；
3. 训练证据记录 `actor = user / agent / shared / imported` 与
   `assistance = none / hint / copilot / delegated`；
4. Judge 正确性与用户贡献度分开；
5. 模型总结、猜测或 Agent 代做不能自动写成用户能力事实；
6. Memory 是可复用经验，Ability Profile 是用户能力证据，两者不能混为一个分数。

随后使用分层真实轨迹校准召回和推荐。第一轮以六赛道 × Coach/Copilot/Delegate ×
至少两次为覆盖参考，而不是把任意固定次数当成能力完成证明。

## 3. CTF 通用能力

通用 CTF 最小验收是六个独立赛道，而不是把 Misc 与 Forensics 合并：

- Web；
- Pwn；
- Reverse；
- Crypto；
- Forensics；
- Misc。

每个赛道至少保留一条真实 Judge-verified 闭环，包括材料、轨迹、Checkpoint、候选、
Judge、提示依赖、用户贡献、恢复和复盘证据。一题一赛道只表示 smoke 通过，不表示完整
CTF 成绩。

协作验收嵌入真实题目：

- 至少一题在自然卡关后由 Solver 请求 Coding Agent 工具，工具结果再交回 Solver；
- 至少一题在重复失败后由独立 Strategist 复盘、重新规划并交回 Solver 验证。

在远程 Web/Pwn 扩样本前完成动态 Endpoint 确认与窄网络边界：

- 页面或 Agent 发现的新目标只能提出申请，不能自动扩权；
- HTTP、TCP、SSH 按精确目标逐条确认并生成不可变 Scope；
- 通用 CTF Shell 默认无网络；
- 存在一个授权目标不能等价为允许 Shell 访问整个网络；
- 复杂协议经受控网络 broker/proxy 或单次批准的窄执行器。

## 4. Runtime Bench

评测拆为两个互不冒充的层次：

1. **Runtime Reliability Bench**：优先使用自建安全 fixture，验证多轮规划、文件、普通
   开发命令、工具、恢复、压缩、成本、超时、取消和失败分类；
2. **NYU CTF Outcome Bench**：六赛道真实闭环稳定后，才将正式 CTF Runtime 接到人工
   准入的安全子集。

现有 one-shot 与两回合只读 safe-static 记录只描述为 Pi Runtime smoke，不是完整
MilkSU CTF 成绩，不进入用户能力画像。

## 5. 架构约束

架构债不建立独立的“大重构里程碑”，采用触碰即拆分：

- 做 Endpoint/Memory UI 时拆 `CTFPage.vue` 对应状态；
- 修改网络、LSP 或 Computer Use 时拆 `bridge-policy.js` 对应策略；
- 扩平台 Browser/Judge 时拆 `internal/browsercap/manager.go`；
- 修改恢复语义前拆 CTF Runner / Recovery；
- `app.go` 只保留 Wails 桌面 Facade 和 DTO 转换。

必须持续保持：

- 领域层不依赖 Wails；
- Pi Runtime 不知道平台页面细节；
- 平台 Adapter 不决定学习成功或用户能力；
- 新纵切不能继续给巨型文件增加新的职责。

## 6. 本地交付

数据安全、异常退出标记、脱敏日志和问题诊断属于开发期基础。Developer ID、hardened
runtime、公证、stapling、签名升级包、升级失败回滚和全新 macOS 用户安装属于外部
Beta/正式版发布门。

窗口和性能必须先定义支持矩阵与基线，再设置回归阈值；不使用“支持小窗口”或“优化包体”
这样的无验收目标。

## 文档纪律

- 本文件是唯一当前执行顺序；
- 状态文档只记录已验证事实，不维护第二份 backlog；
- ADR、带日期 Review、Research 和设计稿保留历史语境，不自动成为当前任务；
- 开发过程中只保留测试、轨迹、回执、Checkpoint 和必要 ADR；
- 功能与真实验收完成后，再统一更新架构图、里程碑、状态和发布说明。
