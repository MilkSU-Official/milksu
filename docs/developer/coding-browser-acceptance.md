# Coding Browser 真实证据验收

> 状态：可执行的本机 Chrome + 正式 Playwright MCP 集成验收。
>
> 边界：这是 Browser 与前端 QA 的自动化基线，不替代打包 MilkSU 中的真实用户任务成功率
> 验收，也不代表 Computer Use 或用户登录态浏览器。

## 自动化纵切

运行：

```bash
npm run test:coding-browser
```

将这条真实 Browser 验收纳入完整工程回归：

```bash
MILKSU_BROWSER_INTEGRATION=1 npm run m3:release-check
```

保留临时工作区和证据供人工检查：

```bash
MILKSU_KEEP_BROWSER_FIXTURE=1 npm run test:coding-browser
```

验收使用 `internal/browsercap.Manager` 启动一个新的隔离 Chrome Profile，再把后端生成的精确
回环 CDP Endpoint 交给正式 `createFirstPartyPlaywrightMcpServer`。MCP 仍通过 MilkSU 的
macOS 沙箱运行，测试不会改用另一套 Browser Runner。

本地页面会产生一个预期 Console Error 和一个预期 HTTP 503。自动化必须完成：

1. 导航到本机页面并读取可访问性快照；
2. 点击语义明确的 Verify 按钮并观察 `Verified`；
3. 在 `1080×680` 和 `1440×900` 分别保存 PNG；
4. 保存最终快照、Console 和 Network 证据；
5. 验证 Console 包含固定错误，Network 包含固定 503；
6. 验证全部文件都位于当前 Session 的
   `.milksu/browser-evidence/<session-id>`，且为非空普通文件；
7. 确认生产 Adapter 排除 `browser_run_code_unsafe`。

本验收不访问外部站点，不使用用户 Cookie、浏览器登录态或 Provider Credential。未安装
MilkSU 支持的 Chrome/Chromium 时会明确失败；默认 `m3:release-check` 不强制安装浏览器，
只有显式设置 `MILKSU_BROWSER_INTEGRATION=1` 才启用本 Gate。

## 打包 App 人工验收

在一个用户明确授权、能够启动本机预览服务的普通前端项目中：

1. 在 Coding 任务中启用隔离 Browser，并选择“替我审批”；
2. 请求 Agent 修改一个可见的小交互，并执行 `frontend-visual-qa`；
3. 确认普通导航、快照、点击、Resize、Console、Network 和截图不产生无意义的逐次审批；
4. 确认 Agent 报告测试命令、路由、两个 Viewport 和证据相对路径；
5. 从 Coding 右栏打开证据目录，核对截图、Console 和 Network；
6. 确认页面没有新的意外 Console/Network 失败；
7. 停止隔离 Browser 后，旧 CDP Endpoint 不再复活，也不继承用户登录态浏览器会话。

“工具存在”“Skill 已加载”或只生成一张截图都不能算通过。至少要完成一次 MilkSU 前端纵切
和一次用户授权的其他项目前端纵切，才能进入成功率对照。

已完成的真实任务按次固化在
[前端视觉 QA 真实任务验收记录](./frontend-visual-qa-acceptance.md)，当前只计入 MilkSU
自身项目，不提前计入尚未执行的其他项目。
