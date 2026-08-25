# Loop 切片：按模型的编辑格式与失败降级

> 文档状态：**Target / Not implemented**
>
> 选定范围：Coding Agent 核心 Loop 的 `edit` 节点。不换 Sidecar 内核，不引入 Oh My Pi 整包。
>
> 缺什么：还没有按模型选择的补丁语法，也没有「Hashline/锚点失败 → `replace`」降级。Pi 0.84.1 的 `edit` 仍要求 `oldText` 精确匹配。

## 目标

减少「`oldText` 对不上 → 再 `read` → 再 `edit`」的空转。

- 继续走 Pi 原生 `edit` / `write`，不另写一套文件工具。
- 对已用夹具验证过的模型，允许锚点补丁（Hashline 或同等格式：补丁绑文件内容哈希，过期锚点拒绝写入）。
- 连续解析失败或锚点失败时，同一回合降回 Pi 的 `replace`（`oldText`/`newText`），不能卡死。
- `@oh-my-pi/hashline` 仅在 MIT、可审阅、能单独钉版本时作为补丁库候选；不够就写最小自有锚点层。不引入 OMP 的 31 工具表、Bun 内核或默认 20k prompt。
- 现有重复刹车（同命令 10 次、族 25 次、150 次询问）保留。

## 现状

机制上成立：Pi `edit` 指南写明 `edits[].oldText` 必须精确匹配。我们没有生产流量里的编辑失败率，但这条空转会表现为反复 `read`+`edit`，然后撞上重复刹车。本切片先用夹具量基线，再改。

## 测试方式

先在未改的 `main` 上跑同一套夹具拿基线，再在本分支重跑。

1. **补丁器单测（无模型）**  
   精确替换、多处不重叠编辑、读完后文件被改过（必须拒绝）、锚点格式损坏（必须失败并可降级）、空白/缩进差异。
2. **Sidecar Loop 夹具**  
   沿 `node scripts/test-coding-agent-delivery.mjs` 的假 Provider 路径，注入会失败的 `oldText` 与会成功的锚点补丁，断言降级和拒绝过期文件。
3. **真模型对照（需用户授权的计费链路，不写成未跑就完成）**  
   固定仓库、固定 20–50 处编辑（重命名、改函数体、两处并排、上一跳刚改过的文件）。对比：失败 `edit` 次数、第一次成功写入前的工具次数、输出 token、是否触发 10 次刹车。
4. **负向**  
   已知写不好锚点的模型必须在 N 次失败后回到 `replace`。CTF/CVE/实验室会话不得换一套编辑器。

## 验收标准

- [ ] 未改代码的基线数字写进本 PR 或 Evidence；没有基线不算完成。
- [ ] 假 Provider / 单测覆盖：过期哈希拒绝、坏补丁降级、短文件精确替换仍走 Pi `edit`。
- [ ] 真模型对照若已跑：失败 `edit` 次数或「成功写入前工具次数」相对基线有数量级或成倍下降；几个百分点不够。
- [ ] 真模型对照若未跑：PR 标明「夹具完成、计费链路待用户授权」，不得把夹具写成真实 Coding 完成。
- [ ] 10/25/150 重复刹车回归仍通过。
- [ ] 不把 Provider Key 写入工具参数、日志或补丁器测试夹具。
- [ ] 无新用户可见页面。工具行最多多一句失败原因，中英 `t()` 成对。

## 非目标

Oh My Pi 内核、默认工具表扩张、按用户句子选编辑格式、新的 MilkSU 文件 API。

## UI

无新面。可选工具行文案。

## 删除路径

关掉锚点格式后，行为回到当前 Pi `edit`。补丁库从 Sidecar 依赖拿掉即可。

## 基线实测（当前架构，未实现本切片）

机器：macOS darwin arm64，Node v26.0.0，Pi `@earendil-works/pi-coding-agent` 0.84.1。时间：2026-08-25T10:25:13Z。命令：`node --test sidecar/pi/loop-baseline-edit.test.js`（5 通过）。

构造的用例对 Pi 真实 `createEditTool().execute` 写临时 `sample.ts`：

```ts
export function greet(name: string) {
  return `hello ${name}`;
}
```

| 用例 | 做法 | 结果 |
| --- | --- | --- |
| exact-match | `oldText` 含两个空格缩进，与文件一致 | 成功，`Successfully replaced 1 block(s)`，约 1ms |
| whitespace-mismatch | 去掉行首空格，子串在文件中仍唯一 | **仍成功**。Pi 匹配的是唯一子串，不是整行。 |
| indent-tab-vs-spaces | `oldText` 用 tab，文件是空格 | 失败：`must match exactly including all whitespace and newlines`，文件未改 |
| two-edits-against-original | 两处都相对原始文件 | 成功（Pi 文档：多处 edit 都对原始内容匹配，不是增量） |
| oldText-not-in-file | `"hello world"` 不存在 | 失败，同一句 exact whitespace 错误 |
| file-changed-after-read | 文件已改成 `bonjour`，补丁仍用 `hello` | 失败，文件保持 `bonjour` |
| 重复失败 edit | 同一失败签名连续调用 | 第 **10** 次触发 `createToolRepeatGuard` 终止 |

**Summary：** 当前 Loop 的 `edit` 是精确子串替换，不是 Hashline，也不是 Codex `apply_patch`。缩进/空白不对或文件已变就会整次失败、文件不动；同一失败调用会在第 10 次被刹车。本切片要测的「空转」在实机上成立。没有锚点过期恢复，没有按模型降级。
