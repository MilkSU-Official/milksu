# 战术档案 UI 视觉验收

final result: passed

## 视觉源与方法

- 定稿图：`docs/design/game-ui/tactical-archive-approved.png`
- 对照视口：1536 × 1024
- Desktop：Vite 浏览器巡检 CTF、CVE、Coding、个人资料、设置；最终仍需打包 Beta 做原生壳复检。
- Admin：Vite fixture 以 Browser/IAB 检查用户列表、选中用户档案和主题切换。

## 对照记录

| 对照点 | 定稿图 | 实际实现 | 处理 |
| --- | --- | --- | --- |
| 三栏骨架 | 固定左 rail、中央指挥区、右档案 | Desktop Coding 与 Admin 均保持三栏 | 通过共享 shell 与 inspector 实现 |
| 材质分层 | 黑色碳黑命令面、暖中性纸档案 | 使用两张独立 raster 材质，不以 CSS 假造纹理 | 已实现并打包进资源 |
| 任务层级 | 大标题、阶段轨、目标带、活动、输入 | 领域 Coding 空态由 `MissionOperationPanel` 完整承载 | 已实现 |
| 颜色语义 | 蓝色动作、酸绿目标/选中、橙色注册点 | 共享 token 约束 Desktop/Admin | 已实现 |
| 组件几何 | 斜切页角、硬边、低圆角 | Topbar、列表选中、档案、输入台均已改造 | 已实现 |
| 字体 | 压缩标题 + 中性正文 + 等宽微标 | Barlow Condensed + Inter + SF Mono | 已实现 |
| 日间模式 | 纸质内容区，深色指挥组件仍保留 | Desktop 实测主题切换后保持黑/纸双层 | 已实现 |
| Admin | 用户表与右侧用户档案 | 实际 fixture 首屏与方案同语法，保留管理交互 | 已实现 |

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
P0/P1/P2 视觉差异。原生 Beta 的最终分支、Commit、tracking ID 和运行状态在交付阶段另行记录。
