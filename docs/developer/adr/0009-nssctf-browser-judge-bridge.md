# ADR-0009：NSSCTF 已登录页面桥接与平台 Judge 回执

> 文档状态：**Historical ADR with verified narrow path**。P3879 回执仍是有效证据，但
> 不能外推为六赛道或所有平台完成。
>
日期：2026-07-30
状态：Accepted；NSSCTF P3879 `correct=true` 窄路径已于 2026-07-31 验收，CTFshow 与长期
发布回归仍按当前状态文档跟踪。

## 背景

公开题面导入只能帮助 MilkSU 建立 Challenge，不能证明产品真的参与了 CTF。真实训练闭环还必须使用用户已经登录的平台页面提交候选，并把网站的判题结果保存成独立事实。

直接读取 Chrome Profile、Cookie 或密码会扩大权限；只把候选复制到剪贴板再让用户手工回填，又无法形成可验证、可恢复的 Agent harness。

## 决策

MilkSU 增加一个仅面向 NSSCTF 题目详情页的浏览器 Adapter：

1. 桌面端第一次使用时选择随机 loopback 端口并生成 192-bit 随机配对 Token；端口与 Token 以 `0600` 权限保存在用户数据目录，后续应用重启复用同一配对信息，因此扩展只需配对一次。若保存的端口被其他进程占用，MilkSU 明确报错而不悄悄换端口制造失联。
2. MilkSU CTF 顶栏提供 NSSCTF/CTFshow 共用的“连接浏览器”入口，可直接复制配对码或打开 Chrome 扩展管理页和 Finder 中的准确扩展目录；用户完成 Chrome 要求的“加载已解压的扩展程序”确认后，在已经登录的平台标签页粘贴配对码并连接当前页。
3. 扩展只共享当前题目的规范 URL、题号、可见题面和提交区状态，不共享 Cookie、密码或浏览历史。
4. 扩展建立 WebSocket 后先发送当前仍持有的页面会话清单；桌面端据此逐题标记实时连接状态，只把 `nssctf.submit_flag` 或 `nssctf.fetch_attachment` 发给声明持有该页面会话的扩展客户端。命令固定包含已绑定的页面会话和题号；提交命令额外包含有界候选 Flag，二者都不能携带任意脚本或 CSS selector。
5. 扩展再次检查 origin、路径、题号和登录状态，然后填写平台提交区。若开启提交区会消耗平台金币，工作台必须在按钮旁显示该成本；用户点击提交即是对这一次开启和提交的明确操作。
6. 只有页面出现可识别的 NSSCTF 成功或失败消息，Adapter 才返回 `accepted` 或 `rejected`。超时、DOM 漂移和无法确认的通知返回 `ambiguous/error`，不能把 Job 标成完成。
7. 每次平台响应先追加为 `ctf.judge_receipt` 事实；仅含明确 `correct=true/false` 的回执才能驱动外部 Evaluator 和 Outcome。
8. 公开题标记有附件时，建工作台前由已绑定页面请求 NSSCTF 的附件接口。附件未解锁时只返回提示，不点击开启题目或代替用户花金币；用户本人在平台确认后才能重试。
9. 附件限制为 4 MiB；扩展计算 SHA-256，Go bridge 解码后再次计算并核对题号、文件名、长度和摘要，随后才作为带 provenance 的 `MaterialRequest` 进入 Artifact Store。
10. 产品级回归必须从配对页开始，覆盖附件导入、归档预检与展开、Challenge Workspace、平台 Judge、脱敏训练报告，以及关闭并重新打开 Runtime 后恢复 Accepted 与回放；分层单元测试不能代替这条闭环。

## 信任边界

- bridge 只监听 `127.0.0.1`，HTTP ingest 使用随机 Bearer token，WebSocket 同时校验协议和 token；
- token 不以独立字段序列化到 Vue，前端只得到用户显式复制的封装配对码；持久化文件位于用户数据目录且权限固定为 `0600`；
- WebSocket 只接受 Chrome/Firefox 扩展 origin；
- WebSocket 的 `hello` 会话清单限制为 24 项并逐项校验格式；“扩展在线”和“当前题目标签在线”是两个不同状态，Judge 只认后者；
- 页面 URL 必须是无 query、无 fragment、无凭据的 NSSCTF canonical HTTPS 题目地址；
- 命令有唯一 ID、30/45 秒过期时间和有界输入输出，扩展缓存近期结果以避免同一命令重复执行；
- 附件下载地址必须使用 HTTPS；文件名不能含路径分隔符，WebSocket 和解码后的字节数都有独立上限；
- 多个候选、Rejected、无回执和连接错误都留在事件链中，模型不能声明平台成功。

## 用户流程

训练场保持题库与 Agent 工作台分层：

1. 用户从 NSSCTF Challenge Desk 的完整分页列表中搜索、筛选并选择题目；
2. MilkSU 读取公开题面并在右侧详情区展示；
3. 首次使用时，用户从 CTF 顶栏的统一“连接浏览器”菜单打开 Chrome 扩展页、选择 MilkSU 已定位的扩展目录并复制配对码；之后只需在 Chrome 打开同一题并连接当前标签页；扩展对空值或损坏配对码给出产品化错误，不泄漏 JSON 解码异常；
4. 用户选择协作模式并点击“用 Agent 开始”，模型与用户在 PI 工作台共同形成候选；
5. 用户点击提交，MilkSU 等待并展示 NSSCTF Judge 回执；
6. Accepted 才完成任务；Rejected 回到下一轮假设和实验；Ambiguous 保持待判断。

第一批真实入门题同时复用 `ctf.decode_text`：模型只能请求有界的 Base64（支持多层）、Hex、Binary、Morse 或 URL 解码，Go 返回确定性 Artifact 与 Observation。这个能力覆盖常见签到/编码训练，但不等同于 Shell、脚本执行器或完整 Crypto/Pwn 工具箱。

## 非目标与后续

这个 Adapter 不是通用网页自动化接口，也不执行 Shell、控制题目靶机或替代通用 Challenge Intake。MVP 后续仍需：

- 用真实登录会话验证 NSSCTF 返回的附件地址在同源与跨源签名 URL 两种情况下都能下载；
- 为附件增加更多格式与恶意样本回归，并实现真正的容器/VM 隔离；当前已有类型识别、ZIP/Tar/Gzip 归档预检、受限展开，以及 CTF PI 的 macOS Seatbelt 文件边界，但仍不是容器/VM；
- CTFshow 题面中的同源图片会替换为可见材料标记，并与普通附件共享 16 项/4 MiB 导入预算、SHA-256 校验和 Workspace 预检；跨源图片只留下明确警告，不静默扩张扩展权限。Challenge Desk 也允许用户显式选择本地截图、题面图片或手动下载的附件，单次最多 8 项、单项 4 MiB、合计 12 MiB，provenance 只记录基本文件名和 SHA-256，不保存原始磁盘路径；NSSCTF 题面内远程图片仍需后续自动 Intake；
- 为 Crypto/Web/Pwn/Reverse 增加受控 File、Shell、HTTP、Socket 和 Debugger 工具；
- 增加提交速率限制、金币预算和更明确的重复候选提示；
- 用真实 NSSCTF 登录会话完成一次原生桌面验收，并把 DOM 适配回归固定为可重复测试 fixture。
