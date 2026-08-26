# Linux 安装与桌面合同

> 文档状态：Target / Designed
>
> 目标范围：Ubuntu 24.04、Debian 13、Omarchy、当前仍受支持的 NixOS stable
>
> 最后审阅：2026-08-26
>
> 本文记录 Linux 安装面与 Computer Use 的产品边界。它不是实施队列，也不把计划写成已验证能力。
> 当前发行事实仍以 [当前开发目标](current-objectives.md)、[文档状态](document-status.md)、当前代码和真实平台回执为准。

## 决策

1. “支持四个发行版”表示普通用户能从对应安装面装上 MilkSU，并在真实桌面跑通 Coding / CTF / CVE / 实验室的 Pi 工作循环。它不表示四个环境具有同等 Computer Use、Browser Use、本地 OCR 或 Secret Service，也不表示要发 8 个 arch×distro 安装包。
2. GitHub Release 的 Linux 安装包最多 4 个，默认只发 2 个能跨发行版使用的包：
   - 一份 `.deb`：Ubuntu 24.04 与 Debian 13 共用；
   - 一份 `.tar.gz`：Omarchy / Arch 用仓库里的 PKGBUILD 安装，NixOS 用仓库 flake 包装同一目录。
   PKGBUILD、`.desktop` 和 flake 是安装方法，不是额外的二进制产品。不要为每个发行版、每种 CPU 再打一份。
3. 正式发行架构仍是 `linux/amd64`。Apple Silicon 上的 ARM 虚拟机只作开发测试：ARM 上跑通后，同一代码打 x64 包。ARM DEB/tarball 可以留在本机或 CI 试验产物里，不进入 GitHub Latest。
4. Ubuntu 与 Debian 共用那份 `.deb`，不能假定 Ubuntu-only 包名。Omarchy / NixOS 不要求用户拆 DEB。
5. ISSUE [#19](https://github.com/MilkSU-Official/milksu/issues/19) 已关闭：X11 `cua-driver --permission-mode bounded` 与 `xinput detach/disable` 拒绝合入。Linux 产品代码不运行 `xinput detach/disable`，不把 root/uinput 或 `/dev/input` 做成隐式后门，也不接入 Cua Linux 驱动。Xorg 会话 Computer Use 保持 unavailable。若以后做 X11，另开 XTEST 合成事件的 issue，不复活摘设备路径。
6. GNOME Wayland 的宿主 Computer Use 走 XDG Desktop Portal 最小路径：系统授权框、截屏、按坐标点击、打字；停止或崩溃后物理键鼠仍归用户。这是整桌面级输入，不能写成 macOS/Windows 那种精确窗口 Scope。Hyprland 在上游 RemoteDesktop 可依赖之前保持 unavailable。
7. NixOS 没有 Ubuntu 式 LTS。flake 随当时仍受支持的 nixpkgs 通道重验。Omarchy 是滚动发行，安装面随官方包仓走。
8. 嵌套 Wayland session、Hyprland 私有协议后端、CDP 附着外部 Electron App，都不是本安装合同的一部分。

## 当前事实

正式发行 `v26.825.1` 的 Linux 产物只有一个在 `ubuntu-24.04` GitHub-hosted runner 上构建的 `linux/amd64` DEB。自动化验证了包结构、Node/Pi Sidecar、Go Runtime 和 Xvfb Electron 启动；没有真实 GNOME/Hyprland 桌面回执。发布脚本明确记录 `localOcr: false` 与 `computerUse: false`。

- Sidecar 只有 `linux/amd64` Node runtime；Linux 没有已审阅的 `@napi-rs/system-ocr` 原生包。
- Browser Use 查找 Chrome / Chromium / Edge、PATH、snap、Nix 与桌面入口。
- Provider Credential 仍由本地 `credentials.db` 承载；Linux Secret Service 没有接入。

本机 Apple Silicon QEMU 上的 Ubuntu 24.04 ARM64 GNOME Wayland 已看到：应用窗口、hicolor 图标（不再落到齿轮）、隔离浏览器，以及装上 Chromium 后的 Browser Use 可执行文件探测。换入本切片 Go/Sidecar 后，用户点允许桌面共享：会话 `ready`，坐标点击成功，打字写入系统设置搜索框（`milksu-portal`），停止后 Portal session 与 socket 消失、Mutter 可再 CreateSession。锁屏会抑制 RemoteDesktop。Screenshot 接口在该 virtio-gpu 上返回 code 2，画面改从已授权 ScreenCast 流取出。

Debian 13 ARM64 Hyprland 0.55.2（trixie-backports，virtio-gpu）：tarball 应用在 `ozone-platform=wayland` 下启动，Hyprland `hyprctl clients` 可见 class `milksu`。Computer Use 为 unavailable，文案写明 Hyprland 暂不可用、不走 xinput。Hyprland 上 `ready-to-show` 可能不触发，Linux 会在 5 秒后 `show()`。这是试验回执，不是 GitHub Latest。

NixOS 26.05 ARM64 GNOME 图形 live（virtio-gpu）：同一 ARM tarball 经 `packaging/linux` flake/`default.nix` 的 FHS 包装后，在 Wayland 上启动并显示出登录页。FHS 需要 `libgbm`（以及 fontconfig / freetype / gdk-pixbuf / wayland），否则 Electron 会在加载 `libgbm.so.1` 时退出。从 SSH 会话拉起时不要带无授权的 `DISPLAY`；图形会话内用 `ozone-platform=wayland`。这是试验回执，不是 GitHub Latest。Computer Use 未在该 live 上单独点授权，GNOME 仍走同一 Portal 路径。

因此“有一个 DEB”不能写成“四个发行版已支持”。

## 支持矩阵

能力分三层，分开验收，互不做完成门。正式包是 x86_64；ARM 只测不发。

| 环境 | 用户怎么装 | 应用与 Pi 工作循环 | Host Computer Use |
| --- | --- | --- | --- |
| Ubuntu 24.04 · GNOME Wayland | 共用 `.deb` | 本切片 | Portal 最小路径（桌面级） |
| Debian 13 · GNOME Wayland | 同一 `.deb` | `verify-linux-deb-debian13.sh` | 同上 |
| Omarchy · Hyprland | 同一 `.tar.gz` + PKGBUILD | `verify-linux-pacman-arch.sh` | unavailable |
| NixOS · GNOME 或 Hyprland | 同一 `.tar.gz` + flake | `verify-linux-nixos.sh` | GNOME 同 Portal；Hyprland unavailable |

Ubuntu / Debian 的 Xorg 会话只做负向验收：Computer Use 不走 `xinput`。Fedora、openSUSE、KDE、Sway 不在首轮承诺里；代码应按能力探测自然降级。

### 1. 安装、启动与通用工作循环

普通用户从安装面进入，不依赖 checkout、隐藏环境变量或手工拆包。已登录 Stable 的自动更新：`.deb` 安装走 `pkexec dpkg --install`，目录/tarball 安装解压到当前前缀（不可写时同样 pkexec），Nix store 不自动更新。官方 OTA 只覆盖 `linux/x64`。

### 2. 凭据、浏览器与 OCR

独立验收。Browser Use 需要本机 Chromium 家族浏览器。未做的能力保持准确 unavailable。

### 3. Computer Use

按显示协议与 compositor 实现，不按发行版写四份后端，也不按 CPU 写两套包。

ISSUE [#19](https://github.com/MilkSU-Official/milksu/issues/19) 已关闭：X11 后端拒绝合入；GNOME Wayland Portal 路径已通过停止后键鼠仍可用的验收。

GNOME Portal 只承诺显示器级输入，产品文案必须写明，不得冒充 App/Window Scope。Hyprland 在上游 RemoteDesktop 可依赖前保持 unavailable。

## GitHub Release 上传清单

同一 source commit、同一 `linux/amd64` staging。最多 4 个 Linux 文件，默认这 2 个安装包：

1. `MilkSU-Linux-x64-<version>.deb` — Ubuntu / Debian
2. `MilkSU-Linux-x64-<version>.tar.gz` — Omarchy / Arch / NixOS / 通用目录

可选随附、不单独算产品包：`PKGBUILD`、`milksu.desktop`。

不上传：arm64 DEB/tarball、按发行版拆开的第二份 DEB、AUR/nixpkgs 上游提交。

## 当前切片

- Ubuntu 24.04 / Debian 13：空 recommends 的共用 `.deb`
- Omarchy / Arch：同一 tarball + `packaging/linux/PKGBUILD.in`
- NixOS：`packaging/linux` flake 包装同一 unpacked 目录
- 桌面：Wayland ozone auto；hicolor 16–512 图标；Browser Use 查找 Chromium 家族
- GNOME Computer Use：XDG Desktop Portal 授权后截屏 / 坐标点击 / 打字，不接 Cua
- 本机 ARM 虚拟机只验证，不改变正式包架构

验证脚本：`scripts/verify-linux-deb-debian13.sh`、`scripts/verify-linux-pacman-arch.sh`、`scripts/verify-linux-nixos.sh`。容器安装成功不是 GNOME/Hyprland 真机 GUI 回执。Xvfb、一次截图或 Portal 在线都不能替代真实桌面回执。

## 尚未建立的事实

- Debian 13 GNOME 与 Ubuntu 同类，本切片跳过独立 Debian GNOME 验收；
- Omarchy 官方 ISO 仍是 x86_64；ARM 上用 Debian 13 + Hyprland 0.55 做过 Wayland 试验，不是 Omarchy 发行面回执；
- NixOS ARM GNOME live 已有 FHS 启动回执，仍没有正式 GitHub Release 回执；
- Linux Secret Service 与本地 OCR 仍未实现；
- Hyprland RemoteDesktop 尚未成为可依赖的正式上游能力，Computer Use 保持 unavailable；
- Linux ARM64 不是发行架构；
- Portal 与通用 tarball 尚未进入 GitHub Latest `v26.825.1`。

在这些事实形成前，README、下载页与 Release Notes 继续只把已上传的 x64 包写成可下载产物。
