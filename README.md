<p align="center">
  <img src="app/src/assets/milksu-app-icon.png" width="112" alt="MilkSU">
</p>

<h1 align="center">MilkSU</h1>

<p align="center">
  面向安全学习、漏洞研究与软件开发的本地 AI 工作台
</p>

<p align="center">
  <a href="https://github.com/MilkSU-Official/milksu/releases"><img src="https://img.shields.io/badge/status-internal_beta-a6ef00?style=flat-square&labelColor=20211f" alt="Internal beta"></a>
  <img src="https://img.shields.io/badge/latest_receipt-26.822.1-f3f0e8?style=flat-square&labelColor=20211f" alt="Latest receipted release 26.822.1">
  <img src="https://img.shields.io/badge/platform-macOS_Windows_Linux-f3f0e8?style=flat-square&labelColor=20211f" alt="macOS, Windows and Linux">
  <img src="https://img.shields.io/badge/desktop-Electron_%2B_Vue_%2B_Go-f3f0e8?style=flat-square&labelColor=20211f" alt="Electron, Vue and Go">
</p>

<p align="center">
  <a href="https://github.com/MilkSU-Official/milksu/releases">下载内测版</a>
  ·
  <a href="docs/architecture/current-system.md">了解系统</a>
  ·
  <a href="https://github.com/MilkSU-Official/milksu/issues">反馈问题</a>
</p>

![MilkSU Coding 工作台](docs/media/readme-coding.png)

MilkSU 把 Coding、CTF、CVE 和实验室放进同一个桌面工作台。你可以让 Agent 阅读项目、修改文件、运行测试，也可以从一道 CTF、一个 CVE 或一次实验室作业出发，把题面、材料、研究过程和最终产物留在同一个可回看的任务里。

它不是又一个只有输入框的聊天客户端。MilkSU 让 Agent 的工作对象真正出现在你面前：项目文件、内置浏览器、真实浏览器标签页和外部桌面应用都可以成为当前任务的一部分；你可以随时观察、补充要求、接管或停止。

可下载的最新三端回执发行是 **26.822.1**。下载页以 [v26.822.1](https://github.com/MilkSU-Official/milksu/releases/tag/v26.822.1) 为准，不要把同版本号的后续提交或空 tag 当成已经发出的包。

## 你可以用 MilkSU 做什么

### Coding

- 让 Agent 理解现有仓库，完成修改、构建、测试和代码审阅；
- 使用 Plan / Go，以及只读、请求批准、替我审批、完全访问控制执行范围；
- 会话可以改名、归档、恢复；回到 Coding 会接着上次的任务，不必每次从空白草稿开始；
- 查看文件变更、Git 状态、终端任务和可预览产物；
- 按任务使用隔离浏览器、真实浏览器标签页、Computer Use、MCP、LSP 和已审核 Skill；
- 在干净 Git 项目中自动隔离修改，不打乱当前工作区。

输入框旁有上下文用量环，悬停能看到本轮和本会话的缓存命中。接近窗口约 85% 且空闲时会自动整理上下文。模型可以用工作台动作操作标签、产物、环境和产品记录，不必让你去点界面。

### CTF

- 浏览 NSSCTF、CTFshow 题库，收藏题目并获得每日训练建议；
- 点题目进入详情，用「打开」开始，而不是在列表上堆操作；
- 导入自定义题目，为每道题建立独立工作区；
- 保存材料、Evidence、候选、Judge 回执、检查点和复盘；
- 解题对话走右下角可拖放小窗（默认 4:3），和工作区、斜杠命令、Skills、项目 MCP 在一起。

成功只由平台 Judge 或你本人确认，不由模型自述决定。

### CVE

- 按编号、产品或关键词搜索公开 CVE，加入个人研究列表；
- 按严重性、KEV、厂商、年份筛选已添加的条目；
- 点进档案再复现：Agent 编辑 `report.md`，相关 CVE 记在 `related.md`，对话留在小窗；
- 厂商/产品按公开资料呈现，不以「复现成功 / 没复现上」当完成面。

### 实验室

- 独立一级入口，和 CTF / CVE / Coding 同级；
- 给出本地或远程作业要求，开一次探测；
- 列表里可以双击标题或用菜单改名；
- Agent 把过程写进 `report.md`，对话同样走可拖放小窗。

<table>
  <tr>
    <td width="50%">
      <img src="docs/media/readme-ctf.png" alt="MilkSU CTF 题库与每日挑战">
      <p align="center"><sub>CTF 题库与每日挑战</sub></p>
    </td>
    <td width="50%">
      <img src="docs/media/readme-cve.png" alt="MilkSU CVE 研究列表">
      <p align="center"><sub>CVE 列表、筛选与点进档案复现</sub></p>
    </td>
  </tr>
  <tr>
    <td width="50%">
      <img src="docs/media/readme-lab.png" alt="MilkSU 实验室作业列表">
      <p align="center"><sub>实验室作业列表与改名入口</sub></p>
    </td>
    <td width="50%">
      <img src="docs/media/readme-settings.png" alt="MilkSU 安全工具设置">
      <p align="center"><sub>设置里的本机安全工具</sub></p>
    </td>
  </tr>
</table>

## Agent 不只看得到，也做得到

MilkSU 会把当前任务可用的能力告诉模型，再由模型按上下文选择合适的工具。用户不需要在每次任务前手工拼装一套工具链，产品也不会靠扫描句子里的关键词来打开浏览器或切换页面。

- **项目能力**：文件、Shell、Git、LSP、测试与产物预览；
- **网页能力**：会话隔离的内置浏览器，以及你明确选择的真实 Chrome / Edge 标签页；
- **桌面能力**：针对准确 App 和窗口的 Computer Use；
- **安全工具**：设置里准备 IDA Pro / idalib、capa 等本机能力，就绪后可进 Coding 或实验室作业；
- **工作台动作**：列出或切换内置浏览器标签，打开产物 / 环境 / 变更 / 终端，以及改会话名、归档、更新 CVE、创建实验室或 CTF 记录。设置、凭据、审批档和你自己的 Chrome 不在这个工具里。

## 开始使用

MilkSU 目前处于内测阶段。

1. 从 [Releases](https://github.com/MilkSU-Official/milksu/releases/tag/v26.822.1) 下载 `26.822.1`：
   - **macOS Apple Silicon**：Developer ID 签名并经 Apple 公证的 DMG，正式支持；
   - **Windows x64**：未签名安装器，可能出现 SmartScreen 提示；打包 Runtime 与 Pi Agent 回合已在真实安装包验证；
   - **Linux x64**：试用 DEB，已验证包结构、Sidecar、Go Runtime 与 Xvfb 启动，不含 Secret Service、本地 OCR 或 Computer Use。
2. 安装并打开 MilkSU；
3. 使用 GitHub 登录；
4. 由内测管理员为账户开通模型，或在“设置 → 模型”中添加自己的 Provider / OpenAI-compatible 中转站；
5. 选择 Coding、CTF、CVE 或实验室，开始第一个任务。

账户未分配模型额度时仍可登录和浏览本地功能，只是暂时不能发起模型任务。macOS 正式版本使用 Developer ID 签名与 Apple 公证；Stable 客户端支持登录后检查受保护的应用更新，但 `26.822.1` 没有发布 OTA。

## 本地优先

- 用户可见的 Coding、CTF、CVE 和实验室产物保存在各系统用户文档目录下的 `MilkSU/`；
- 项目目录、浏览器标签页和桌面窗口都需要明确进入当前任务范围；
- Provider 凭据保存在本机凭据存储中，不进入聊天内容、普通日志或项目文件；
- CTF 的成功结果以平台 Judge 或你确认的结果为准，不由模型自述决定。

## 当前状态

最近一次带哈希回执的三端内测包是 **26.822.1**（2026-08-22）：CVE 点进档案再复现，实验室作为独立入口，对话小窗接到 Agent，会话可归档改名，日间模式跟随纸面主题。

MilkSU 面向个人学习、授权研究和本地开发，不是互联网资产扫描器或无人值守的自动红队平台。

## 本地开发

需要 Node.js、npm、Go。桌面构建在 macOS Apple Silicon 上最完整；Windows / Linux 可跑对应平台的开发与打包脚本。

```bash
# 安装依赖
npm install
npm --prefix app install

# 启动 Vue 预览
npm --prefix app run dev

# 启动桌面开发版本
npm run desktop:start
```

提交前至少运行与改动对应的测试：

```bash
go test ./...
npm run test:sidecar
npm --prefix app run test
npm --prefix app run build
```

更完整的架构、开发边界和当前事实请从以下文档开始：

- [当前开发目标](docs/developer/current-objectives.md)
- [文档与事实状态](docs/developer/document-status.md)
- [当前系统与分层](docs/architecture/current-system.md)
- [架构索引](docs/architecture/index.md)

## 鸣谢

感谢在内测期间直接向仓库提交代码的同学。没有他们，三端包和工作台到不了 `26.822.1`。

| 同学 | 主要贡献 |
| --- | --- |
| Hikaru（HikaruQwQ） | Windows / Linux 启动与打包、账户授权恢复、Sidecar 安装路径、发行 workflow 与测试门禁 |
| SuInk | 会话归档与恢复、行内改名、主题切换、回到 Coding 时恢复上次视图 |
| 东云 | 账户模型可用性与可调用目录（PR #3） |
| 荒景肆（ArakeiShi） | Windows 产物目录和数据目录打开（PR #6） |
| 薄荷布丁（SkyAerope） | 自定义中转站保存与 MilkSU 账户行（PR #7） |
| AsabaLazy（Aeko233）、Luo | CTF 收藏/全部视图改走本地目录（PR #8） |
| shiluoshiro | 设置页切换分类时清掉上一分类提示（PR #24） |

完整提交记录以 Git 历史为准。问题和产品建议可以继续提到 [GitHub Issues](https://github.com/MilkSU-Official/milksu/issues)，或发送邮件至 [milksu@proton.me](mailto:milksu@proton.me)。
