# ADR-0006：M3 产品控制面与比赛/CVE 工作流

> 文档状态：**Historical ADR**。本页保留当时产品壳决策；CVE 当前暂停，当前导航、状态和
> 缺口以后继文档为准。
>
> 状态：Accepted for M3 Product Shell（2026-07-30）

## 背景

M2-A 和 M3-A 已经证明 CTF 与 Vuln Research 可以复用同一套可验证 Runtime，但此前桌面入口仍按“上传一道题”和“启动一个本地研究样本”组织。它们能展示底层能力，却不是用户会持续使用的产品入口：

- CTF 选手首先关心正在参加哪场比赛、有哪些题、进度和下一步，而不是先选择文件；
- 漏洞研究员首先关心哪些 CVE 值得处理、命中了哪些资产、研究推进到哪里，而不是先创建一次本地 fixture 运行。

M3 Product Shell 的目标是把已经存在的窄纵切放进正确的信息架构，同时明确区分演示数据、持久化产品状态和真实 Runtime 事实。

## 决策

### 1. 赛事优先，而不是题目上传优先

“赛事训练场”以比赛目录作为入口。用户选择比赛后，Competition Adapter 归一化比赛元数据、分类、题目、附件、连接信息、赛程和榜单，前端据此自动组装工作台。

进入比赛后的稳定结构是：

`Competition → Category → Challenge → Environment / Agent / Judge / Evidence`

题面、文件、网站和本地目录仍是 Challenge Intake 的输入通道，但不再承担顶层导航职责。当前内置比赛目录是可交互演示适配器；它验证产品流，不冒充已接入 picoCTF 或 Hack The Box 的在线账号和实时数据。

### 2. 情报队列优先，而不是本地样本启动优先

“漏洞情报”以 CVE 优先队列作为入口，并把选中项展开为：

`CVE → Severity / Exploit Signal → Affected Assets → Research Status → Research Task`

面板支持搜索、严重度筛选、资产筛选、关注、来源修订、选中项检查和研究任务建立。研究任务建立时固化情报快照、资产命中和下一步授权检查；它不会因为面板里出现 CVE 就自动运行外部触发输入。

当前 CVE 条目使用公开已知漏洞作为演示数据，但 UI 明确标记“内置演示源”。NVD、Vendor Advisory 和 CISA KEV 只是可追溯参考链接，不代表已有后台实时同步服务。

### 3. 产品状态与 Runtime 事实分层

M3 Product Shell 使用三层状态：

- 静态 Adapter 数据：比赛目录、赛题样例和内置 CVE 情报，用于确定性演示；
- 本地产品状态：关注项、筛选条件、任务是否建立和研究状态，使用版本化 localStorage 持久化；
- Runtime 事实：真实 Agent 动作、Artifact、Evidence 和 Judge/Evaluator 结果，继续由 Go Runtime 和只读 Projection 掌握。

前端可以改变“我关注什么”和“我要建立任务”，但不能自行宣称漏洞成立或任务成功。CTF 的 Accepted 仍由独立 Judge 语义表达；Vuln 的成功仍要求可引用 Evidence 与 Evaluator/Human Review。

### 4. 视觉语言服务于高密度工作

全局使用 Memoh 的暖白画布、纯白工作面、炭黑正文、低对比细分隔线和克制的紫色状态强调；主动作使用高对比黑色按钮。Challenge Desk、PI 工作台和 CVE Inspector 都以连续工作面为主，不使用装饰性卡片墙。

这个选择优先保证：

- 用户一眼知道当前位于比赛、题目还是 CVE；
- 主行动只有一个明显强调色；
- 表格、证据和进度能在桌面尺寸同时可见；
- 窄屏时导航收缩、页头分层、内容转为纵向阅读。

## 端到端演示路径

### 赛事训练场

1. 打开“CTF 训练”，选择 NSSCTF 或 CTFshow；
2. 在完整分页列表中搜索、筛选并选择题目；
3. 在右侧核对题面、材料、协作模式和平台连接状态；
4. 点击“用 Agent 开始”，系统自动生成单题 Workspace、连接信息、附件、Agent 和 Judge；
5. 在 PI 工作台形成并提交候选 Flag；
6. 独立 Judge 返回 Accepted 后更新题目状态、能力画像和复盘。

### 漏洞情报

1. 打开“漏洞情报”，按严重度、关键词或资产命中筛选；
2. 选择 CVE，检查受影响版本、利用信号、参考链接和资产命中；
3. 关注条目并建立研究任务；
4. 任务固化情报快照与授权待办，状态从“待复现”推进为“研究中”；
5. 刷新应用后任务仍可继续，但漏洞是否成立不能由这个产品状态代替证据判断。

## 面试叙事

这次迭代的重点不是“做了两个漂亮页面”，而是把技术纵切改造成用户工作流：

- 产品判断：从开发者视角的能力入口，改为用户视角的比赛与情报入口；
- 领域建模：Competition/Challenge 和 CVE/Asset/ResearchTask 两组模型共享 Runtime，但不共享错误的业务对象；
- 状态设计：演示 Adapter、本地产品状态和可验证 Runtime 事实分层，避免 UI 自报成功；
- 可扩展性：未来接平台 API 或实时 CVE Feed 时替换 Adapter，不需要重写工作台；
- 安全边界：情报追踪与研究编排不等于自动执行漏洞触发输入，外部能力仍受授权和发布门约束。

## 未完成边界

本 ADR 接受的是 M3 Product Shell，不是完整 M3。CTF 真实平台的后续决策见 [ADR-0007](/developer/adr/0007-ctf-agent-harness-and-nssctf-arena)：

- 比赛目录已支持 NSSCTF 公开单题导入，Agent Arena 已连接官方 Token、领题、恢复、提交与放弃 API；通用比赛账号、分页、平台限速和浏览器提交仍未完成；
- Arena 平台响应已经进入 Runtime Evidence/Evaluation；后续 P3879 已取得真实配对页面
  `correct=true`，当前可宣称的是这一条已验证样本，不能外推为多题型或通用解题成绩；
- 环境启动仍需接 Managed Lab 生命周期；
- CVE 数据尚未接 NVD/CISA/Vendor 的增量同步、去重和更新时间语义；
- 资产来自演示关联，不是 CMDB 或真实暴露面扫描；
- 研究任务需继续接入完整 Runtime Projection、Evidence 与恢复。

这些缺口在 UI 中不得伪装成已完成能力。
