# 安全工具设置生产界面视觉验收

final result: passed

## 视觉源与实现证据

- 主详情参考：`docs/design/milksu-security-tools-settings-master.png`。
- 配置进度参考：`docs/design/milksu-security-tools-settings-option-3.png`。
- 生产组件默认态：`docs/design/audits/milksu-security-tools-settings-production.png`。
- 生产组件进度态：`docs/design/audits/milksu-security-tools-settings-production-progress.png`。
- 对照视口：参考图 1487 × 1058；实现 1488 × 1056，device density 1×。
- 状态：夜间主题；真实 `SettingsPage` 与 `SecurityToolsSettingsPanel`；预览层只模拟 Desktop RPC 数据与事件。

## 对照结论

| 对照点 | 结果 | 说明 |
| --- | --- | --- |
| 三栏骨架 | 通过 | 复用生产 `AppSidebar` 与设置分类栏，安全工具目录和详情保持主从结构。 |
| 信息层级 | 通过 | 大标题、短说明、工具状态、详情、能力、单组操作依次展开，没有把安装日志或完整 Schema 常驻首屏。 |
| 配置状态 | 通过 | 开始准备后由事件进入百分比、四步时间线与当前步骤；不是前端假计时。 |
| 颜色语义 | 通过 | 酸绿用于安全工具焦点、进度与成功状态；普通 Switch 继续使用项目现有蓝色选择控件 token。 |
| 字体与密度 | 通过 | 复用 Barlow Condensed、Inter 与现有中文回退；1488 × 1056 下无截断或溢出。 |
| 核心交互 | 通过 | 工具切换、启停、重新检测、准备、健康检查、Coding 草稿交接和 Schema 展开均连接生产方法。 |

## 浏览器证据

- 页面身份为 `MilkSU · 安全工具设置预览`，URL 为本地生产组件预览入口，Vite error overlay 和浏览器 console error 均为 0。
- 切换到 capa 后显示“已加入自动能力目录”；展开 Schema 可见真实 `capa_analyze` 工具名。
- 点击“准备 IDA MCP”后，页面进入 60% 进度态：检测与激活完成，固定版本 MCP 正在配置只读工具，健康检查等待中。
- 默认态与进度态均在同一 1488 × 1056 视口截图，并与两张选定参考图在同一次视觉比较中核对。

## 有意保留的差异

- 参考图把 Switch 画成酸绿；生产实现保留共享 UI 的蓝色选中态，避免在单一页面改写全局选择控件语义。
- 参考图的 IDA 默认详情直接显示配置步骤；生产实现把能力详情与运行中的配置步骤分为两个真实状态，未开始时不会伪装成正在安装。
- 生产全局 rail 和设置分类栏沿用当前产品宽度，不为一张概念图单独改变导航几何。

## 验证结果

- Go 全仓：通过。
- Vue：72 个测试文件、396 个测试通过。
- Sidecar / Desktop / Browser Extension：216 个测试通过。
- Vue lint：通过；仅保留 `ChatPage.vue` 既有的 `no-useless-escape` warning。
- 生产前端 build：通过。
- 无剩余 P0、P1 或 P2 视觉问题。
