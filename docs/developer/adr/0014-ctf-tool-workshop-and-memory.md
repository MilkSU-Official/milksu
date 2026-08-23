# ADR-0014：CTF 工具工坊、Agent 产物交接与训练记忆

> 文档状态：**Historical ADR**。主链已有实现，真实协作与 Memory 校准缺口只看当前台账；
> 正文“明确未完成”不是当前实施顺序。
>
> 状态：Accepted for M3 MVP（2026-07-31）

## 背景

真实 CTF 解题经常需要临时编写解析器、解码器、协议客户端、验证脚本或数据转换工具。只说“CTF Agent 有 Bash，所以它能写脚本”没有形成可恢复、可审查的产品能力；让两个 Agent 互相自由聊天也很容易丢失输入输出契约、测试证据和失败状态。

MilkSU 此前已经有三类持久状态：

- Runtime 的 Job、Experiment、Observation、Artifact、Evidence 与 Judge 回执；
- CTF 单题工作区的 `notes.md`、`work/`、候选文件和 PI 轨迹；
- 本机 Conversation 的可见聊天记录。

这些能恢复一次题目，却没有“旧题得到的可复用技法怎样进入新题”的明确长期记忆层。

本决策同时参考 [Obelisk](https://github.com/tommy0103/obelisk) 的公开架构。可取之处不是复制其实现，而是把原始会话当证据层、把人工确认的 Markdown 结论当可撤销的综合缓存，并用本地 SQLite 做检索索引。Obelisk 使用 AGPL-3.0；MilkSU 不复制其源码、Schema 或查询运行时，只采用这一通用分层思想并为 CTF 训练重新建模。

## 决策

### 1. Coding Agent 可以为 CTF 编写工具，但必须进入工具工坊

CTF 的搭档和代理模式本来就复用 PI Coding Agent，能够读取文件、写代码和运行受限 Shell。M3 将这项隐含能力显式化为同一道题里的固定角色会话：

- `solver`：CTF 解题 Agent，负责题面理解、假设、实验、证据与候选；
- `tool-builder`：Coding Agent 工具构建者，只负责最小辅助工具、测试和交付，不猜 Flag。
- `strategist`：独立策略复盘者，只审阅题面、轨迹和证据，诊断过早收敛与重复失败，
  输出一个信息增益最高的下一步，不执行命令、不碰候选。

三个角色共享同一个受限题目工作区，但使用不同的确定性 Conversation ID。工具工坊的轨迹写入 `evidence/tool-builder-trajectory.jsonl`，不会覆盖解题会话的 `run.json` 和 `trajectory.jsonl`。

### 2. Agent 通过文件协议交接，不通过隐式聊天同步

工作区新增：

```text
TOOLING.md
work/
├── tool-requests/
└── tools/
```

解题 Agent 在 `work/tool-requests/` 写请求，至少包含：

- `pending / ready / blocked` 状态；
- 要验证的单一假设；
- 输入、参数、允许环境和输出契约；
- 验收条件、最小 fixture、安全边界和已知限制。

工具构建者在 `work/tools/` 实现，先探测依赖，提供确定性用法、非零失败码和本地测试，再把请求更新为 `ready`。解题 Agent 恢复后重新验证工具输出并把观察写回 `notes.md`。这使同一协议以后可以承载真正的并行 Agent，而不需要改写 CTF Runtime。

界面把协议投影成明确状态：没有请求、`pending` 待实现、`ready` 待验收、`blocked`
阻塞。解题会话可以生成严格的工具请求，出现 `pending` 后入口改为“交给 Coding Agent”；
出现 `ready` 后解题 Agent 必须独立验收。Coding Agent 没有收到 `pending` 请求时不得自行
发明需求。

工具工坊的执行能力与解题协作模式分离：即使解题 Agent 处于无 Shell 的 Coach 模式，
专用 Coding Agent 也拥有离线、工作区内的沙箱化 Bash 来实际运行测试。该角色在执行层
不能写 `candidate-flags.txt`，也不会继承题目的远程网络 Scope。

普通产品回合的运行与结束状态由 Pi 原生会话生命周期负责。MilkSU 不再按文本或工具事件
另建无进展看门狗，也不会因为一段时间没有投影事件就强制中止模型调用；用户停止和独立评测
预算仍通过各自明确的取消入口处理。

### 3. 卡住时使用独立策略复盘，而不是让执行器自我说服

这一角色吸收了 [D-CIPHER](https://github.com/NYU-LLM-CTF/nyuctf_agents) 的
Planner/Executor 分工、[CAI](https://github.com/aliasrobotics/cai) 的专业角色交接和
[EnIGMA+](https://github.com/amazon-science/Cyber-Zero/tree/main/enigma-plus) 的证据保留思想，
但不复制它们的源码或引入新运行时依赖。开源对照快照已从现行文档删除，考古用 Git history。
MilkSU 的策略 Agent 使用独立 Conversation ID，只得到
`read / write / grep / find / ls`：

- 可读 `TASK.md`、`notes.md`、`MEMORY.md`、运行断点与解题轨迹；
- 只能写 `work/strategy-review.md`；
- 执行层禁止修改 `notes.md`、`candidate-flags.txt`、工具请求和工具实现；
- 没有 Shell，也不会继承题目的 HTTP/Socket Scope；
- 建议必须标明证据快照、已证伪路线、最多三个方向、唯一下一步、预期观察与停止条件。

解题 Agent 返回时先独立验证这份建议，再写入自己的事实记录。策略建议不是共享真相，
不会直接进入 Judge，也不会覆盖解题运行检查点。策略轨迹单独写入
`evidence/strategist-trajectory.jsonl`。Solver、工具构建者和策略 Agent 按各自
Conversation ID 独立计算回合与计时预算；辅助角色不会吃掉 Solver 余额，平台错误提交
预算也只约束 Solver。

### 4. 批量材料分诊是内置只读工具

新增 `ctf_triage`，在不执行样本的前提下对 `materials/` 做有界、确定性的递归清点：

- 最多 64 个文件，默认 32；
- 单文件最多 16 MiB，累计最多 32 MiB；
- 最多访问 4096 个目录项；
- 跳过符号链接、`.git`、`.milksu`、`node_modules` 和 Evidence；
- 返回相对路径、大小、SHA-256、类型、熵、可打印比例与编码线索。

`ctf_inspect` 继续负责单文件字符串和 Hex 深挖。三种协作模式都可用这两个只读工具；Coach 仍没有 Shell。

### 5. 训练记忆分成证据、综合和学习者三层

MilkSU 不把所有聊天压成一个“永远正确”的向量记忆：

1. **证据层**：Runtime、原始 PI 轨迹、工具工坊轨迹、材料哈希、Judge 回执和训练报告，保持可追溯；
2. **综合层**：用户在复盘面板明确点击“沉淀为可复用技法”后，生成一份可审查 Markdown，并在用户数据目录的 SQLite 中登记分类、标签、来源 Job、证据引用、置信度和状态；
3. **学习者层**：提示次数、独立步骤、Reflection 和能力画像继续由真实训练事实计算，不从综合记忆反推成绩。

综合记忆可以是成功技法或失败教训。写入前必须至少存在关键观察、失败分支或用户 Reflection；候选 Flag 会被替换，原值不进入记忆。相同来源 Job 再次保存会更新同一条记忆；归档只让它退出主动召回，不删除原始证据。

### 6. 新题只召回待验证先验

准备 PI 工作区时，MilkSU 从本机 SQLite 取同分类的最近高置信记忆，写入受保护的 `MEMORY.md`。系统契约明确：

- 记忆不是当前题事实或答案；
- 使用前必须通过当前材料和实验重新验证；
- 不复制旧题 Flag、Token 或其他秘密；
- 原始 Evidence 优先于综合缓存。

M3 先按分类建立有界候选集，再用题名、知识点、标签、置信度和更新时间做可解释重排；
同一 Job 不召回自己的综合记忆。训练工作台提供折叠的“解题记忆”视图，让用户知道本题
给 Agent 注入了哪些待验证先验，并可停用错误综合。M3 不引入向量数据库或远程
Embedding。等真实题目积累后，再根据误召回数据决定是否增加 FTS5、图关系或语义检索。

## 本地数据

所有新增状态都位于系统用户配置目录，而非应用包或源码目录：

```text
<user-config>/com.milksu.app/
├── ctf/memory.sqlite3
├── ctf/memories/*.md
└── ctf-workspaces/<job-hash>/
```

目录权限为 `0700`，数据库和 Markdown 为 `0600`。这延续了凭据 SQLite 和题库 SQLite 的本地优先边界。

## 明确未完成

- 尚无全局记忆管理页；单题工作台已能检查并停用本题匹配的综合记忆；
- 尚未自动从模型回答抽取技法，避免未经用户确认写入错误结论；
- 三个角色是独立 PI 会话和产物协议，但不是后台自动并行 Swarm；用户显式选择何时复盘或构建工具；
- 工具工坊轨迹已独立保存并回流 Coding Agent Turn，训练报告已列出请求状态、工具数量和
  Coding Agent 指标，但还没有为每个工具保存内容哈希、版本与完整测试矩阵；
- 召回暂按分类和显式关键词重排，没有向量语义检索、衰减学习或跨分类因果图。

## 验收

1. PI 工作区默认提供 `ctf_triage` 与 `ctf_inspect`，批量分诊不能执行或越界读取材料；
2. 同一 Job 的解题、工具构建和策略复盘会话 ID 均不同，工作区相同；
3. 工具构建者和策略 Agent 不能覆盖解题运行检查点，也不能自动写入候选；
4. 策略 Agent 没有 Shell/网络，不能改解题笔记或工具，只能留下可验证的复盘建议；
5. `TOOLING.md`、`MEMORY.md`、题面、材料和 Evidence 受执行层保护；
6. 没有观察、失败记录或 Reflection 时不能保存长期记忆；
7. 保存记忆不含候选 Flag，并能由同分类新题召回；
8. 归档记忆不再进入主动召回，原始训练 Evidence 仍保留。
