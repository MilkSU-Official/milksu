# 浏览器执行表面真实证据验收

> 文档状态：**Evidence / Living acceptance contract**。
>
> 当前边界：只记录 MilkSU 管理的“浏览器”执行表面；Browser Use 与 Computer Use 必须分别验收，
> 不能用本页结果代替。
>
> 当前完成度与剩余缺口以代码、测试、Git 历史和[当前开发目标](./current-objectives.md)为准。

## 当前打包 App 验收

当前至少要在打包 MilkSU 中覆盖：

1. 用户在右栏直接导航和操作真实网页，Agent 经同一 Target 读取、点击、输入并回读结果；
2. Agent 开始任务后折叠右栏，聊天进度和浏览器动作继续；重新展开时仍是同一页面与最新状态；
3. 至少各保留一项点击任务、表单任务和公开资料调研结果，记录是否回退 Shell、是否需要人工接管；
4. Profile、下载、弹窗、页面权限、崩溃和停止走明确负向路径，旧 Target 在停止后不可复活；
5. 浏览器不继承用户真实 Chrome/Edge 登录态，Browser Use 也不继承 MilkSU 浏览器 Profile；
6. 页面内容只作为不可信 Observation，不能凭网页文字扩大 Scope、执行外部攻击或建立 CTF Judge 成功。

“工具存在”“Skill 已加载”、旧外部 Chrome fixture、模型自述成功或只生成一张截图都不能算通过。
至少要保留打包 App 中的真实页面终态、工具轨迹、面板折叠期间的连续执行证据和重新展开后的同一
Session 状态，才能把对应任务记为通过。

### 2026-08-10 已保留结果

| 场景 | Agent 结果 | 折叠连续性 | 人工接管 / Shell |
| --- | --- | --- | --- |
| 顺序点击 CTF-like fixture | 按页面提示完成四步，取得 `flag{browser_agent_ok}` | 第 2 步后折叠，继续完成；重新展开仍见最终 flag | 无 / 无 |
| 表单 fixture | 填写项目、类型、备注与确认框，取得 `FORM_OK:MilkSU:browser-qa:collapsed-continuity` | 工具开始后折叠，继续提交；重新展开仍见字段和回执 | 无 / 无 |
| Electron 官方资料调研 | 读取 `WebContentsView` 与 `BrowserView` 官方页面，正确识别后者已弃用并给出迁移含义 | 导航开始后折叠，继续查阅与归纳；页面状态保留 | 无 / 无 |

同一轮还验证了裸 `google.com` 会补全为 HTTPS，普通文本会进入 DuckDuckGo 搜索。公开 X 页面只做
可达性 spot-check；没有继续验证登录、发布、私有内容或长期站点兼容，不能把它写成完整通过。

这组结果证明的是当前 macOS ARM64 打包 App 中的页面控制和面板显隐生命周期。下载、弹窗、权限拒绝、
renderer 崩溃/恢复、显式停止后的旧 Target 失效和 Windows 仍需各自的负向证据。

新浏览器任务必须按当前 Electron 路径单独记录，不复用旧外部 Chrome 或 Wails 时代的结果。
