<p align="center">
  <img src="app/src/assets/milksu-app-icon.png" width="112" alt="MilkSU">
</p>

<h1 align="center">MilkSU</h1>

<p align="center">
  面向安全学习、漏洞研究与软件开发的本地 AI 工作台
</p>

<p align="center">
  <a href="https://github.com/MilkSU-Official/milksu/releases/tag/v26.915.1"><img src="https://img.shields.io/badge/latest_release-26.915.1-f3f0e8?style=flat-square&labelColor=20211f" alt="Latest GitHub Release 26.915.1"></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-AGPL--3.0-blue?style=flat-square&labelColor=20211f" alt="AGPL-3.0-only"></a>
  <img src="https://img.shields.io/badge/platform-macOS_Windows_Linux-f3f0e8?style=flat-square&labelColor=20211f" alt="macOS, Windows and Linux">
  <img src="https://img.shields.io/badge/desktop-Electron_%2B_Vue_%2B_Go-f3f0e8?style=flat-square&labelColor=20211f" alt="Electron, Vue and Go">
</p>

<p align="center">
  <a href="https://github.com/MilkSU-Official/milksu/releases/tag/v26.915.1">下载 26.915.1</a>
  ·
  <a href="https://github.com/MilkSU-Official/milksu/releases">全部发行</a>
  ·
  <a href="docs/architecture/current-system.md">了解系统</a>
  ·
  <a href="https://github.com/MilkSU-Official/milksu/issues">反馈问题</a>
</p>

![MilkSU Coding 工作台](docs/media/readme-coding.png)

MilkSU 把 Coding、CTF、CVE 和实验室放进同一个桌面。Agent 读项目、改文件、跑测试；也可以对着一道题、一个 CVE 或一次实验室作业，把题面、材料、过程和产物留在同一条可回看的任务里。

它不是只有输入框的聊天客户端。项目文件、内置浏览器、你选定的真实浏览器标签页、外部桌面应用，都可以成为当前任务的一部分。你可以随时看、补一句、接管或停掉。

## 能做什么

### Coding

打开仓库，让 Agent 改代码、构建、测试、审阅。会话能改名、归档、恢复；回到 Coding 接着上次，不必每次从空白草稿开始。输入框旁有上下文用量；接近窗口约 80% 且空闲时会自动整理。执行范围用 Plan / Go，以及只读、请求批准、替我审批、完全访问。

### CTF

浏览 NSSCTF、CTFshow，收藏题目，拿每日训练。点进详情再打开，为每道题单独工作区。材料、Evidence、候选、Judge 回执和复盘都留在题目里。解题对话在右下角可拖放小窗，和终端、Git、产物在一起。成功只由平台 Judge 或你本人确认。

### CVE

按编号、产品或关键词搜索公开 CVE，加入个人研究列表。点进档案再复现：Agent 编辑 `report.md`，对话留在小窗。不以「复现成功 / 没复现上」当完成面。

### 实验室

和 CTF / CVE / Coding 同级。可以给本地或远程地址开一次探测，也可以从题目包起本机 Docker 靶（Juice Shop / WebGoat / S2-045 / whoami）或安卓 MilkSU-Lab。Agent 把过程写进 `report.md`。

<table>
  <tr>
    <td width="50%">
      <img src="docs/media/readme-ctf.png" alt="MilkSU CTF 题库与每日挑战">
      <p align="center"><sub>CTF 题库与每日挑战</sub></p>
    </td>
    <td width="50%">
      <img src="docs/media/readme-cve.png" alt="MilkSU CVE 研究列表">
      <p align="center"><sub>CVE 列表与点进档案复现</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/media/readme-lab.png" alt="MilkSU 实验室题目包">
      <p align="center"><sub>实验室题目包与本机靶机</sub></p>
    </td>
    <td width="50%">
      <img src="docs/media/readme-settings.png" alt="MilkSU 安全工具设置">
      <p align="center"><sub>设置里的本机安全工具</sub></p>
    </td>
  </tr>
</table>

## Agent 怎么动手

当前任务里有哪些能力，产品会告诉模型；模型按上下文选用。不会靠扫描你句子里的关键词去开浏览器或切页。

- 文件、Shell、Git、LSP、测试、产物预览
- 会话隔离的内置浏览器，以及你明确点选的 Chrome / Edge 标签页
- Computer Use：macOS / Windows 按窗口；Linux GNOME 按整桌面授权
- 设置里准备 IDA Pro / idalib、capa，就绪后可进 Coding 或实验室作业

项目目录、浏览器标签页和桌面窗口都要明确进入当前任务。设置、凭据、审批档和你自己的日常 Chrome 不交给这个工具。

## 安装

当前安装包是 **[26.915.1](https://github.com/MilkSU-Official/milksu/releases/tag/v26.915.1)**：macOS ARM64 DMG（Developer ID 签名并公证）、Windows x64 EXE、Linux x64 `.deb` 与 `.tar.gz`。Windows 安装器尚未代码签名，可能被 SmartScreen 拦住。已登录后可从侧栏下载本机更新。

| 系统 | 安装包 | Computer Use | Browser Use |
| --- | --- | --- | --- |
| macOS Apple Silicon | DMG | 窗口 | 可用 |
| Windows x64 | EXE | 窗口 | 可用 |
| Linux x64 GNOME Wayland | `.deb` / `.tar.gz` | 整桌面 Portal | 可用 |
| Linux Hyprland / Xorg | 同上 | 不可用 | 可用 |

Linux 只发两份包：Ubuntu / Debian 用 `.deb`，Omarchy / Arch / NixOS 用同一份 `.tar.gz`。Linux 暂无 Secret Service 和本地 OCR。

```bash
# Ubuntu / Debian
sudo apt install ./MilkSU-Linux-x64-26.915.1.deb

# Omarchy / Arch：用仓库 packaging/linux/PKGBUILD.in，填版本与 sha256 后
makepkg -si

# NixOS：解压同一 tar.gz
MILKSU_LINUX_UNPACKED=/path/to/unpacked nix --impure build ./packaging/linux
```

打开后用 GitHub 登录。管理员为账户开通模型，或在「设置 → 模型」添加自己的 Provider。没有模型额度时仍可登录和看本地内容，只是还不能发起模型任务。

用户可见产物在各系统文档目录下的 `MilkSU/`。凭据留在本机，不进聊天、普通日志或项目文件。MilkSU 面向个人学习、授权研究和本地开发，不是互联网扫描器或无人值守红队。

## 本地开发

需要 Node.js、npm、Go。

```bash
npm install
npm --prefix app install
npm run desktop:start
```

提交前跑与改动对应的测试：`go test ./...`、`npm run test:sidecar`、`npm --prefix app run test`。

开发入口：[当前开发目标](docs/developer/current-objectives.md)、[当前系统](docs/architecture/current-system.md)。

## 鸣谢

应用图标由 **奶噗** 绘制。

<p align="center">
  <a href="https://github.com/HikaruQwQ"><img src="https://github.com/HikaruQwQ.png?size=96" width="72" height="72" alt="HikaruQwQ"></a>
  &nbsp;
  <a href="https://github.com/SuInk"><img src="https://github.com/SuInk.png?size=96" width="72" height="72" alt="SuInk"></a>
  &nbsp;
  <a href="https://github.com/2409324124"><img src="https://github.com/2409324124.png?size=96" width="72" height="72" alt="东云"></a>
  &nbsp;
  <a href="https://github.com/ArakeiShi"><img src="https://github.com/ArakeiShi.png?size=96" width="72" height="72" alt="荒景肆"></a>
  &nbsp;
  <a href="https://github.com/SkyAerope"><img src="https://github.com/SkyAerope.png?size=96" width="72" height="72" alt="薄荷布丁"></a>
  &nbsp;
  <a href="https://github.com/Aeko233"><img src="https://github.com/Aeko233.png?size=96" width="72" height="72" alt="AsabaLazy"></a>
  &nbsp;
  <a href="https://github.com/luo"><img src="https://github.com/luo.png?size=96" width="72" height="72" alt="Luo"></a>
  &nbsp;
  <a href="https://github.com/shiluoshiro"><img src="https://github.com/shiluoshiro.png?size=96" width="72" height="72" alt="shiluoshiro"></a>
  &nbsp;
  <a href="https://github.com/MetatronPrototype"><img src="https://github.com/MetatronPrototype.png?size=96" width="72" height="72" alt="メタトロン"></a>
</p>

感谢在内测期间直接向仓库提交代码的同学。没有 ta 们，MilkSU 无法到今天这样基本可用的地步。

| 同学 | 主要贡献 |
| --- | --- |
| [Hikaru（HikaruQwQ）](https://github.com/HikaruQwQ) | Windows / Linux 启动与打包（PR #4）、账户授权恢复、Sidecar 安装路径、发行 workflow 与测试门禁；Composer 目标/计划/目录 chips（PR #12）；工具活动组展开与完成态（PR #20）；项目会话后台完成提醒（PR #26）；前端 typecheck（PR #28）；上下文用量与按模型思考档位（PR #31） |
| [SuInk](https://github.com/SuInk) | 会话归档与恢复、行内改名、主题切换、回到 Coding 时恢复上次视图 |
| [东云](https://github.com/2409324124) | 账户模型可用性与可调用目录（PR #3） |
| [荒景肆（ArakeiShi）](https://github.com/ArakeiShi) | Windows 无 Git 启动与 Computer Use 驱动（PR #5）；产物目录和数据目录打开（PR #6）；实验性 v1 本地插件框架（PR #34） |
| [薄荷布丁（SkyAerope）](https://github.com/SkyAerope) | 自定义中转站保存与 MilkSU 账户行、设置里的数据库兼容行（PR #7） |
| [AsabaLazy（Aeko233）](https://github.com/Aeko233)、[Luo](https://github.com/luo) | CTF 收藏/全部视图改走本地目录（PR #8）；Windows 源码换行测试（PR #9）；应用级本地调试模式（PR #10） |
| [shiluoshiro](https://github.com/shiluoshiro) | 设置页切换分类时清掉上一分类提示（PR #25） |
| [メタトロン（MetatronPrototype）](https://github.com/MetatronPrototype) | bash 调用注入默认超时上界，非活跃工作区的 Sidecar 停靠保活（PR #80）；凭据变更改为惰性替换 Sidecar，停止与运行态跟住引擎真相（PR #83） |

问题和产品建议可以提到 [GitHub Issues](https://github.com/MilkSU-Official/milksu/issues)，或发到 [milksu@proton.me](mailto:milksu@proton.me)。

## 开源组件

MilkSU 的 Agent 循环、记忆分层、视觉和界面行为分别建立在这些项目上。第三方保留各自原许可，完整文本见 [NOTICE](NOTICE) 和 `third_party/licenses/`。

| 项目 | 在 MilkSU 中做什么 | 许可 |
| --- | --- | --- |
| [Pi](https://github.com/earendil-works/pi) | 通用 Agent 会话、上下文压缩和工具循环。当前固定 `@earendil-works/pi-coding-agent` 0.84.1 | MIT |
| [Obelisk](https://github.com/tommy0103/obelisk) | 本地会话记忆与学习记录的分层参考。MilkSU 以 AGPL-3.0-only 发布，以便嵌入该组件 | AGPL-3.0 |
| [ak-ui](https://github.com/YunYouJun/ak-ui) | 少量界面彩蛋（列表筛选、连接状态、顶栏模块字标）。不把 `@yunyoujun/ak-ui` 写进 app 依赖 | MIT |
| [Beautiful UI](https://www.beautifului.dev/) | 当前已发表面仍用其材料。新 UI / 重构以仓库根目录 `AGENTS.md` 为准，最高优先参考 DeepSeek Harness web GUI。不引入其 React 运行时或付费图标 | MIT |
| [Felinic](https://github.com/memohai/ui) | Vue 组件库与交互行为，以 `packages/ui` 引入 `@felinic/ui` | 上游未附 SPDX |

桌面壳还使用 Electron、Vue、xterm.js、Playwright MCP、Archify、Cua 等，详见 NOTICE。

## 许可证

MilkSU 以 [GNU Affero General Public License v3.0 only](LICENSE) 发布。第三方组件保留各自原许可，见 [NOTICE](NOTICE) 和 `third_party/licenses/`。
