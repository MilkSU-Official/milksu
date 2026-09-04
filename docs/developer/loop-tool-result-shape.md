# Loop 切片：`read` / `bash` 回流形状

> 文档状态：**Fixture implemented / real-model pending**
>
> 选定范围：Coding Agent 核心 Loop 的 `tool_result` 节点。继续用 Pi 的截断 hook，不换摘要器内核。
>
> 夹具完成：过长 `bash`/`grep`/未自截断的 dump 改成头+尾，带路径/行号/16 位哈希。
> Pi `read` 已先 `truncateHead` 时只保留头并加上路径/哈希，不再把头的中间切掉。
> 真模型对照未跑，计费链路待用户授权。

## 目标

让过长的 `read` / `bash` / `grep` 回流变成下一跳用得上的结构，而不是「前 2000 行原文」。

- 短输出保持原文，禁止把短结果改成摘要。
- 过长结果：模型上下文里是带路径、行号、可选内容哈希的摘要或切片；全文仍按现有 overflow 文件 + `read` offset。
- 继续走 Pi `tool_result` 约 50KB / 2000 行边界，不自写第二套截断器。
- 不把完整命令、HTTP、文件正文倒进 `content`。

依赖：与「按模型的编辑格式」互补（锚点需要可读的行/哈希），但不阻塞对方合并。

## 现状

爆窗问题已经用截断 + overflow 治过。剩下的 Loop 问题是：截断后的头不一定是下一跳 `edit` 需要的位置，模型会再 `read` 同一文件或盲猜 `oldText`。

## 测试方式

先在 `main` 上对同一夹具量基线。

1. **单测**  
   短字符串不变形；刚好低于/高于 50KB 与 2000 行；UTF-8 截断不破码点；overflow 路径可 `read`+offset 续上。
2. **Sidecar 夹具**  
   大于阈值的源文件、长 `find`/`grep`/`bash` 各一次。记录进入下一轮模型的 tool_result token、offset 再读次数、同一 path 的重复 `read`。
3. **与编辑夹具联跑**  
   大文件上的成功编辑次数不得低于基线。若编辑格式切片已合并，用同一仓库跑。
4. **负向**  
   凭据、环境变量、Key 不得出现在摘要或 overflow 文件名提示之外的模型可见字段。CTF 题面 HTML/抓包仍不得整页进上下文。

## 验收标准

- [x] 短输出字节级等于工具原文（允许末尾换行规范化，不允许改写成摘要）。
- [x] 过长输出：模型可见长度不超过现行 Pi 边界；notice 指出 overflow 路径；`read`+offset 能读到被切掉的部分。
- [ ] 相对 `main` 基线：下一轮 input 中该 tool_result 的 token、同一文件重复 `read` 次数下降，且编辑成功率不下降。真模型对照待授权。
- [x] 无新用户可见页面。截断提示若改措辞，中英 `t()` 成对。
- [x] 不把完整 HTTP/命令/文件 dump 写进 `content`。

## 非目标

通用第二摘要器、默认打开 31 个工具、改 compact 算法（那是 rewind/handoff 切片）。

## UI

无新面。现有截断提示可改成「摘要 / 全文在某文件」。

## 删除路径

`tool_result` hook 退回只做现行 `truncateHead` + overflow。

## 基线实测（当前架构，未实现本切片）

机器：macOS darwin arm64，Node v26.0.0，Pi 0.84.1。时间：2026-08-25T10:25:13Z。命令：`node --test sidecar/pi/loop-baseline-tool-result.test.js`（1 通过）。另：`bridge-tool-result-bound.test.js` 等 Sidecar Loop 相关测试本机 46 通过。

构造：2500 行文本，每行 `line-{i}`，最后一行带 `-END`。经 `boundModelText`（Pi `truncateHead`）。

| 项 | 数值 |
| --- | ---: |
| Pi `DEFAULT_MAX_BYTES` | 51200 |
| Pi `DEFAULT_MAX_LINES` | 2000 |
| 输入 | 61389 B / 2500 行 |
| 模型可见 | 48889 B / **2000 行** |
| 保留头部 `line-0` | 是 |
| 保留尾部 `line-2499-END` | **否** |
| 策略 | `truncateHead` |

**Summary：** 过长回流只留头、丢掉尾。错误栈、命令结尾、文件末尾导出不会出现在下一跳。overflow 落盘 + `read` offset 仍在，但默认下一跳看不到尾。没有头+尾，没有行号/哈希摘要。本切片要改的形状在实机上就是 `truncateHead`。
