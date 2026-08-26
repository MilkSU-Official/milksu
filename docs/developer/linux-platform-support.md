# Linux 四发行版支持合同

> 文档状态：Target / Designed
>
> 目标范围：Ubuntu 24.04、Debian 13、Omarchy、当前仍受支持的 NixOS stable
>
> 最后审阅：2026-08-26
>
> 本文记录 Linux 安装面与 Computer Use 的产品边界。它不是实施队列，也不把计划写成已验证能力。
> 当前发行事实仍以 [当前开发目标](current-objectives.md)、[文档状态](document-status.md)、当前代码和真实平台回执为准。

## 决策

1. “支持四个发行版”先表示普通用户能从对应安装面装上 MilkSU，并在真实桌面跑通 Coding / CTF / CVE / 实验室的 Pi 工作循环。它不表示四个环境具有同等 Computer Use、Browser Use、本地 OCR 或 Secret Service。
2. Ubuntu 与 Debian 共用同一份 `.deb`，必须在两边都做过真实安装，不能假定 Ubuntu 专用包名、Chrome 路径或依赖。Omarchy 用原生 PKGBUILD / pacman，包同一份通用 Linux 目录。NixOS 用 flake 包装同一目录，不要求用户拆 DEB。
3. 不恢复 ISSUE #19 的 X11 `cua-driver --permission-mode bounded` 路径。Linux 产品代码不运行 `xinput detach/disable`，不把 root/uinput 或 `/dev/input` 做成隐式后门。
4. Host Computer Use 在 Linux 上保持 unavailable，直到某个后端在真实桌面证明：系统或 compositor 授权、停止/崩溃后物理键鼠仍可用、不摘除物理设备。GNOME Wayland 的 XDG Desktop Portal 是隔离研究对象，不是已准入的生产路径。Portal 是否能提供与 macOS/Windows 同等的 App/Window Scope 尚未证明；未证明前不得写成“精确 Scope”。
5. Hyprland（Omarchy 默认桌面，NixOS 也可选）在上游 RemoteDesktop + ConnectToEIS 成为可依赖的正式能力，并经过真机验收前，只承诺应用能安装运行。产品 UI 显示 Host Computer Use 暂不可用。
6. 第一轮正式 Linux 包仍是 x86_64。Apple Silicon 上的 ARM64 虚拟机可以做协议/门户可行性，不能给 x86_64 安装包背书。Omarchy 当前官方安装是 x86_64。
7. NixOS 没有 Ubuntu 式 LTS。不要把某个即将 EOL 的 `yy.mm` 钉成与 Ubuntu 24.04 对等的支持承诺；flake 必须随当时仍受支持的 nixpkgs 通道重验。Omarchy 是滚动发行，安装面随官方包仓走，不做冻结版本号。
8. 嵌套 Wayland session、Hyprland 私有协议后端、CDP 附着外部 Electron App，都不是四发行版安装合同的一部分。以后若做，各自走设计准入；成功也不能写成四发行版 Computer Use 完成。

## 当前事实

正式发行 `v26.825.1` 的 Linux 产物只有一个在 `ubuntu-24.04` GitHub-hosted runner 上构建的 `linux/amd64` DEB。自动化验证了包结构、Node/Pi Sidecar、Go Runtime 和 Xvfb Electron 启动；没有真实 GNOME/Hyprland 桌面回执。发布脚本明确记录 `localOcr: false` 与 `computerUse: false`。

- `internal/computercap` 只允许 macOS 与 Windows；其余平台 `unavailable`。
- Sidecar 只有 `linux/amd64` Node runtime；Linux 没有已审阅的 `@napi-rs/system-ocr` 原生包。
- Browser Use 已按 PATH 查找 Google Chrome、Chromium、`chromium-browser` 和 Edge，但 `MILKSU_CHROME_PATH` 仍只是隐藏开发兜底。
- Provider Credential 仍由本地 `credentials.db` 承载；Linux Secret Service 没有接入。

因此“有一个 DEB”不能写成“四个发行版已支持”。

## 支持矩阵

第一轮以 x86_64 为基线。能力分三层，分开验收，互不做完成门。

| 环境 | 安装面 | 应用与 Pi 工作循环 | Host Computer Use |
| --- | --- | --- | --- |
| Ubuntu 24.04 · GNOME Wayland | `.deb` | 当前切片的对照面（已有 Ubuntu + Xvfb 烟测） | unavailable；Portal 仅隔离研究 |
| Debian 13 · GNOME Wayland | 同一 `.deb` | **当前切片**：容器/真机 `dpkg` 安装 + Pi 启动 | unavailable |
| Omarchy · Hyprland | PKGBUILD / pacman | 以后单独开切片 | unavailable |
| NixOS（当时仍受支持的 stable）· GNOME 或 Hyprland | flake + 通用 Linux 目录 | 以后单独开切片 | unavailable |

Ubuntu / Debian 的 Xorg 会话只做负向验收：Computer Use 保持不可用，不运行 `xinput`。Fedora、openSUSE、KDE、Sway、Debian XFCE/MATE 不在首轮承诺里；代码应按能力探测自然降级。

### 1. 安装、启动与通用工作循环

普通用户从安装面进入，不依赖 checkout、隐藏环境变量或手工拆包。共同完成线：安装、首次启动、重启、升级、卸载；GitHub 登录或本机 Provider；Coding 的文件、Shell、Git、附件、终端、内置浏览器与 Pi 工具回合；CTF / CVE / 实验室进入同一通用循环；路径走 XDG / 平台 API。

### 2. 凭据、浏览器与 OCR

这些能力独立验收，不能由应用启动回执代替。未做之前保持准确 unavailable，设置页用现有平台门控文案，不预建通用 capability descriptor。

### 3. Computer Use

按显示协议与 compositor 实现，不按发行版写四份后端。NixOS 可能是 GNOME 或 Hyprland，不能只测一个桌面就声明“NixOS Computer Use”。

ISSUE [#19](https://github.com/MilkSU-Official/milksu/issues/19) 保持 open，直到真实桌面后端证明：不碰 `xinput`、不摘物理设备、停止/崩溃后键鼠仍可用。关闭说明必须是“X11 后端拒绝合入；替代路径已通过崩溃恢复验收”，不能是“已经写了计划或开了工作项”。

GNOME Portal 若只能给出显示器级输入，就不能冒充现有 App/Window Scope。届时另开产品决策，没有该决策时继续显示不可用。研究 helper 不进入 release 默认启动；失败则保留结论，不把实验依赖留在生产图。不另开 `computercap` 平台后端清理里程碑；只有某个 Linux 后端真正准入时，才在现有 `Manager` 里加适配。

## 安装结构

从一个不可变 source commit 生成与包管理器无关的 Linux staging tree，再分别打 DEB、pacman 包和 flake 所用通用归档。GitHub Release 只发布到授权的 `MilkSU-Official/milksu`。没有单独授权时，不向 AUR、nixpkgs、Omarchy 仓库或其他上游提交包。x86_64 与 arm64 是独立产物与回执。

## 当前切片

在 Debian 13 上安装现有 `linux/amd64` DEB：`dpkg`/`apt` 能解析依赖并完成安装；打包的 Go Runtime 与 Pi Sidecar 能启动。这证明 Ubuntu 构建的 DEB 不是 Ubuntu-only。

2026-08-26 本机用 `debian:13` amd64 容器对 `v26.825.1` 包跑通 `scripts/verify-linux-deb-debian13.sh`：`apt-get install --no-install-recommends` 成功，Sidecar `create_session` 返回 `ready`，Go Runtime 报 `ready`。这不是 GNOME 桌面回执。安装脚本已接到 `linux-release.yml`。electron-builder 默认 `Recommends: libappindicator3-1` 是 Ubuntu-only，后续 Linux 包改为空 recommends。

本切片不包含：GNOME 真桌面 GUI、Secret Service、OCR、Computer Use、PKGBUILD、flake、ARM64 发行包。容器里的 `dpkg` 成功不能写成 Debian GNOME 桌面已验收。

Xvfb、容器、按钮存在、Portal 在线、模型自述成功或一次截图，都不能替代以后各层自己的真实桌面回执。

## 尚未建立的事实

- Debian、Omarchy、NixOS 还没有正式 MilkSU 安装包回执；
- Linux Secret Service、本地 OCR 与 Computer Use 仍未实现；
- GNOME Portal 尚未证明满足窗口范围、自窗口排除和崩溃恢复；
- Hyprland RemoteDesktop 尚未成为可依赖的正式上游能力；
- Linux ARM64 尚未进入发行合同。

在这些事实形成前，README、下载页、`current-system.md` 与 Release Notes 继续只写 `v26.825.1` Linux x64 试用 DEB 的准确边界。
