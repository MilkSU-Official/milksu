# 前端视觉 QA 真实任务验收记录

> 文档状态：**Evidence / Dated acceptance record**。
>
> 验收状态：2026-08-03 旧 Wails + 独立 Chrome 进程时代的 MilkSU 自身项目
> 前端纵切 1/1；
> 该记录不得计入当前 Electron 内置浏览器的验收进度。
>
> 边界：本记录只固化一次已经完成的真实 MilkSU 任务，不把 Skill 已加载、自动化 fixture
> 或单张截图当作整体完成，也不代表当前 Electron 内置浏览器、Browser Use、
> Computer Use 或其他项目已经验收。
>
> 当前完成度与剩余缺口以代码、测试、Git 历史和[当前开发目标](./current-objectives.md)为准。

## 验收对象

| 项目 | 记录 |
| --- | --- |
| 日期 | 2026-08-03 |
| 项目 | MilkSU |
| 任务基线 | `5bfb8c1 feat: surface abnormal desktop recovery` |
| Browser Session | `browser_beeb61c4-d42b-4406-b099-40110237a6fd` |
| 证据目录 | `.milksu/browser-evidence/browser_beeb61c4-d42b-4406-b099-40110237a6fd/` |
| 预览地址 | `http://127.0.0.1:3000` |
| Viewport | `1440×900`、`1080×680` |

任务通过打包 MilkSU 的普通 Coding 会话运行，使用正式隔离 Coding Browser 与
`milksu-playwright` MCP。预览服务由项目内命令启动，没有借用用户登录态浏览器，也没有为
验收另造第二套 Browser Runner。

## 已验收流程

真实任务完成了以下操作：

1. 阅读当前仓库和前端测试约束，确认工作区基线；
2. 启动本机 Vite 预览服务；
3. 在两个支持的 Viewport 检查 Coding 与 Settings；
4. 覆盖导航、点击、键盘操作、响应式布局与可访问性快照；
5. 保存页面截图、布局审计、Console 和 Network 汇总；
6. 检查 Settings 的普通状态切换和脱敏持久化表现；
7. 停止任务后确认项目源文件没有变化。

任务最终报告记录：

- Console 为 0 error、0 warning；
- 999 条 Network 请求均为 200，失败数为 0；
- 工作区保持干净；
- 证据路径指向当前 Browser Session，而不是临时外部目录。

主 Agent 随后独立复核了证据目录元数据：

- 目录存在且不是符号链接；
- 共 48 个非空普通文件；
- 没有证据文件通过符号链接逃逸；
- 截图、页面快照、Console/Network 汇总和布局审计均存在。

主 Agent 还实际查看了：

- `coding-empty-1080x680.png`：三栏 Coding 布局、输入区和权限栏在最低支持尺寸内可见，
  没有明显裁切或重叠；
- `settings-general-1080x680.png`：设置导航和本地数据区域在最低支持尺寸内可见，没有
  明显裁切或重叠。

本次复核没有读取 Provider Credential，也没有把任何 Key 写入验收记录。

## 结论与剩余门槛

这次任务满足当时 `frontend-visual-qa` 对 MilkSU 自身项目的真实 Browser、双 Viewport、
交互、Console、Network、截图和证据路径要求，因此历史记录为：

- MilkSU 前端纵切：**通过（1/1）**；
- 用户授权的其他项目前端纵切：**未在这份历史记录中执行**。

当前完成条件只以 [`coding-browser-acceptance.md`](./coding-browser-acceptance.md) 为准。
本页不再维护一条独立的“1/2”进度。

Computer Use 当前仍需用户在 macOS 中一次性授予 Accessibility 与 Screen Recording。
这是独立的系统权限验收，不计入本次 Browser 结果，也不能由“替我审批”绕过。
