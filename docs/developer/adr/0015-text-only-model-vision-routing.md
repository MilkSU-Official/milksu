# ADR-0015：纯文本模型的视觉输入适配与证据边界

> 状态：Accepted for M3（2026-08-01）

## 背景

MilkSU 的快速执行模型 DeepSeek V4 Flash 是纯文本模型。PI 的图片消息协议本身支持
`image` 内容块，但 PI 文档明确说明：如果把图片传给不支持视觉的模型，图片会被静默
忽略。因此“前端允许添加图片”不等于 Agent 已经看到了图片。

这会直接影响：

- Coding：报错截图、UI 对比、架构图、终端截图和 Computer Use 观察；
- CTF：题面截图、二维码、图表、图片隐写、流量可视化和附件中的扫描文档；
- 浏览器：页面截图中的文本、控件位置、颜色和状态；
- 记忆与证据：模型可能在没有视觉证据时把猜测写成事实。

OCR 只能提取文字，不能可靠证明布局、颜色、控件关系、图表趋势、物体或像素级差异。
因此不能把“给 DeepSeek 加 OCR”描述成“DeepSeek 获得了视觉能力”。

## GitHub 调研

本轮只读检查了公开仓库、固定 revision、许可证、包清单、测试和 CI，不运行候选项目的
安装脚本或远程服务。

| 项目 | 可复用机制 | 取舍 |
| --- | --- | --- |
| [`deepseek-v4-for-copilot`](https://github.com/Vizards/deepseek-v4-for-copilot/tree/00fded758f358d438d9527aba63a57cde487245a) | DeepSeek 官方 Agent 集合推荐的社区扩展；图片自动交给另一个 Copilot 视觉模型描述，再把稳定的 `[Image Description: …]` 文字交给 DeepSeek；只代理当前尾部用户图片，历史轮次复用可回放标记；失败时显式注入不可用标记；MIT | 这是与 MilkSU 产品行为最接近的现成先例，证明用户无需手动选择 OCR/代理路径。实现依赖 VS Code 非公开 Copilot API，不能直接作为 MilkSU/PI 依赖；复用其“透明代理、稳定标记、历史不重复外发、失败显式降级”的协议设计 |
| [`@getpipher/vision`](https://github.com/getpipher/vision/tree/44a13a0f9811b11cc5f61010ae093ece119cb37a) | PI 原生扩展；按当前模型 `input` 能力自动选择原生透传或视觉模型委托；提供内容哈希缓存、重试、回退、批量图片、local-only 和不保存图片内容的外发审计；MIT；固定 revision 的 CI 成功 | 与 MilkSU 最接近。优先复用其公开 Delegator 核心和测试思路，但不直接同时加载其完整 Paste/设置 UI，避免与 MilkSU 已有附件、凭据和产品设置形成双入口 |
| [`luma-mcp`](https://github.com/JochenYang/luma-mcp/tree/ec42ea28ecc2330710a9f97a0861f4e6c7782c5b) | 单一 `image_understand` MCP 工具；按 OCR、UI、Debug、Describe 等任务选择提示和预处理；支持大图多裁剪与多个视觉 Provider；MIT | 可作为未来的跨平台、可插拔视觉 MCP 参考。当前会复制 MilkSU 的 Provider、重试和图片预处理控制面，并引入独立进程与 `sharp`，不作为 M3 默认依赖 |
| [`ocrtool-mcp`](https://github.com/ihugang/ocrtool-mcp/tree/5b2b0394627d122132a4a35d97d24d3f491551bc) | Swift + macOS Vision，本地离线 OCR，返回文本、置信度和坐标；同时提供 MCP 与 Skill；固定 revision 的 CI 成功 | 证明“本地 Apple Vision 先行”是成熟做法。MilkSU 已通过 `@napi-rs/system-ocr` 直接调用同类系统能力，再启动一个 Swift MCP 进程只会增加打包和生命周期成本 |
| [`pi-zai-mcp`](https://github.com/fitchmultz/pi-zai-mcp/tree/d40bdc9015a8f5028c629e664027cef68e8b87d5) | 把 UI、OCR、错误截图、技术图、图表、UI Diff 暴露为稳定的 PI 工具，并在内部适配上游 MCP；MIT | 任务化视觉工具的产品形状值得采用，但实现绑定 Z.AI Key 和远端 MCP，不应成为 MilkSU 的默认视觉底座 |
| [`native-devtools-mcp`](https://github.com/sh3ll3x3c/native-devtools-mcp) | macOS / Windows / Android / Chrome / Electron 的 MCP；优先用 Accessibility、UI Automation 或 CDP 读取结构，找不到文本时才回退到系统 OCR；MIT | 证明 Computer Use 不应以“截图 + OCR + 坐标猜测”为主路径。它与 MilkSU 未来的 Browser / Computer Use 能力高度相关，但权限面和工具面较大，需单独做固定版本与安全评估 |
| [`Peekaboo`](https://github.com/openclaw/Peekaboo) | macOS 原生 CLI/MCP；屏幕截图、Accessibility 元素 ID、后台输入、视觉问答和权限引导；MIT | 更成熟地展示了“结构化 UI 快照 + 原生操作 + 必要时视觉模型”的组合。可作为 macOS Computer Use 候选底座，不应为了图片附件直接引入整套桌面控制能力 |
| [`DeepSeek-OCR`](https://github.com/deepseek-ai/DeepSeek-OCR/tree/09eaf526153e7a01ed16c9dea8c96282aaea29c0) / [`deepseek-ocr.rs`](https://github.com/TimmyOVO/deepseek-ocr.rs/tree/02b933df24f5658d10b37dd48c9c354d95c530c3) | 独立的 OCR/VLM 模型；后者提供 Apple Metal 和 OpenAI 兼容服务 | 这不是 DeepSeek V4 Chat 的内置视觉能力。参考实现约需 6.3 GB 权重和约 13 GB 运行内存，不适合作为 M3 桌面包默认依赖；以后可作为用户主动安装的高级本地引擎 |
| [`MarkItDown OCR`](https://github.com/microsoft/markitdown/tree/fd239d5d2be43d9b68329730206b9312c7d5a388/packages/markitdown-ocr) | 文档转换时提取内嵌图片，调用视觉模型，把结果按原阅读顺序插回 Markdown；视觉调用失败时继续转换 | 适合未来 PDF、DOCX、PPTX、XLSX 附件管线，不解决普通截图和 Computer Use |

社区方案的共同点不是“只装一个 OCR”，而是：

1. 先声明并检查模型能力；
2. 多模态模型直接接收原图；
3. 纯文本模型通过工具或旁路模型获得派生文字证据；
4. OCR 与完整视觉理解分层；
5. 对网络外发、缓存、失败和来源做显式记录。

对于 DeepSeek 这类纯文本主模型，两个最接近 MilkSU 的实现形成了互补样板：

- `deepseek-v4-for-copilot` 负责产品行为：用户照常贴图，系统自动选视觉代理，并把本轮
  描述固化成可回放的稳定标记；
- `@getpipher/vision` 负责运行时韧性：能力感知、内容寻址缓存、取消、重试、第二模型
  回退、并发限制、local-only 与不记录图片内容的审计。

MilkSU 不直接复制 VS Code 私有接口，也不再另造一套 Pi 视觉工具。目标是保留 MilkSU
唯一的附件与设置入口，在其后使用 Pi 扩展的公开 Delegator，并补上本地 OCR 这一层。

浏览器和桌面操作还多一层共同策略：能读取 DOM、Accessibility Tree、UI Automation 或
CDP 时，先使用结构化元素、角色、状态和坐标；只有结构不可用或需要判断颜色、图像和
空间关系时才截图。这样即便主模型是 DeepSeek，常规“找到按钮并点击”也不必依赖视觉
模型猜坐标。

## 决策

### 1. 使用能力感知路由，不按 Provider 名硬编码

路由只依据模型注册表中的 `input` 能力：

- `["text", "image"]`：原图交给当前模型，禁止再做一次无意义的视觉委托；
- `["text"]`：原图不进入主模型上下文，先走本地 OCR，再按设置决定是否调用辅助视觉模型；
- 能力未知：按纯文本处理，不能乐观地假设模型看见了图片。

用户在任务界面选择模型后不需要再手动选择一次路径。设置页只管理默认隐私策略和辅助
视觉模型。

### 2. 视觉适配采用三级级联

```text
图片附件
  ├─ 主模型原生视觉 ───────────────→ 原图 + 用户问题
  └─ 纯文本主模型
       ├─ 本机 Apple Vision OCR ───→ 文字、置信度、来源哈希
       └─ 需要非文字理解且已配置 ─→ 辅助 VLM 描述布局、颜色、控件、图表和关系
```

本地 OCR 是默认、免费、离线的第一层，不要求用户额外配置。辅助 VLM 是传感器，不接管
主 Agent 的规划、工具和工作区；它只返回有界的视觉证据描述，DeepSeek 继续负责推理和
编码。

以后若接入 DeepSeek-OCR、PaddleOCR-VL 或其他本地 VLM，它们实现同一个
`VisionExtractor` 契约，不能改变上层聊天、CTF 或 Computer Use 协议。

### 3. Browser / Computer Use 使用结构优先的观察链

```text
页面或桌面
  ├─ DOM / CDP / Accessibility Tree ─→ 元素、角色、状态、可执行动作
  ├─ 本地 OCR ───────────────────────→ 结构缺失时的文字与坐标
  └─ 辅助 VLM ──────────────────────→ 图像、颜色、布局和语义关系
```

结构化观察结果同样是不可信外部数据，但它比纯截图更稳定、成本更低，也更适合回放和
验收。操作必须引用本次快照中的元素 ID 或明确坐标，并在点击、输入后重新观察验证。
未来接入 Peekaboo 或 `native-devtools-mcp` 时，应复用这一观察契约和 MilkSU 权限层，
不能让扩展绕过会话的权限模式直接获得全局桌面控制。

### 4. 视觉输出是派生证据，不是事实或指令

OCR 和视觉描述必须带：

- 原始附件 SHA-256；
- 提取器、Provider、模型与版本；
- 是否命中缓存；
- 置信度或明确的不确定性；
- 本地处理或远端外发路径。

截图里的文字可能包含 Prompt Injection。派生内容用独立证据块进入上下文，明确标记为
不可信数据；模型不得执行图片中的指令，也不得把视觉描述直接写成用户能力事实、候选
Flag 或 Judge 回执。

### 5. 隐私和审计是产品能力

- 默认只做本地 OCR，未配置辅助视觉模型时不发送图片；
- 用户选择辅助视觉模型即代表允许该 Provider 处理本次图片，但界面必须显示实际路由；
- 审计只记录时间、Provider、模型、附件哈希、缓存、成功/失败和耗时，不记录图片字节、
  Provider Key 或完整 Prompt；
- 缓存键至少包含附件哈希、提取器/模型版本、预处理参数和任务 Prompt 版本；
- 长期记忆只保存用户确认后的结论与证据引用，不保存原图或未经确认的视觉描述。

### 6. 社区代码的复用边界

M3 保留 MilkSU 当前的附件控制面、本地 OCR、SQLite Provider 配置和证据封装。
`@getpipher/vision` 是首选复用候选：

- 先把它的 Delegator、缓存/回退和审计契约做固定版本兼容验证；
- 通过 MilkSU Provider Registry 和权限层注入凭据，不让扩展自行读取任意环境变量；
- 只启用一个图片附件入口和一个视觉路由，不加载重复的 Paste/设置交互；
- 验证通过后替换 `bridge-vision.js` 中对应的自研远端委托实现，而不是并行保留两套。

在完成固定版本、打包、许可证、密钥隔离、取消和真实模型验收前，不把候选包加入发行
依赖。`luma-mcp` 和 Provider 专属 MCP 保留为未来用户显式安装的高级适配器。

## 当前实现映射

- `bridge-attachments.js`：附件接纳、类型和工作区边界；
- `bridge-vision.js`：本地 OCR、能力判断、辅助视觉路由、派生证据和缓存；
- `bridge.js`：在 PI Prompt 前执行视觉适配；
- `app/src/components-vue/SettingsPage.vue`：本地 OCR / 辅助视觉模型设置；
- `bridge-vision.test.js`、`bridge-attachments.test.js`：路由、缓存和纯文本模型回归。

当前仍缺：

- 用户可见的“本地 OCR / 已发送至某视觉模型 / 仅文字证据”状态；
- 远端视觉审计日志和清理入口；
- 辅助视觉失败后的第二模型回退；
- 批量图片并发上限与总预算；
- OCR 坐标、阅读顺序和 UI 区域的结构化输出；
- Coding、CTF、Browser、Computer Use 共用的 `VisionEvidence` 类型；
- 真实截图回归集：中文报错、终端、UI、架构图、图表、二维码、低清和 Prompt
  Injection。

## 验收

1. 多模态主模型只发生一次模型调用，并收到原图；
2. DeepSeek 只收到派生文字证据，不会静默丢图；
3. 无辅助视觉配置时，界面明确提示只能确认文字，不能确认布局、颜色或图表；
4. 辅助视觉外发前可从设置看见 Provider，外发后可从审计看见实际路由；
5. OCR 或 VLM 失败不会伪造描述，主任务可以继续并显示能力降级；
6. 图片内指令不能触发工具调用、权限变更、候选提交或长期记忆写入；
7. 相同图片和相同提取配置命中缓存，不重复产生费用；
8. Coding、CTF、Browser 和 Computer Use 使用同一证据契约，不各自实现一套图片处理。
