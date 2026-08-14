# 本地交付基线

> 文档状态：**Evidence / Living Runbook**。
>
> 验收状态：pre-release 可复跑基线，不是 Release Candidate 门禁。
>
> 边界：记录打包 App 的启动、空闲内存、逻辑体积、窗口下限、无 Provider 首启和脱敏失败
> 路径；同时设置保守 pre-release 回归阈值。Developer ID、公证、升级、全新无开发工具机器
> 和正式 RC 性能承诺仍在 RC 阶段验收。
>
> 当前完成度与剩余缺口以代码、测试、Git 历史和[当前开发目标](./current-objectives.md)为准。
>
> 当前基线（2026-08-10）：自动化入口使用 Electron/Chromium 打包 App。

## 自动化入口

先构建当前原生 App，再运行：

```bash
npm run test:local-delivery
```

将它作为完整工程回归中的真实 App Gate：

```bash
go test ./...
npm run test:sidecar
npm --prefix app test -- --run
npm run sidecar:smoke
npm run desktop:build
npm run test:local-delivery
npm run codesign:check
```

只验证 pre-release 阈值报告结构，不启动 App：

```bash
MILKSU_LOCAL_DELIVERY_THRESHOLD_FIXTURE=1 node scripts/test-local-delivery-baseline.mjs
```

脚本使用打包后的 `build/bin/MilkSU.app`，不会启动第二套测试壳。它会：

1. 检测已有 MilkSU App，但使用独立 Instance ID 与数据目录启动测试实例，不打断用户会话；
2. 创建一次性的空白 `HOME` 和 `TMPDIR`，不读取现有设置、会话或 Provider Credential；
3. 使用不包含 Provider 环境变量的最小环境启动打包 App；
4. 以 `lifespan.json` 的正式 `running` 状态确认 Electron 已拉起受管 Go Runtime 并完成生命周期
   初始化；
5. 等待两秒后采样 App 及子进程 RSS；
6. 发送 `SIGTERM`，验证 Electron 等待受管 Go Runtime 完成关闭，并将同一运行标记改为 `clean`；
7. 统计 App、打包 Sidecar、前端产物和最大文件的逻辑字节；
8. 验证当前窗口仍为默认 `1440×900`、最低 `1080×680`；
9. 用保守阈值检查启动、RSS、App/Sidecar/frontend 体积、最大前端 chunk 和进程数；
10. 写出忽略于 Git 的 `build/test-results/local-delivery-baseline.json`。

测试只读取自己创建的 `lifespan.json`，不会读取临时或现有凭据库内容。首次启动没有
Provider 配置，脚本也不触发模型请求；这证明 MilkSU 可以在无模型配置时打开和关闭，不
等价于物理断网环境的完整回归，也不表示模型能力可以离线工作。

## 2026-08-10 Electron/Chromium 基线

环境为 Apple Silicon macOS（Darwin 25.5.0）。重新打包的 `build/bin/MilkSU.app` 在隔离 Instance、
空白数据目录和无 Provider 环境下由同一脚本连续完成两次实测；第二次运行时另有一个用户 MilkSU
实例存在，但测试实例仍使用独立身份和数据目录：

| 指标 | 观察值 | Pre-release 上限 |
| --- | ---: | ---: |
| 启动至 Go Runtime lifespan 标记 | 663–3,442 ms | 5,000 ms |
| 启动后两秒 App 进程树 RSS | 400.5–409.3 MiB | 512 MiB |
| App 未压缩逻辑体积 | 628.8 MiB | 700 MiB |
| 其中打包 Sidecar 未压缩逻辑体积 | 327.1 MiB | 400 MiB |
| 前端 dist 未压缩逻辑体积 | 3.3 MiB | 4 MiB |
| 最大前端 JS/CSS chunk | 1.35 MiB | 2 MiB |
| 运行进程数 | 5 | 6 |
| 正常退出标记 | `clean` | 必须为 `clean` |

窗口源码门禁同时确认默认 `1440×900`、最低 `1080×680`。这些阈值是回归 tripwire，不是产品
性能承诺；它们只覆盖当前单机和 ad-hoc 签名包。

当前 App 最大单文件包括 Electron Framework 182.6 MiB、Node Runtime 115.4 MiB、Computer Use
Driver 51.5 MiB、`gopls` 39.0 MiB、Coding Bridge 22.2 MiB 和 Go Runtime 21.7 MiB。当前最大的
前端 chunk 为：

| Chunk | 逻辑体积 |
| --- | ---: |
| 相关历史语义图 | 1.35 MiB |
| 主入口 JS | 412.6 KiB |
| Coding Terminal JS | 350.1 KiB |
| Chat Page JS | 166.8 KiB |
| CTF Page JS | 158.7 KiB |
| 主样式 | 157.0 KiB |
| Markdown JS | 138.3 KiB |

语义图仅在完整图谱视图懒加载。后续只有真实启动、内存、下载或更新成本证明收益时，才单独进入
Sidecar 去重或 chunk 优化纵切。

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
- 全新 macOS 用户、没有 Node/Go 等开发工具的安装验收；
- Developer ID、hardened runtime、notarization、stapling；
- 签名升级源、旧版升级、升级失败回滚与离线升级降级。

上述项目仍属于正式发行阶段，不能用本基线提前宣称通过。
