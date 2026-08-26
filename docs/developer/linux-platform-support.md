# Linux 四发行版支持合同

> 文档状态：Target / Designed
>
> 目标范围：Ubuntu 24.04、Debian 13、Omarchy 4、NixOS 26.05
>
> 最后审阅：2026-08-26
>
> 本文定义尚未全部实现的 Linux 产品边界、实现顺序与验收合同。当前发行事实仍以
> [当前开发目标](current-objectives.md)、[文档状态](document-status.md)、当前代码和真实平台回执为准。

## 决策摘要

1. “支持四个发行版”先表示应用有对应安装面，且 Coding、CTF、CVE、实验室的通用 Pi 工作循环能在
   真实桌面完成；它不自动表示四个环境具有同等 Computer Use、Browser Use、本地 OCR 或凭据能力。
2. Ubuntu 与 Debian 共用经过两边安装验收的 `.deb`；Omarchy 使用原生 PKGBUILD / pacman 包；NixOS
   使用 flake 包装同一份通用 Linux 目录，不要求用户拆 DEB。
3. Linux Computer Use 不继续修 ISSUE #19 中会摘除物理键鼠的 X11 `cua-driver` 路径。候选主路径改为
   Wayland 下的 XDG Desktop Portal ScreenCast + RemoteDesktop；输入优先使用 ConnectToEIS / libei。
4. GNOME Wayland 是第一条 Computer Use 可行性路径。Hyprland 在上游 RemoteDesktop + ConnectToEIS
   正式发布，或独立的原生/受管 Surface 后端通过产品准入与真机验收前，只承诺应用安装运行，并在产品 UI
   明确显示 Host Computer Use 暂不可用。
5. 第一轮正式发行架构保持 Linux x86_64。若要把 Apple Silicon 上的 ARM64 VM 用作正式验收，必须另开
   `linux/arm64` 产品切片并生成真实 ARM64 发行产物；ARM64 开发构建不能证明 x86_64 包成立。
6. CDP 可以成为协作式 Electron App 的窄适配器，但不能当作“所有 Electron App 天然可控”，也不能
   替代 Linux 桌面 Computer Use。

## 当前事实

正式发行 `v26.825.1` 的 Linux 产物只有一个在 `ubuntu-24.04` GitHub-hosted runner 上构建的
`linux/amd64` DEB。自动化验证了包结构、Node/Pi Sidecar、Go Runtime 和 Xvfb Electron 启动；没有
真实 GNOME/Hyprland 桌面回执。发布脚本明确记录 `localOcr: false` 与 `computerUse: false`。

当前代码还存在以下边界：

- `internal/computercap` 只允许 macOS 与 Windows，Linux 状态明确为 unavailable；
- Sidecar 只有 `linux/amd64` Node runtime，Linux 没有已审阅的 `@napi-rs/system-ocr` 原生包；
- Browser Use 已按 PATH 查找 Google Chrome、Chromium、`chromium-browser` 和 Edge，但
  `MILKSU_CHROME_PATH` 仍只是隐藏开发兜底，不是 NixOS/普通用户的产品配置面；
- Provider Credential 仍由本地 `credentials.db` 承载；Linux Secret Service 没有接入。

因此，“有一个 DEB”与“四个发行版受支持”之间仍有安装、桌面集成、能力探测和真实验收四段距离。

## 支持矩阵

第一轮支持合同以 x86_64 为基线：

| 验收环境 | 安装面 | 应用与 Pi 工作循环 | Computer Use |
| --- | --- | --- | --- |
| Ubuntu 24.04 · GNOME Wayland | `.deb` | 目标支持 | 第一条实现与验收路径 |
| Debian 13 · GNOME Wayland | 同一 `.deb` | 目标支持 | 复验同一 GNOME Portal 后端 |
| Omarchy 4 · Hyprland | `.pkg.tar.zst` / PKGBUILD | 目标支持 | Portal 或独立后端通过准入前明确不可用 |
| NixOS 26.05 · GNOME Wayland | flake + 通用 Linux 目录 | 目标支持 | 复验同一 GNOME Portal 后端 |
| NixOS 26.05 · Hyprland | 同一 flake | 目标支持 | Portal 或独立后端通过准入前明确不可用 |

Ubuntu / Debian 的 Xorg 登录会话只做负向验收：Computer Use 保持不可用，不运行 `xinput`，不摘除或
禁用物理设备，不把 Xvfb smoke 写成桌面能力回执。Fedora、openSUSE、KDE、Sway、Debian XFCE/MATE
不在这份首轮合同里；代码应按能力探测自然降级，但没有真实回执时不写支持声明。

## 三层产品承诺

### 1. 安装、启动与通用工作循环

四个发行版都必须从普通用户可理解的安装面进入，而不是依赖 checkout、隐藏环境变量或手工拆包。
共同完成线包括：

- 安装、首次启动、重启、升级、卸载；
- GitHub 登录或设置中的本机 Provider 配置；
- Coding 的文件、Shell、Git、附件、终端、内置浏览器与 Pi 工具回合；
- CTF、CVE、实验室进入与同一通用工具循环；
- 用户产物、App Data、缓存、运行时与桌面入口使用平台路径，不写死某台机器。

### 2. 凭据、浏览器与 OCR

这些能力独立验收，不能由应用启动回执代替：

- **Secret Service**：通过会话 D-Bus 探测并使用 Secret Service；服务缺失或未解锁时，设置页显示准确的
  下一步。pre-release 的 SQLite Provider Credential 不进入普通迁移，用户重新授权或重新填写；不得
  把未加密 SQLite 当作 Linux 正式凭据边界。
- **Browser Use**：继续支持 Chrome/Chromium/Edge，并补 `.desktop`、`XDG_DATA_DIRS` 与用户选择路径的
  产品探测。Nix store 路径和 Omarchy 默认 Chromium 不写死；隐藏环境变量只保留开发用途。
- **本地 OCR**：单独评测 PaddleOCR、Tesseract/ONNX 等可审阅候选的许可证、包体、中文/英文截图效果、
  离线行为、x86_64/arm64 构建和退出成本。未选定前保持能力探测与准确降级，不把 OCR 阻塞混进 #19。

### 3. Computer Use

Computer Use 按显示协议与 Portal 能力实现，不按发行版写四份后端。GNOME 与 Hyprland 是不同合成器
边界，NixOS 可能进入其中任意一种，不能只测一个桌面就声明“NixOS Computer Use”。

## ISSUE #19 决策

[ISSUE #19](https://github.com/MilkSU-Official/milksu/issues/19) 记录的 P0 不是短暂卡顿，而是 X11
`cua-driver --permission-mode bounded` 摘除并禁用物理键鼠后缺少可靠恢复，可能令桌面持续失去输入。
早期 AT-SPI 广告还会触发 GNOME 全桌面冻结，并留下未复位的 a11y 状态。

该路径的产品决策是：

- 不合入或恢复旧 X11 分支；
- Linux 产品代码不运行 `xinput detach/disable`，不把 root/uinput 或 `/dev/input` 控制做成隐式后门；
- 第一条 Linux Computer Use 不启用 AT-SPI 广告，不依赖元素树；先提供门户授权的视觉帧与像素操作；
- 停止、Driver/Helper 崩溃、MilkSU 强杀、注销和重启都必须关闭 Portal Session，旧操作不重放；
- 在新 Wayland 工作项建立后，#19 可按“拒绝不安全 X11 后端，由 Wayland 方案替代”关闭，而不是按
  “已修好 X11”关闭。

## GNOME Wayland 后端

XDG Desktop Portal 的候选流程是：

```text
CreateSession
  -> SelectDevices(pointer + keyboard)
  -> ScreenCast.SelectSources(window preferred)
  -> RemoteDesktop.Start (system consent)
  -> ScreenCast.OpenPipeWireRemote (visual frames)
  -> RemoteDesktop.ConnectToEIS (libei sender)
  -> observe / click / type / key / scroll
  -> close portal session
```

依据：

- [RemoteDesktop Portal specification](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.RemoteDesktop.html)
- [ScreenCast Portal specification](https://flatpak.github.io/xdg-desktop-portal/docs/doc-org.freedesktop.portal.ScreenCast.html)
- [libei client and portal overview](https://libinput.pages.freedesktop.org/libei/api/index.html)
- [GNOME Remote Desktop implementation](https://github.com/GNOME/gnome-remote-desktop)
- [RustDesk Wayland/PipeWire implementation reference](https://github.com/rustdesk/rustdesk/blob/master/libs/scrap/src/wayland/pipewire.rs)

RustDesk 只作为 Portal 时序、PipeWire 格式协商和输入映射的上游参考，不整包引入。MilkSU 先比较
liboeffis/libei/PipeWire 或可审阅的薄 helper，再决定是否需要最小自有适配；不在 Go、Sidecar 与
Electron 各写一套会话状态机。

### 进入生产前的可行性门

一次隔离研究必须在真实 GNOME Wayland 中证明：

1. 系统授权框由用户明确选择外部窗口或显示区域；
2. PipeWire 连续取得帧，并处理缩放、多显示器、游标和常见像素格式；
3. `mapping_id`、逻辑尺寸与 libei region 能把所有输入限制在已授权范围；
4. MilkSU 自身窗口可被排除，或系统返回足够身份让 MilkSU 拒绝自控；
5. 用户取消、窗口关闭、Portal/Helper/MilkSU 崩溃后，真实键鼠仍正常，Portal Session 无残留；
6. ASCII、中文输入、修饰键、滚动与输入法的真实结果被分别记录，不用一个 click smoke 外推完整能力。

如果 Portal 只能提供显示器级输入权限，或不能证明自窗口排除，就不能冒充现有“准确 App/Window Scope”。
届时必须另行决定是否设计一个用户明确授权的“共享整个桌面”产品面；没有该决策时继续显示不可用。

## Hyprland 边界

`xdg-desktop-portal-hyprland` 已提供 ScreenCast，但截至 2026-08-26，RemoteDesktop + ConnectToEIS
仍在上游开放 PR 中，不能写成完成事实：

- [RemoteDesktop tracking issue #252](https://github.com/hyprwm/xdg-desktop-portal-hyprland/issues/252)
- [RemoteDesktop + ConnectToEIS pull requests](https://github.com/hyprwm/xdg-desktop-portal-hyprland/pulls)

首轮产品不引入 Hyprland 私有协议、`ydotool`、root/uinput 或模拟 GNOME 授权框。Omarchy 与 NixOS
Hyprland 通过同一 Portal 能力探测显示“此桌面暂不支持 Computer Use”。上游正式发布后先在 Omarchy
x86_64 和 NixOS Hyprland 分别验收，再决定是否把现有 GNOME Portal helper 复用为共同后端。独立、
不进入 release 的 Hyprland 原生后端研究可以先行，但必须通过下节的权限与范围门。

## 没有 RemoteDesktop Portal 时的替代阶梯

“能截图，再按坐标点一下”有多种曲折实现，但截图范围和输入权限必须分别核算。一个后端即使只返回
目标窗口画面，只要输入端能操作整个宿主桌面，就仍然是全局 Computer Use 权限，不能写成窗口级授权。

| 顺序 | 路径 | 能覆盖什么 | 产品结论 |
| --- | --- | --- | --- |
| 1 | App 协作协议：CDP、App API、Accessibility | MilkSU 受管启动且明确暴露控制面的 App | 最窄、优先；不是任意 App 通解 |
| 2 | MilkSU 受管 App Surface | 由 MilkSU 启动进嵌套 compositor/session 的任意兼容 App | 无 Portal 桌面的首选通用降级研究；范围由受管表面而非宿主桌面提供 |
| 3 | 合成器原生后端 | Hyprland 等具有截图、窗口映射和虚拟输入协议的已知 compositor | 可作为逐 compositor 的第二后端；必须单独验收和维护 |
| 4 | 全桌面远控桥 | `wayvnc` 等把 wlroots session 暴露为 RFB 的组件 | 只适合明确授权的整个桌面或受管 session；不等于窗口 Scope |
| 不准入默认产品 | `ydotool`/uinput、root 输入守护进程 | 几乎任意已运行桌面 | 权限过宽、无 compositor 授权/范围，不能作为“哪里都能点”的静默兜底 |

### Hyprland 原生曲折路径

Hyprland 当前发布的协议已经提供窗口/输出截图与虚拟输入原语：

- [`hyprland-toplevel-export-v1`](https://github.com/hyprwm/hyprland-protocols) 导出单个 toplevel buffer；
- [`wlr-screencopy-unstable-v1`](https://gitlab.freedesktop.org/wlroots/wlr-protocols) 截输出；
- `wlr-virtual-pointer-unstable-v1` 与 `virtual-keyboard-unstable-v1` 注入输入；
- [`hyprctl`](https://wiki.hypr.land/Configuring/Advanced-and-Cool/Using-hyprctl/) 可枚举 `clients`、
  monitor、active window 和 cursor position，[dispatcher](https://wiki.hypr.land/Configuring/Basics/Dispatchers/)
  还可聚焦窗口、移动游标和发送键鼠。

因此一个可行 spike 是：用稳定窗口身份锁定目标，通过 toplevel export 取帧，将帧内坐标按 scale、transform、
monitor offset 和窗口位置换算为全局坐标，再通过虚拟 pointer/keyboard 点击。生产实现应直接使用固定版本、
可审阅的 Wayland 协议 helper，而不是让模型获得任意 `hyprctl`、plugin、shell 或 IPC 权限。

这条路仍需证明：

1. 只有用户当次选中的窗口能被返回；最小化、移动、跨屏、缩放和重建窗口时身份不漂移；
2. 点击前做 fresh observe，并在执行瞬间复核目标 bounds、focus、遮挡与坐标映射；
3. Helper 拒绝 MilkSU 自身窗口、锁屏、登录界面和目标外坐标，不把原始全局输入能力交给模型；
4. 用户可见地开始/停止，断开、崩溃与 compositor 重启后无按键、按钮或 socket 残留；
5. 明确告知用户：范围是 MilkSU helper 的软件约束，不是 Portal/系统授权框强制的 OS Scope。

[`wayvnc`](https://github.com/any1/wayvnc) 证明 wlroots 的 screencopy + virtual input 可以组成完整远控，
适合作为帧时序、输入与恢复的上游参考；它默认面向输出/桌面，且引入 RFB endpoint，不直接满足现有 App/Window
Scope。近期基于 Hyprland 内部 ABI 的窗口定向插件也只能是研究证据：每次 compositor ABI 变化可能需要重编，
不能作为发行承诺。

### 受管 App Surface：更接近通解

对于“宿主桌面没有安全 Computer Use 后端”的共同情况，另行研究把用户选定 App 启动到 MilkSU 管理的嵌套
Wayland/Xwayland session。MilkSU 只截取和注入这块受管 surface；宿主 Hyprland、Sway、KDE 或其他桌面只负责
显示一个普通窗口，不需要把全局键鼠权交给 MilkSU。

这条边界更强，但能力更窄：只能控制经 MilkSU 新启动的 App，不能无损接管宿主上已经运行、已经登录的窗口；
GPU、输入法、剪贴板、文件选择、Secret Service、辅助功能与打包体积也都需要单独产品化。可行性阶段比较成熟的
nested compositor/session 组件并记录许可证、维护状态和退出点，不先把某个候选写进生产依赖。

因此对用户的能力声明保持三态：`Host Computer Use`、`Managed App Surface`、`Unavailable`。受管 surface
成功不能升级成“Hyprland 全桌面已支持”，Hyprland 原生 spike 成功也不能外推 Fedora/Sway/KDE。

## Electron 与 CDP 边界

Electron 内含 Chromium，因此每个 `WebContents` 都有 DevTools Target；但“内部可用 CDP”不等于
“任意运行中的外部 Electron App 都能被 MilkSU 附着”。

| 场景 | CDP 可用性 | 边界 |
| --- | --- | --- |
| MilkSU 自己拥有的 `WebContents` | 可以 | 主进程可用 `webContents.debugger`，无需暴露端口 |
| 外部 Electron App 明确开启 `--remote-debugging-port` | 通常可以 | 必须由目标 App/启动方式协作，端口暴露该实例的多个 Target |
| 普通方式已经运行的外部 Electron App | 默认不可以 | 没有远程调试 endpoint；单实例 App 也可能吞掉第二次带参数启动 |
| Electron 原生标题栏、菜单、托盘、系统文件框、Portal 授权框 | 不可以 | 这些不属于目标 renderer DOM/WebContents |
| GTK/Qt/原生 App 或整个桌面 | 不可以 | 仍需要 Portal/合成器级 Computer Use |

Electron 官方入口：

- [`webContents.debugger`](https://www.electronjs.org/docs/latest/api/debugger)
- [`--remote-debugging-port`](https://www.electronjs.org/docs/latest/api/command-line-switches#--remote-debugging-portport)
- [renderer 与 main process 的不同调试边界](https://www.electronjs.org/docs/latest/tutorial/application-debugging)

若以后准入“Electron App Control”，它应是用户明确选择并由 MilkSU 受管启动的窄适配器：loopback 随机
endpoint、精确 Target、过滤创建/关闭其他 Target 等全局 CDP 方法、停止即撤销。它可以在 Hyprland 上
覆盖一部分协作式 Electron App，但不能作为四发行版 Computer Use 的完成证据，也不能把任意外部 App
的无认证调试端口暴露给模型。

## 安装与发行结构

先从一个不可变 source commit 生成与包管理器无关的 Linux staging tree：

```text
Vue dist + Electron shell + Go Runtime + Pi Sidecar + licenses + build tracking
  -> Debian package (.deb)
  -> Arch package (.pkg.tar.zst / PKGBUILD)
  -> generic tarball -> Nix flake package
```

- DEB 在 Ubuntu 24.04 与 Debian 13 都做真实安装，不使用 Ubuntu 专用路径、Chrome 名称或依赖假设；
- PKGBUILD 直接安装 staging tree、desktop entry、图标和许可证，不经 `debtap` 转换；
- flake 固定 nixpkgs 与 MilkSU source/release hash。先比较 `autoPatchelfHook` 与 `buildFHSEnv` 的依赖闭包、
  图形驱动、Portal、DBus、升级和包体，再保留一个方案；
- GitHub Release 仍只发布到授权的 `MilkSU-Official/milksu`。没有单独授权时，不向 AUR、nixpkgs、
  Omarchy 仓库或其他上游提交包；
- x86_64 与 arm64 是独立 staging、Sidecar、安装包与回执，不用一端的结果替另一端背书。

## 实施切片

### L0 · 合同与能力探测

- 保留本文、当前目标入口和 #19 替代决策；
- 定义 Linux capability descriptor：session type、desktop hint、Portal interface/version、Secret Service、
  Browser、OCR；实际可用性以 D-Bus/文件/进程探测为准，不只读发行版名字；
- 设置与 Computer Use 面按能力显示准确状态和下一步，中文/英文成对；
- 完成条件：Ubuntu GNOME、Omarchy Hyprland、NixOS 两桌面的合成状态单元测试和真实探测快照。

### L1 · 共同 Linux staging 与三个安装面

- 把 `release-linux.mjs` 的 `linux/amd64 + deb` 构建拆成共同 staging 与各包适配；
- 生成 DEB、pacman 包和 Nix flake 所需通用归档；
- 保持 Pi、Go、Vue、许可证、build tracking 来自同一 source commit；
- 完成条件：五个真实桌面完成安装、启动、Pi 文件/Shell 回合、重启和卸载。

### L2 · Secret Service、Browser Use 与 OCR 降级

- 接 Linux Secret Service 和产品内缺失/解锁路径；旧 SQLite Credential 要求重新授权；
- Browser Use 补 Chromium/Nix store/桌面入口探测与用户选取；
- OCR 未选定前保持明确不可用或使用当前模型 image input，不增加假本地能力；
- 完成条件：五个桌面分别留下凭据重启、浏览器连接和 OCR 能力状态回执。

### L3a · GNOME Portal 隔离可行性

- 研究 helper 不进入 release 默认启动；
- 完成上文六项可行性门及负向恢复；
- 记录采用的上游实现阶梯、依赖许可证、固定版本、包体与退出点；
- 失败时保留研究结论并继续准确 unavailable，不把实验文件留在生产依赖图。

### L3b · 无 Portal 后端的隔离可行性

- Hyprland 原生 spike 验证 toplevel export、窗口身份、坐标换算、virtual input 和上述五项范围门；
- 受管 App Surface spike 验证嵌套 session 能否只控制新启动的目标 App，并量化 GPU、输入法、剪贴板、
  Secret Service、包体和退出恢复成本；
- 两条研究相互独立。任何一条成功都只建立对应 capability，不把 helper 软件约束写成系统权限；
- `ydotool`/uinput 和全局 RFB 不作为失败后的自动 fallback。

### L4 · GNOME Computer Use 产品纵切

- 抽出 `computercap` platform backend，保留 macOS/Windows reviewed driver 语义；
- Linux 后端保持同一 `observe/click/type/key/scroll` 模型工具与 fresh-observe 规则；
- Portal 授权属于用户可见、可删除 Scope，不持久化为隐藏全局权限，不自动重放旧会话；
- 完成条件：Ubuntu、Debian、NixOS GNOME 各完成一项真实外部 App 任务及停止/崩溃恢复。

### L5 · Hyprland 与受管 Surface 产品决策

- 只在上游正式 RemoteDesktop 版本出现后复验 Omarchy/NixOS Hyprland；
- 若 L3b 的 Hyprland 原生后端或受管 App Surface 通过安全、维护和包体评审，分别另开产品纵切；
- 未通过时保持准确 unavailable，不让四发行版“能安装”暗示宿主 Computer Use。

### L6 · Linux ARM64 决策

- 若选择 ARM64，补 Linux Node/Go/Electron/Helper/安装包与 Ubuntu、Debian、NixOS ARM64 真实回执；
- Omarchy ARM64 只有在其官方安装与包仓形成可审阅产品路径后再承诺。

## 验收矩阵

| 结果 | Ubuntu GNOME | Debian GNOME | Omarchy Hyprland | NixOS GNOME | NixOS Hyprland |
| --- | --- | --- | --- | --- | --- |
| 原生安装、升级、卸载 | 必须 | 必须 | 必须 | 必须 | 必须 |
| Pi 文件/Shell/终端 | 必须 | 必须 | 必须 | 必须 | 必须 |
| Secret Service 状态 | 必须 | 必须 | 必须 | 必须 | 必须 |
| 内置浏览器 | 必须 | 必须 | 必须 | 必须 | 必须 |
| Browser Use Chromium 路径 | 必须 | 必须 | 必须 | 必须 | 必须 |
| 本地 OCR 或准确降级 | 必须 | 必须 | 必须 | 必须 | 必须 |
| GNOME Portal observe/input | 目标 | 目标 | 不声明 | 目标 | 不声明 |
| 受管 App Surface（若准入） | 不替代 Host CUA | 不替代 Host CUA | 独立验收 | 不替代 Host CUA | 独立验收 |
| Computer Use 停止/崩溃恢复 | 目标 | 目标 | 不声明 | 目标 | 不声明 |

每份回执绑定完整 commit、版本、架构、发行版、桌面、显示协议、Portal 版本、安装包 SHA-256 和准确任务。
Xvfb、容器、按钮存在、Portal 在线、模型自述成功或一次截图不能替代真实桌面验收。

## 首批工作项拆分

建议从本合同另开以下独立 issue / PR，不把全部 Linux 工作塞进一个长期分支：

1. `linux: capability descriptor and unsupported UI`；
2. `linux: shared staging and Debian 13 installation`；
3. `linux: PKGBUILD and Omarchy desktop acceptance`；
4. `linux: flake and NixOS GNOME/Hyprland application acceptance`；
5. `linux: Secret Service and Chromium product discovery`；
6. `linux-cua: GNOME Portal scope and crash-safety spike`；
7. `linux-cua: Hyprland native bounded-backend spike`；
8. `linux-cua: managed App Surface fallback spike`；
9. `linux-cua: production Portal backend`；
10. `linux: local OCR candidate evaluation`；
11. `linux-arm64: product and release decision`。

每条纵切单独评审、测试、提交和真实验收。相邻但不阻塞的 Bug 记在相关目标旁，不在安装包、凭据、
OCR 与 Computer Use 之间机会式扩 Scope。

## 尚未建立的事实

- 四个发行版尚未完成真实安装矩阵；
- Debian、Omarchy、NixOS 还没有正式 MilkSU 安装包回执；
- Linux Secret Service、本地 OCR 与 Computer Use 仍未实现；
- GNOME Portal 尚未证明满足 MilkSU 的准确窗口、自窗口排除和崩溃恢复边界；
- Hyprland RemoteDesktop 尚未成为可依赖的正式上游能力；
- Linux ARM64 尚未进入发行合同。

在这些事实形成前，README、下载页、`current-system.md` 与 Release Notes 继续只写 `v26.825.1`
Linux x64 试用 DEB 的准确边界。
