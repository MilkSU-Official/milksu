# ADR-0008：Vue 3、Memoh UI 与 Challenge Desk

日期：2026-07-30
状态：Accepted；配色部分已被后续黑绿产品主题取代，Vue、Memoh 依赖与 Challenge Desk
信息架构仍有效。当前视觉事实见 `/architecture/`。

## 背景

M3 早期控制面把比赛选择、题目列表、Agent 对话、环境、证据、提交和复盘同时放在一个页面。虽然底层 Runtime 能力存在，首屏却没有明确的下一步；这不适合作为用户第一次接触 MilkSU 的入口。

团队同时决定把桌面视图层从 React 迁移到 Vue 3，并复用 Memoh 产品正在使用的组件与颜色，而不是继续维护 MilkSU 自己的 shadcn/Base UI 派生组件。

## 决策

1. Wails、Go application service、Runtime Projection、Sidecar 和事件协议保持不变；迁移只替换 L1 视图层。
2. `memohai/ui` 以 git submodule 固定到 Memoh 主仓库当前使用的 gitlink。应用通过 `@felinic/ui` 直接导入 `ActionCard`、`Button`、`Input`、`SettingsSection/Row`、`SegmentedControl`、`Table`、`Badge` 等组件。
3. 根元素显式设置 `data-color-scheme="memoh"`。暖白 canvas、纯白内容面、炭黑正文、低对比 hairline 和稀疏紫色 brand 均来自 Memoh 的语义 token；MilkSU 不复制第二套十六进制调色板。
4. 训练场默认进入连续的 Challenge Desk：
   - 页头用一个可扩展下拉选择训练来源；NSSCTF/CTFshow 提供搜索和题型筛选，规划中平台提供明确状态页，自定义题目独立进入本地 Intake；
   - 左侧使用完整本地目录的分页题目列表，题号只是统一搜索条件，不是单独入口；
   - 右侧展示所选题面、材料状态与 Coach/Copilot/Delegate；
   - “用 Agent 开始”才进入包含观察、证据、提交闸门和复盘的 PI 工作台。
   - 题名前缀系列与推荐保留作辅助组织，不阻挡用户按平台原有心智模型选题。
5. 真实平台判题仍决定 Outcome。UI 可以引导、记录和显示状态，不能把模型输出当成 Accepted。

## 性能口径

Vue 3 并不自动保证任何页面都比 React 更快。这个迁移的首要收益是：

- 与选定组件库使用同一框架，减少适配层；
- Composition API 让事件订阅、可恢复 Projection 和页面状态更直接；
- 删除 React、React DOM、React i18n、Base UI 和 shadcn 运行依赖；
- 通过列表/详情分栏和进入 Agent 后再展示运行事实，减少首屏同时活跃的交互状态。

当前生产构建的 JS 为约 202 kB（gzip 约 68 kB），CSS 为约 133 kB（gzip 约 23 kB）。后续性能结论必须继续以 bundle、首屏渲染和交互测量为依据，而不是只根据框架名称。

## 代价

- `memohai/ui` 是源码包，`npm install` 会从固定 submodule 制作本地 package copy；宿主 Vite 必须把其 `#/*` alias 指向该 copy，Tailwind 必须扫描 package 源码；
- 本地依赖安装必须同时满足应用与 UI 子模块的锁文件；
- Challenge Desk 会保持题库列表常驻，不以最少 DOM 为唯一目标；性能应由后端分页、可见行数和真实交互测量保证；
- 历史 ADR 中的 React 描述仍保留为当时决策记录，当前实现以本 ADR 和应用 README 为准。
