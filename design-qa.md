# 战术档案 UI 视觉验收

final result: passed

## 视觉源与方法

- 定稿图：`docs/design/game-ui/tactical-archive-approved.png`
- 对照视口：1536 × 1024
- Desktop：先用 Vite 浏览器巡检，再在干净提交 `9d8e9f84b8c562e9680054439b91f7c55ffa6456` 打出的 `MilkSU Beta` 中用 Computer Use 复检原生壳、真实本地数据与隐藏状态。
- Admin：Vite fixture 以 Browser/IAB 检查用户列表、选中用户档案和主题切换。

## 对照记录

| 对照点 | 定稿图 | 实际实现 | 处理 |
| --- | --- | --- | --- |
| 三栏骨架 | 固定左 rail、中央指挥区、右档案 | Desktop Coding 与 Admin 均保持三栏 | 通过共享 shell 与 inspector 实现 |
| 材质分层 | 黑色碳黑命令面、暖中性纸档案 | 使用两张独立 raster 材质，不以 CSS 假造纹理 | 已实现并打包进资源 |
| 任务层级 | 大标题、阶段轨、目标带、活动、输入 | 领域 Coding 空态由 `MissionOperationPanel` 完整承载 | 已实现 |
| 颜色语义 | 酸绿动作、目标与选中，蓝色只用于链接和执行/诊断信息 | 共享 token 约束 Desktop/Admin；任务阶段和活动状态也已收回酸绿体系 | 已实现 |
| 组件几何 | 斜切页角、硬边、低圆角 | Topbar、列表选中、档案、输入台均已改造 | 已实现 |
| 字体 | 压缩标题 + 中性正文 + 等宽微标 | Barlow Condensed + Inter + SF Mono | 已实现 |
| 日间模式 | 纸质内容区，深色指挥组件仍保留 | Desktop 实测主题切换后保持黑/纸双层 | 已实现 |
| Admin | 用户表与右侧用户档案 | 实际 fixture 首屏与方案同语法，保留管理交互 | 已实现 |
| 隐藏面板 | 抽屉、右栏、浮层仍属于同一战术工作台 | 会话抽屉与领域上下文、浏览器、变更、架构、相关历史等共用 `TacticalPanelShell`；CTF 历史位于 overlay 层 | Beta 原生复检通过 |
| 窄屏 | 信息重排，不把主任务挤出可视区 | 右栏在不足空间时覆盖主区；任务标题、目标、阶段轨和简报按容器宽度折行与重排 | 1120 × 760 复检通过 |
| 模块标题 | CTF / 挑战与 CVE / 漏洞成对出现 | CTF、CVE 首页均使用模块绿字加白色中文标题 | Beta 原生复检通过 |

## 文案差异

定稿图中的 `Baby_Reversing`、示例步骤和附件属于特定 CTF 数据，不作为静态文案写死。实际页面从
当前任务结构化上下文读取标题、目标、类别、来源和材料；无任务时保持原产品空态。未新增与功能无关
的可见营销文案。

## 有意保留的差异

- Electron 顶部红黄绿由桌面壳拥有，不在 Web 预览中伪造。
- Admin 右栏显示真实额度管理控件，而不是复制 CTF 简报字段。
- Desktop 一般 Coding 无领域任务时不展示虚假的四阶段进度，只在 CTF/CVE 接力中展示。

## 结论

结构、材质、字体、操作色、目标色、斜切几何、日间主题和关键交互均已按定稿方案实现；没有剩余
P0/P1/P2 视觉差异。原生 Beta 已确认 `channel=beta`、`tree=clean`，最终视觉修正提交为
`26dd96e5b7e12f00a3cfd0c8eb08396a0a4ce7bc`，追踪号为
`445f59964ccb81e815dfcf8b7b1f55eacd4ca6f09c647c70395d820f6446bcd9`。Computer Use 实际打开并检查了
设置追踪、CTF 历史、CVE 首页、CVE 接力、会话抽屉、右栏页面选择、浏览器、变更和架构图空态。
