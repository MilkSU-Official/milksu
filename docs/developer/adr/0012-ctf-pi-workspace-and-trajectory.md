# ADR-0012：CTF 单题工作区、PI 解题交接与轨迹回流

> 文档状态：**Historical ADR**。开源项目比较和 M3 取舍是 2026-07-31 快照；当前六赛道
> 验收和 subagent 策略见[当前目标](/developer/current-objectives)。
>
> 状态：Accepted for M3 MVP（2026-07-31）

## 背景

能力雷达和题目推荐只能回答“今天练什么”，不能回答“选中后怎样真的开始”。此前 CTF 页的 Security Sidecar 只有材料读取、确定性解码、提示和候选提交等窄能力；它适合验证类型化 Runtime，却不足以覆盖真实 Web、Pwn、Reverse、Crypto 与 Forensics 题目。

MilkSU 已经有可用的 PI Coding Agent：项目目录、文件工具、Shell、可见工具输出、停止和会话恢复都已验证。M3 不应再维护第二套残缺的通用 Agent Loop，而应把 CTF Challenge 安全、可恢复地交给 PI，再把 PI 的运行事实回流到 CTF Runtime。

## 2026 CTF Agent 开源实现复核

本决策只吸收目标一致、能进入 MilkSU 事实链的机制；项目方公布的解题率和比赛名次均视为自述。

| 项目 | 成熟机制 | MilkSU 的取舍 |
| --- | --- | --- |
| [BoxPwnr](https://github.com/0ca/BoxPwnr) | 多平台 Adapter、多 Solver、Docker 执行器、回合/时间/价格预算、Attempt 目录、恢复摘要和轨迹回放 | 采用平台与 Solver 解耦、运行检查点、退出原因和累计指标；M3 不把宿主工作区误称为 BoxPwnr 的 Docker 隔离 |
| [verialabs/ctf-agent](https://github.com/verialabs/ctf-agent) | Competition Poller、每题 Solver、独立 Docker、类别工具、发现共享、运行中操作员消息和循环检测 | M3 采用“每题一个工作区、操作员可随时介入、预算和循环检测”；没有可靠沙箱与单 Agent 基线前不做 Solver 竞速 |
| [NYU D-CIPHER / nyuctf_agents](https://github.com/NYU-LLM-CTF/nyuctf_agents) | Planner、Executor、Auto-prompter 分工；限制 Executor 可见观察数；保存轮次、成本、退出原因和结构化日志 | 采用有界上下文、显式退出原因和可恢复进度；暂不增加三 Agent 编排复杂度 |
| [HackSynth](https://github.com/aielte-research/HackSynth) | Planner 与 Summarizer 循环、Docker 命令超时、输出截断和压缩历史 | 采用失败签名、输出有界与基于事实的交接摘要；摘要不能替代原始轨迹 |
| [Cybench](https://github.com/andyzorigin/cybench) | Guided/Unguided 两种评测、最大迭代与 Token、从日志恢复、Research Plan 与 Log | 采用协作模式与运行预算分离、工作区笔记和轨迹恢复；训练提示依赖单独进入 Human Outcome |
| [Alias Robotics CAI](https://github.com/aliasrobotics/CAI) | Agent、Tool、Handoff、Turn、Tracing、Guardrail、HITL，以及运行中人工遥操作 | 采用 Handoff、Turn Budget、Tracing 和不终止会话的人工接管；不把整个框架或通用任意目标能力引入核心 |
| [Amazon Science Cyber-Zero / EnIGMA+](https://github.com/amazon-science/Cyber-Zero) | `challenge.json`、可选 Compose 环境、统一 benchmark、轨迹与 Evaluation | 采用机器可读 Challenge Contract 和可重放轨迹；数据合成不是当前桌面产品主线 |
| [ljagiello/ctf-skills](https://github.com/ljagiello/ctf-skills) | 按题型延迟加载解题方法、可复现工作目录和持续记录 | 采用轻量类别 Playbook 与 `notes.md`；不把庞大工具集直接装进用户宿主机 |
| [TransilienceAI Community Tools](https://github.com/transilienceai/communitytools) | 用版本化 Markdown Skills 做跨模型、benchmark 驱动的能力改进 | 采用“真实轨迹失败 → 更新 Playbook → 固定题回归”的迭代方式；不默认加载未经审查的用户级 Skill |

共同结论仍是：模型与多 Agent 数量不是第一瓶颈。题目契约、材料组织、工具工作区、预算、循环停止、候选闸门、平台 Judge 与可回放轨迹才是先决条件。

## 决策

### 1. 每题建立稳定的 Challenge Workspace

用户选择题目后，MilkSU 在应用私有数据目录为 CTF Job 建立固定工作区：

```text
challenge.json
AGENTS.md
TASK.md
notes.md
candidate-flags.txt
materials/
work/
evidence/trajectory.jsonl
evidence/run.json
```

- `challenge.json` 保存 Job、题目、来源授权、知识点、材料哈希和预算；
- `materials/` 只导出 Runtime 已接纳并重新核对 SHA-256 的材料；
- 每份材料在导出时先做只读预检：识别文本、常见二进制和 ZIP/Tar/Tar.gz/Gzip，记录条目数、声明展开体积、路径逃逸、链接、可执行权限、高压缩比和类型不一致；
- 可安全处理的归档随后进入应用私有的临时目录，逐条执行规范化路径和实际写入字节上限检查，只提交普通文件，统一去掉执行权限并以 `0600` 写入 `materials/extracted/`；路径清单保存到 `materials[].extractedPaths`；
- 含逃逸路径、链接、特殊文件、重复路径、加密条目或超过 2048 条目/64 MiB 实际展开上限的归档整包不展开，原件和拒绝原因仍保留；
- `AGENTS.md` 是可信运行约束和按类别选择的最小 Playbook；
- `TASK.md` 把题面明确标为不可信数据，并从不可变 Scope 与工作区 Manifest 生成精确授权目标和材料清单；
- `notes.md`、`work/` 和候选文件在再次准备工作区时不会被覆盖；
- `evidence/run.json` 是可从 JSONL 和工作区文件重建的运行检查点，保存模型、退出原因、累计回合、工具调用、错误、候选数量与摘要；它只保存候选 SHA-256，不复制原始 Flag；
- 会话 ID 从 Job ID 确定性派生，因此同一题再次打开会恢复同一个 PI 会话；
- 重新准备已经产生轨迹、候选或非 `ready` 检查点的工作区时，Handoff 必须返回恢复 Prompt，而不能再次伪装成首次开始。

这仍不是容器或 VM。CTF 的 PI Shell 仍是用户本机子进程，但在 macOS 上必须经 Seatbelt `sandbox-exec` 启动：文件写入只允许题目工作区，读取只允许题目工作区和系统/Homebrew 工具链，命令环境会移除模型密钥等 Sidecar Secret。没有动态 `origin / socket / lab` Scope 时网络默认关闭；存在动态目标时当前只做到“允许本回合联网”，尚不是按主机、端口精确收口的内核级网络 allowlist。因此 MilkSU 不宣称任意附件和远程目标已达到容器级隔离。

Arena 返回的 HTTP、TCP 或 SSH 动态端点只有在解析、标准化并进入 `source.scope.targets` 后才显示为授权环境；题面里偶然出现的地址不会因为一段文字自动扩权。材料清单展示导出路径、安全展开路径、检测类型、哈希与预检提示，Agent 不必从自然语言猜测附件状态。

### 2. PI 成为默认真实解题 Agent

公开 NSSCTF 和 Arena Intake 都使用 `deferAgent=true`，不再自动启动旧的窄能力 Runner。工作台的默认动作是“用 PI 开始解题”：

1. 准备或刷新 Challenge Workspace；
2. 建立带题目固定目录的 Coding Agent 会话；
3. 让 PI 读取任务契约、材料和已有笔记；
4. PI 使用 `read / bash / edit / write / grep / find / ls`、确定性的 `ctf_capabilities / ctf_decode / ctf_triage / ctf_inspect`，以及按 Scope 启用的 `ctf_http / ctf_socket` 在 `work/` 中分析并持续记录；
5. 用户可像普通 Coding Agent 一样追问、提供线索和停止回合。

旧 Security Sidecar 保留作类型化 Capability、离线 fixture 和基准对照，不再冒充真实题目的主 Solver。

`ctf_capabilities`、`ctf_decode`、`ctf_triage` 与 `ctf_inspect` 是随 Sidecar 打包、无需用户先安装 Kali 环境的确定性基线：工具探测只检查固定目录中一份审查过的常见 CTF 命令清单，避免模型虚构工具可用性；单步解码只在 Agent 明确指定时执行 Hex、Base64、Base32、URL、ROT13 或二进制字节转换，返回长度、SHA-256 和确定性内容，不自动枚举链或宣称结果是 Flag；材料分诊对整批材料做有界清点；单文件检查只读取本题工作区内不超过 16 MiB 的普通文件，提供类型、SHA-256、字节熵、可打印比例、编码线索、最多 200 个字符串或最多 4096 字节的十六进制窗口。它们不会执行样本，也不替代后续容器化 Pwn/Reverse/Forensics 工具包；Coach 也可使用它们获取事实而无需获得 Shell。

`ctf_http` 和 `ctf_socket` 是首批类型化远端能力。它们只有在不可变 Scope 中分别存在 `origin` 或 `socket` Target 时才进入工具集：HTTP 必须与授权 Origin 完全相同，不附带浏览器 Cookie 或模型凭据、不自动跟随重定向，单次请求具有 30 秒和 1 MiB 上限；TCP 必须与授权 `host:port` 完全相同，只发送一次不超过 256 KiB 的载荷并有界读取。它们让 Coach 也能获得可审计的基线观察，同时不会因为题面文本出现一个地址而扩权。多步协议仍应写成工作区脚本，继续受 Shell 与 Scope 契约约束。自制工具和 Agent 间交接见 [ADR-0014](/developer/adr/0014-ctf-tool-workshop-and-memory)。

### 3. 人工介入是 CTF 会话的一等能力

用户不应先学会怎样写一段高质量 Agent Prompt 才能开始训练。CTF PI 会话在普通输入框之上提供四个紧凑的快捷协作动作：

- `梳理题面`：暂停执行，只总结目标、现有证据与第一步；
- `提示 1`：只指出一个证据或概念，不给命令、完整解法或候选；
- `提示 2`：给出一个可执行、可验证的下一步实验，不透露候选；
- `重新规划`：读取笔记与轨迹，显式整理已证伪假设、有效证据和信息增益最高的下一步。

这些动作走同一 PI 会话和预算，不创建旁路 Agent。提示动作同时以级别写入 CTF Human Outcome，因此能力画像、复盘和推荐能区分“独立推进”与“依赖提示”。Conversation 持久化 `ctfJobId` 与协作模式，退出应用后仍能恢复正确的提示契约；按钮只是结构化人工消息，不绕过 Workspace、Tool Policy 或 Judge。

### 4. 轨迹必须回到 Runtime

聊天不是 CTF 事实。MilkSU 保存 PI 的模型选择、工具输入、工具结果、错误和完成消息到 `evidence/trajectory.jsonl`；流式 delta 不重复写入。每次事件同步刷新原子写入的 `run.json`，因此进程重启后仍能知道上次结束原因、累计指标和交接摘要。每个完成回合同时提交：

```text
Attempt(pi)
  → Step(pi-coding-agent-turn)
  → Action(ctf.pi_agent_turn)
  → Observation(final summary)
  → Artifact(JSONL trajectory)
  → Evidence(replayable PI turn)
```

因此训练页的实验、制品和证据来自同一 Runtime，退出后仍可复核。Projection 还暴露 `agentRuns`，其中的工具调用、错误、工具分布和轨迹摘要从 JSONL 确定性计算，不采信模型自报。

按需读取的 `AgentReplay v1alpha1` 会重新核对检查点会话、从完整 JSONL 计算指标，并返回有序的 session、tool、assistant 与 error 事件。单条文本和错误分别限长，事件总数有上限，UI 不需要直接解析或无限载入原始轨迹文件。

### 5. 候选只能通过显式文件进入 Judge

MilkSU 不从自然语言回答里用正则猜 Flag。PI 必须把候选逐行写入 `candidate-flags.txt`；回合完成后只读取最后一个有效候选，并先保存为 `agent.candidate` Role Fact：

- 候选成为内容寻址 Artifact，但此时还不是一次平台提交；
- 候选进入事实前拒绝控制字符，并产生 `plausible / unusual` 格式评估；异常格式只警告、不擅自阻断题目自定义 Flag；
- 训练 UI 可以载入它，解释引用 PI 笔记与轨迹；提交闸门会明确展示“格式正常”或逐条异常原因，但不会把自定义格式伪判为不可提交；
- 只有用户实际点击提交时才读取平台当前错误次数，并进入 `PrepareExternalSubmission` 的 `needs_review` Evaluation；
- 已进入提交历史的相同候选会在按钮前标记等待判题、已拒绝、已通过或不明确，用户必须先处理现有回执或修改候选，避免用一次失败交互才发现后端去重；
- 只有 NSSCTF Arena、已绑定页面或用户确认的外部 Judge 回执能产生 Pass。

PI 不能直接调用平台提交，也不能自报成功。

### 6. M3 最小运行闸门

每个工作区根据协作模式写入机器可读 Policy，并由发送入口执行相应预算：

- **教练**：48 个完成回合 / 60 分钟 / 2 个已确认错误候选；先追问用户观察，每轮只给一个最小提示；
- **搭档**：36 个完成回合 / 50 分钟 / 3 个已确认错误候选；共同列假设，一次做一个实验，在方向分叉处停下协商；
- **代理**：24 个完成回合 / 45 分钟 / 3 个已确认错误候选；可在授权范围内连续推进，但在边界或重复失败时停下；
- 教练在 PI 底层不注册 Shell；搭档和代理才注册 `bash`。三种模式都保留工作区内的读取、搜索和笔记工具；
- CTF 的全部文件工具在执行层规范化绝对路径、解析现存祖先和符号链接，拒绝工作区外路径；普通 Coding Agent 不套用这条 CTF 限制；
- 搭档和代理的 Shell 默认超时 120 秒，模型最多只能请求 300 秒；输出继续受 PI 的 2000 行/50 KiB 截断，Sidecar 单次工具事件最多回传 60 KiB，完整截断输出写入题目工作区的私有临时目录；
- Shell 子进程只获得固定 PATH、工作区 HOME/TMPDIR 和必要 Locale/证书变量，不继承 DeepSeek、OpenAI、Relay 等模型凭据；
- 同一回合连续三次完全相同的工具名和输入，或连续三次同工具同失败签名，都视为没有进展，MilkSU 保存退出原因并停止该回合。

Policy 同时进入 `challenge.json`、`AGENTS.md`、`TASK.md`、初始/恢复 Prompt 和前端说明；回合、时间与错误提交预算由发送入口检查，不只是 Prompt 文案。M3 暂不声称有精确 Token/价格预算；需要 Sidecar 暴露可靠 usage 后再加入。

训练工作台通过与发送入口相同的 `EvaluateAgentBudget` 读取 Runtime Attempt、首次 PI 回合时间和平台 Rejected 记录，展示已用/剩余回合、剩余时间与错误提交余额。状态每 30 秒刷新，点击进入 PI 前再次同步；任一硬预算耗尽时按钮在工作台直接停止，并解释是回合、时间还是错误提交触发，避免用户先进入聊天再得到迟到的拒绝。

工作台同时按需读取 `run.json` 的脱敏投影，紧凑展示上次退出状态、最后完整摘要、完成回合、工具调用和候选数量。运行记录不存在时返回空状态，不捏造恢复点。用户点击“继续 PI 解题”时复用固定会话和工作区；如果该会话当前没有正在运行的回合，MilkSU 会发送恢复 Prompt，让 PI 先读 `notes.md`、`run.json` 与现有工作文件后继续，而不是只把用户送回一段静止聊天记录。当前进程里已经运行中的会话不会被重复发送第二个回合。

### 7. 轨迹面板优先展示失败分支

CTF Projection 为每个 Experiment 暴露 `attemptId`、开始和结束时间。训练工作台按 Runtime 顺序展示 PI 回合、确定性实验、提交闸门和中断回合，并标出 Observation、模型和关联制品；候选卡同时展示 PI 写入候选文件时的解释。UI 不从聊天文本重新猜测事件。

### 8. 复盘与制品查看不能脱离证据

CTF Projection 同步生成结构化 `Debrief`，内容只来自 Runtime 中已经提交的事实：

- 完整 Observation 形成关键观察，流式残片不会进入复盘；
- 失败 Step、Action 和 Attempt 形成失败分支，并保留真实中断原因；
- 提交历史保留候选与独立 Judge Verdict；
- 提示、独立步骤、Reflection、Evidence 和 Artifact 只做确定性计数；
- Outcome 结束而用户尚未写 Reflection 时，界面要求用户用自己的话记录关键转折和下一步。

Artifact 查看器先验证制品属于当前 CTF Job，再由内容寻址存储重新核对 SHA-256。只有受支持的 UTF-8 文本类型可以显示最多 128 KiB 的只读预览；二进制、错误媒体类型和无效 UTF-8 只展示来源、哈希、类型、大小和存储标识，永不执行。

训练报告从 Projection、Workspace Manifest、运行检查点与 Replay 四份可核事实生成 JSON/Markdown，列出平台、题目、协作模式、材料哈希、工具统计、失败分支、Judge 回执与 Human Outcome。候选值会从结果、观察和回执摘要中替换，报告只保留候选数量与最新 SHA-256，避免把真实 Flag 意外带入面试材料或公开分享。

当前训练工作台还提供两个按需加载的本地档案入口：

- `运行回放` 读取受限的逐事件 PI 轨迹，默认只显示最近六条，展开时最多渲染最近一百条，避免长会话拖垮界面；
- `生成报告` 写入本机 JSON/Markdown 训练报告，展示平台验证、工具、实验和独立步骤指标，并允许复制已经隐去原始候选内容的 Markdown。

## 明确未完成

- PI Shell 尚未进入真正的容器/VM；类型化 HTTP/TCP 工具已按 Scope 精确收口，但 macOS Seatbelt Shell 一旦允许动态网络，仍未按目标主机/端口形成精确内核级 allowlist；
- NSSCTF 公共题附件已能经已登录页面显式导入，也可由用户从 Challenge Desk 补充本地截图或手动下载材料；两条路径都限长、哈希校验并进入统一归档预检与安全普通文件展开，本地选择路径不会进入训练记录；仍没有容器/VM 隔离、杀毒/格式专用静态分析、题面内远程图片自动导入，也未完成真实登录会话验收；
- CTFshow 已有登录题库同步、按题读取题面、同源附件哈希导入和浏览器 Judge Adapter；仍需在真实账号会话完成端到端验收；
- CTFshow 只有 `correct` 回执能验证本次候选；`already_solved` 仅说明账号历史状态，必须记录为不明确，不能伪造本次候选成功；
- 轨迹 UI 已显示回合、实验、候选、失败原因、结构化复盘、受限 Artifact 预览和有界逐事件回放；还没有逐工具 Diff；
- Swarm、发现消息总线、winner cancellation 和 benchmark 重跑在单 Agent 真实基线稳定后再做；
- M3 完成仍要求至少一题真实 NSSCTF 返回 `correct=true`。

## 验收

1. 推荐题或题号导入后，一键生成固定工作区并进入 PI；
2. 材料导出前后 SHA-256 一致，路径不能逃逸；
3. 再次打开同一题不会覆盖笔记和工作文件；
4. PI 的完成回合在 CTF Projection 中增加 Experiment、Artifact 和 Evidence；
5. 只有显式候选文件能进入外部 Judge 闸门；
6. 回合、时间、错误提交、重复工具调用与重复失败有程序化停止条件；
7. 退出并重启后，`run.json` 与 Runtime Projection 仍能恢复累计指标和上次退出原因；训练工作台能显示该恢复点，并从同一固定会话发送恢复 Prompt；
8. NSSCTF 与 CTFshow 都能从本地列表进入相同 Challenge Workspace 和 Judge 证据链。
9. 归档附件只在路径、条目类型和实际写入预算全部通过时自动展开为无执行权限的私有普通文件；任何危险条目使整包拒绝展开，原因必须进入机器可读预检结果。
10. 教练模式不能注册 Shell；其他 CTF 模式的文件工具拒绝绝对路径和符号链接逃逸，Shell 命令具有默认/最大超时、工作区写边界和脱敏环境；普通 Coding Agent 的既有工具能力保持不变。
11. CTF PI 会话提供题面梳理、两级提示和重新规划动作；点击提示后必须写入对应 Job 的提示依赖，重启后 Conversation 仍保留 Job 与协作模式关联。
12. Agent 可先确定性探测沙箱可见的 CTF CLI；HTTP/TCP 工具只能访问 Scope 中精确授权的 Origin 或 host:port，拒绝越界目标和自动重定向，Coach 无需获得 Shell 即可执行基线交互。
