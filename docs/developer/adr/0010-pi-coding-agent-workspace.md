# ADR-0010：PI Coding Agent 工作区

> 文档状态：**Historical ADR**。保留 Coding 工作区建立原因；当前权限、能力与自举缺口见
> [Coding / Pi 扩展边界](/architecture/coding-agent-pi-extension-boundary)、代码、测试和 Git 历史。
>
> 状态：Accepted（2026-07-31）

## 背景

M3 Product Shell 仍把 `任务运行时 M1` 暴露为一级入口，同时“新建对话”只提供文本收发。前者是用于证明追加事件、恢复和 Evaluator 的工程观察面，不是用户目标；后者又主动关闭了 PI 的全部 Coding Tools，因此不能承担正常 Coding Agent 的工作。

用户侧的三个稳定目标应是：

1. 在真实 CTF 题目上训练；
2. 让通用 Agent 进入一个项目完成编码任务；
3. 追踪并研究 CVE。

## 决策

### 用户信息架构

一级导航固定为 `CTF / CVE / Coding`。Milestone 编号和 Runtime Walking Skeleton 不再出现在产品界面。会话搜索与最近任务只在 Coding 中显示，不占用 CTF 和 CVE 的注意力。

Runtime、Event Store、Artifact 和恢复机制继续作为内部基础设施保留；删除的是用户入口与页面，不是底层事实链。

### 项目授权

Coding Agent 在任务开始前让用户通过原生目录选择器明确选择项目。该目录成为 PI 的工作目录；未选择时使用 MilkSU 自己的临时沙盒。任务发出第一条消息后目录锁定，切换项目需要新建编码任务，避免同一会话的上下文和文件权限悄悄漂移。

### PI 能力

通用 Agent Sidecar 启用 PI 的：

- `read`
- `bash`
- `edit`
- `write`
- `grep`
- `find`
- `ls`

工具调用的关键输入与结果通过现有 JSONL 事件桥显示在会话中。用户可以停止正在生成或执行的回合。PI SessionManager 使用 MilkSU 应用数据目录中的持久 JSONL 会话，并用 MilkSU Conversation ID 恢复同一任务。

项目根目录的 `AGENTS.md` 会作为项目指令载入。扩展、用户级 Skills、Prompt Templates 和 Themes 仍默认关闭，避免桌面产品在没有产品控制面的情况下继承不可见的本机配置。

设置页保存 Provider 凭据后会运行一次 45 秒有界的真实模型探针：启动同一套 PI Sidecar、选择用户指定模型并完成一个禁用工具的最小响应。成功结果按 Provider、模型和时间写入非敏感设置元数据；更换模型、密钥或 Relay 状态会自动使旧结果失效。验证失败只向用户展示有界首行，不泄漏 Sidecar 堆栈；Sidecar 进程级中断会结束全部受影响会话的运行态并写入可恢复的错误消息，不能让界面永久停在“生成中”。

### 进程与权限

开发模式下 Sidecar 以所选项目为 `cwd`。打包模式下固定 Node Runtime 只获得：

- Sidecar bundle 的读取权限；
- 所选项目与 MilkSU Agent 数据目录的读写权限；
- Coding Agent 所需的 child-process 权限。

目录选择代表用户对本机编码任务的明确授权。`bash` 是正常 Coding Agent 能力，不宣称为容器沙箱。

CTF Security Sidecar 保持独立：它继续关闭 PI Built-in Tools，只暴露 MilkSU 的类型化 CTF Capability。2026-07-31 的 [ADR-0012](0012-ctf-pi-workspace-and-trajectory.md) 进一步允许用户把已接纳的 CTF Challenge 显式交给通用 PI，但只在 MilkSU 创建的固定单题工作区中运行，并把轨迹与候选回流到 CTF Runtime；该 CTF 路径在 macOS 上额外使用工作区文件门禁、命令超时、脱敏子进程环境和 Seatbelt sandbox，但不冒充原 Security Sidecar 的类型化能力，也不宣称本机 Shell 是容器或 VM。

## 验收

1. 产品侧不再出现 `任务运行时` 或 M1/M3 标签。
2. Coding Agent 能选择项目，并明确展示当前工作目录。
3. 打包 Sidecar 的 smoke test 确认七个 Coding Tools 均已注册。
4. 工具调用与结果可见，运行中的回合可停止。
5. 删除任务时同时删除对应的 PI 持久会话文件。
6. Security Sidecar 的协议测试继续返回 `inheritedTools: []`。
7. 保存 Provider 后能直接验证模型；凭据缺失、模型不存在、网络失败和超时都给出有界反馈。
8. Sidecar 进程退出后，所有受影响会话都离开运行态并持久化失败原因。
