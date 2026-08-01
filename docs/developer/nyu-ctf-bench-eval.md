# NYU CTF Bench：安全的离线评测元数据适配器

> 状态：Metadata adapter implemented；runner deliberately absent
> MilkSU schema：`milksu.evalbench.* / v1alpha1`

## 用途

NYU CTF Bench 在 MilkSU 中只用于开发者比较模型与 Harness，不进入用户训练题库，也不计入个人能力画像。

当前适配器只完成三件事：

1. 从用户提供的本地 checkout 读取 `development_dataset.json` 或 `test_dataset.json`；
2. 记录模型/Harness 的摘要级外部运行结果；
3. 按 split、category、模型/Harness 配置聚合静态 JSON 报告。

它不启动挑战容器、不运行 Agent 或模型命令、不读取挑战附件、不读取 `challenge.json` 内容、不提取或验证 Flag，也不保存 Prompt、命令、Transcript、模型输出或 Exploit。运行结果的权威性固定标记为 `reported-not-verified`，不能冒充 MilkSU 的独立 Judge 回执。

## 固定上游

| 字段 | 固定值 |
| --- | --- |
| 官方仓库 | <https://github.com/NYU-LLM-CTF/NYU_CTF_Bench> |
| Release | `v20250206` |
| Commit | `1dc13a0dc41a71504f727649679e2b5a6d0cb1b1` |
| License | `GPL-2.0-only` |
| 论文 | [NYU CTF Bench（NeurIPS 2024 Datasets and Benchmarks Track）](https://proceedings.neurips.cc/paper_files/paper/2024/file/69d97a6493fbf016fff0a751f253ad18-Paper-Datasets_and_Benchmarks_Track.pdf) |

MilkSU 不复制、修改或重新分发数据集及其 Python runner。适配器是独立实现的 JSON 消费者；用户自行提供遵守上游许可证的本地 checkout。若以后需要打包、派生或分发上游内容，必须单独做许可证审查。

官方 README 将 development split 描述为 55 题，但上述固定 commit 的 `development_dataset.json` 实际有 57 个索引项；`test_dataset.json` 有 200 个索引项。适配器不硬编码数量，而是以固定 revision 的实际索引为准，并把差异保留为数据质量事实。

## 导入契约

入口为 `internal/evalbench.ImportNYUCTFBenchCatalog(root, split)`。

适配器只接受上游索引中的五个字段：

| 字段 | 作用 |
| --- | --- |
| `year` | CSAW 年份 |
| `event` | `CSAW-Quals` 或 `CSAW-Finals` |
| `category` | `crypto / forensics / misc / pwn / rev / web` |
| `challenge` | 展示名称 |
| `path` | checkout 内的相对任务目录 |

目录必须位于所选 split 下，路径必须已经规范化，Symlink 解析后仍须位于 benchmark 根目录。每个目录必须含一个常规 `challenge.json` 文件，但适配器只验证它存在，绝不打开它；因此上游 JSON 中的 Flag、服务地址、Compose 与附件不会进入 MilkSU 的评测元数据。

本地绝对路径只存在于进程内的 `Task.Directory`，其 JSON 标记为 `json:"-"`，不会进入导出的 Catalog 或 Report。

## Run schema

`RunRecord` 只保存：

- 固定 benchmark revision、split 与 task ID；
- model provider/name/revision；
- harness name/version 与配置 SHA-256；
- 开始和结束 UTC 时间；
- turns、tool calls、input/output token 数；
- `completed / failed / cancelled`；
- 外部报告的 `solved / unsolved / unknown`。

约束如下：

- `completed` 只能搭配 `solved` 或 `unsolved`；
- `failed`、`cancelled` 只能搭配 `unknown`；
- `resultAuthority` 必须为 `reported-not-verified`；
- 解码使用严格 schema，任何额外字段都会被拒绝，尤其不会接受 command、prompt、flag、transcript 或 model output 扩展。

这使 Run 文件可以比较模型/Harness，却不能被后续代码恢复成可执行攻击步骤。

## 静态报告

`internal/evalbench.Aggregate` 是纯数据函数。它验证：

- Catalog 均来自固定 NYU CTF Bench revision；
- 每条 Run 指向已导入的 split/task；
- Run ID 不重复；
- 所有运行记录都满足摘要级 schema。

输出按名称稳定排序，包括：

- 总任务、已尝试任务和外部报告已解任务；
- completed/solved/unsolved/failed/cancelled 计数；
- split 与 category 汇总；
- model + harness + config digest 配置汇总；
- 仅基于 completed runs 的 `reportedSolveRate`。

报告没有生成时间和本机路径，因此同一组输入得到逐字节一致的 JSON。它也不计算 Pass@k：在没有记录 sampling group、种子和一致预算前，计算 Pass@k 会制造不可比较的指标。

开发者可以用只读报告入口消费一个本地 checkout 和零到多条摘要 Run Record：

```bash
go run ./cmd/nyu-ctf-bench-report \
  -root /path/to/NYU_CTF_Bench \
  -split development \
  -run /path/to/run-a.json \
  -run /path/to/run-b.json \
  -out /path/to/report.json
```

省略 `-run` 会得到只含 Catalog 维度的空基线报告；省略 `-out` 则把 JSON 写到标准输出。
这个命令只读索引、目录形状和摘要 Run Record，不执行挑战或模型。

## 与产品的边界

- `development` 可用于内部选择 Prompt、工具与 Harness；`test` 只用于版本验收。
- 当前没有 Wails API、普通用户 UI 或自动 runner。
- 若后续增加 runner，必须放在独立包与显式开发者开关后，并另行完成容器、安全策略、Judge 权威性和安全测试；不能把 runner 偷塞进这个元数据适配器。
- NSSCTF 的真实平台 Judge 和用户学习记录仍走 CTF Runtime，不与 benchmark 的 `reported-not-verified` 结果混用。

## 测试证据

`internal/evalbench` 的单元测试使用从零构造的最小目录和 JSON：

- 证明 task 顺序、Catalog/Report 编码可复现；
- 证明无效的 `challenge.json` 不会被读取；
- 拒绝路径穿越和越界 Symlink；
- 拒绝未知索引字段和可执行 Run 扩展；
- 拒绝未知 task、重复 run 与不一致终态；
- 证明导出不泄漏本地绝对路径。
