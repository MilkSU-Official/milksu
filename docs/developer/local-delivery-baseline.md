# 本地交付基线

> 文档状态：**Evidence / Living Runbook**。
>
> 验收状态：pre-release 可复跑基线，不是 Release Candidate 门禁。
>
> 边界：记录打包 App 的启动、空闲内存、逻辑体积、窗口下限、无 Provider 首启和脱敏失败
> 路径；同时设置保守 pre-release 回归阈值。Developer ID、公证、升级、全新无开发工具机器
> 和正式 RC 性能承诺仍在 RC 阶段验收。
>
> 动态完成度与剩余缺口以[目标覆盖台账](./objective-coverage-ledger.md)为准。

## 自动化入口

先构建当前原生 App，再运行：

```bash
npm run test:local-delivery
```

将它作为完整工程回归中的真实 App Gate：

```bash
MILKSU_APP_INTEGRATION=1 npm run m3:release-check
```

只验证 pre-release 阈值报告结构，不启动 App：

```bash
MILKSU_LOCAL_DELIVERY_THRESHOLD_FIXTURE=1 node scripts/test-local-delivery-baseline.mjs
```

脚本使用打包后的 `build/bin/MilkSU.app`，不会启动第二套测试壳。它会：

1. 拒绝在已有 MilkSU App 进程运行时继续，避免打断用户会话；
2. 创建一次性的空白 `HOME` 和 `TMPDIR`，不读取现有设置、会话或 Provider Credential；
3. 使用不包含 Provider 环境变量的最小环境启动打包 App；
4. 以 `lifespan.json` 的正式 `running` 状态确认 Wails `OnStartup` 已进入并完成生命周期
   初始化；
5. 等待两秒后采样 App 及子进程 RSS；
6. 发送 `SIGTERM`，验证 Wails `OnShutdown` 将同一运行标记改为 `clean`；
7. 统计 App、打包 Sidecar、前端产物和最大文件的逻辑字节；
8. 验证当前窗口仍为默认 `1440×900`、最低 `1080×680`；
9. 用保守阈值检查启动、RSS、App/Sidecar/frontend 体积、最大前端 chunk 和进程数；
10. 写出忽略于 Git 的 `build/test-results/local-delivery-baseline.json`。

测试只读取自己创建的 `lifespan.json`，不会读取临时或现有凭据库内容。首次启动没有
Provider 配置，脚本也不触发模型请求；这证明 MilkSU 可以在无模型配置时打开和关闭，不
等价于物理断网环境的完整回归，也不表示模型能力可以离线工作。

## 2026-08-03 首条基线

环境为 Apple Silicon macOS（Darwin 25.5.0）。同一构建连续执行三次，并在两次完整 M3
重新打包后各执行一次，观察到：

| 指标 | 观察值 |
| --- | ---: |
| 启动至正式 lifespan 标记 | 155–949 ms |
| 启动后两秒 App 进程树 RSS | 107.4–117.7 MiB |
| App 未压缩逻辑体积 | 347.0 MiB |
| 其中打包 Sidecar 未压缩逻辑体积 | 327.2 MiB |
| 前端 dist 未压缩逻辑体积 | 1.8 MiB |
| App / Sidecar 文件数 | 2,797 / 2,793 |
| 运行进程数 | 1 |
| 正常退出标记 | 5/5 `clean` |

这些值受文件缓存、机器负载和构建方式影响。当前阈值只用于发现明显 pre-release 回归：

| Gate | Pre-release 上限 |
| --- | ---: |
| 启动至正式 lifespan 标记 | 5,000 ms |
| 启动后两秒 App 进程树 RSS | 192 MiB |
| App 未压缩逻辑体积 | 450 MiB |
| 打包 Sidecar 未压缩逻辑体积 | 400 MiB |
| 前端 dist 未压缩逻辑体积 | 4 MiB |
| 最大前端 JS/CSS chunk | 512 KiB |
| App 进程树进程数 | 3 |

这些不是正式发行承诺。启动指标是生命周期初始化标记，不等价于首屏完全可交互时间；空闲 RSS
只统计 MilkSU 进程树，不包含 macOS 共享的 WebKit 系统进程。后续至少在发布目标机器矩阵上
重复冷启动、热启动和首屏交互测量，再冻结 RC 上限。

`local-delivery-baseline.json` 中的 `performanceThresholds` 还包含当前单机 support matrix
entry。现在只有 Apple Silicon macOS 被标为 `measured-pre-release-baseline`；多机器、
Intel/macOS 版本矩阵仍等待 RC 阶段重复实测。

当前体积主要来自 Sidecar，而不是前端：

| 产物 | 逻辑体积 |
| --- | ---: |
| Node Runtime | 115.4 MiB |
| Computer Use Driver | 51.5 MiB |
| `gopls` | 39.0 MiB |
| Coding Bridge | 22.2 MiB |
| MilkSU 原生可执行文件 | 18.0 MiB |

当前最大的前端 JS/CSS chunk：

| Chunk | 逻辑体积 |
| --- | ---: |
| 主入口 JS | 378.5 KiB |
| Coding Terminal JS | 349.5 KiB |
| CTF Page JS | 169.5 KiB |
| 主样式 | 149.7 KiB |
| Markdown JS | 139.4 KiB |
| Chat Page JS | 112.3 KiB |

这张表用于后续对照，不把“最大文件存在”本身判定为缺陷。前端拆分和 Sidecar 去重只有在
真实启动、内存、下载体积或更新成本证明有收益时才进入优化纵切。

## 无 Provider 首启、离线失败与诊断边界

自动化还覆盖两层负向路径：

- Engine 将模型验证失败限制为首行、最多 320 个 Unicode 字符，并对 Key、Bearer、
  Token、Secret 和带凭据 Query 进行脱敏；回环端口拒绝仍保留可操作的
  `connection refused` 原因。
- Settings 在设置已经保存、随后模型验证离线失败时明确显示“凭据已保存”，不会把保存失败
  和网络验证失败混成一个状态。

既有 `internal/appdata` 回归继续验证异常退出识别、脱敏事件白名单、日志轮转、诊断包不含
会话正文/工具原始输出/凭据，以及备份恢复入口。这个纵切复用这些实现，不增加第二套诊断
格式，也不扩大持久化内容。

## 尚未完成

- 多台支持机器的冷启动、空闲内存和 App/升级包下载体积 RC 阈值；
- `1080×680` 及更多尺寸的原生 App 人工视觉与键盘回归；
- 全新 macOS 用户、没有 Node/Go/Wails 等开发工具的安装验收；
- Developer ID、hardened runtime、notarization、stapling；
- 签名升级源、旧版升级、升级失败回滚与离线升级降级。

上述项目仍属于正式发行阶段，不能用本基线提前宣称通过。
