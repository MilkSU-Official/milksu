# 项目关系词典

> 状态：概念词典。下表中的项目只是关系示例，不表示已安装、默认启用或进入当前开发范围。

开源项目写进 MilkSU 架构图，不等于把它加入依赖。每个项目必须选择一种明确关系：

| 关系 | MilkSU 做什么 | 例子 |
| --- | --- | --- |
| 接入 `adapter` | 调用已有 CLI、API、MCP 或结构化输出 | CodeQL |
| 外部 Worker `external-worker` | 委派完整 Job，再归一化 Evidence 与 Outcome | PentAGI、Shannon 候选 |
| 学习 `adapt` | 学习已验证的数据模型和运行行为，用 MilkSU 契约重做 | BoxPwnr Harness、Agentic SOC Case |
| Benchmark | 只用于任务、Judge、失败分类和对照 | ARTEMIS、CTF 数据集 |
| 拒绝 `reject` | 与 SOTA Worker 重复、收益不可验证或风险不可接受 | 只有 Prompt 人格和薄工具封装的候选 |

正式判断、项目列表和升级门槛见[开源项目坐标](/developer/industry-baseline)。
