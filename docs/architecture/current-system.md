# 当前系统与分层

> Current。2026-09-25。不安排任务。发行回执见 [当前开发目标](/developer/current-objectives)。产品 UI 只写在 `AGENTS.md`。

```text
React → Electron Preload / Desktop RPC → Go Application Service → Domain / Runtime → Adapter
```

Electron 主窗口跑产品 renderer。右栏浏览器是同壳的会话隔离 `WebContentsView`。Go 是受管 Runtime，不拥有 GUI，也不拥有通用模型循环。Pi 与 DeepSeek Harness 拥有会话、压缩和工具循环。MilkSU 持有桌面授权、凭据、领域事实和 Judge。

两个内核：Pi `@earendil-works/pi-coding-agent` 0.87.0；DSH `@deepseek-ai/dsh` 0.1.6-alpha.1（ACP）。新对话二选一，出厂 Pi。

## 桌面执行表面

| 表面 | 对象 | 边界 |
| --- | --- | --- |
| 浏览器 | 会话隔离 `WebContentsView` | 不是用户 Chrome |
| Browser Use | 用户选定的 Chrome/Edge 标签 | 不拿整个 Profile，不替代 Judge |
| Computer Use | macOS/Windows 可见窗口；Linux 仅 GNOME Portal | 动作后台 AX 优先，无 AX 节点走像素，前台只兜单个动作；不替代另外两面。Hyprland/Xorg 不可用 |

面板折叠不停止 Session。

## 数据放哪

产物在各系统文档目录 `MilkSU/{Coding,CTF,CVE,Lab}`。Runtime、凭据、Obelisk、浏览器 Profile 在用户配置目录。

用户长期记忆全应用一份，只记这个人。某道题、某个 CVE、某次实验室作业的结论留在该作业里，不进长期记忆。仓库规矩留在项目里。Obelisk 只存其他会话的原文，供看板娘按当前这句话检索。

TokenFlux 只走 `https://tokenflux.dev/v1`。Provider Key 不进 renderer、模型上下文、日志或文档。

## 入口

| 做什么 | 从哪读 |
| --- | --- |
| 桌面壳 | `desktop/main.cjs`、`desktop/preload.cjs` |
| Go RPC | `cmd/milksu-backend/` |
| Pi | `sidecar/pi/bridge.js` |
| 看板娘 | `sidecar/companion/`、`internal/companion/` |
| CTF | `internal/ctf/` |
| 打包 | `scripts/package-sidecar.mjs`、`scripts/package-electron.mjs` |
| 发版 | [三端打包与发版流程](/developer/release-process) |
| 产品回归 | [产品回归循环](/developer/product-regression-loop) |
